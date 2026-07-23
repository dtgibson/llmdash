import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Point every data source at a temp sandbox BEFORE importing (config reads env
// on import). Nothing here touches the real ~/.claude or ~/.codex.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-health-'));
const dataDir = path.join(tmp, 'data');
const codexDir = path.join(tmp, 'codex');
process.env.LLMDASH_DATA_DIR = dataDir;
process.env.LLMDASH_CODEX_DIR = codexDir;
process.env.LLMDASH_CODEX_CMD = path.join(tmp, 'missing', 'codex');
process.env.LLMDASH_CLAUDE_CMD = path.join(tmp, 'missing', 'claude');
delete process.env.LLMDASH_CLAUDE_AUTOREFRESH;

const {
  resolveCommand, dataSourceHealth, healthLines, freshnessModeLine,
  serviceStateLine, resetBillingConfigLine,
} = await import('../src/health.js');
const { config } = await import('../config.js');

test('resolveCommand finds a bare name on the given PATH', () => {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const tool = path.join(bin, 'mytool');
  fs.writeFileSync(tool, '#!/bin/sh\n');
  fs.chmodSync(tool, 0o755);
  assert.equal(resolveCommand('mytool', bin), tool);
  // Also when the PATH has other (empty/missing) entries around it.
  assert.equal(resolveCommand('mytool', `/nonexistent-dir${path.delimiter}${bin}`), tool);
});

test('resolveCommand returns null for a bare name not on PATH (the launchd failure mode)', () => {
  assert.equal(resolveCommand('mytool', '/usr/bin:/bin:/usr/sbin:/sbin'), null);
  assert.equal(resolveCommand('codex', path.join(tmp, 'empty-path-entry')), null);
});

test('resolveCommand checks an explicit path directly', () => {
  const bin = path.join(tmp, 'bin2');
  fs.mkdirSync(bin, { recursive: true });
  const tool = path.join(bin, 'codex');
  fs.writeFileSync(tool, '#!/bin/sh\n');
  fs.chmodSync(tool, 0o755);
  assert.equal(resolveCommand(tool), tool);
  assert.equal(resolveCommand(path.join(bin, 'nope')), null);
});

test('resolveCommand rejects a non-executable file and an empty command', () => {
  const bin = path.join(tmp, 'bin3');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'plainfile'), 'not a program', { mode: 0o644 });
  assert.equal(resolveCommand('plainfile', bin), null);
  assert.equal(resolveCommand('', bin), null);
  assert.equal(resolveCommand(null, bin), null);
});

test('dataSourceHealth reports the fresh-install state honestly (everything missing)', () => {
  const h = dataSourceHealth();
  assert.equal(h.claudeRatelimits.present, false);
  assert.equal(h.claudeRatelimits.ageMs, null);
  assert.equal(h.claudeCmd.resolved, null);
  assert.equal(h.codexCmd.resolved, null);
  assert.equal(h.codexSessions.present, false);
});

test('dataSourceHealth sees the sources once they exist, with a sane age', () => {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'claude-ratelimits.json'), '{}');
  fs.mkdirSync(path.join(codexDir, 'sessions'), { recursive: true });
  const h = dataSourceHealth();
  assert.equal(h.claudeRatelimits.present, true);
  assert.ok(Number.isFinite(h.claudeRatelimits.ageMs) && h.claudeRatelimits.ageMs >= 0);
  assert.equal(h.codexSessions.present, true);
});

test('healthLines names each missing source and its fix', () => {
  const out = healthLines({
    claudeRatelimits: { file: '/x/claude-ratelimits.json', present: false, ageMs: null },
    claudeCmd: { cmd: 'claude', resolved: null },
    codexCmd: { cmd: 'codex', resolved: null },
    codexSessions: { dir: '/x/sessions', present: false },
  }).join('\n');
  assert.match(out, /no statusline reading yet/);
  assert.match(out, /renders its status line/); // one way a reading arrives
  assert.match(out, /auto-refresh captures one after Claude activity/); // the other way
  assert.match(out, /claude command not found \("claude"\)/);
  assert.match(out, /LLMDASH_CLAUDE_CMD/); // the auto-refresh fix
  assert.match(out, /codex command not found \("codex"\)/);
  assert.match(out, /LLMDASH_CODEX_CMD/); // the fix
  assert.match(out, /no Codex sessions recorded on this machine yet/);
});

test('healthLines reports healthy sources as present/OK, with reading age and stale band (QA-14)', () => {
  const out = healthLines({
    claudeRatelimits: { file: '/x/claude-ratelimits.json', present: true, ageMs: 90_000 },
    claudeCmd: { cmd: '/usr/local/bin/claude', resolved: '/usr/local/bin/claude' },
    codexCmd: { cmd: '/usr/local/bin/codex', resolved: '/usr/local/bin/codex' },
    codexSessions: { dir: '/x/sessions', present: true },
  }).join('\n');
  assert.match(out, /statusline reading present \(updated 1m ago; marked stale after 10m\)/);
  // The refresh reality rides along with the healthy line: statusline renders
  // AND the auto-refresh mechanism (FR-29).
  assert.match(out, /via auto-refresh within minutes of Claude activity/);
  assert.match(out, /claude command OK \(\/usr\/local\/bin\/claude\)/);
  assert.match(out, /codex command OK \(\/usr\/local\/bin\/codex\)/);
  assert.match(out, /sessions dir present/);
  // The refuted manual-only claim never prints on the healthy path (QA-27).
  assert.doesNotMatch(out, /refresh only when a real Claude Code session renders/);
});

test('resetBillingConfigLine discloses the empty state, fixed route, and write posture', () => {
  const line = resetBillingConfigLine({
    state: 'empty', reason: 'account_config_missing', config: null,
    file: '/x/account-config.json',
  }, { subscriptionsFile: '/x/subscriptions.json' });
  assert.match(line, /no account configuration saved at \/x\/account-config\.json/);
  assert.match(line, /no fallback reset or recurring monthly amount is assumed/);
  assert.match(line, /Open \/settings on this same llmdash origin/);
  assert.match(line, /exact same-origin PUT \/api\/config\/reset-billing/);
  assert.match(line, /legacy fixed periods remain read-only at \/x\/subscriptions\.json/);
});

test('resetBillingConfigLine reports degraded state without leaking configuration values or secrets', () => {
  const line = resetBillingConfigLine({
    state: 'last-valid', reason: 'account_config_invalid',
    file: '/x/account-config.json',
    csrfToken: 'sentinel-csrf-token',
    config: {
      resetSchedule: { isoWeekday: 5, localTime: '23:00', timeZone: 'America/Secret_Zone' },
      recurringPlans: [{ amountCents: 8675309 }],
    },
  }, { subscriptionsFile: '/x/subscriptions.json' });
  assert.match(line, /serving the last validated account configuration/);
  assert.match(line, /on-disk file .* is not currently usable/);
  assert.match(line, /Configuration values are not printed/);
  assert.doesNotMatch(line, /23:00|America\/Secret_Zone|8675309|sentinel-csrf-token/);

  const unavailable = resetBillingConfigLine({
    state: 'unavailable', reason: 'account_config_unreadable', config: null,
    file: '/x/account-config.json',
  }, { subscriptionsFile: '/x/subscriptions.json' });
  assert.match(unavailable, /configuration unavailable/);
  assert.match(unavailable, /unsafe or invalid content will not be overwritten/);
});

test('healthLines includes the reset and billing startup disclosure', () => {
  const out = healthLines({
    claudeRatelimits: { file: '/x/claude-ratelimits.json', present: false, ageMs: null },
    claudeCmd: { cmd: 'claude', resolved: null },
    codexCmd: { cmd: 'codex', resolved: null },
    codexSessions: { dir: '/x/sessions', present: false },
  }).join('\n');
  assert.match(out, /Reset & billing:/);
  assert.match(out, /Open \/settings on this same llmdash origin/);
  assert.match(out, /Configuration values are not printed in this health log/);
});

test('freshnessModeLine states the shipped auto-refresh mechanism, cadence, knobs, and disclosures (FR-28)', () => {
  const line = freshnessModeLine();
  assert.match(line, /auto-refresh/);
  assert.match(line, /spawns a short-lived Claude Code session/); // the mechanism, plainly
  assert.match(line, /\/usage/);
  assert.match(line, /older than 5m/); // the threshold…
  assert.match(line, /active within 10m/); // …and the activity window
  assert.match(line, /no message is sent and no plan usage is consumed/);
  assert.match(line, /LLMDASH_CLAUDE_AUTOREFRESH=0/); // the off-switch, by name
  assert.match(line, /claude-refresh-cwd/); // the dedicated cwd
  assert.match(line, /trust this folder/); // the one-time trust entry
  assert.match(line, /history\.jsonl/); // the per-refresh append
  assert.match(line, /LLMDASH_CLAUDE_MAX_AGE_MS/); // the knob, by name
  assert.match(line, /default 300000 ms = 5m/); // its default, surfaced
  assert.match(line, /2x/); // the derived stale band rule
  // The refuted manual-only claim is gone (QA-27).
  assert.doesNotMatch(line, /refresh only when a real Claude Code session renders/);
});

test('freshnessModeLine reflects a customized knob while keeping the default visible', () => {
  const line = freshnessModeLine({ ...config, claudeMaxAgeMs: 120_000, claudeStaleAfterMs: 240_000 });
  assert.match(line, /older than 2m/);
  assert.match(line, /older than 4m as stale/);
  assert.match(line, /default 300000/);
});

test('freshnessModeLine states the disabled reality when the off-switch is set', () => {
  const line = freshnessModeLine({ ...config, claudeAutoRefresh: false });
  assert.match(line, /auto-refresh is OFF \(LLMDASH_CLAUDE_AUTOREFRESH=0\)/);
  assert.match(line, /unset the variable and restart to re-enable/);
  // Disabled means the manual path IS the only path — saying so is honest here.
  assert.match(line, /only when a real Claude Code session renders its status line/);
});

// ── serviceStateLine — the menu-bar service/uninstall disclosure (FR-22/QA-22) ─

test('serviceStateLine names the service state + uninstall scope, DB-preserved-by-default (QA-22)', () => {
  const present = serviceStateLine({ plistPresent: true, checkout: '/scratch/co' });
  assert.match(present, /Service: launchd agent present/);
  assert.match(present, /install\/remove or uninstall it/);
  assert.match(present, /\/scratch\/co/);                // the checkout it would act on
  assert.match(present, /preserving llmdash\.db by default/);
  assert.match(present, /separate, explicit opt-in/);

  const absent = serviceStateLine({ plistPresent: false, checkout: '/scratch/co' });
  assert.match(absent, /no launchd agent plist on disk/);
  assert.match(absent, /"Install the local service" can \(re\)create it/);
  assert.match(absent, /preserving llmdash\.db by default/);
});

test('healthLines includes the service-state disclosure line (QA-22)', () => {
  const out = healthLines({
    claudeRatelimits: { file: '/x/claude-ratelimits.json', present: false, ageMs: null },
    claudeCmd: { cmd: 'claude', resolved: null },
    codexCmd: { cmd: 'codex', resolved: null },
    codexSessions: { dir: '/x/sessions', present: false },
  }).join('\n');
  assert.match(out, /Service: (launchd agent present|no launchd agent plist on disk)/);
  assert.match(out, /preserving llmdash\.db by default/);
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
