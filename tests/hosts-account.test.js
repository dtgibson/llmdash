import test from 'node:test';
import assert from 'node:assert/strict';
import { accountKey, groupAccounts, sharedKeys, joinLabels, ACCT_TOL_MS } from '../src/host-view.js';

// The detect-and-collapse derivation (FR-15, the ratified centerpiece). Two
// machines on the SAME account share identical per-window reset epochs, so they
// group; different accounts don't. Bucketing by TOL absorbs clock skew so one
// account never splits into two.
const iso = (ms) => new Date(ms).toISOString();
const BASE = Date.UTC(2026, 6, 2, 12, 0, 0);

const toolWith = (source, fhResetMs, sdResetMs) => ({
  source,
  limits: {
    five_hour: fhResetMs == null ? null : { usedPct: 50, resetsAt: iso(fhResetMs) },
    seven_day: sdResetMs == null ? null : { usedPct: 40, resetsAt: iso(sdResetMs) },
  },
});
const host = (label, reachable, tools) => ({ label, reachable, state: reachable ? { tools } : null });

test('accountKey is null when a tool has no usable reading (not groupable)', () => {
  assert.equal(accountKey(toolWith('claude-code', null, null)), null);
  assert.equal(accountKey({ source: 'codex' }), null);
  assert.equal(accountKey(null), null);
});

test('two hosts with identical reset epochs share one account key', () => {
  const a = accountKey(toolWith('claude-code', BASE + 3 * 3600_000, BASE + 3 * 86400_000));
  const b = accountKey(toolWith('claude-code', BASE + 3 * 3600_000, BASE + 3 * 86400_000));
  assert.equal(a, b);
});

test('epochs within the same TOL bucket collapse to the same key (skew absorbed)', () => {
  // Same-account machines report the SAME account-wide resetsAt; the TOL bucket
  // additionally absorbs a small (few-second) capture-time skew within a bucket.
  const anchor = Math.round((BASE + 3 * 3600_000) / ACCT_TOL_MS) * ACCT_TOL_MS; // a bucket center
  const a = accountKey(toolWith('claude-code', anchor + 2_000, BASE + 3 * 86400_000));
  const b = accountKey(toolWith('claude-code', anchor + 5_000, BASE + 3 * 86400_000));
  assert.equal(a, b, 'a few-seconds skew inside a bucket must not split one account');
});

test('identical account-wide resetsAt (the real same-account case) always matches exactly', () => {
  // Two machines on one account observe the SAME reset windows, so their epochs
  // are truly equal — the primary, exact path (no reliance on bucket tolerance).
  const fh = BASE + 2 * 3600_000 + 41 * 60_000, sd = BASE + 3 * 86400_000 + 5 * 3600_000;
  assert.equal(
    accountKey(toolWith('claude-code', fh, sd)),
    accountKey(toolWith('claude-code', fh, sd)));
});

test('epochs far apart (a different account) yield different keys', () => {
  const a = accountKey(toolWith('claude-code', BASE + 3 * 3600_000, BASE + 3 * 86400_000));
  const b = accountKey(toolWith('claude-code', BASE + 1 * 3600_000, BASE + 6 * 86400_000));
  assert.notEqual(a, b);
});

test('groupAccounts groups same-account reachable hosts per source; sharedKeys flags ≥2 (QA-15)', () => {
  const claudeTool = () => toolWith('claude-code', BASE + 3 * 3600_000, BASE + 3 * 86400_000);
  const hosts = [
    host('This machine', true, [claudeTool()]),
    host('Desktop', true, [claudeTool()]),
  ];
  const groups = groupAccounts(hosts);
  const shared = sharedKeys(groups);
  assert.equal(groups['claude-code'].size, 1, 'both hosts land in one account group');
  assert.equal([...shared['claude-code']].length, 1, 'that key is shared (≥2 hosts)');
});

test('a genuinely different-account host does NOT join the shared group (reads distinct, QA-15)', () => {
  const same = () => toolWith('claude-code', BASE + 3 * 3600_000, BASE + 3 * 86400_000);
  const different = toolWith('claude-code', BASE + 1 * 3600_000, BASE + 6 * 86400_000);
  const hosts = [
    host('This machine', true, [same()]),
    host('Desktop', true, [same()]),
    host('Work laptop', true, [different]),
  ];
  const groups = groupAccounts(hosts);
  const shared = sharedKeys(groups);
  // Two keys: the shared one (2 hosts) and the distinct one (1 host, NOT shared).
  assert.equal(groups['claude-code'].size, 2);
  assert.equal([...shared['claude-code']].length, 1, 'only the ≥2 group is collapsed');
  const distinctKey = accountKey(different);
  assert.ok(!shared['claude-code'].has(distinctKey), 'the different account is not collapsed');
});

test('Claude and Codex group INDEPENDENTLY (shared Claude, different Codex)', () => {
  const claudeShared = () => toolWith('claude-code', BASE + 3 * 3600_000, BASE + 3 * 86400_000);
  const hosts = [
    host('This machine', true, [claudeShared(), toolWith('codex', BASE + 1 * 3600_000, BASE + 4 * 86400_000)]),
    host('Desktop', true, [claudeShared(), toolWith('codex', BASE + 2 * 3600_000, BASE + 5 * 86400_000)]),
  ];
  const shared = sharedKeys(groupAccounts(hosts));
  assert.equal([...(shared['claude-code'] || [])].length, 1, 'Claude is shared across the two');
  assert.equal([...(shared['codex'] || [])].length, 0, 'Codex accounts differ → not shared');
});

test('an offline host never participates in grouping (QA-13/QA-15)', () => {
  const same = () => toolWith('claude-code', BASE + 3 * 3600_000, BASE + 3 * 86400_000);
  const hosts = [
    host('This machine', true, [same()]),
    host('Work laptop', false, null), // offline
  ];
  const groups = groupAccounts(hosts);
  const members = [...groups['claude-code'].values()][0];
  assert.equal(members.length, 1, 'only the reachable host is a group member');
});

test('a host with no reading for a tool contributes no key (shows not-available in-group)', () => {
  const hosts = [
    host('This machine', true, [toolWith('claude-code', BASE + 3 * 3600_000, BASE + 3 * 86400_000)]),
    host('Desktop', true, [toolWith('claude-code', null, null)]), // no reading
  ];
  const groups = groupAccounts(hosts);
  const shared = sharedKeys(groups);
  assert.equal([...(shared['claude-code'] || [])].length, 0, 'no ≥2 group — the no-reading host is not folded in');
});

test('joinLabels: A / A & B / A, B & C', () => {
  assert.equal(joinLabels(['A']), 'A');
  assert.equal(joinLabels(['A', 'B']), 'A & B');
  assert.equal(joinLabels(['A', 'B', 'C']), 'A, B & C');
});

test('single reachable host ⇒ no shared group (no banner)', () => {
  const hosts = [host('This machine', true, [toolWith('claude-code', BASE + 3 * 3600_000, BASE + 3 * 86400_000)])];
  const shared = sharedKeys(groupAccounts(hosts));
  assert.equal([...(shared['claude-code'] || [])].length, 0);
});
