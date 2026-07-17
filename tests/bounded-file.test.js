import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readBoundedRegularFile } from '../src/bounded-file.js';

function regularStat({ dev = 1, ino = 1, size = 1, mtimeMs = 1 } = {}) {
  return {
    dev, ino, size, mtimeMs,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
}

test('bounded reader uses the inspected descriptor identity and exact byte ceiling', () => {
  const expected = regularStat();
  let fstats = 0;
  let largestRead = 0;
  const fsImpl = {
    openSync: () => 7,
    fstatSync: () => (++fstats === 1 ? regularStat() : regularStat({ size: 2, mtimeMs: 2 })),
    readSync(_descriptor, buffer, offset, length) {
      largestRead = Math.max(largestRead, length);
      buffer.write('ab', offset);
      return 2;
    },
    closeSync() {},
  };
  assert.throws(
    () => readBoundedRegularFile('/private/raced', { fsImpl, maxBytes: 8, expectedStat: expected }),
    (error) => error.code === 'BOUNDED_FILE_CHANGED' && error.message === 'Bounded file validation failed',
  );
  assert.equal(largestRead, expected.size + 1, 'growth detection never requests more than inspected size plus one byte');
});

test('bounded reader rejects identity swaps before reading and final symlinks', () => {
  let reads = 0;
  const fsImpl = {
    openSync: () => 7,
    fstatSync: () => regularStat({ ino: 2 }),
    readSync() { reads++; return 0; },
    closeSync() {},
  };
  assert.throws(
    () => readBoundedRegularFile('/private/swapped', { fsImpl, maxBytes: 8, expectedStat: regularStat() }),
    (error) => error.code === 'BOUNDED_FILE_CHANGED',
  );
  assert.equal(reads, 0);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-bounded-link-'));
  try {
    const target = path.join(root, 'target');
    const link = path.join(root, 'link');
    fs.writeFileSync(target, 'private');
    fs.symlinkSync(target, link);
    assert.throws(
      () => readBoundedRegularFile(link, { maxBytes: 64 }),
      (error) => error.code === 'BOUNDED_FILE_INVALID',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bounded reader returns a normal regular file without retaining extra bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-bounded-read-'));
  try {
    const file = path.join(root, 'data');
    fs.writeFileSync(file, 'hello');
    const result = readBoundedRegularFile(file, { maxBytes: 5 });
    assert.equal(result.content, 'hello');
    assert.equal(result.stat.size, 5);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
