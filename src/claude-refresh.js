import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { config } from '../config.js';
import { readClaudeLimits } from './claude-limits.js';
import { resolveCommand } from './health.js';

// Claude limit auto-refresh (the [R2-scrape] mechanism, spike-validated):
// when the statusline reading is stale while Claude is actually being used,
// spawn a short-lived Claude Code session in a dedicated cwd, type /usage,
// scrape the rendered pane from the pty typescript, and write the same
// reading file the statusline script writes. Runs only from the poller
// (never the HTTP path); every gate below has to open before any work runs.
//
// Boundary notes (ratified 2026-07-02, pipeline/claude-auto-refresh):
// the probe sends only the /usage keystrokes — never a message, never plan
// usage, never a transcript. The two disclosed Claude-file side effects are
// Claude Code's own: the one-time trust entry for the dedicated cwd in
// ~/.claude.json, and one ~/.claude/history.jsonl line per refresh.

// ---------------------------------------------------------------------------
// Failure/backoff state (in-memory, process-lifetime — like codex's diag).

const BACKOFF_BASE_MS = 5 * 60_000; // first failure waits 5m…
const BACKOFF_CAP_MS = 60 * 60_000; // …doubling to a 60m cap (FR-15)

const state = {
  disabled: !config.claudeAutoRefresh,
  inFlight: false,
  lastAttemptAt: null,
  nextAttemptAt: null, // wall-clock ms before which no attempt may start
  consecutiveFailures: 0,
  lastFailureCause: null, // 'spawn-error' | 'timeout' | 'parse-failed' | 'no-reading-produced'
};

export function getRefreshState() { return { ...state }; }

// Test seam: reset the module state between cases (never used at runtime).
export function _resetRefreshState() {
  state.disabled = !config.claudeAutoRefresh;
  state.inFlight = false;
  state.lastAttemptAt = null;
  state.nextAttemptAt = null;
  state.consecutiveFailures = 0;
  state.lastFailureCause = null;
  loggedCauses.clear();
}

// Each distinct failure cause logs ONCE (not once per attempt); a success
// re-arms the set so a later regression logs again (codex's convention).
const loggedCauses = new Set();
const CAUSE_LOG = {
  'spawn-error': () => `cannot run "${config.claudeCmd}" — set LLMDASH_CLAUDE_CMD to the absolute path from 'which claude' and restart (the macOS installer does this when re-run).`,
  'timeout': () => `probe sessions time out before the /usage pane renders (timeout ${config.claudeRefreshTimeoutMs}ms, LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS).`,
  'parse-failed': () => `the /usage screen rendered but couldn't be parsed — a Claude Code update may have changed its layout.`,
  'no-reading-produced': () => `probe sessions finish without producing a reading.`,
};

function recordFailure(cause, attemptStartedAt, cfg) {
  state.consecutiveFailures += 1;
  state.lastFailureCause = cause;
  const backoff = Math.min(BACKOFF_BASE_MS * 2 ** (state.consecutiveFailures - 1), BACKOFF_CAP_MS);
  // Backoff lengthens the spacing, never shortens it (FR-14/FR-15).
  state.nextAttemptAt = attemptStartedAt + Math.max(backoff, cfg.claudeMaxAgeMs);
  if (!loggedCauses.has(cause)) {
    loggedCauses.add(cause);
    const detail = CAUSE_LOG[cause] ? CAUSE_LOG[cause]() : cause;
    console.error(`claude auto-refresh: ${detail} The last statusline capture keeps rendering; open a Claude Code CLI session to refresh manually.`);
  }
}

// ---------------------------------------------------------------------------
// Gates + attempt orchestration. Called once per poller tick.

// Returns a short verdict string (useful in tests; the poller ignores it).
export async function maybeRefreshClaude({
  now = Date.now(),
  disabled = state.disabled,
  readReading = readClaudeLimits,
  newestActivityMs = newestTranscriptMtimeMs,
  attempt = attemptRefresh,
  cfg = config,
} = {}) {
  // 1. Off-switch: zero work of any kind — no scans, no spawns (FR-27).
  if (disabled) return 'disabled';

  // 2. Freshness suppression: organic statusline captures count (FR-13).
  const reading = readReading();
  if (reading && reading.capturedAt) {
    const age = now - Date.parse(reading.capturedAt);
    if (Number.isFinite(age) && age < cfg.claudeMaxAgeMs) return 'fresh';
  }

  // 3. Activity gate: refresh only while Claude is actually in use — the
  //    reading can't have changed otherwise (FR-12; signal per OQ-02).
  const activityMs = newestActivityMs(cfg);
  if (activityMs == null || now - activityMs > cfg.claudeStaleAfterMs) return 'idle';

  // 4. Single flight + spacing. All arithmetic is wall-clock, so a
  //    sleep-spanning gap yields at most one attempt on the first wake tick —
  //    never a catch-up burst (FR-14).
  if (state.inFlight) return 'in-flight';
  if (state.nextAttemptAt != null && now < state.nextAttemptAt) return 'waiting';

  // 5. Attempt.
  state.inFlight = true;
  state.lastAttemptAt = now;
  state.nextAttemptAt = now + cfg.claudeMaxAgeMs; // spacing floor; a failure lengthens it below
  try {
    const result = await attempt({ cfg });
    if (result && result.ok) {
      state.consecutiveFailures = 0;
      state.lastFailureCause = null;
      loggedCauses.clear(); // a later regression should log again
      return 'refreshed';
    }
    recordFailure((result && result.cause) || 'no-reading-produced', now, cfg);
    return 'failed';
  } catch {
    recordFailure('no-reading-produced', now, cfg);
    return 'failed';
  } finally {
    state.inFlight = false;
  }
}

// Newest transcript mtime under projectsDir — the activity signal. Bounded
// metadata scan (readdir + stat, one project-dir level, like stats.js walks);
// never reads file content, never runs on the HTTP path.
export function newestTranscriptMtimeMs(cfg = config) {
  let newest = null;
  let dirs;
  try { dirs = fs.readdirSync(cfg.projectsDir, { withFileTypes: true }); } catch { return null; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(cfg.projectsDir, d.name);
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      let st;
      try { st = fs.statSync(path.join(dir, name)); } catch { continue; }
      if (newest == null || st.mtimeMs > newest) newest = st.mtimeMs;
    }
  }
  return newest;
}

// ---------------------------------------------------------------------------
// The spawn (inherited law from pipeline/statusline-auto-refresh, NFR-06):
// a FIXED /bin/sh script constant — no config value is ever interpolated into
// it; the typescript path and the resolved claude path enter as positional
// argv only. Keystrokes travel through a real shell pipe (script(1)'s stdin
// must never be a Node pipe — the macOS socketpair failure mode). The 300s
// dwell just keeps the pipe open past any allowed timeout; capture or
// teardown always ends the session long before it drains.
const RUNNER_SRC = '(sleep 6; printf \'/usage\'; sleep 1; printf \'\\r\'; sleep 300) | /usr/bin/script -q -t 0 "$1" "$2"';

// Explicit allowlist env — the parent's CLAUDECODE*/ANTHROPIC_* vars are
// never inherited (allowlist construction makes that structural). PATH is
// node's own dir ⊕ system dirs ⊕ the resolved claude binary's dir.
function cleanEnv(claudePath) {
  const user = process.env.USER || os.userInfo().username;
  return {
    PATH: [path.dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin', path.dirname(claudePath)].join(':'),
    HOME: os.homedir(),
    USER: user,
    LOGNAME: process.env.LOGNAME || user,
    TERM: 'xterm-256color',
    LANG: process.env.LANG || 'en_US.UTF-8',
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Find the probe's claude pid: one ps snapshot, matched by walking ppid links
// back to OUR spawn — a process that isn't a descendant of the probe can never
// match, so the user's live sessions are structurally untouchable (NFR-04).
function findClaudePid(rootPid, claudePath) {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-axo', 'pid=,ppid=,command='], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      const procs = [];
      for (const line of stdout.split('\n')) {
        const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
        if (m) procs.push({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] });
      }
      const byPid = new Map(procs.map((p) => [p.pid, p]));
      const base = path.basename(claudePath);
      for (const p of procs) {
        if (!(p.cmd.includes(claudePath) || p.cmd.includes(base))) continue;
        for (let cur = p, depth = 0; cur && depth < 12; cur = byPid.get(cur.ppid), depth++) {
          if (cur.pid === rootPid) return resolve(p.pid);
        }
      }
      resolve(null);
    });
  });
}

// Teardown: TERM the probe's own process group, 2s grace, then verify the
// pty-orphaned claude pid followed (script's death SIGHUPs it); escalate
// TERM→KILL on that pid only. Nothing not recorded at spawn time is signaled.
async function teardown(child, claudePid) {
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await sleep(2000);
  if (claudePid != null && alive(claudePid)) {
    try { process.kill(claudePid, 'SIGTERM'); } catch {}
    await sleep(1000);
    if (alive(claudePid)) { try { process.kill(claudePid, 'SIGKILL'); } catch {} }
  }
}

// One refresh attempt: spawn → poll the typescript for a parseable /usage
// pane every 500ms → capturedAt = the hit moment → immediate teardown →
// convert + clamp + newest-wins write. Resolves { ok: true } or
// { ok: false, cause }; never throws, never leaves the process tree running.
async function attemptRefresh({ cfg = config } = {}) {
  const claudePath = resolveCommand(cfg.claudeCmd);
  if (!claudePath) return { ok: false, cause: 'spawn-error' }; // never a blind spawn (FR-26)

  try {
    fs.mkdirSync(cfg.claudeRefreshCwd, { recursive: true, mode: 0o700 });
    fs.mkdirSync(cfg.dataDir, { recursive: true });
  } catch {
    return { ok: false, cause: 'spawn-error' };
  }
  const tsPath = path.join(cfg.dataDir, `claude-usage-probe-${process.pid}-${Date.now()}.typescript`);

  let child;
  try {
    child = spawn('/bin/sh', ['-c', RUNNER_SRC, 'sh', tsPath, claudePath], {
      cwd: cfg.claudeRefreshCwd,
      env: cleanEnv(claudePath),
      detached: true, // own process group → one-shot group kill at teardown
      stdio: 'ignore', // script's stdin comes from the sh pipeline, never a Node pipe
    });
  } catch {
    try { fs.unlinkSync(tsPath); } catch {}
    return { ok: false, cause: 'spawn-error' };
  }

  return await new Promise((resolve) => {
    let settled = false;
    let sawPane = false;
    let claudePid = null;
    const timers = [];

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      for (const t of timers) { clearTimeout(t); clearInterval(t); }
      await teardown(child, claudePid);
      try { fs.unlinkSync(tsPath); } catch {}
      resolve(result);
    };

    child.on('error', () => { finish({ ok: false, cause: 'spawn-error' }); });
    child.on('exit', () => {
      // The pipeline EOF'd or died before a reading parsed.
      if (!settled) finish({ ok: false, cause: sawPane ? 'parse-failed' : 'no-reading-produced' });
    });

    // Record the claude pid early (the TUI is up within a few seconds); a
    // second look right when /usage is typed covers a slow start.
    const notePid = async () => { if (claudePid == null && !settled) claudePid = await findClaudePid(child.pid, claudePath); };
    timers.push(setTimeout(notePid, 2000), setTimeout(notePid, 6000));

    timers.push(setTimeout(() => {
      finish({ ok: false, cause: sawPane ? 'parse-failed' : 'timeout' });
    }, cfg.claudeRefreshTimeoutMs));

    timers.push(setInterval(() => {
      let text;
      try { text = fs.readFileSync(tsPath, 'utf8'); } catch { return; }
      const parsed = parseUsagePane(text);
      if (parsed.sawPane) sawPane = true;
      if (!parsed.ok) return;
      const capturedAtMs = Date.now(); // the pane renders live data — the hit moment IS evidence time (FR-09)
      try {
        writeReadingIfNewer(buildReadingPayload(parsed.windows, capturedAtMs), cfg);
        finish({ ok: true }); // a skipped write means a newer organic capture won — still a produced reading
      } catch {
        finish({ ok: false, cause: 'no-reading-produced' });
      }
    }, 500));
  });
}

// ---------------------------------------------------------------------------
// Parsing the /usage pane (the fragile surface — fixture-tested against real
// captures; a layout change fails loudly as 'parse-failed', never a partial
// or fabricated reading).

// Strip ANSI/pty control sequences, leaving the rendered words. Sequences are
// replaced by a space (not removed) so cursor-move remnants never fuse two
// unrelated fragments into one token.
function deAnsi(s) {
  return s
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, ' ') // OSC (window title etc.)
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, ' ') // CSI (colors, cursor moves)
    .replace(/\u001b[()][0-9A-Za-z]/g, ' ') // charset designation (ESC ( B)
    .replace(/\u001b[@-~]/g, ' ') // other two-byte escapes
    .replace(/\u001b[0-9<=>]/g, ' ') // ESC 7/8 (cursor save/restore), keypad modes
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' '); // stray control bytes
}

// The two contract anchors, plus the sections that are NEVER scraped: the
// per-model promo meter and the local-analysis block (decisions 2026-06-16 /
// spike finding 7). Loose \s+ tolerates pty-dropped or padded characters.
const SESSION_ANCHOR = /Current\s+session/g;
const WEEK_ANCHOR = /Current\s+week\s+\(all models\)/g;
const STOP_ANCHORS = [/Current\s+week\s+\((?!all models\))/g, /What'?s\s+contributing/g];

function lastMatchIndex(re, s, from = 0) {
  re.lastIndex = from;
  let idx = -1;
  let m;
  while ((m = re.exec(s))) idx = m.index;
  return idx;
}

function firstMatchIndex(re, s, from = 0) {
  re.lastIndex = from;
  const m = re.exec(s);
  return m ? m.index : -1;
}

// One window segment: "NN% used" (tolerant of dropped spacing) and the
// "Resets <text> (<IANA zone>)" clause — real captures drop characters
// ("Resets" → "Rests"), so the verb matches on its Res… stem. A window with a
// readable used% but an unreadable reset still ships (resets_at null) rather
// than dropping the reading (spike finding 5).
function parseWindowSeg(seg) {
  const pct = seg.match(/(\d{1,3})\s*%\s*used/);
  if (!pct) return null;
  const reset = seg.match(/\bRes[a-z]*\s+([^()\n]+?)\s*\(([A-Za-z][A-Za-z0-9_+/-]*)\)/);
  return {
    usedPct: Math.min(100, Math.max(0, Number(pct[1]))), // clamp 0–100 at ingest
    resetText: reset ? reset[1].trim() : null,
    zone: reset ? reset[2] : null,
  };
}

// Parse a raw pty typescript into the two contract windows. Returns
// { ok: true, windows } or { ok: false, sawPane } — sawPane distinguishes "a
// usage pane rendered but didn't parse" (parse-failed) from "nothing usage-
// shaped ever appeared" (timeout / no-reading-produced).
export function parseUsagePane(text) {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, sawPane: false };
  const plain = deAnsi(text);
  // The TUI may redraw; the LAST session anchor belongs to the latest frame.
  const sessIdx = lastMatchIndex(SESSION_ANCHOR, plain);
  const weekIdx = sessIdx >= 0 ? firstMatchIndex(WEEK_ANCHOR, plain, sessIdx) : -1;
  const sawPane = sessIdx >= 0 || weekIdx >= 0 || /\d{1,3}\s*%\s*used/.test(plain);
  if (sessIdx < 0 || weekIdx < 0) return { ok: false, sawPane };
  // The weekly segment ends at the first excluded section (the Fable/promo
  // meter or the "What's contributing" analysis) so those are structurally
  // unreachable; without a stop match, first-match-wins still lands on the
  // all-models meter (it renders first).
  let weekEnd = plain.length;
  for (const stop of STOP_ANCHORS) {
    const i = firstMatchIndex(stop, plain, weekIdx);
    if (i >= 0 && i < weekEnd) weekEnd = i;
  }
  const five = parseWindowSeg(plain.slice(sessIdx, weekIdx));
  const seven = parseWindowSeg(plain.slice(weekIdx, weekEnd));
  if (!five || !seven) return { ok: false, sawPane: true }; // both windows required — else the pane changed
  return { ok: true, windows: { five_hour: five, seven_day: seven } };
}

// ---------------------------------------------------------------------------
// Reset-text → epoch conversion, via Intl zone math (no deps). The pane gives
// local-time text plus an IANA zone in parens. A bare time ("12:20am") is the
// next future occurrence in that zone; a dated one ("Jul 3 at 11pm") is that
// calendar date there, nearest-future year. Returns epoch SECONDS (the
// statusline resets_at unit) or null — a failed conversion never drops the
// used% reading (the caller ships resets_at null and logs once).

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function resetTextToEpoch(text, zone, nowMs = Date.now()) {
  if (!text || !zone) return null;
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
    });
  } catch { return null; } // not a zone Intl knows — conversion honestly fails

  const wallInZone = (ms) => {
    const parts = {};
    for (const p of fmt.formatToParts(ms)) if (p.type !== 'literal') parts[p.type] = Number(p.value);
    if (parts.hour === 24) parts.hour = 0; // some engines render midnight as 24 with hour12:false
    return parts;
  };
  // The UTC instant whose wall clock in `zone` reads (y, mo, d, h, mi):
  // guess UTC, measure the zone's wall time there, correct by the difference
  // (twice covers DST edges).
  const zonedToUtcMs = (y, mo, d, h, mi) => {
    let guess = Date.UTC(y, mo, d, h, mi, 0);
    for (let i = 0; i < 3; i++) {
      const w = wallInZone(guess);
      const diff = Date.UTC(y, mo, d, h, mi, 0) - Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
      if (diff === 0) break;
      guess += diff;
    }
    return guess;
  };
  const hm = (hRaw, miRaw, ap) => {
    let h = Number(hRaw);
    const mi = miRaw == null ? 0 : Number(miRaw);
    if (!Number.isFinite(h) || h < 1 || h > 12 || !Number.isFinite(mi) || mi < 0 || mi > 59) return null;
    if (/pm/i.test(ap)) h = h === 12 ? 12 : h + 12;
    else h = h === 12 ? 0 : h;
    return { h, mi };
  };

  const t = String(text).trim();
  let m;
  if ((m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i))) {
    const time = hm(m[1], m[2], m[3]);
    if (!time) return null;
    const today = wallInZone(nowMs);
    let ms = zonedToUtcMs(today.year, today.month - 1, today.day, time.h, time.mi);
    if (ms <= nowMs) ms = zonedToUtcMs(today.year, today.month - 1, today.day + 1, time.h, time.mi);
    return Math.floor(ms / 1000);
  }
  if ((m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i))) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    const day = Number(m[2]);
    const time = hm(m[3], m[4], m[5]);
    if (mo == null || !time || day < 1 || day > 31) return null;
    const nowWall = wallInZone(nowMs);
    let ms = zonedToUtcMs(nowWall.year, mo, day, time.h, time.mi);
    if (ms <= nowMs) ms = zonedToUtcMs(nowWall.year + 1, mo, day, time.h, time.mi);
    return Math.floor(ms / 1000);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Building + writing the reading (the exact statusline file shape, so
// readClaudeLimits(), gauges, freshness, snapshots and trends all work
// unmodified — FR-07).

let warnedResetConversion = false; // once per process (spike finding 5)

export function buildReadingPayload(windows, capturedAtMs) {
  const rl = {};
  for (const key of ['five_hour', 'seven_day']) {
    const w = windows[key];
    const epoch = resetTextToEpoch(w.resetText, w.zone, capturedAtMs);
    if (epoch == null && !warnedResetConversion) {
      warnedResetConversion = true;
      console.error(`claude auto-refresh: couldn't convert a reset time ("${w.resetText}" in ${w.zone}) — the reading ships without it; reset countdowns for that window will show "—" until a statusline capture.`);
    }
    rl[key] = {
      used_percentage: Math.min(100, Math.max(0, w.usedPct)),
      resets_at: epoch, // epoch seconds, or null when conversion failed
    };
  }
  return { rate_limits: rl, capturedAt: new Date(capturedAtMs).toISOString() };
}

// Newest-capturedAt-wins, atomically (temp + rename): a probe capture must
// never replace a newer organic statusline capture, whatever the write order
// (FR-10). Returns whether the file was written.
export function writeReadingIfNewer(payload, cfg = config) {
  const newTs = Date.parse(payload.capturedAt);
  if (!Number.isFinite(newTs)) return false;
  let currentTs = NaN;
  try {
    const cur = JSON.parse(fs.readFileSync(cfg.rateLimitsFile, 'utf8'));
    if (cur && cur.capturedAt) currentTs = Date.parse(cur.capturedAt);
  } catch { /* absent or unreadable — any real reading is an improvement */ }
  if (Number.isFinite(currentTs) && currentTs >= newTs) return false;
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const tmp = `${cfg.rateLimitsFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, cfg.rateLimitsFile);
  return true;
}
