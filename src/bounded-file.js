import fs from 'node:fs';

const MAX_OVERSIZED_PREFIX_BYTES = 64 * 1024;
const oversizedLineMarkers = new WeakSet();

function oversizedLineMarker(prefix) {
  const marker = Object.freeze({ prefix });
  oversizedLineMarkers.add(marker);
  return marker;
}

// Returns a bounded prefix only for markers created by this reader. A normal
// parsed event cannot spoof the signal, and no oversized content reaches a
// result/cache object.
export function boundedFileOversizedLinePrefix(value) {
  return value && typeof value === 'object' && oversizedLineMarkers.has(value)
    ? value.prefix : null;
}

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

// Descriptor-validated JSONL reader. Unlike readBoundedRegularFile(), this
// keeps peak allocation bounded by one line plus a small I/O chunk, so a large
// but valid rollout does not require a same-sized Buffer and UTF-8 string at
// once. Oversized lines are yielded as an explicit content-free marker after
// being drained; reducers can classify the omission without retaining content.
export function readBoundedRegularFileLines(file, {
  fsImpl = fs,
  maxBytes,
  maxLineBytes,
  expectedStat = null,
  chunkBytes = 64 * 1024,
  check = null,
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('maxBytes must be a non-negative safe integer');
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1) throw new TypeError('maxLineBytes must be a positive safe integer');
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 1024 * 1024) {
    throw new TypeError('chunkBytes must be between 1 byte and 1 MiB');
  }
  if (check !== null && typeof check !== 'function') throw new TypeError('check must be a function or null');
  const inspected = expectedStat || pathStat(file, fsImpl);
  validateStat(inspected, maxBytes);

  const descriptorIo = ['openSync', 'fstatSync', 'readSync', 'closeSync']
    .every((name) => typeof fsImpl[name] === 'function');
  if (!descriptorIo) {
    const { content } = readBoundedRegularFile(file, { fsImpl, maxBytes, expectedStat: inspected });
    return {
      lines: (function *fallbackLines() {
        let cursor = 0;
        while (cursor <= content.length) {
          const end = content.indexOf('\n', cursor);
          const lineEnd = end < 0 ? content.length : end;
          if (lineEnd > cursor) {
            const line = content.slice(cursor, lineEnd);
            yield Buffer.byteLength(line, 'utf8') <= maxLineBytes
              ? line
              : oversizedLineMarker(Buffer.from(line, 'utf8')
                  .subarray(0, MAX_OVERSIZED_PREFIX_BYTES).toString('utf8'));
          }
          if (end < 0) break;
          cursor = end + 1;
        }
      }()),
      stat: inspected,
    };
  }

  return {
    lines: (function *descriptorLines() {
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

        // Read at most the opened snapshot plus one byte. The extra byte detects
        // concurrent growth without allowing an unterminated append stream to
        // run past either the inspected snapshot or the hard byte ceiling.
        const readCeiling = Math.min(maxBytes, opened.size) + 1;
        const chunk = Buffer.alloc(Math.min(chunkBytes, Math.max(1, readCeiling)));
        let fragments = [];
        let fragmentBytes = 0;
        let prefixFragments = [];
        let prefixBytes = 0;
        let droppingOversizedLine = false;
        let bytesRead = 0;
        let stoppedError = null;
        const retainPrefix = (part) => {
          if (!part.length || prefixBytes >= MAX_OVERSIZED_PREFIX_BYTES) return;
          const retained = part.subarray(0, MAX_OVERSIZED_PREFIX_BYTES - prefixBytes);
          prefixFragments.push(Buffer.from(retained));
          prefixBytes += retained.length;
        };
        const oversizedMarker = () => oversizedLineMarker(
          Buffer.concat(prefixFragments, prefixBytes).toString('utf8'),
        );
        while (bytesRead < readCeiling) {
          try { check?.(); } catch (error) { stoppedError = error; break; }
          const count = fsImpl.readSync(descriptor, chunk, 0,
            Math.min(chunk.length, readCeiling - bytesRead), null);
          if (count === 0) break;
          bytesRead += count;
          if (bytesRead > opened.size) break;
          let start = 0;
          for (let index = 0; index < count; index++) {
            if (chunk[index] !== 0x0a) continue;
            const part = chunk.subarray(start, index);
            retainPrefix(part);
            if (!droppingOversizedLine) {
              if (fragmentBytes + part.length > maxLineBytes) {
                fragments = [];
                fragmentBytes = 0;
                droppingOversizedLine = true;
              } else if (part.length) {
                fragments.push(Buffer.from(part));
                fragmentBytes += part.length;
              }
            }
            if (droppingOversizedLine) yield oversizedMarker();
            else if (fragmentBytes) yield Buffer.concat(fragments, fragmentBytes).toString('utf8');
            fragments = [];
            fragmentBytes = 0;
            prefixFragments = [];
            prefixBytes = 0;
            droppingOversizedLine = false;
            start = index + 1;
          }
          const tail = chunk.subarray(start, count);
          retainPrefix(tail);
          if (!droppingOversizedLine && tail.length) {
            if (fragmentBytes + tail.length > maxLineBytes) {
              fragments = [];
              fragmentBytes = 0;
              droppingOversizedLine = true;
            } else {
              fragments.push(Buffer.from(tail));
              fragmentBytes += tail.length;
            }
          }
        }
        const finished = fsImpl.fstatSync(descriptor);
        validateStat(finished, maxBytes);
        if (!sameStat(opened, finished) || bytesRead > opened.size) {
          throw boundedFileError('BOUNDED_FILE_CHANGED');
        }
        if (stoppedError) throw stoppedError;
        if (bytesRead !== opened.size) throw boundedFileError('BOUNDED_FILE_CHANGED');

        if (droppingOversizedLine) yield oversizedMarker();
        else if (fragmentBytes) yield Buffer.concat(fragments, fragmentBytes).toString('utf8');
      } finally {
        try { fsImpl.closeSync(descriptor); } catch {}
      }
    }()),
    stat: inspected,
  };
}

export function isBoundedFileError(error, ...codes) {
  return codes.includes(error?.code);
}
