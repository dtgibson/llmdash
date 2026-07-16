import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Gate logic for the auto-refresh mechanism, driven entirely through the
// injectable seams (clock, reading, activity signal, attempt) — the default
// test run NEVER spawns a real claude session (that is Stage-6 QA). Wall-clock
// arithmetic, spacing, backoff, and single-flight per FR-12..15 / QA-10..14.
delete process.env.LLMDASH_CLAUDE_AUTOREFRESH;

const {
  maybeRefreshClaude, getRefreshState, _resetRefreshState, newestTranscriptMtimeMs,
} = await import('../src/claude-refresh.js');

const MIN = 60_000;
const T0 = Date.UTC(2026, 6, 2, 12, 0, 0);
const cfg = { claudeMaxAgeMs: 5 * MIN, claudeStaleAfterMs: 10 * MIN, claudeCmd: 'claude' };

// Seam helpers: a reading of a given age, an activity signal of a given age.
const readingAged = (now, ageMs) => () => (ageMs == null ? null : { capturedAt: new Date(now - ageMs).toISOString() });
const activityAged = (now, ageMs) => () => (ageMs == null ? null : now - ageMs);

function countingAttempt(results) {
  const calls = [];
  const fn = async () => {
    calls.push(1);
    const r = results.shift();
    return r === undefined ? { ok: true } : r;
  };
  fn.calls = calls;
  return fn;
}

test.beforeEach(() => _resetRefreshState());

test('a fresh reading suppresses everything — organic captures count (FR-13, QA-12)', async () => {
  const attempt = countingAttempt([]);
  for (let i = 0; i < 60; i++) {
    const now = T0 + i * MIN;
    // Reading kept 2m old by "organic" captures across an hour of ticks.
    const verdict = await maybeRefreshClaude({
      now, readReading: readingAged(now, 2 * MIN), newestActivityMs: activityAged(now, 0), attempt, cfg,
    });
    assert.equal(verdict, 'fresh');
  }
  assert.equal(attempt.calls.length, 0);
});

test('idle beyond the activity window = zero refresh work (FR-12, QA-10)', async () => {
  const attempt = countingAttempt([]);
  for (let i = 0; i < 60; i++) {
    const now = T0 + i * MIN;
    const verdict = await maybeRefreshClaude({
      now, readReading: readingAged(now, 60 * MIN), newestActivityMs: activityAged(now, 11 * MIN), attempt, cfg,
    });
    assert.equal(verdict, 'idle');
  }
  assert.equal(attempt.calls.length, 0);
  // No activity signal at all (fresh install, no transcripts) is idle too.
  assert.equal(await maybeRefreshClaude({
    now: T0, readReading: () => null, newestActivityMs: () => null, attempt, cfg,
  }), 'idle');
  assert.equal(attempt.calls.length, 0);
});

test('stale + active = an attempt; a success resets the failure state', async () => {
  const attempt = countingAttempt([{ ok: true }]);
  const verdict = await maybeRefreshClaude({
    now: T0, readReading: readingAged(T0, 20 * MIN), newestActivityMs: activityAged(T0, MIN), attempt, cfg,
  });
  assert.equal(verdict, 'refreshed');
  const s = getRefreshState();
  assert.equal(s.consecutiveFailures, 0);
  assert.equal(s.lastFailureCause, null);
  assert.equal(s.inFlight, false);
  assert.equal(s.lastAttemptAt, T0);
});

test('attempt starts are spaced ≥ the refresh threshold (FR-14, QA-13)', async () => {
  const attempt = countingAttempt([{ ok: true }, { ok: true }]);
  const stale = (now) => ({ now, readReading: readingAged(now, 60 * MIN), newestActivityMs: activityAged(now, 0), attempt, cfg });
  assert.equal(await maybeRefreshClaude(stale(T0)), 'refreshed');
  // 1 minute later (still stale — the write is mocked away): spacing blocks it.
  assert.equal(await maybeRefreshClaude(stale(T0 + MIN)), 'waiting');
  assert.equal(await maybeRefreshClaude(stale(T0 + 4 * MIN)), 'waiting');
  // At the threshold, the next attempt may start.
  assert.equal(await maybeRefreshClaude(stale(T0 + 5 * MIN)), 'refreshed');
  assert.equal(attempt.calls.length, 2);
});

test('single flight: a due trigger mid-attempt is skipped, not queued (FR-14)', async () => {
  let release;
  const hanging = () => new Promise((r) => { release = r; });
  const stale = (now, attempt) => ({ now, readReading: readingAged(now, 60 * MIN), newestActivityMs: activityAged(now, 0), attempt, cfg });
  const first = maybeRefreshClaude(stale(T0, hanging));
  await new Promise((r) => setImmediate(r)); // let the first attempt start
  assert.equal(getRefreshState().inFlight, true);
  const second = countingAttempt([]);
  assert.equal(await maybeRefreshClaude(stale(T0 + 10 * MIN, second)), 'in-flight');
  assert.equal(second.calls.length, 0);
  release({ ok: true });
  assert.equal(await first, 'refreshed');
  assert.equal(getRefreshState().inFlight, false);
});

test('backoff schedule under consecutive failures: 5, 10, 20, 40, 60, 60 minutes (FR-15, QA-14)', async () => {
  const fail = { ok: false, cause: 'timeout' };
  const attempt = countingAttempt([fail, fail, fail, fail, fail, fail, { ok: true }]);
  const stale = (now) => ({ now, readReading: readingAged(now, 999 * MIN), newestActivityMs: activityAged(now, 0), attempt, cfg });
  let now = T0;
  const expectedGapsMin = [5, 10, 20, 40, 60, 60];
  for (const [i, gap] of expectedGapsMin.entries()) {
    assert.equal(await maybeRefreshClaude(stale(now)), 'failed', `attempt ${i + 1} fails`);
    assert.equal(getRefreshState().consecutiveFailures, i + 1);
    // Just before the backoff boundary: no attempt starts.
    assert.equal(await maybeRefreshClaude(stale(now + gap * MIN - 1)), 'waiting', `still waiting before +${gap}m`);
    now += gap * MIN;
  }
  // The 7th attempt succeeds and resets gating to normal.
  assert.equal(await maybeRefreshClaude(stale(now)), 'refreshed');
  const s = getRefreshState();
  assert.equal(s.consecutiveFailures, 0);
  assert.equal(s.lastFailureCause, null);
  // Normal spacing (the threshold) applies again after the success.
  assert.equal(await maybeRefreshClaude(stale(now + 4 * MIN)), 'waiting');
  assert.equal(await maybeRefreshClaude(stale(now + 5 * MIN)), 'refreshed');
});

test('a sleep-spanning gap fires at most ONE attempt on the first wake tick (FR-14, QA-13)', async () => {
  const attempt = countingAttempt([{ ok: false, cause: 'timeout' }, { ok: false, cause: 'timeout' }]);
  const stale = (now) => ({ now, readReading: readingAged(now, 999 * MIN), newestActivityMs: activityAged(now, 0), attempt, cfg });
  assert.equal(await maybeRefreshClaude(stale(T0)), 'failed');
  // The machine sleeps 8 hours; many "missed" triggers elapse. The first wake
  // tick starts exactly one attempt — never a catch-up burst.
  const wake = T0 + 8 * 60 * MIN;
  assert.equal(await maybeRefreshClaude(stale(wake)), 'failed');
  assert.equal(attempt.calls.length, 2);
  // And the very next tick is spaced/backed off as usual (2 failures → 10m).
  assert.equal(await maybeRefreshClaude(stale(wake + MIN)), 'waiting');
});

test('the off-switch gate does zero work — no reads, no scans, no attempts (FR-27, QA-16)', async () => {
  let touched = 0;
  const verdict = await maybeRefreshClaude({
    now: T0,
    disabled: true,
    readReading: () => { touched++; return null; },
    newestActivityMs: () => { touched++; return T0; },
    attempt: async () => { touched++; return { ok: true }; },
    cfg,
  });
  assert.equal(verdict, 'disabled');
  assert.equal(touched, 0);
});

test('an unresolvable claude binary → failure("spawn-error"), nothing spawns, server survives (FR-26, QA-25)', async () => {
  const badCfg = {
    ...cfg,
    claudeCmd: path.join(os.tmpdir(), 'definitely', 'missing', 'claude'),
    // Never reached (resolve fails first), but present so an accidental spawn
    // path would still land in a sandbox rather than real config paths.
    claudeRefreshCwd: path.join(os.tmpdir(), 'llmdash-never-created'),
    dataDir: path.join(os.tmpdir(), 'llmdash-never-created-data'),
    claudeRefreshTimeoutMs: 1000,
  };
  // Default attempt (the real one) with the unresolvable cfg command.
  const verdict = await maybeRefreshClaude({
    now: T0, readReading: readingAged(T0, 60 * MIN), newestActivityMs: activityAged(T0, 0), cfg: badCfg,
  });
  assert.equal(verdict, 'failed');
  const s = getRefreshState();
  assert.equal(s.lastFailureCause, 'spawn-error');
  assert.equal(s.consecutiveFailures, 1);
  assert.equal(fs.existsSync(badCfg.claudeRefreshCwd), false); // resolve failed BEFORE any fs work
});

test('failure causes log once per distinct cause, not once per attempt (FR-20, QA-19)', async () => {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const fail = { ok: false, cause: 'timeout' };
    const attempt = countingAttempt([fail, fail, fail, { ok: false, cause: 'parse-failed' }]);
    let now = T0;
    for (const gapMin of [0, 5, 10, 20]) {
      now += gapMin * MIN;
      await maybeRefreshClaude({ now, readReading: readingAged(now, 999 * MIN), newestActivityMs: activityAged(now, 0), attempt, cfg });
    }
    const timeoutLogs = logged.filter((l) => l.includes('time out'));
    const parseLogs = logged.filter((l) => l.includes("couldn't be parsed"));
    assert.equal(timeoutLogs.length, 1, 'timeout logged exactly once across 3 failures');
    assert.equal(parseLogs.length, 1, 'the distinct cause logs once too');
  } finally {
    console.error = orig;
  }
});

test('newestTranscriptMtimeMs finds the newest .jsonl mtime; metadata only', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-activity-'));
  const projectsDir = path.join(tmp, 'projects');
  assert.equal(newestTranscriptMtimeMs({ projectsDir }), null); // no dir yet → no signal
  const mk = (dir, name, ageMin) => {
    fs.mkdirSync(path.join(projectsDir, dir), { recursive: true });
    const fp = path.join(projectsDir, dir, name);
    fs.writeFileSync(fp, '');
    const t = new Date(Date.now() - ageMin * MIN);
    fs.utimesSync(fp, t, t);
    return t.getTime();
  };
  mk('proj-a', 'old.jsonl', 120);
  const newest = mk('proj-b', 'new.jsonl', 3);
  mk('proj-b', 'ignored.txt', 0); // non-transcript files don't count
  const got = newestTranscriptMtimeMs({ projectsDir });
  assert.ok(Math.abs(got - newest) < 1000, `newest jsonl mtime (got ${got}, want ~${newest})`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- Config knob parsing (fresh import per case, like the freshness tests) ----

test('LLMDASH_CLAUDE_AUTOREFRESH: only "0"/"false" disable (FR-27, QA-26)', async () => {
  for (const [raw, expected] of [
    [undefined, true],
    ['1', true],
    ['on', true],
    ['no', true], // not a documented off value — stays on
    ['', true],
    ['0', false],
    ['false', false],
    ['FALSE', false],
  ]) {
    if (raw === undefined) delete process.env.LLMDASH_CLAUDE_AUTOREFRESH;
    else process.env.LLMDASH_CLAUDE_AUTOREFRESH = raw;
    const { config: c } = await import(`../config.js?autorefresh=${encodeURIComponent(raw ?? 'unset')}`);
    assert.equal(c.claudeAutoRefresh, expected, `raw=${JSON.stringify(raw)}`);
  }
  delete process.env.LLMDASH_CLAUDE_AUTOREFRESH;
});

test('LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS: default 30s, clamped 5s–5m', async () => {
  for (const [raw, expected] of [
    [undefined, 30_000],
    ['garbage', 30_000],
    ['1000', 5_000], // floor
    ['60000', 60_000],
    ['999999999', 300_000], // ceiling
  ]) {
    if (raw === undefined) delete process.env.LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS;
    else process.env.LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS = raw;
    const { config: c } = await import(`../config.js?timeout=${encodeURIComponent(raw ?? 'unset')}`);
    assert.equal(c.claudeRefreshTimeoutMs, expected, `raw=${JSON.stringify(raw)}`);
  }
  delete process.env.LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS;
});

test('claudeCmd defaults to "claude" (LLMDASH_CLAUDE_CMD overrides); the cwd is a fixed constant', async () => {
  delete process.env.LLMDASH_CLAUDE_CMD;
  const { config: c1 } = await import('../config.js?claudecmd=unset');
  assert.equal(c1.claudeCmd, 'claude');
  assert.equal(c1.claudeRefreshCwd, path.join(os.homedir(), '.llmdash', 'claude-refresh-cwd'));
  process.env.LLMDASH_CLAUDE_CMD = '/opt/somewhere/claude';
  const { config: c2 } = await import('../config.js?claudecmd=set');
  assert.equal(c2.claudeCmd, '/opt/somewhere/claude');
  delete process.env.LLMDASH_CLAUDE_CMD;
});
