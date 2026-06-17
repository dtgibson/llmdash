import test from 'node:test';
import assert from 'node:assert/strict';
import { toolWrap } from '../src/server.js';

const iso = (ms) => new Date(ms).toISOString();

test('toolWrap exposes a per-window projection (five_hour + seven_day shown at once)', () => {
  const now = Date.UTC(2026, 0, 4, 0, 0, 0);
  const live = {
    capturedAt: iso(now),
    windows: {
      five_hour: { usedPct: 50, resetsAt: iso(now + 3 * 3600_000) },
      seven_day: { usedPct: 90, resetsAt: iso(now + 2 * 24 * 3600_000) },
    },
  };
  const t = toolWrap('claude-code', 'Claude Code', 'Max', live, { hasData: false }, now);
  assert.ok(t.projection && typeof t.projection === 'object');
  assert.ok('five_hour' in t.projection && 'seven_day' in t.projection);
  assert.equal(typeof t.projection.five_hour.hitsBeforeReset, 'boolean');
  assert.equal(typeof t.projection.seven_day.hitsBeforeReset, 'boolean');
});

test('a window with no reset time yields a null projection for that window only', () => {
  const now = Date.UTC(2026, 0, 4, 0, 0, 0);
  const live = {
    capturedAt: iso(now),
    windows: {
      five_hour: { usedPct: 40, resetsAt: iso(now + 3 * 3600_000) },
      seven_day: { usedPct: 88, resetsAt: null }, // a reading, but no reset time
    },
  };
  const t = toolWrap('codex', 'Codex', 'ChatGPT Plus', live, { hasData: false }, now);
  assert.ok(t.projection.five_hour); // has a reading + reset → projected
  assert.equal(t.projection.seven_day, null); // no reset → honest null, not a guess
});
