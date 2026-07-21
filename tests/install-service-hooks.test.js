import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

// ── install-macos.sh --service install|remove|status — the launchctl/plist hooks ─
// (menubar-service-controls, FR-02/FR-03/FR-04/FR-07/FR-08/FR-17.)
//
// SCRATCH ONLY. Every spawn injects:
//   - a DISTINCT launchd label (com.llmdash.spike-*) — NEVER com.llmdash.dashboard,
//   - a scratch LaunchAgents dir (LLMDASH_LAUNCH_AGENTS_DIR) — NEVER ~/Library/…,
//   - a scratch checkout (with the plist template + a trivial server.js),
//   - fake absolute node/codex/claude bins on PATH.
// The real service, real plist, real checkout, and real data are NEVER touched.
// A scratch agent that a test bootstraps is booted out in test.after (cleanup is
// verified; a real com.llmdash.dashboard is left untouched).

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'scripts', 'install-macos.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-svc-hooks-'));
const uid = String(os.userInfo().uid);
// One distinct scratch label NAMESPACE per test FILE — never the real one, and
// disjoint from the other launchd-touching test file (so a parallel run's cleanup
// asserts only about ITS OWN labels). Recorded so test.after can boot out anything
// a test left loaded (defensive; each test also removes).
const NS = `com.llmdash.spike-svchooks-${process.pid}`;
const LABEL = NS;
const bootedLabels = new Set();

function fakeBin(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, '#!/bin/sh\n');
  fs.chmodSync(fp, 0o755);
  return fp;
}

function fakeLaunchctlHarness(mode) {
  const dir = fs.mkdtempSync(path.join(tmp, `launchctl-${mode}-`));
  const log = path.join(dir, 'calls.log');
  const state = path.join(dir, 'state');
  const printCount = path.join(dir, 'print-count');
  const bootstrapCount = path.join(dir, 'bootstrap-count');
  const hangPid = path.join(dir, 'hang.pid');
  const descendantPid = path.join(dir, 'descendant.pid');
  const launchctl = path.join(dir, 'launchctl');
  fs.writeFileSync(launchctl, `#!/bin/sh
set -u
printf '%s\\n' "$*" >> "$LLMDASH_FAKE_LAUNCHCTL_LOG"
command="$1"

hang_forever() {
  printf '%s\\n' "$$" > "$LLMDASH_FAKE_LAUNCHCTL_HANG_PID"
  trap '' TERM
  exec >/dev/null 2>&1
  exec /bin/sleep 60
}

if [ "$command" = "bootout" ]; then
  case "$LLMDASH_FAKE_LAUNCHCTL_MODE" in
    hang-bootout)
      echo 'Boot-out began, then hung.' >&2
      hang_forever
      ;;
    bootout-error-stuck)
      printf '%s\\n' old > "$LLMDASH_FAKE_LAUNCHCTL_STATE"
      echo 'Boot-out failed: 78: Function not implemented' >&2
      exit 78
      ;;
    bootout-error-absent)
      printf '%s\\n' absent > "$LLMDASH_FAKE_LAUNCHCTL_STATE"
      echo 'Boot-out failed: 78: already absent' >&2
      exit 78
      ;;
    bootout-status-124-absent)
      printf '%s\\n' absent > "$LLMDASH_FAKE_LAUNCHCTL_STATE"
      echo 'Boot-out failed: 124: Operation canceled' >&2
      exit 124
      ;;
    delayed-absence|never-absent|hang-print-second|hang-poll-sleep|forked-poll-sleep)
      printf '%s\\n' old > "$LLMDASH_FAKE_LAUNCHCTL_STATE"
      ;;
    *) printf '%s\\n' absent > "$LLMDASH_FAKE_LAUNCHCTL_STATE" ;;
  esac
  exit 0
fi

current_state="absent"
if [ -f "$LLMDASH_FAKE_LAUNCHCTL_STATE" ]; then
  current_state="$(cat "$LLMDASH_FAKE_LAUNCHCTL_STATE")"
fi

if [ "$command" = "print" ]; then
  if [ "$LLMDASH_FAKE_LAUNCHCTL_MODE" = "print-error" ]; then
    echo 'Could not print service: 78: Function not implemented' >&2
    exit 78
  fi
  if [ "$LLMDASH_FAKE_LAUNCHCTL_MODE" = "print-status-124" ]; then
    echo 'Could not print service: 124: Operation canceled' >&2
    exit 124
  fi
  if [ "$LLMDASH_FAKE_LAUNCHCTL_MODE" = "hang-print-second" ]; then
    count=0
    if [ -f "$LLMDASH_FAKE_LAUNCHCTL_PRINT_COUNT" ]; then
      count="$(cat "$LLMDASH_FAKE_LAUNCHCTL_PRINT_COUNT")"
    fi
    count=$((count + 1))
    printf '%s\\n' "$count" > "$LLMDASH_FAKE_LAUNCHCTL_PRINT_COUNT"
    if [ "$count" -eq 1 ]; then
      exit 0
    fi
    echo 'Print began, then hung.' >&2
    hang_forever
  fi
  if [ "$current_state" = "loaded" ]; then
    exit 0
  fi
  if [ "$LLMDASH_FAKE_LAUNCHCTL_MODE" = "never-absent" ] ||
     [ "$LLMDASH_FAKE_LAUNCHCTL_MODE" = "bootout-error-stuck" ] ||
     [ "$LLMDASH_FAKE_LAUNCHCTL_MODE" = "hang-poll-sleep" ] ||
     [ "$LLMDASH_FAKE_LAUNCHCTL_MODE" = "forked-poll-sleep" ]; then
    exit 0
  fi
  if [ "$LLMDASH_FAKE_LAUNCHCTL_MODE" = "delayed-absence" ] && [ "$current_state" = "old" ]; then
    count=0
    if [ -f "$LLMDASH_FAKE_LAUNCHCTL_PRINT_COUNT" ]; then
      count="$(cat "$LLMDASH_FAKE_LAUNCHCTL_PRINT_COUNT")"
    fi
    count=$((count + 1))
    printf '%s\\n' "$count" > "$LLMDASH_FAKE_LAUNCHCTL_PRINT_COUNT"
    if [ "$count" -le 2 ]; then
      exit 0
    fi
    printf '%s\\n' absent > "$LLMDASH_FAKE_LAUNCHCTL_STATE"
  fi
  exit 113
fi

if [ "$command" = "bootstrap" ]; then
  count=0
  if [ -f "$LLMDASH_FAKE_LAUNCHCTL_BOOTSTRAP_COUNT" ]; then
    count="$(cat "$LLMDASH_FAKE_LAUNCHCTL_BOOTSTRAP_COUNT")"
  fi
  count=$((count + 1))
  printf '%s\\n' "$count" > "$LLMDASH_FAKE_LAUNCHCTL_BOOTSTRAP_COUNT"
  case "$LLMDASH_FAKE_LAUNCHCTL_MODE" in
    error-5-once|hang-retry-sleep)
      if [ "$count" -eq 1 ]; then
        echo 'Bootstrap failed: 5: Input/output error' >&2
        exit 5
      fi
      ;;
    persistent-error-5)
      echo 'Bootstrap failed: 5: Input/output error' >&2
      exit 5
      ;;
    non-5-error)
      echo 'Bootstrap failed: 78: Function not implemented' >&2
      exit 78
      ;;
    bootstrap-status-124)
      echo 'Bootstrap failed: 124: Operation canceled' >&2
      exit 124
      ;;
    hang-bootstrap-first)
      echo 'Bootstrap began, then hung.' >&2
      hang_forever
      ;;
    hang-bootstrap-second)
      if [ "$count" -eq 1 ]; then
        echo 'Bootstrap failed: 5: Input/output error' >&2
        exit 5
      fi
      echo 'Second bootstrap began, then hung.' >&2
      hang_forever
      ;;
  esac
  printf '%s\\n' loaded > "$LLMDASH_FAKE_LAUNCHCTL_STATE"
  exit 0
fi

exit 64
`);
  fs.chmodSync(launchctl, 0o755);
  const sleep = path.join(dir, 'sleep');
fs.writeFileSync(sleep, `#!/bin/sh
set -u
if [ "$LLMDASH_FAKE_LAUNCHCTL_MODE" = "forked-poll-sleep" ] && [ "\${1:-}" = "0.1" ]; then
  echo 'Forked sleep wrapper began, then hung.' >&2
  printf '%s\\n' "$$" > "$LLMDASH_FAKE_LAUNCHCTL_HANG_PID"
  trap '' TERM
  /bin/sleep 60 &
  descendant_pid=$!
  printf '%s\\n' "$descendant_pid" > "$LLMDASH_FAKE_LAUNCHCTL_DESCENDANT_PID"
  wait "$descendant_pid"
fi
if { [ "$LLMDASH_FAKE_LAUNCHCTL_MODE" = "hang-poll-sleep" ] && [ "\${1:-}" = "0.1" ]; } ||
   { [ "$LLMDASH_FAKE_LAUNCHCTL_MODE" = "hang-retry-sleep" ] && [ "\${1:-}" = "0.2" ]; }; then
  echo "Sleep \${1:-} began, then hung." >&2
  printf '%s\\n' "$$" > "$LLMDASH_FAKE_LAUNCHCTL_HANG_PID"
  trap '' TERM
  exec >/dev/null 2>&1
  exec /bin/sleep 60
fi
exit 0
`);
  fs.chmodSync(sleep, 0o755);
  return {
    dir,
    hangPid,
    descendantPid,
    env: {
      LLMDASH_FAKE_LAUNCHCTL_MODE: mode,
      LLMDASH_FAKE_LAUNCHCTL_LOG: log,
      LLMDASH_FAKE_LAUNCHCTL_STATE: state,
      LLMDASH_FAKE_LAUNCHCTL_PRINT_COUNT: printCount,
      LLMDASH_FAKE_LAUNCHCTL_BOOTSTRAP_COUNT: bootstrapCount,
      LLMDASH_FAKE_LAUNCHCTL_HANG_PID: hangPid,
      LLMDASH_FAKE_LAUNCHCTL_DESCENDANT_PID: descendantPid,
      TMPDIR: dir,
    },
    calls() {
      if (!fs.existsSync(log)) return [];
      return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
    },
    deadlineFiles() {
      return fs.readdirSync(dir).filter((name) => name.startsWith('llmdash-deadline.'));
    },
  };
}

// A scratch checkout: the plist template + a trivial (sleep-loop) server.js so a
// bootstrap has a real program to run. NOT the real server.
function scratchCheckout() {
  const dir = fs.mkdtempSync(path.join(tmp, 'checkout-'));
  fs.mkdirSync(path.join(dir, 'macos'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'macos', 'com.llmdash.dashboard.plist.example'),
    path.join(dir, 'macos', 'com.llmdash.dashboard.plist.example'));
  fs.copyFileSync(script, path.join(dir, 'scripts', 'install-macos.sh'));
  fs.writeFileSync(path.join(dir, 'src', 'server.js'), 'setInterval(() => {}, 1e9);\n');
  return dir;
}

// Fake absolute node/codex/claude so resolve_* produce absolute paths.
const binDir = path.join(tmp, 'bin');
const fakeNode = fakeBin(binDir, 'node');
const fakeCodex = fakeBin(binDir, 'codex');
const fakeClaude = fakeBin(binDir, 'claude');
const SYS_PATH = `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`;
const HANG_TEST_OUTER_TIMEOUT_MS = 8000;
let acceleratedScript;
let deadlineHarness;
let delayedObservationDeadlineHarness;

function scriptWithAcceleratedDeadlines() {
  if (acceleratedScript) return acceleratedScript;
  const source = fs.readFileSync(script, 'utf8');
  assert.equal((source.match(/^SERVICE_LAUNCHCTL_DEADLINE_SECONDS=5$/gm) || []).length, 1);
  assert.equal((source.match(/^SERVICE_SLEEP_DEADLINE_SECONDS=1$/gm) || []).length, 1);
  assert.equal((source.match(/^SERVICE_BOOTOUT_WAIT_ATTEMPTS=50$/gm) || []).length, 1);
  acceleratedScript = path.join(tmp, 'install-macos-short-deadlines.sh');
  fs.writeFileSync(acceleratedScript, source
    .replace('SERVICE_LAUNCHCTL_DEADLINE_SECONDS=5', 'SERVICE_LAUNCHCTL_DEADLINE_SECONDS=1')
    .replace('SERVICE_BOOTOUT_WAIT_ATTEMPTS=50', 'SERVICE_BOOTOUT_WAIT_ATTEMPTS=3'));
  fs.chmodSync(acceleratedScript, 0o755);
  return acceleratedScript;
}

function runWithDeadline(args, { timeout = 7000, delayedObservation = false } = {}) {
  let selectedHarness = delayedObservation ? delayedObservationDeadlineHarness : deadlineHarness;
  if (!selectedHarness) {
    const source = fs.readFileSync(script, 'utf8');
    const helperStart = source.indexOf('SERVICE_WATCHDOG_POLL_SECONDS=');
    const helperEnd = source.indexOf('\nwait_for_service_absent() {');
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'deadline helper source is extractable');
    let helperSource = source.slice(helperStart, helperEnd);
    if (delayedObservation) {
      assert.equal((helperSource.match(/^SERVICE_WATCHDOG_POLL_SECONDS=0\.01$/gm) || []).length, 1);
      helperSource = helperSource.replace(
        'SERVICE_WATCHDOG_POLL_SECONDS=0.01',
        'SERVICE_WATCHDOG_POLL_SECONDS=1',
      );
    }
    selectedHarness = path.join(tmp,
      delayedObservation ? 'run-with-delayed-observation.sh' : 'run-with-deadline.sh');
    fs.writeFileSync(selectedHarness, `#!/bin/bash
set -euo pipefail
${helperSource}
if run_with_deadline "$@"; then
  exit 0
else
  exit $?
fi
`);
    fs.chmodSync(selectedHarness, 0o755);
    if (delayedObservation) {
      delayedObservationDeadlineHarness = selectedHarness;
    } else {
      deadlineHarness = selectedHarness;
    }
  }
  return spawnSync('/bin/bash', [selectedHarness, ...args], {
    encoding: 'utf8',
    timeout,
    killSignal: 'SIGKILL',
  });
}

function runSvc(args, {
  label = LABEL,
  laDir,
  checkout,
  home,
  commandDir,
  env = {},
  scriptPath = script,
  timeout,
} = {}) {
  return spawnSync('/bin/bash', [scriptPath, ...args], {
    env: {
      ...env,
      PATH: commandDir ? `${commandDir}:${SYS_PATH}` : SYS_PATH,
      HOME: home || path.join(tmp, 'home'),
      LLMDASH_SERVICE_LABEL: label,
      LLMDASH_LAUNCH_AGENTS_DIR: laDir,
    },
    encoding: 'utf8',
    timeout,
    killSignal: 'SIGKILL',
  });
}

function assertBoundedTimeout(result, diagnostic) {
  assert.equal(result.error, undefined, `outer process deadline fired: ${result.error?.message || ''}`);
  assert.equal(result.status, 124, result.stderr);
  assert.match(result.stderr, diagnostic);
  assert.doesNotMatch(result.stderr, /(?:Terminated|Killed): [0-9]+/,
    'watchdog job notifications stay out of user diagnostics');
}

function assertPidFileGone(pidFile, description) {
  assert.ok(fs.existsSync(pidFile), `${description} recorded its PID`);
  const pid = fs.readFileSync(pidFile, 'utf8').trim();
  const stillAlive = processIsRunning(pid);
  if (stillAlive) {
    try { process.kill(Number(pid), 'SIGKILL'); } catch {}
  }
  assert.equal(stillAlive, false, `${description} PID ${pid} was terminated and reaped`);
}

function processIsRunning(pid) {
  const processRead = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'pid='], { encoding: 'utf8' });
  return processRead.stdout.trim() === String(pid);
}

function terminateProcess(pid) {
  if (processIsRunning(pid)) {
    try { process.kill(Number(pid), 'SIGKILL'); } catch {}
  }
  for (let attempt = 0; attempt < 40 && processIsRunning(pid); attempt += 1) {
    spawnSync('/bin/sleep', ['0.05']);
  }
}

function assertRecordedProcessGone(fake, description) {
  assertPidFileGone(fake.hangPid, description);
  assertNoDeadlineCaptureFiles(fake, description);
}

function assertNoDeadlineCaptureFiles(fake, description) {
  assert.deepEqual(fake.deadlineFiles(), [], `${description} left no deadline capture file`);
}

test('--service status: not-installed when no plist on disk (QA-04)', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const label = `${LABEL}-ni`;
  const r = runSvc(['--service', 'status'], { label, laDir });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'not-installed');
});

test('--service install: regenerates the plist with ABSOLUTE paths and bootstraps it (QA-02)', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const label = `${LABEL}-install`;
  bootedLabels.add(label);
  const r = runSvc(['--service', 'install', checkout], { label, laDir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /State: running/);

  const plist = path.join(laDir, `${label}.plist`);
  assert.ok(fs.existsSync(plist), 'the scratch plist was written');
  const body = fs.readFileSync(plist, 'utf8');
  // Absolute node/codex/claude + the checkout dir are baked in; NO placeholders remain.
  assert.ok(body.includes(fakeNode), 'absolute node path baked in');
  assert.ok(body.includes(fakeCodex), 'absolute codex path baked in');
  assert.ok(body.includes(fakeClaude), 'absolute claude path baked in');
  assert.ok(body.includes(checkout), 'the checkout dir baked in as WorkingDirectory');
  assert.doesNotMatch(body, /NODE_PATH|PROJECT_DIR|CODEX_PATH|CLAUDE_PATH/, 'no template placeholders left');
  // The scratch label is in the plist, NOT the real one.
  assert.match(body, new RegExp(`<string>${label}</string>`));
  assert.doesNotMatch(body, /<string>com\.llmdash\.dashboard<\/string>/, 'the real label must not leak into a scratch plist');
  // It really bootstrapped into the user domain.
  const printed = spawnSync('/bin/launchctl', ['print', `gui/${uid}/${label}`], { encoding: 'utf8' });
  assert.equal(printed.status, 0, 'the scratch agent is bootstrapped (launchctl print succeeds)');
});

test('--service status: running once bootstrapped, then not-installed after remove (QA-04/QA-08)', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const label = `${LABEL}-cycle`;
  bootedLabels.add(label);
  assert.equal(runSvc(['--service', 'install', checkout], { label, laDir }).status, 0);
  assert.equal(runSvc(['--service', 'status'], { label, laDir }).stdout.trim(), 'running');

  const rm = runSvc(['--service', 'remove'], { label, laDir });
  assert.equal(rm.status, 0, rm.stderr);
  assert.match(rm.stdout, /unloaded and deleted the plist/);
  assert.equal(fs.existsSync(path.join(laDir, `${label}.plist`)), false, 'the scratch plist is gone');
  assert.equal(runSvc(['--service', 'status'], { label, laDir }).stdout.trim(), 'not-installed');
});

test('--service status: stopped when the plist is present but not bootstrapped (QA-08)', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const label = `${LABEL}-stopped`;
  // Drop a plist on disk WITHOUT bootstrapping it → "stopped", not "not-installed".
  fs.writeFileSync(path.join(laDir, `${label}.plist`), '<plist/>');
  const r = runSvc(['--service', 'status'], { label, laDir });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'stopped');
});

test('--service install is idempotent: repeated scratch-label reloads end running (QA-07)', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const label = `${LABEL}-idem`;
  bootedLabels.add(label);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = runSvc(['--service', 'install', checkout], { label, laDir });
    assert.equal(result.status, 0, `reload ${attempt + 1}: ${result.stderr}`);
    assert.match(result.stdout, /State: running/);
  }
});

test('--service install waits until the prior job is absent before bootstrap', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const label = `${LABEL}-wait`;
  const fake = fakeLaunchctlHarness('delayed-absence');
  const result = runSvc(['--service', 'install', checkout], {
    label,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /State: running/);
  assert.deepEqual(fake.calls().map((call) => call.split(' ')[0]), [
    'bootout',
    'print',
    'print',
    'print',
    'bootstrap',
    'print',
  ]);
});

test('--service install retries one bootstrap error 5 and recovers', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const label = `${LABEL}-retry5`;
  const fake = fakeLaunchctlHarness('error-5-once');
  const result = runSvc(['--service', 'install', checkout], {
    label,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /State: running/);
  assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 2);
});

test('--service install bounds persistent bootstrap error 5 and fails loudly', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const label = `${LABEL}-persistent5`;
  const fake = fakeLaunchctlHarness('persistent-error-5');
  const result = runSvc(['--service', 'install', checkout], {
    label,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
  });
  assert.equal(result.status, 5);
  assert.match(result.stderr, /Bootstrap failed: 5: Input\/output error/);
  assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 2);
});

test('--service install does not retry a non-5 bootstrap failure', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const label = `${LABEL}-non5`;
  const fake = fakeLaunchctlHarness('non-5-error');
  const result = runSvc(['--service', 'install', checkout], {
    label,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
  });
  assert.equal(result.status, 78);
  assert.match(result.stderr, /Bootstrap failed: 78: Function not implemented/);
  assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 1);
});

test('--service install fails before bootstrap when the prior job never disappears', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const label = `${LABEL}-stuck`;
  const fake = fakeLaunchctlHarness('never-absent');
  const result = runSvc(['--service', 'install', checkout], {
    label,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`timed out waiting for ${label} to unload`));
  assert.equal(fake.calls().filter((call) => call.startsWith('print ')).length, 50);
  assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 0);
});

test('--service install rejects a non-113 launchctl print failure without bootstrapping', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const label = `${LABEL}-print-error`;
  const fake = fakeLaunchctlHarness('print-error');
  const result = runSvc(['--service', 'install', checkout], {
    label,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
  });
  assert.equal(result.status, 78);
  assert.match(result.stderr, /Could not print service: 78: Function not implemented/);
  assert.match(result.stderr, /launchctl print exited 78/);
  assert.equal(fake.calls().filter((call) => call.startsWith('print ')).length, 1);
  assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 0);
});

test('run_with_deadline makes the timer authoritative at the polling boundary', () => {
  const sleeper = path.join(tmp, 'deadline-sleeper');
  fs.writeFileSync(sleeper, `#!/bin/sh
printf '%s\\n' "$$" > "$1"
exec /bin/sleep "$2"
`);
  fs.chmodSync(sleeper, 0o755);

  const status113 = path.join(tmp, 'deadline-status-113');
  const status5 = path.join(tmp, 'deadline-status-5');
  fs.writeFileSync(status113, '#!/bin/sh\nexit 113\n');
  fs.writeFileSync(status5, '#!/bin/sh\nexit 5\n');
  fs.chmodSync(status113, 0o755);
  fs.chmodSync(status5, 0o755);

  const fastPid = path.join(tmp, 'deadline-fast.pid');
  const fast = runWithDeadline(['5.000', sleeper, fastPid, '0.010']);
  assert.equal(fast.error, undefined, fast.error?.message);
  assert.equal(fast.status, 0, fast.stderr);
  assertPidFileGone(fastPid, 'fast deadline command');
  assert.equal(runWithDeadline(['5.000', status113]).status, 113);
  assert.equal(runWithDeadline(['5.000', status5]).status, 5);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const pidFile = path.join(tmp, `deadline-boundary-${attempt}.pid`);
    const result = runWithDeadline(['0.100', sleeper, pidFile, '0.200'], {
      delayedObservation: true,
      timeout: 3000,
    });
    assert.equal(result.error, undefined, `attempt ${attempt}: ${result.error?.message || ''}`);
    assert.equal(result.status, 124, `attempt ${attempt} escaped the timer: ${result.stderr}`);
    assert.equal(result.stderr, '', `attempt ${attempt} leaked a job notification`);
    assertPidFileGone(pidFile, `post-deadline command attempt ${attempt}`);
  }
});

test('--service install times out and reaps a hanging bootout before any state check', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const fake = fakeLaunchctlHarness('hang-bootout');
  const result = runSvc(['--service', 'install', checkout], {
    label: `${LABEL}-hang-bootout`,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
    scriptPath: scriptWithAcceleratedDeadlines(),
    timeout: HANG_TEST_OUTER_TIMEOUT_MS,
  });
  assertBoundedTimeout(result, /launchctl bootout exceeded 1s/);
  assert.match(result.stderr, /Boot-out began, then hung/);
  assert.equal(fake.calls().filter((call) => call.startsWith('print ')).length, 0);
  assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 0);
  assertRecordedProcessGone(fake, 'hanging bootout');
});

test('--service install times out and reaps a hanging repeated print without bootstrapping', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const fake = fakeLaunchctlHarness('hang-print-second');
  const result = runSvc(['--service', 'install', checkout], {
    label: `${LABEL}-hang-print`,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
    scriptPath: scriptWithAcceleratedDeadlines(),
    timeout: HANG_TEST_OUTER_TIMEOUT_MS,
  });
  assertBoundedTimeout(result, /launchctl print exceeded 1s/);
  assert.match(result.stderr, /Print began, then hung/);
  assert.equal(fake.calls().filter((call) => call.startsWith('print ')).length, 2);
  assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 0);
  assertRecordedProcessGone(fake, 'hanging print');
});

test('--service install times out and reaps a hanging absence-poll sleep', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const fake = fakeLaunchctlHarness('hang-poll-sleep');
  const result = runSvc(['--service', 'install', checkout], {
    label: `${LABEL}-hang-poll-sleep`,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
    scriptPath: scriptWithAcceleratedDeadlines(),
    timeout: HANG_TEST_OUTER_TIMEOUT_MS,
  });
  assertBoundedTimeout(result, /unload poll delay.*sleep exceeded 1s/);
  assert.match(result.stderr, /Sleep 0\.1 began, then hung/);
  assert.equal(fake.calls().filter((call) => call.startsWith('print ')).length, 1);
  assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 0);
  assertRecordedProcessGone(fake, 'hanging absence-poll sleep');
});

test('--service install capture is not held open by a forked poll-sleep descendant', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const fake = fakeLaunchctlHarness('forked-poll-sleep');
  let descendantPid = '';
  try {
    const result = runSvc(['--service', 'install', checkout], {
      label: `${LABEL}-forked-poll-sleep`,
      laDir,
      commandDir: fake.dir,
      env: fake.env,
      scriptPath: scriptWithAcceleratedDeadlines(),
      timeout: HANG_TEST_OUTER_TIMEOUT_MS,
    });
    assertBoundedTimeout(result, /unload poll delay.*sleep exceeded 1s/);
    assert.match(result.stderr, /Forked sleep wrapper began, then hung/);
    assert.equal(fake.calls().filter((call) => call.startsWith('print ')).length, 1);
    assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 0);
    assertRecordedProcessGone(fake, 'forked poll-sleep wrapper');
    assert.ok(fs.existsSync(fake.descendantPid), 'forked poll-sleep descendant recorded its PID');
    descendantPid = fs.readFileSync(fake.descendantPid, 'utf8').trim();
    assert.equal(processIsRunning(descendantPid), true,
      'the exact-child watchdog intentionally does not signal the forked descendant');
  } finally {
    if (!descendantPid && fs.existsSync(fake.descendantPid)) {
      descendantPid = fs.readFileSync(fake.descendantPid, 'utf8').trim();
    }
    if (descendantPid) terminateProcess(descendantPid);
  }
  assert.equal(processIsRunning(descendantPid), false, 'the test cleaned up its forked descendant');
});

test('--service install times out and reaps a hanging first bootstrap', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const fake = fakeLaunchctlHarness('hang-bootstrap-first');
  const result = runSvc(['--service', 'install', checkout], {
    label: `${LABEL}-hang-bootstrap-first`,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
    scriptPath: scriptWithAcceleratedDeadlines(),
    timeout: HANG_TEST_OUTER_TIMEOUT_MS,
  });
  assertBoundedTimeout(result, /launchctl bootstrap exceeded 1s/);
  assert.match(result.stderr, /Bootstrap began, then hung/);
  assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 1);
  assertRecordedProcessGone(fake, 'hanging first bootstrap');
});

test('--service install times out and reaps a hanging second bootstrap', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const fake = fakeLaunchctlHarness('hang-bootstrap-second');
  const result = runSvc(['--service', 'install', checkout], {
    label: `${LABEL}-hang-bootstrap-second`,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
    scriptPath: scriptWithAcceleratedDeadlines(),
    timeout: HANG_TEST_OUTER_TIMEOUT_MS,
  });
  assertBoundedTimeout(result, /launchctl bootstrap exceeded 1s/);
  assert.match(result.stderr, /Second bootstrap began, then hung/);
  assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 2);
  assertRecordedProcessGone(fake, 'hanging second bootstrap');
});

test('--service install times out and reaps a hanging bootstrap-retry sleep', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const fake = fakeLaunchctlHarness('hang-retry-sleep');
  const result = runSvc(['--service', 'install', checkout], {
    label: `${LABEL}-hang-retry-sleep`,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
    scriptPath: scriptWithAcceleratedDeadlines(),
    timeout: HANG_TEST_OUTER_TIMEOUT_MS,
  });
  assertBoundedTimeout(result, /timed out before retrying.*sleep exceeded 1s/);
  assert.match(result.stderr, /Sleep 0\.2 began, then hung/);
  assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 1);
  assertRecordedProcessGone(fake, 'hanging bootstrap-retry sleep');
});

test('--service install preserves bootout evidence when absence remains unconfirmed', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const label = `${LABEL}-bootout-evidence`;
  const fake = fakeLaunchctlHarness('bootout-error-stuck');
  const result = runSvc(['--service', 'install', checkout], {
    label,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
    scriptPath: scriptWithAcceleratedDeadlines(),
    timeout: HANG_TEST_OUTER_TIMEOUT_MS,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Boot-out failed: 78: Function not implemented/);
  assert.match(result.stderr, /launchctl bootout .* exited 78/);
  assert.match(result.stderr, new RegExp(`timed out waiting for ${label} to unload`));
  assert.ok(result.stderr.indexOf('Boot-out failed: 78') < result.stderr.indexOf('timed out waiting'),
    'the root bootout evidence precedes the terminal absence failure');
  assert.equal(fake.calls().filter((call) => call.startsWith('print ')).length, 3);
  assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 0);
});

test('--service install suppresses a failed bootout diagnostic after print 113 confirms absence', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const fake = fakeLaunchctlHarness('bootout-error-absent');
  const result = runSvc(['--service', 'install', checkout], {
    label: `${LABEL}-bootout-absent`,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.stdout, /Boot-out failed/);
  assert.deepEqual(fake.calls().map((call) => call.split(' ')[0]), [
    'bootout',
    'print',
    'bootstrap',
    'print',
  ]);
});

test('--service install treats prompt bootout status 124 as benign after print 113', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const fake = fakeLaunchctlHarness('bootout-status-124-absent');
  const result = runSvc(['--service', 'install', checkout], {
    label: `${LABEL}-bootout-status-124`,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.stdout, /Boot-out failed|timed out/);
  assert.deepEqual(fake.calls().map((call) => call.split(' ')[0]), [
    'bootout',
    'print',
    'bootstrap',
    'print',
  ]);
  assertNoDeadlineCaptureFiles(fake, 'prompt bootout status 124');
});

test('--service install preserves prompt print status 124 without calling it a timeout', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const fake = fakeLaunchctlHarness('print-status-124');
  const result = runSvc(['--service', 'install', checkout], {
    label: `${LABEL}-print-status-124`,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
  });
  assert.equal(result.status, 124, result.stderr);
  assert.match(result.stderr, /Could not print service: 124: Operation canceled/);
  assert.match(result.stderr, /launchctl print exited 124/);
  assert.doesNotMatch(result.stderr, /timed out/);
  assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 0);
  assertNoDeadlineCaptureFiles(fake, 'prompt print status 124');
});

test('--service install preserves prompt bootstrap status 124 without calling it a timeout', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const fake = fakeLaunchctlHarness('bootstrap-status-124');
  const result = runSvc(['--service', 'install', checkout], {
    label: `${LABEL}-bootstrap-status-124`,
    laDir,
    commandDir: fake.dir,
    env: fake.env,
  });
  assert.equal(result.status, 124, result.stderr);
  assert.match(result.stderr, /Bootstrap failed: 124: Operation canceled/);
  assert.doesNotMatch(result.stderr, /timed out/);
  assert.equal(fake.calls().filter((call) => call.startsWith('bootstrap ')).length, 1);
  assertNoDeadlineCaptureFiles(fake, 'prompt bootstrap status 124');
});

test('--service remove is idempotent: remove-when-absent → "nothing to remove", exit 0 (QA-07)', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const label = `${LABEL}-absent`;
  const r = runSvc(['--service', 'remove'], { label, laDir });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /nothing to remove/);
});

test('--service remove NEVER touches a different label\'s plist (marker-gating by label, QA-25)', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const label = `${LABEL}-mine`;
  // A foreign plist (a different label) sits in the same scratch dir.
  const foreign = path.join(laDir, 'com.someone.else.plist');
  fs.writeFileSync(foreign, '<plist/>');
  const r = runSvc(['--service', 'remove'], { label, laDir });
  assert.equal(r.status, 0);
  // Only "$label.plist" is ever the target — the foreign file is untouched.
  assert.ok(fs.existsSync(foreign), 'a different label\'s plist must not be deleted');
});

test('the service hooks are the SINGLE source of truth — no second sed/launchctl copy (QA-17)', () => {
  const src = fs.readFileSync(script, 'utf8');
  // The sed template substitution appears exactly once (in generate_plist); the
  // main flow calls generate_plist rather than re-inlining a second sed.
  const sedCount = (src.match(/sed -e '\/<!--\/,\/-->\/d'/g) || []).length;
  assert.equal(sedCount, 1, 'the plist sed substitution must live in exactly one place');
  // The main flow delegates to the shared functions (no second inline launchctl load).
  assert.match(src, /generate_plist "\$DIR" "\$NODE_BIN"/);
  assert.equal((src.match(/^\s*load_service$/gm) || []).length, 2,
    'the service hook and main installer must both call the shared loader');
  // Modern per-domain verbs in the user domain — no sudo, no system domain.
  assert.match(src, /launchctl bootstrap "gui\/\$uid"/);
  assert.match(src, /launchctl bootout "gui\/\$uid\/\$SERVICE_LABEL"/);
  assert.match(src, /run_with_deadline_capture "\$SERVICE_LAUNCHCTL_DEADLINE_SECONDS" launchctl bootout/);
  assert.match(src, /run_with_deadline_capture "\$SERVICE_LAUNCHCTL_DEADLINE_SECONDS" launchctl print/);
  assert.match(src, /run_with_deadline_capture "\$SERVICE_LAUNCHCTL_DEADLINE_SECONDS" launchctl bootstrap/);
  assert.match(src, /run_with_deadline "\$SERVICE_SLEEP_DEADLINE_SECONDS" sleep "\$SERVICE_BOOTOUT_POLL_SECONDS"/);
  assert.match(src, /run_with_deadline "\$SERVICE_SLEEP_DEADLINE_SECONDS" sleep "\$SERVICE_BOOTSTRAP_RETRY_SECONDS"/);
  assert.match(src, /run_captured wait_for_service_absent "\$uid"/);
  assert.doesNotMatch(src, /absence_output="\$\(wait_for_service_absent/,
    'absence polling must not expose a command-substitution pipe');
  assert.match(src, /for running_pid in \$\(jobs -pr\)/);
  assert.match(src, /\/bin\/sleep "\$deadline_seconds" &/);
  assert.match(src, /\/usr\/bin\/mktemp "\$\{TMPDIR:-\/tmp\}\/llmdash-deadline\.XXXXXX"/);
  // No actual privilege escalation: no `sudo …` command invocation and no
  // system launchd domain. (The word "sudo" appears only in comments documenting
  // its absence, so match a real command form, not any mention.)
  const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('#'));
  for (const l of codeLines) {
    assert.doesNotMatch(l, /(^|[;&|]|\bthen\b|\bdo\b|\s)sudo\s+\S/, `no sudo invocation: ${l.trim()}`);
    assert.doesNotMatch(l, /system\/com\.llmdash/, 'no system launchd domain');
    assert.doesNotMatch(l, /\bkill\s+-0\b/, 'no PID-probing signal');
    assert.doesNotMatch(l, /\bkill\s+-(?:TERM|KILL)\s+-/, 'no process-group signal');
    assert.doesNotMatch(l, /\b(?:pkill|timeout|gtimeout)\b/, 'no non-stock or broad process killer');
  }
});

test('--service status classifies the three scratch states (round-trip, QA-04)', () => {
  const laDir = fs.mkdtempSync(path.join(tmp, 'la-'));
  const checkout = scratchCheckout();
  const label = `${LABEL}-three`;
  bootedLabels.add(label);
  // not-installed → install → running → remove → not-installed
  assert.equal(runSvc(['--service', 'status'], { label, laDir }).stdout.trim(), 'not-installed');
  runSvc(['--service', 'install', checkout], { label, laDir });
  assert.equal(runSvc(['--service', 'status'], { label, laDir }).stdout.trim(), 'running');
  runSvc(['--service', 'remove'], { label, laDir });
  assert.equal(runSvc(['--service', 'status'], { label, laDir }).stdout.trim(), 'not-installed');
});

test.after(() => {
  // Boot out any scratch agent a test left loaded — NEVER the real one — and verify.
  for (const label of bootedLabels) {
    try { execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${label}`], { stdio: 'ignore' }); } catch {}
  }
  // Assert only about THIS file's own label namespace (a parallel launchd test
  // file may still be cleaning up its own labels — never assert about those).
  const list = spawnSync('/bin/launchctl', ['list'], { encoding: 'utf8' }).stdout || '';
  const escaped = NS.replace(/[.\\+*?[^\]$(){}=!<>|:#-]/g, '\\$&');
  assert.doesNotMatch(list, new RegExp(escaped), 'no scratch labels from THIS file remain loaded');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});
