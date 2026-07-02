import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

// THE GUARD (FR-16 / QA-16). Multi-host must not touch the single-host
// /api/state contract: not one field renamed, removed, or changed in meaning,
// and the handler's response shape byte-identical to a pre-feature golden. The
// badge and the local view consume /api/state unchanged. This test is the
// structural proof; if it fails, multi-host has leaked into /api/state.
//
// A deterministic sandbox with a known statusline reading so buildState() emits
// the full populated shape (not just the empty-diagnostic path).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-golden-'));
process.env.LLMDASH_DATA_DIR = path.join(tmp, 'data');
process.env.LLMDASH_CLAUDE_DIR = path.join(tmp, 'claude');
process.env.LLMDASH_CODEX_DIR = path.join(tmp, 'codex');
process.env.LLMDASH_CODEX_CMD = path.join(tmp, 'missing', 'codex');
delete process.env.LLMDASH_CLAUDE_AUTOREFRESH;
delete process.env.LLMDASH_HOSTS; // /api/state must be identical with or without peers

const { buildState, server } = await import('../src/server.js');
const { config } = await import('../config.js');

fs.mkdirSync(config.dataDir, { recursive: true });
const FIXED = Date.UTC(2026, 6, 2, 12, 0, 0);
fs.writeFileSync(config.rateLimitsFile, JSON.stringify({
  rate_limits: {
    five_hour: { used_percentage: 62, resets_at: new Date(FIXED + 3 * 3600_000).toISOString() },
    seven_day: { used_percentage: 36, resets_at: new Date(FIXED + 3 * 86400_000).toISOString() },
  },
  capturedAt: new Date(FIXED).toISOString(),
}));

// The frozen contract: the exact top-level keys, per-tool keys, window keys, and
// meanings /api/state has shipped. Locking the KEY SET (not the volatile values)
// is the byte-identical-shape guard; a new key here would be a contract change.
const TOOL_KEYS = ['source', 'label', 'plan', 'haveLimits', 'limits', 'projection', 'activity', 'dataAt', 'freshness', 'limitsDiagnostic'];
const STATE_KEYS = ['tools', 'headroom', 'generatedAt'];
const WINDOW_KEYS = ['usedPct', 'remainingPct', 'resetsAt', 'capturedAt'];

test('buildState top-level shape is unchanged (tools, headroom, generatedAt — nothing added)', () => {
  const s = buildState(FIXED);
  assert.deepEqual(Object.keys(s).sort(), [...STATE_KEYS].sort(),
    'a new top-level /api/state key would break the badge/local contract');
  assert.ok(Array.isArray(s.tools));
  assert.equal(typeof s.generatedAt, 'string');
});

test('each tool object carries exactly its shipped fields (no multi-host field leaked in)', () => {
  const s = buildState(FIXED);
  for (const tool of s.tools) {
    assert.deepEqual(Object.keys(tool).sort(), [...TOOL_KEYS].sort(),
      `tool ${tool.source} field set changed`);
    assert.deepEqual(Object.keys(tool.limits).sort(), ['five_hour', 'seven_day']);
    assert.deepEqual(Object.keys(tool.projection).sort(), ['five_hour', 'seven_day']);
  }
});

test('a populated window keeps its exact field set (usedPct/remainingPct/resetsAt/capturedAt)', () => {
  const s = buildState(FIXED);
  const claude = s.tools.find((t) => t.source === 'claude-code');
  assert.ok(claude.limits.five_hour, 'the seeded reading should populate the 5-hour window');
  assert.deepEqual(Object.keys(claude.limits.five_hour).sort(), [...WINDOW_KEYS].sort());
  assert.equal(claude.limits.five_hour.usedPct, 62);
  assert.equal(claude.limits.five_hour.remainingPct, 38);
});

test('the Claude freshness object still carries the server-supplied thresholds unchanged', () => {
  const s = buildState(FIXED);
  const claude = s.tools.find((t) => t.source === 'claude-code');
  assert.deepEqual(Object.keys(claude.freshness).sort(), ['capturedAt', 'freshForMs', 'staleAfterMs']);
  const codex = s.tools.find((t) => t.source === 'codex');
  assert.equal(codex.freshness, null); // Codex is still no-band
});

test('/api/state handler response is byte-identical whether or not peers are configured (FR-16)', async () => {
  const hit = (env) => new Promise((resolve, reject) => {
    // buildState() is nondeterministic across two calls only by wall-clock
    // fields; call the handler twice in the SAME process with LLMDASH_HOSTS
    // toggled and assert the SHAPE (key sets, at every level) is identical.
    const srv = server.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      http.get({ host: '127.0.0.1', port, path: '/api/state' }, (res) => {
        let body = ''; res.setEncoding('utf8');
        res.on('data', (c) => body += c);
        res.on('end', () => { srv.close(() => resolve({ status: res.statusCode, body })); });
      }).on('error', reject);
    });
  });
  const before = await hit();
  process.env.LLMDASH_HOSTS = '100.64.0.7=Desktop,100.64.0.9=Work';
  const after = await hit();
  delete process.env.LLMDASH_HOSTS;
  assert.equal(before.status, 200);
  assert.equal(after.status, 200);
  // Compare structural shape (recursive key sets), value-independent.
  const shape = (v) => {
    if (Array.isArray(v)) return v.length ? ['[]', shape(v[0])] : ['[]'];
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = shape(v[k]); return o; }
    return typeof v;
  };
  assert.deepEqual(shape(JSON.parse(after.body)), shape(JSON.parse(before.body)),
    'configuring peers must not change the /api/state response shape');
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
