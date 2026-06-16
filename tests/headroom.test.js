import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHeadroom } from '../src/server.js';

const tool = (label, source, fiveRemaining) => ({
  label, source,
  limits: { five_hour: fiveRemaining == null ? null : { remainingPct: fiveRemaining } },
});

test('headroom fires when one tool is low and another has room', () => {
  const h = computeHeadroom([tool('Claude Code', 'claude-code', 7), tool('Codex', 'codex', 71)]);
  assert.ok(h);
  assert.equal(h.lowLabel, 'Claude Code');
  assert.equal(h.bestLabel, 'Codex');
  assert.equal(h.bestRemaining, 71);
});

test('no headroom when both are comfortable', () => {
  assert.equal(computeHeadroom([tool('Claude Code', 'claude-code', 60), tool('Codex', 'codex', 80)]), null);
});

test('no headroom when only one tool has limit data', () => {
  assert.equal(computeHeadroom([tool('Claude Code', 'claude-code', 7), tool('Codex', 'codex', null)]), null);
});
