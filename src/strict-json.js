const JSON_WHITESPACE = new Set([' ', '\t', '\n', '\r']);
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

export class StrictJsonError extends SyntaxError {
  constructor(code, offset = 0) {
    super('Strict JSON validation failed');
    this.name = 'StrictJsonError';
    this.code = code;
    this.offset = offset;
  }
}

function strictError(code, offset) {
  return new StrictJsonError(code, offset);
}

function decodeUtf8(input) {
  if (!(input instanceof Uint8Array)) throw new TypeError('input must be a Buffer or Uint8Array');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw strictError('STRICT_JSON_INVALID_UTF8', 0);
  }
}

/**
 * Parse one UTF-8 JSON value without dependencies.
 *
 * Unlike JSON.parse, this parser rejects duplicate decoded object keys. The
 * root array/object occupies depth 1; each nested array/object adds one.
 */
export function parseStrictJson(input, { maxDepth = 8 } = {}) {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) {
    throw new TypeError('maxDepth must be a positive safe integer');
  }
  const source = decodeUtf8(input);
  let offset = 0;

  const whitespace = () => {
    while (offset < source.length && JSON_WHITESPACE.has(source[offset])) offset++;
  };

  const string = () => {
    const start = offset;
    if (source[offset] !== '"') throw strictError('STRICT_JSON_INVALID', offset);
    offset++;
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      if (code < 0x20) throw strictError('STRICT_JSON_INVALID', offset);
      if (source[offset] === '"') {
        offset++;
        try { return JSON.parse(source.slice(start, offset)); }
        catch { throw strictError('STRICT_JSON_INVALID', start); }
      }
      if (source[offset] === '\\') {
        offset++;
        if (offset >= source.length) throw strictError('STRICT_JSON_INVALID', offset);
        const escaped = source[offset];
        if (escaped === 'u') {
          const hex = source.slice(offset + 1, offset + 5);
          if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw strictError('STRICT_JSON_INVALID', offset);
          }
          offset += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escaped)) throw strictError('STRICT_JSON_INVALID', offset);
      }
      offset++;
    }
    throw strictError('STRICT_JSON_INVALID', start);
  };

  const value = (depth) => {
    whitespace();
    if (offset >= source.length) throw strictError('STRICT_JSON_INVALID', offset);
    const current = source[offset];

    if (current === '{') {
      if (depth > maxDepth) throw strictError('STRICT_JSON_TOO_DEEP', offset);
      offset++;
      whitespace();
      const result = {};
      const keys = new Set();
      if (source[offset] === '}') { offset++; return result; }
      for (;;) {
        whitespace();
        const keyOffset = offset;
        const key = string();
        if (keys.has(key)) throw strictError('STRICT_JSON_DUPLICATE_KEY', keyOffset);
        keys.add(key);
        whitespace();
        if (source[offset] !== ':') throw strictError('STRICT_JSON_INVALID', offset);
        offset++;
        const item = value(depth + 1);
        // Define rather than assign so a __proto__ key remains ordinary data.
        Object.defineProperty(result, key, {
          value: item, enumerable: true, configurable: true, writable: true,
        });
        whitespace();
        if (source[offset] === '}') { offset++; return result; }
        if (source[offset] !== ',') throw strictError('STRICT_JSON_INVALID', offset);
        offset++;
      }
    }

    if (current === '[') {
      if (depth > maxDepth) throw strictError('STRICT_JSON_TOO_DEEP', offset);
      offset++;
      whitespace();
      const result = [];
      if (source[offset] === ']') { offset++; return result; }
      for (;;) {
        result.push(value(depth + 1));
        whitespace();
        if (source[offset] === ']') { offset++; return result; }
        if (source[offset] !== ',') throw strictError('STRICT_JSON_INVALID', offset);
        offset++;
      }
    }

    if (current === '"') return string();
    for (const [token, parsed] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(token, offset)) { offset += token.length; return parsed; }
    }

    NUMBER.lastIndex = offset;
    const match = NUMBER.exec(source);
    if (!match) throw strictError('STRICT_JSON_INVALID', offset);
    offset = NUMBER.lastIndex;
    const parsed = Number(match[0]);
    if (!Number.isFinite(parsed)) throw strictError('STRICT_JSON_INVALID_NUMBER', offset);
    return parsed;
  };

  whitespace();
  const result = value(1);
  whitespace();
  if (offset !== source.length) throw strictError('STRICT_JSON_TRAILING_DATA', offset);
  return result;
}
