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
  const launchctl = path.join(dir, 'launchctl');
  fs.writeFileSync(launchctl, `#!/bin/sh
set -u
printf '%s\\n' "$*" >> "$LLMDASH_FAKE_LAUNCHCTL_LOG"
command="$1"

if [ "$command" = "bootout" ]; then
  case "$LLMDASH_FAKE_LAUNCHCTL_MODE" in
    delayed-absence|never-absent) printf '%s\\n' old > "$LLMDASH_FAKE_LAUNCHCTL_STATE" ;;
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
  if [ "$current_state" = "loaded" ]; then
    exit 0
  fi
  if [ "$LLMDASH_FAKE_LAUNCHCTL_MODE" = "never-absent" ]; then
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
    error-5-once)
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
  esac
  printf '%s\\n' loaded > "$LLMDASH_FAKE_LAUNCHCTL_STATE"
  exit 0
fi

exit 64
`);
  fs.chmodSync(launchctl, 0o755);
  const sleep = path.join(dir, 'sleep');
  fs.writeFileSync(sleep, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(sleep, 0o755);
  return {
    dir,
    env: {
      LLMDASH_FAKE_LAUNCHCTL_MODE: mode,
      LLMDASH_FAKE_LAUNCHCTL_LOG: log,
      LLMDASH_FAKE_LAUNCHCTL_STATE: state,
      LLMDASH_FAKE_LAUNCHCTL_PRINT_COUNT: printCount,
      LLMDASH_FAKE_LAUNCHCTL_BOOTSTRAP_COUNT: bootstrapCount,
    },
    calls() {
      if (!fs.existsSync(log)) return [];
      return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
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

function runSvc(args, { label = LABEL, laDir, checkout, home, commandDir, env = {} } = {}) {
  return spawnSync('/bin/bash', [script, ...args], {
    env: {
      ...env,
      PATH: commandDir ? `${commandDir}:${SYS_PATH}` : SYS_PATH,
      HOME: home || path.join(tmp, 'home'),
      LLMDASH_SERVICE_LABEL: label,
      LLMDASH_LAUNCH_AGENTS_DIR: laDir,
    },
    encoding: 'utf8',
  });
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
  // No actual privilege escalation: no `sudo …` command invocation and no
  // system launchd domain. (The word "sudo" appears only in comments documenting
  // its absence, so match a real command form, not any mention.)
  const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('#'));
  for (const l of codeLines) {
    assert.doesNotMatch(l, /(^|[;&|]|\bthen\b|\bdo\b|\s)sudo\s+\S/, `no sudo invocation: ${l.trim()}`);
    assert.doesNotMatch(l, /system\/com\.llmdash/, 'no system launchd domain');
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
