import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  atomicWriteSecureFile, readSecureRegularFile, SecureConfigFileError,
} from '../src/secure-config-file.js';

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-secure-file-'));
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function proxyFs(overrides = {}) {
  return new Proxy(fs, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

test('secure reader returns bounded bytes from one owned regular file', () => {
  const root = sandbox();
  try {
    const file = path.join(root, 'account-config.json');
    fs.writeFileSync(file, 'private', { mode: 0o600 });
    const result = readSecureRegularFile(file, { root, maxBytes: 7 });
    assert.equal(result.buffer.toString('utf8'), 'private');
    assert.ok(result.stat.isFile());
    assert.throws(
      () => readSecureRegularFile(file, { root, maxBytes: 6 }),
      (error) => error.code === 'SECURE_TARGET_TOO_LARGE',
    );
    assert.throws(
      () => readSecureRegularFile(path.join(root, '..', path.basename(root), '..', 'outside'), { root, maxBytes: 8 }),
      (error) => error.code === 'SECURE_PATH_INVALID',
    );
  } finally { cleanup(root); }
});

test('secure reader rejects symlink parents/finals, non-files, hard links, and writable targets', () => {
  const root = sandbox();
  const outside = sandbox();
  try {
    const target = path.join(root, 'target.json');
    fs.writeFileSync(target, '{}', { mode: 0o600 });

    const finalLink = path.join(root, 'final-link.json');
    fs.symlinkSync(target, finalLink);
    assert.throws(() => readSecureRegularFile(finalLink, { root, maxBytes: 8 }),
      (error) => error.code === 'SECURE_TARGET_INVALID');

    const outsideFile = path.join(outside, 'outside.json');
    fs.writeFileSync(outsideFile, '{}', { mode: 0o600 });
    const parentLink = path.join(root, 'linked-parent');
    fs.symlinkSync(outside, parentLink);
    assert.throws(() => readSecureRegularFile(path.join(parentLink, 'outside.json'), { root, maxBytes: 8 }),
      (error) => error.code === 'SECURE_PARENT_INVALID');

    assert.throws(() => readSecureRegularFile(root, { root, maxBytes: 8 }),
      (error) => error.code === 'SECURE_PATH_INVALID');
    const directory = path.join(root, 'directory.json');
    fs.mkdirSync(directory);
    assert.throws(() => readSecureRegularFile(directory, { root, maxBytes: 8 }),
      (error) => error.code === 'SECURE_TARGET_INVALID');

    const hardLink = path.join(root, 'hard.json');
    fs.linkSync(target, hardLink);
    assert.throws(() => readSecureRegularFile(target, { root, maxBytes: 8 }),
      (error) => error.code === 'SECURE_TARGET_INVALID');
    fs.unlinkSync(hardLink);

    fs.chmodSync(target, 0o620);
    assert.throws(() => readSecureRegularFile(target, { root, maxBytes: 8 }),
      (error) => error.code === 'SECURE_TARGET_INVALID');
  } finally { cleanup(root); cleanup(outside); }
});

test('secure reader fails closed on wrong ownership and descriptor identity swaps', () => {
  const root = sandbox();
  try {
    const file = path.join(root, 'account-config.json');
    fs.writeFileSync(file, '{}', { mode: 0o600 });
    const canonicalFile = fs.realpathSync(file);
    const actual = fs.lstatSync(file);
    const wrongOwner = proxyFs({
      lstatSync(candidate) {
        const stat = fs.lstatSync(candidate);
        if (candidate !== canonicalFile) return stat;
        return new Proxy(stat, { get(target, key) { return key === 'uid' ? actual.uid + 1 : target[key]; } });
      },
    });
    assert.throws(() => readSecureRegularFile(file, { root, maxBytes: 8, fsImpl: wrongOwner }),
      (error) => error.code === 'SECURE_TARGET_INVALID');

    const swapped = proxyFs({
      fstatSync(descriptor) {
        const stat = fs.fstatSync(descriptor);
        return new Proxy(stat, { get(target, key) { return key === 'ino' ? target.ino + 1 : target[key]; } });
      },
    });
    assert.throws(() => readSecureRegularFile(file, { root, maxBytes: 8, fsImpl: swapped }),
      (error) => error.code === 'SECURE_TARGET_CHANGED');
  } finally { cleanup(root); }
});

test('atomic writer performs partial-write loops, mode 0600, data sync, rename, and directory sync', () => {
  const root = sandbox();
  try {
    const file = path.join(root, 'account-config.json');
    fs.writeFileSync(file, 'old', { mode: 0o600 });
    let writeCalls = 0;
    let dataSyncs = 0;
    let directorySyncs = 0;
    const fsImpl = proxyFs({
      writeSync(descriptor, buffer, offset, length, position) {
        writeCalls++;
        return fs.writeSync(descriptor, buffer, offset, Math.min(2, length), position);
      },
      fdatasyncSync(descriptor) { dataSyncs++; return fs.fdatasyncSync(descriptor); },
      fsyncSync(descriptor) { directorySyncs++; return fs.fsyncSync(descriptor); },
    });
    const body = Buffer.from('{"schemaVersion":1}');
    const result = atomicWriteSecureFile(file, body, {
      root, fsImpl, randomBytesImpl: () => Buffer.alloc(16, 7),
    });
    assert.equal(fs.readFileSync(file, 'utf8'), body.toString('utf8'));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(result.stat.mode & 0o777, 0o600);
    assert.ok(writeCalls > 1, 'short writes are completed in a loop');
    assert.equal(dataSyncs, 1);
    assert.equal(directorySyncs, 1);
    assert.deepEqual(fs.readdirSync(root), ['account-config.json']);
  } finally { cleanup(root); }
});

test('atomic writer supports first creation and cleans temporary files after pre-rename faults', () => {
  const root = sandbox();
  try {
    const file = path.join(root, 'account-config.json');
    atomicWriteSecureFile(file, Buffer.from('first'), {
      root, randomBytesImpl: () => Buffer.alloc(16, 1),
    });
    assert.equal(fs.readFileSync(file, 'utf8'), 'first');

    const failing = proxyFs({ renameSync() { const error = new Error('rename failed'); error.code = 'EIO'; throw error; } });
    assert.throws(() => atomicWriteSecureFile(file, Buffer.from('second'), {
      root, fsImpl: failing, randomBytesImpl: () => Buffer.alloc(16, 2),
    }), /rename failed/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'first');
    assert.deepEqual(fs.readdirSync(root), ['account-config.json']);
  } finally { cleanup(root); }
});

test('a directory-fsync failure is reconciled as a committed current target', () => {
  const root = sandbox();
  try {
    const file = path.join(root, 'account-config.json');
    fs.writeFileSync(file, 'old', { mode: 0o600 });
    const failing = proxyFs({
      fsyncSync() { const error = new Error('directory sync failed'); error.code = 'EIO'; throw error; },
    });
    const result = atomicWriteSecureFile(file, Buffer.from('new'), {
      root, fsImpl: failing, randomBytesImpl: () => Buffer.alloc(16, 3),
    });
    assert.equal(result.committed, true);
    assert.equal(result.directorySynced, false);
    assert.equal(result.warningCode, 'SECURE_DIRECTORY_SYNC_FAILED');
    assert.equal(fs.readFileSync(file, 'utf8'), 'new');
    assert.deepEqual(fs.readdirSync(root), ['account-config.json']);
  } finally { cleanup(root); }
});

test('secure access rejects a service-owned symlink above the configured root', () => {
  const base = sandbox();
  const outside = sandbox();
  try {
    const outsideRoot = path.join(outside, 'data');
    fs.mkdirSync(outsideRoot, { mode: 0o700 });
    const outsideFile = path.join(outsideRoot, 'account-config.json');
    fs.writeFileSync(outsideFile, 'outside', { mode: 0o600 });
    const link = path.join(base, 'redirect');
    fs.symlinkSync(outside, link);
    const redirectedRoot = path.join(link, 'data');
    const redirectedFile = path.join(redirectedRoot, 'account-config.json');

    assert.throws(
      () => readSecureRegularFile(redirectedFile, { root: redirectedRoot, maxBytes: 32 }),
      (error) => error.code === 'SECURE_PARENT_INVALID',
    );
    assert.throws(
      () => atomicWriteSecureFile(redirectedFile, Buffer.from('changed'), { root: redirectedRoot }),
      (error) => error.code === 'SECURE_PARENT_INVALID',
    );
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside');
  } finally { cleanup(base); cleanup(outside); }
});

test('secure access rejects a user-owned symlink directly beneath a shared ancestor', () => {
  const outside = sandbox();
  const link = path.join(os.tmpdir(), `llmdash-secure-link-${process.pid}-${Date.now()}`);
  try {
    const outsideRoot = path.join(outside, 'data');
    fs.mkdirSync(outsideRoot, { mode: 0o700 });
    const outsideFile = path.join(outsideRoot, 'account-config.json');
    fs.writeFileSync(outsideFile, 'outside', { mode: 0o600 });
    fs.symlinkSync(outside, link);
    const redirectedRoot = path.join(link, 'data');
    const redirectedFile = path.join(redirectedRoot, 'account-config.json');

    assert.throws(
      () => readSecureRegularFile(redirectedFile, { root: redirectedRoot, maxBytes: 32 }),
      (error) => error.code === 'SECURE_PARENT_INVALID',
    );
    assert.throws(
      () => atomicWriteSecureFile(redirectedFile, Buffer.from('changed'), { root: redirectedRoot }),
      (error) => error.code === 'SECURE_PARENT_INVALID',
    );
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside');
  } finally {
    try { fs.unlinkSync(link); } catch {}
    cleanup(outside);
  }
});

test('secure reader distinguishes a missing target from a missing parent', () => {
  const root = sandbox();
  try {
    assert.throws(
      () => readSecureRegularFile(path.join(root, 'missing.json'), { root, maxBytes: 32 }),
      (error) => error.code === 'SECURE_TARGET_MISSING',
    );
    const missingRoot = path.join(root, 'missing-parent');
    assert.throws(
      () => readSecureRegularFile(path.join(missingRoot, 'missing.json'), { root: missingRoot, maxBytes: 32 }),
      (error) => error.code === 'SECURE_PARENT_MISSING',
    );
  } finally { cleanup(root); }
});

test('atomic writer rejects unsafe existing targets before creating a temp file', () => {
  const root = sandbox();
  try {
    const file = path.join(root, 'account-config.json');
    fs.writeFileSync(file, 'old', { mode: 0o600 });
    fs.chmodSync(file, 0o622);
    assert.throws(() => atomicWriteSecureFile(file, Buffer.from('new'), { root }),
      (error) => error instanceof SecureConfigFileError && error.code === 'SECURE_TARGET_INVALID');
    assert.deepEqual(fs.readdirSync(root), ['account-config.json']);
  } finally { cleanup(root); }
});
