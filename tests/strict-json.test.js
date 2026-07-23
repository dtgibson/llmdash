import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictJson, StrictJsonError } from '../src/strict-json.js';

const bytes = (value) => Buffer.from(value, 'utf8');

test('strict parser accepts one complete JSON value and preserves dangerous keys as data', () => {
  const parsed = parseStrictJson(bytes(' \n {"ok":[true,false,null,-1.25e2],"__proto__":{"safe":1}} \r'));
  assert.deepEqual(parsed.ok, [true, false, null, -125]);
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(parsed, '__proto__').value, { safe: 1 });
  assert.equal({}.safe, undefined);
});

test('duplicate decoded keys are rejected at every nesting depth', () => {
  for (const source of [
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"outer":{"x":1,"x":2}}',
    '[{"x":1,"x":2}]',
  ]) {
    assert.throws(
      () => parseStrictJson(bytes(source)),
      (error) => error instanceof StrictJsonError && error.code === 'STRICT_JSON_DUPLICATE_KEY',
      source,
    );
  }
});

test('UTF-8 decoding is fatal', () => {
  const invalid = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]);
  assert.throws(
    () => parseStrictJson(invalid),
    (error) => error.code === 'STRICT_JSON_INVALID_UTF8',
  );
  assert.throws(() => parseStrictJson('{"x":1}'), TypeError);
});

test('depth is bounded with the root container at depth one', () => {
  assert.deepEqual(parseStrictJson(bytes('{"a":{"b":1}}'), { maxDepth: 2 }), { a: { b: 1 } });
  assert.throws(
    () => parseStrictJson(bytes('{"a":{"b":1}}'), { maxDepth: 1 }),
    (error) => error.code === 'STRICT_JSON_TOO_DEEP',
  );
  assert.throws(
    () => parseStrictJson(bytes('[[[]]]'), { maxDepth: 2 }),
    (error) => error.code === 'STRICT_JSON_TOO_DEEP',
  );
});

test('trailing values, malformed grammar, and non-finite numbers are rejected', () => {
  assert.throws(
    () => parseStrictJson(bytes('{"x":1} {"y":2}')),
    (error) => error.code === 'STRICT_JSON_TRAILING_DATA',
  );
  for (const source of ['[1,]', '{"x":01}', '{"x":NaN}', '{"x":"\n"}', '']) {
    assert.throws(() => parseStrictJson(bytes(source)), StrictJsonError, source);
  }
  assert.throws(
    () => parseStrictJson(bytes('1e9999')),
    (error) => error.code === 'STRICT_JSON_INVALID_NUMBER',
  );
});
