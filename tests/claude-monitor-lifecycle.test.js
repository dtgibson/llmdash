import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import {
  cleanupStaleClaudeProbes,
  descendantProcesses,
  parseProcessTable,
  sameProcessIdentity,
  staleProbeRoots,
  terminateProbeTree,
} from '../src/claude-refresh.js';
import { startPoller, stopPoller } from '../src/poller.js';

const proc = (pid, ppid, startedAt, cmd, { pgid = 100, session = 50 } = {}) => (
  { pid, ppid, pgid, session, startedAt, cmd }
);
const tree = [
  proc(100, 1, 'Thu Jul 16 10:00:00 2026', '/bin/sh runner /tmp/data/claude-usage-probe-90-1.typescript /claude'),
  proc(101, 100, 'Thu Jul 16 10:00:01 2026', 'sleep 300'),
  proc(102, 100, 'Thu Jul 16 10:00:01 2026', '/usr/bin/script /tmp/data/claude-usage-probe-90-1.typescript /claude'),
  // Claude owns a separate pty process group in reality; ancestry, not process
  // group membership, is what keeps this descendant inside the teardown set.
  proc(103, 102, 'Thu Jul 16 10:00:02 2026', '/somewhere/claude', { pgid: 103 }),
  proc(104, 103, 'Thu Jul 16 10:00:03 2026', 'claude helper', { pgid: 103 }),
  proc(900, 1, 'Thu Jul 16 09:00:00 2026', '/somewhere/claude --user-session', { pgid: 900, session: 40 }),
];

test('process-table parsing captures kernel birth time plus PID/PPID/PGID/session identity', () => {
  const parsed = parseProcessTable('  103   102   103    50 Thu Jul 16 10:00:02 2026     /somewhere/claude\n');
  assert.deepEqual(parsed, [tree[3]]);
});

test('probe teardown captures complete descendant identities and excludes an independent Claude CLI', () => {
  const descendants = descendantProcesses(tree, tree[0]);
  assert.deepEqual(descendants.map((p) => p.pid), [104, 103, 101, 102]);
  assert.equal(descendants.some((p) => p.pid === 900), false);
  assert.equal(sameProcessIdentity(tree[3], { ...tree[3], ppid: 1 }), true, 'reparenting preserves identity');
  assert.equal(sameProcessIdentity(tree[3], { ...tree[3], startedAt: 'Thu Jul 16 10:05:00 2026' }), false, 'PID reuse does not');
});

test('probe teardown revalidates and individually TERM→KILLs every ancestry-proven process', async () => {
  const sent = [];
  let identityReads = 0;
  await terminateProbeTree(tree[0], {
    initialTable: tree,
    table: async () => { identityReads++; return tree; },
    wait: async () => {},
    send: (pid, signal) => sent.push([pid, signal]),
  });
  for (const pid of [100, 101, 102, 103, 104]) {
    assert.ok(sent.some(([got, signal]) => got === pid && signal === 'SIGTERM'), `TERM ${pid}`);
    assert.ok(sent.some(([got, signal]) => got === pid && signal === 'SIGKILL'), `KILL ${pid}`);
  }
  assert.equal(identityReads, 10, 'one fresh identity read immediately before each of 5 TERM + 5 KILL signals');
  assert.equal(sent.some(([pid]) => pid < 0), false, 'no reusable numeric process group is ever signaled');
  assert.equal(sent.some(([pid]) => pid === 900), false, 'the live user CLI is structurally unreachable');
});

test('teardown source contains no negative-PGID signal path', () => {
  const src = fs.readFileSync(new URL('../src/claude-refresh.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /process\.kill\(\s*-/);
  assert.doesNotMatch(src, /send\(\s*-/);
});

async function reuseScenario(changeDuringGrace) {
  let current = tree.map((p) => ({ ...p }));
  const sent = [];
  await terminateProbeTree(tree[0], {
    initialTable: tree,
    table: async () => current.map((p) => ({ ...p })),
    wait: async () => { current = changeDuringGrace(current); },
    send: (pid, signal) => {
      const live = current.find((p) => p.pid === pid);
      sent.push({ pid, signal, startedAt: live && live.startedAt, pgid: live && live.pgid });
    },
  });
  return sent;
}

test('descendant PID reuse during grace is never KILLed; a reparented owned resistant child is', async () => {
  const replacementStart = 'Thu Jul 16 10:10:00 2026';
  const sent = await reuseScenario((current) => current.map((p) => {
    if (p.pid === 103) return proc(103, 1, replacementStart, '/somewhere/claude --unrelated', { pgid: 777, session: 60 });
    if (p.pid === 104) return { ...p, ppid: 1 }; // original identity, reparented
    return p;
  }));
  assert.equal(sent.some((e) => e.startedAt === replacementStart), false, 'replacement descendant receives no signal');
  assert.ok(sent.some((e) => e.pid === 104 && e.signal === 'SIGKILL'), 'owned reparented descendant receives KILL');
  assert.equal(sent.some((e) => e.pid === 900), false, 'independent CLI receives no signal');
});

test('root PID reuse during grace is never KILLed while surviving owned descendants still are', async () => {
  const replacementStart = 'Thu Jul 16 10:11:00 2026';
  const sent = await reuseScenario((current) => current.map((p) => {
    if (p.pid === 100) return proc(100, 1, replacementStart, '/unrelated/root', { pgid: 100, session: 50 });
    if ([101, 102, 103, 104].includes(p.pid)) return { ...p, ppid: 1 };
    return p;
  }));
  assert.equal(sent.some((e) => e.startedAt === replacementStart), false, 'replacement root receives no signal');
  assert.ok(sent.some((e) => e.pid === 104 && e.signal === 'SIGKILL'), 'owned descendant remains killable by identity');
  assert.equal(sent.some((e) => e.pid === 900), false, 'independent CLI receives no signal');
});

test('PGID reuse during grace cannot receive a group signal; owned TERM-resistant processes still receive KILL', async () => {
  const pgidReuser = proc(700, 1, 'Thu Jul 16 10:12:00 2026', '/unrelated/group-leader', { pgid: 100, session: 70 });
  const sent = await reuseScenario((current) => [
    ...current.filter((p) => p.pid !== 100).map((p) => (
      [101, 102, 103, 104].includes(p.pid) ? { ...p, ppid: 1 } : p
    )),
    pgidReuser,
  ]);
  assert.equal(sent.some((e) => e.pid === 700), false, 'new owner of the numeric PGID receives no signal');
  assert.equal(sent.some((e) => e.pid < 0), false, 'negative-PGID signaling is absent');
  assert.ok(sent.some((e) => e.pid === 104 && e.signal === 'SIGKILL'), 'owned descendant receives KILL');
  assert.equal(sent.some((e) => e.pid === 900), false, 'independent CLI receives no signal');
});

test('startup cleanup recognizes only exact generated probe markers and preserves the last-known-good reading', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-probe-cleanup-'));
  const reading = path.join(tmp, 'claude-ratelimits.json');
  const scratch = path.join(tmp, 'claude-usage-probe-90-1.typescript');
  fs.writeFileSync(reading, '{"last":"good"}');
  fs.writeFileSync(scratch, 'pty scratch');
  const procs = [
    proc(200, 1, 'Thu Jul 16 10:20:00 2026', `/bin/sh runner ${scratch} /claude`, { pgid: 200 }),
    proc(201, 200, 'Thu Jul 16 10:20:01 2026', `/usr/bin/script ${scratch} /claude`, { pgid: 200 }),
    proc(202, 1, 'Thu Jul 16 10:20:02 2026', `${scratch}.bak`, { pgid: 202 }),
  ];
  assert.deepEqual(staleProbeRoots(procs, { dataDir: tmp }).map((p) => p.pid), [200]);
  const terminated = [];
  await cleanupStaleClaudeProbes({
    cfg: { dataDir: tmp },
    table: async () => procs,
    terminate: async (root) => terminated.push(root.pid),
  });
  assert.deepEqual(terminated, [200]);
  assert.equal(fs.existsSync(scratch), false);
  assert.equal(fs.readFileSync(reading, 'utf8'), '{"last":"good"}');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('poller start is idempotent and stop clears the one monitor interval', async () => {
  let intervalStarts = 0;
  let intervalClears = 0;
  let polls = 0;
  const setIntervalImpl = () => { intervalStarts++; return 77; };
  const clearIntervalImpl = (handle) => {
    assert.equal(handle, 77);
    intervalClears++;
  };
  const opts = {
    poll: async () => { polls++; },
    prepare: async () => {},
    intervalMs: 10,
    setIntervalImpl,
    clearIntervalImpl,
  };
  const firstStop = startPoller(opts);
  const secondStop = startPoller(opts);
  assert.equal(firstStop, secondStop);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(intervalStarts, 1);
  assert.equal(polls, 1);
  await stopPoller();
  assert.equal(intervalClears, 1);
});

test('the direct server reload/exit path awaits monitor shutdown before closing', () => {
  const src = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(src, /process\.once\('SIGTERM', shutdown\)/);
  assert.match(src, /process\.once\('SIGINT', shutdown\)/);
  const shutdown = src.slice(src.indexOf('const shutdown = async'), src.indexOf("process.once('SIGTERM'"));
  assert.match(shutdown, /await stopPoller\(\)/);
  assert.ok(shutdown.indexOf('await stopPoller()') < shutdown.indexOf('server.close('));
});
