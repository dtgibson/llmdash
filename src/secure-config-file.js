import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class SecureConfigFileError extends Error {
  constructor(code, { committed = false, cause = null } = {}) {
    super('Protected file validation failed', cause ? { cause } : undefined);
    this.name = 'SecureConfigFileError';
    this.code = code;
    this.committed = committed;
  }
}

function secureError(code, options) {
  return new SecureConfigFileError(code, options);
}

const pinnedRoots = new Map();

function serviceUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function requireMethod(fsImpl, name) {
  if (typeof fsImpl?.[name] !== 'function') throw secureError('SECURE_FILE_UNSUPPORTED');
  return fsImpl[name].bind(fsImpl);
}

function mapMissingParent(error) {
  if (error?.code === 'ENOENT') throw secureError('SECURE_PARENT_MISSING');
  throw error;
}

function inspectLexicalRoot(root, fsImpl, uid) {
  const lstat = requireMethod(fsImpl, 'lstatSync');
  const parsed = path.parse(root);
  let current = parsed.root;
  let anchored = false;
  const pieces = root.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const piece of ['', ...pieces]) {
    if (piece) current = path.join(current, piece);
    let stat;
    try { stat = lstat(current); } catch (error) { mapMissingParent(error); }
    if (stat.isSymbolicLink?.()) {
      // System path aliases may precede the service-owned portion of a path
      // (notably /var on macOS). Once a service-owned safe directory anchors
      // the path, a link can redirect application data and is rejected. Before
      // that anchor, trust only a root-owned system alias; a user-owned link
      // beneath a shared directory such as /tmp is still attacker-controlled.
      if (anchored || stat.uid !== 0) throw secureError('SECURE_PARENT_INVALID');
      continue;
    }
    if (!stat.isDirectory?.()) throw secureError('SECURE_PARENT_INVALID');
    if (owned(stat, uid) && safeMode(stat)) anchored = true;
  }
}

function pinnedRoot(root, fsImpl, uid) {
  inspectLexicalRoot(root, fsImpl, uid);
  const realpath = requireMethod(fsImpl, 'realpathSync');
  let resolved;
  try { resolved = path.resolve(realpath(root)); } catch (error) { mapMissingParent(error); }
  const prior = pinnedRoots.get(root);
  if (prior && prior !== resolved) throw secureError('SECURE_PARENT_CHANGED');
  if (!prior) pinnedRoots.set(root, resolved);
  return prior || resolved;
}

function fixedPaths(file, root, fsImpl, uid) {
  if (typeof file !== 'string' || typeof root !== 'string' || file.includes('\0') || root.includes('\0')
    || !path.isAbsolute(file) || !path.isAbsolute(root)) {
    throw secureError('SECURE_PATH_INVALID');
  }
  const requestedRoot = path.resolve(root);
  const requestedFile = path.resolve(file);
  const relative = path.relative(requestedRoot, requestedFile);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw secureError('SECURE_PATH_INVALID');
  }
  const fixedRoot = pinnedRoot(requestedRoot, fsImpl, uid);
  const fixedFile = path.join(fixedRoot, relative);
  return { root: fixedRoot, file: fixedFile, relative };
}

function owned(stat, uid) {
  return uid === null || (Number.isInteger(stat?.uid) && stat.uid === uid);
}

function safeMode(stat) {
  return Number.isInteger(stat?.mode) && (stat.mode & 0o022) === 0;
}

function validateDirectory(stat, uid) {
  if (!stat || stat.isSymbolicLink?.() || !stat.isDirectory?.() || !owned(stat, uid) || !safeMode(stat)) {
    throw secureError('SECURE_PARENT_INVALID');
  }
}

function validateTarget(stat, uid, maxBytes = null, requireMode0600 = false) {
  if (!stat || stat.isSymbolicLink?.() || !stat.isFile?.() || stat.nlink !== 1
    || !owned(stat, uid) || !safeMode(stat)
    || !Number.isSafeInteger(stat.size) || stat.size < 0) {
    throw secureError('SECURE_TARGET_INVALID');
  }
  if (requireMode0600 && (stat.mode & 0o777) !== 0o600) {
    throw secureError('SECURE_TARGET_INVALID');
  }
  if (maxBytes !== null && stat.size > maxBytes) throw secureError('SECURE_TARGET_TOO_LARGE');
}

function identityPart(value) {
  return (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint';
}

function sameIdentity(left, right) {
  return !!left && !!right && identityPart(left.dev) && identityPart(left.ino)
    && left.dev === right.dev && left.ino === right.ino;
}

function sameVersion(left, right) {
  if (!sameIdentity(left, right) || left.size !== right.size) return false;
  for (const field of ['mtimeMs', 'ctimeMs']) {
    if (Number.isFinite(left[field]) && Number.isFinite(right[field]) && left[field] !== right[field]) return false;
  }
  return true;
}

function inspectParents(file, root, fsImpl, uid) {
  const fixed = fixedPaths(file, root, fsImpl, uid);
  const lstat = requireMethod(fsImpl, 'lstatSync');
  let current = fixed.root;
  let currentStat;
  try { currentStat = lstat(current); } catch (error) { mapMissingParent(error); }
  validateDirectory(currentStat, uid);
  const pieces = fixed.relative.split(path.sep);
  for (const piece of pieces.slice(0, -1)) {
    current = path.join(current, piece);
    try { currentStat = lstat(current); } catch (error) { mapMissingParent(error); }
    validateDirectory(currentStat, uid);
  }
  return { ...fixed, parent: path.dirname(fixed.file), parentStat: currentStat };
}

function lstatTarget(file, fsImpl) {
  return requireMethod(fsImpl, 'lstatSync')(file);
}

function noFollowFlag() {
  if (!Number.isInteger(fs.constants.O_NOFOLLOW) || fs.constants.O_NOFOLLOW === 0) {
    throw secureError('SECURE_FILE_UNSUPPORTED');
  }
  return fs.constants.O_NOFOLLOW;
}

/** Read one fixed, service-owned regular file without following links. */
export function readSecureRegularFile(file, { root, maxBytes, fsImpl = fs } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError('maxBytes must be a non-negative safe integer');
  }
  const uid = serviceUid();
  const fixed = inspectParents(file, root, fsImpl, uid);
  let inspected;
  try { inspected = lstatTarget(fixed.file, fsImpl); }
  catch (error) {
    if (error?.code === 'ENOENT') throw secureError('SECURE_TARGET_MISSING');
    throw error;
  }
  validateTarget(inspected, uid, maxBytes);

  const open = requireMethod(fsImpl, 'openSync');
  const fstat = requireMethod(fsImpl, 'fstatSync');
  const read = requireMethod(fsImpl, 'readSync');
  const close = requireMethod(fsImpl, 'closeSync');
  let descriptor;
  try {
    descriptor = open(fixed.file, fs.constants.O_RDONLY | noFollowFlag());
  } catch (error) {
    if (error?.code === 'ELOOP') throw secureError('SECURE_TARGET_INVALID');
    throw error;
  }
  try {
    const opened = fstat(descriptor);
    validateTarget(opened, uid, maxBytes);
    if (!sameIdentity(inspected, opened)) throw secureError('SECURE_TARGET_CHANGED');
    const openedParents = inspectParents(fixed.file, fixed.root, fsImpl, uid);
    if (!sameIdentity(fixed.parentStat, openedParents.parentStat)) {
      throw secureError('SECURE_PARENT_CHANGED');
    }

    const buffer = Buffer.alloc(opened.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = read(descriptor, buffer, bytesRead, buffer.length - bytesRead, null);
      if (!Number.isInteger(count) || count < 0 || count > buffer.length - bytesRead) {
        throw secureError('SECURE_TARGET_CHANGED');
      }
      if (count === 0) break;
      bytesRead += count;
    }
    const finished = fstat(descriptor);
    validateTarget(finished, uid, maxBytes);
    if (bytesRead !== opened.size || !sameVersion(opened, finished)) {
      throw secureError('SECURE_TARGET_CHANGED');
    }
    const finishedParents = inspectParents(fixed.file, fixed.root, fsImpl, uid);
    if (!sameIdentity(fixed.parentStat, finishedParents.parentStat)) {
      throw secureError('SECURE_PARENT_CHANGED');
    }
    return { buffer: Buffer.from(buffer.subarray(0, bytesRead)), stat: finished };
  } finally {
    try { close(descriptor); } catch {}
  }
}

function targetOrMissing(file, fsImpl, uid) {
  try {
    const stat = lstatTarget(file, fsImpl);
    validateTarget(stat, uid);
    return stat;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function randomToken(randomBytesImpl) {
  const bytes = randomBytesImpl(16);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16) {
    throw secureError('SECURE_RANDOM_INVALID');
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');
}

/** Atomically replace one fixed file with a mode-0600 byte snapshot. */
export function atomicWriteSecureFile(file, buffer, {
  root,
  fsImpl = fs,
  randomBytesImpl = crypto.randomBytes,
  expectedTarget = undefined,
} = {}) {
  if (!(buffer instanceof Uint8Array)) throw new TypeError('buffer must be a Buffer or Uint8Array');
  if (typeof randomBytesImpl !== 'function') throw new TypeError('randomBytesImpl must be a function');
  const bytes = Buffer.from(buffer);
  const uid = serviceUid();
  const fixed = inspectParents(file, root, fsImpl, uid);
  validateDirectory(fixed.parentStat, uid);
  const observedTarget = targetOrMissing(fixed.file, fsImpl, uid);
  const expected = expectedTarget === undefined ? observedTarget : expectedTarget;
  if (expected !== null && (typeof expected !== 'object' || !identityPart(expected.dev)
    || !identityPart(expected.ino) || !Number.isSafeInteger(expected.size) || expected.size < 0)) {
    throw secureError('SECURE_EXPECTATION_INVALID');
  }
  if ((expected === null) !== (observedTarget === null)
    || (expected && !sameVersion(expected, observedTarget))) {
    throw secureError('SECURE_TARGET_CHANGED');
  }

  const open = requireMethod(fsImpl, 'openSync');
  const fstat = requireMethod(fsImpl, 'fstatSync');
  const close = requireMethod(fsImpl, 'closeSync');
  const write = requireMethod(fsImpl, 'writeSync');
  const fchmod = requireMethod(fsImpl, 'fchmodSync');
  const rename = requireMethod(fsImpl, 'renameSync');
  const unlink = requireMethod(fsImpl, 'unlinkSync');
  const fsync = requireMethod(fsImpl, 'fsyncSync');
  const dataSync = typeof fsImpl.fdatasyncSync === 'function'
    ? fsImpl.fdatasyncSync.bind(fsImpl) : fsync;

  const directoryFlags = fs.constants.O_RDONLY | noFollowFlag()
    | (Number.isInteger(fs.constants.O_DIRECTORY) ? fs.constants.O_DIRECTORY : 0);
  let directoryDescriptor;
  let tempDescriptor;
  let tempFile = null;
  let renamed = false;
  let renameReconciled = false;
  let writtenStat = null;
  try {
    directoryDescriptor = open(fixed.parent, directoryFlags);
    const openedParent = fstat(directoryDescriptor);
    validateDirectory(openedParent, uid);
    if (!sameIdentity(fixed.parentStat, openedParent)) throw secureError('SECURE_PARENT_CHANGED');

    const createFlags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollowFlag();
    for (let attempt = 0; attempt < 8; attempt++) {
      tempFile = path.join(fixed.parent,
        `.${path.basename(fixed.file)}.tmp-${process.pid}-${randomToken(randomBytesImpl)}-${attempt}`);
      try {
        tempDescriptor = open(tempFile, createFlags, 0o600);
        break;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        tempFile = null;
      }
    }
    if (tempDescriptor === undefined) throw secureError('SECURE_TEMP_COLLISION');

    let written = 0;
    while (written < bytes.length) {
      const count = write(tempDescriptor, bytes, written, bytes.length - written, null);
      if (!Number.isInteger(count) || count <= 0 || count > bytes.length - written) {
        throw secureError('SECURE_WRITE_INCOMPLETE');
      }
      written += count;
    }
    fchmod(tempDescriptor, 0o600);
    dataSync(tempDescriptor);
    writtenStat = fstat(tempDescriptor);
    validateTarget(writtenStat, uid, bytes.length, true);
    if (writtenStat.size !== bytes.length) throw secureError('SECURE_WRITE_INCOMPLETE');
    close(tempDescriptor);
    tempDescriptor = undefined;

    const checkedAgain = inspectParents(fixed.file, fixed.root, fsImpl, uid);
    validateDirectory(checkedAgain.parentStat, uid);
    if (!sameIdentity(fixed.parentStat, checkedAgain.parentStat)
      || !sameIdentity(openedParent, checkedAgain.parentStat)) {
      throw secureError('SECURE_PARENT_CHANGED');
    }
    const currentTarget = targetOrMissing(fixed.file, fsImpl, uid);
    if ((expected === null) !== (currentTarget === null)
      || (expected && !sameVersion(expected, currentTarget))) {
      throw secureError('SECURE_TARGET_CHANGED');
    }
    if (expected?.digest) {
      let verified;
      try {
        verified = readSecureRegularFile(fixed.file, {
          root: fixed.root,
          maxBytes: expected.size,
          fsImpl,
        });
      } catch {
        throw secureError('SECURE_TARGET_CHANGED');
      }
      const digest = crypto.createHash('sha256').update(verified.buffer).digest('hex');
      if (!sameVersion(expected, verified.stat) || digest !== expected.digest) {
        throw secureError('SECURE_TARGET_CHANGED');
      }
    }

    try {
      rename(tempFile, fixed.file);
      renamed = true;
    } catch (error) {
      // A filesystem can leave the outcome of a reported rename error
      // ambiguous. Prove the ordinary pre-commit case only when both the
      // expected target and our descriptor-verified temp inode are still at
      // their original paths. If the candidate landed (or either pathname
      // cannot be proved), force the caller through post-commit reconciliation
      // instead of reporting a normal failed save after bytes may have changed.
      let targetAfter = null;
      let tempAfter = null;
      let inspectionFailed = false;
      try { targetAfter = targetOrMissing(fixed.file, fsImpl, uid); }
      catch { inspectionFailed = true; }
      try { tempAfter = targetOrMissing(tempFile, fsImpl, uid); }
      catch { inspectionFailed = true; }

      const candidateLanded = !inspectionFailed && targetAfter
        && sameIdentity(writtenStat, targetAfter);
      if (candidateLanded) {
        renamed = true;
        renameReconciled = true;
      }
      const targetUnchanged = !inspectionFailed
        && ((expected === null && targetAfter === null)
          || (expected && sameVersion(expected, targetAfter)));
      const tempUnchanged = !inspectionFailed && tempAfter
        && sameIdentity(writtenStat, tempAfter);
      if (!candidateLanded) {
        if (targetUnchanged && tempUnchanged) throw error;
        throw secureError('SECURE_COMMIT_INDETERMINATE', {
          committed: false,
          cause: error,
        });
      }
    }
    let directorySyncError = null;
    try { fsync(directoryDescriptor); } catch (error) { directorySyncError = error; }
    let finalStat;
    try {
      finalStat = lstatTarget(fixed.file, fsImpl);
      validateTarget(finalStat, uid, bytes.length, true);
      if (finalStat.size !== bytes.length || !sameIdentity(writtenStat, finalStat)) {
        throw secureError('SECURE_TARGET_CHANGED');
      }
    } catch (error) {
      // Rename already committed. Callers must reconcile the descriptor-read
      // target instead of reporting an ordinary failed save with changed bytes.
      throw secureError('SECURE_COMMIT_INDETERMINATE', { committed: true, cause: error });
    }
    return {
      stat: finalStat,
      committed: true,
      renameReconciled,
      directorySynced: directorySyncError === null,
      warningCode: directorySyncError ? 'SECURE_DIRECTORY_SYNC_FAILED' : null,
    };
  } finally {
    if (tempDescriptor !== undefined) {
      try { close(tempDescriptor); } catch {}
    }
    if (!renamed && tempFile) {
      try { unlink(tempFile); } catch {}
    }
    if (directoryDescriptor !== undefined) {
      try { close(directoryDescriptor); } catch {}
    }
  }
}
