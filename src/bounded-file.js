import fs from 'node:fs';

function boundedFileError(code) {
  const error = new Error('Bounded file validation failed');
  error.code = code;
  return error;
}

function validateStat(stat, maxBytes) {
  if (stat?.isSymbolicLink?.() || !stat?.isFile?.()
    || !Number.isSafeInteger(stat.size) || stat.size < 0) {
    throw boundedFileError('BOUNDED_FILE_INVALID');
  }
  if (stat.size > maxBytes) throw boundedFileError('BOUNDED_FILE_TOO_LARGE');
}

function sameStat(left, right) {
  if (!left || !right) return false;
  for (const key of ['dev', 'ino']) {
    if (Number.isFinite(left[key]) && Number.isFinite(right[key]) && left[key] !== right[key]) return false;
  }
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function pathStat(file, fsImpl) {
  return typeof fsImpl.lstatSync === 'function' ? fsImpl.lstatSync(file) : fsImpl.statSync(file);
}

// The production path opens the already-inspected regular file without
// following a final symlink, verifies the descriptor identity, and reads no
// more than the declared bound. The readFileSync fallback exists only for the
// deliberately small injected filesystem seams used by unit tests.
export function readBoundedRegularFile(file, {
  fsImpl = fs,
  maxBytes,
  expectedStat = null,
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('maxBytes must be a non-negative safe integer');
  const inspected = expectedStat || pathStat(file, fsImpl);
  validateStat(inspected, maxBytes);

  const descriptorIo = ['openSync', 'fstatSync', 'readSync', 'closeSync']
    .every((name) => typeof fsImpl[name] === 'function');
  if (!descriptorIo) {
    const content = fsImpl.readFileSync(file, 'utf8');
    if (Buffer.byteLength(content, 'utf8') > maxBytes) throw boundedFileError('BOUNDED_FILE_TOO_LARGE');
    return { content, stat: inspected };
  }

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fsImpl.openSync(file, flags);
  } catch (error) {
    if (error?.code === 'ELOOP') throw boundedFileError('BOUNDED_FILE_INVALID');
    throw error;
  }
  try {
    const opened = fsImpl.fstatSync(descriptor);
    validateStat(opened, maxBytes);
    if (!sameStat(inspected, opened)) throw boundedFileError('BOUNDED_FILE_CHANGED');

    const buffer = Buffer.alloc(opened.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = fsImpl.readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
    const finished = fsImpl.fstatSync(descriptor);
    validateStat(finished, maxBytes);
    if (bytesRead !== opened.size || !sameStat(opened, finished)) {
      throw boundedFileError('BOUNDED_FILE_CHANGED');
    }
    return { content: buffer.subarray(0, bytesRead).toString('utf8'), stat: finished };
  } finally {
    try { fsImpl.closeSync(descriptor); } catch {}
  }
}

export function isBoundedFileError(error, ...codes) {
  return codes.includes(error?.code);
}
