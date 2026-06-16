import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHeadroom } from '../src/server.js';

const tool = (label, source, five, seven) => ({
  label, source,
  limits: {
    five_hour: five == null ? null : { remainingPct: five },
    seven_day: seven == null ? null : { remainingPct: seven },
  },
});

test('fires when a tool\'s weekly is maxed and another has room', () => {
  const h = computeHeadroom([tool('Claude Code', 'claude-code', 93, 83), tool('Codex', 'codex', 67, 0)]);
  assert.ok(h);
  assert.equal(h.lowLabel, 'Codex');
  assert.equal(h.lowWindow, 'weekly');
  assert.equal(h.maxed, true);
  assert.equal(h.bestLabel, 'Claude Code');
});

test('fires when the 5-hour window is low', () => {
  const h = computeHeadroom([tool('Claude Code', 'claude-code', 7, 83), tool('Codex', 'codex', 71, 90)]);
  assert.ok(h);
  assert.equal(h.lowLabel, 'Claude Code');
  assert.equal(h.lowWindow, '5-hour');
  assert.equal(h.maxed, false);
});

test('no headroom when both tools are comfortable on both windows', () => {
  assert.equal(computeHeadroom([tool('Claude Code', 'claude-code', 60, 80), tool('Codex', 'codex', 70, 90)]), null);
});

test('no headroom when only one tool has limit data', () => {
  assert.equal(computeHeadroom([tool('Claude Code', 'claude-code', 7, 50), tool('Codex', 'codex', null, null)]), null);
});
