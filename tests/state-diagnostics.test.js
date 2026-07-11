import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// /api/state must say WHY limits are missing (the server knows; the client
// never guesses). Simulates the fresh-install state: no statusline reading,
// an unresolvable codex command, no Codex sessions — all in a temp sandbox.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-state-'));
process.env.LLMDASH_DATA_DIR = path.join(tmp, 'data');
process.env.LLMDASH_CLAUDE_DIR = path.join(tmp, 'claude');
process.env.LLMDASH_CODEX_DIR = path.join(tmp, 'codex');
process.env.LLMDASH_CODEX_CMD = path.join(tmp, 'missing', 'codex');
// Auto-refresh state must be the enabled zero-attempt baseline for these
// diagnostics (a host env off-switch would swap the expected reason codes).
delete process.env.LLMDASH_CLAUDE_AUTOREFRESH;

const { buildState } = await import('../src/server.js');
const { config } = await import('../config.js');

test('fresh install: each tool carries an honest limits diagnostic', () => {
  const state = buildState();
  const claude = state.tools.find((t) => t.source === 'claude-code');
  const codex = state.tools.find((t) => t.source === 'codex');

  assert.equal(claude.haveLimits, false);
  assert.deepEqual(claude.limitsDiagnostic, { reason: 'no-statusline-reading' });
  // Claude ACTIVITY must keep rendering even with no limit reading (the
  // working path this fix must not break).
  assert.equal(claude.activity.hasData, true);

  assert.equal(codex.haveLimits, false);
  assert.equal(codex.limitsDiagnostic.reason, 'codex-cmd-failed');
  assert.equal(codex.limitsDiagnostic.cmd, process.env.LLMDASH_CODEX_CMD);
  assert.equal(codex.activity.hasData, false); // no sessions yet — honest, not zeros
});

test('a statusline reading arriving clears the Claude diagnostic', () => {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(config.rateLimitsFile, JSON.stringify({
    rate_limits: {
      five_hour: { used_percentage: 30, resets_at: new Date(Date.now() + 3600_000).toISOString() },
      seven_day: { used_percentage: 12, resets_at: new Date(Date.now() + 86400_000).toISOString() },
    },
    capturedAt: new Date().toISOString(),
  }));
  const claude = buildState().tools.find((t) => t.source === 'claude-code');
  assert.equal(claude.haveLimits, true);
  assert.equal(claude.limitsDiagnostic, null);
  assert.equal(claude.limits.five_hour.usedPct, 30);
});

test('the rendered stat set did not silently drop fields (renderer contract)', () => {
  // public/app.js renders from these fields; if one disappears a stat
  // silently blanks. Lock the tool-object shape.
  for (const tool of buildState().tools) {
    for (const key of ['source', 'label', 'plan', 'haveLimits', 'limits', 'modelLimits', 'projection', 'activity', 'dataAt', 'limitsDiagnostic', 'freshness']) {
      assert.ok(key in tool, `tool.${key} missing for ${tool.source}`);
    }
    assert.ok(Array.isArray(tool.modelLimits), `tool.modelLimits must be an array for ${tool.source}`);
    assert.ok('five_hour' in tool.limits && 'seven_day' in tool.limits);
    assert.ok('five_hour' in tool.projection && 'seven_day' in tool.projection);
  }
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
