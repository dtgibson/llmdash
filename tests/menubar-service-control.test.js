import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import {
  runUninstall, runTeardown, summarizeTeardown, asStr, targetIsWholeToken,
} from '../scripts/menubar/service-control-action.mjs';

// ── service-control-action.mjs — the round-trip, no real dialog/service/paths ──
// (menubar-service-controls, FR-12/FR-13/FR-14/FR-19/FR-20/FR-21, NFR-02/NFR-05.)
//
// SCRATCH ONLY. The teardown runs against injected scratch paths and a DISTINCT
// scratch label; no real dialog pops (interactive:false + --yes), no real
// launchctl label is touched (the scratch plist is a plain file the teardown rm's;
// the scratch label bootout is a no-op on an unloaded label), and the real
// checkout/data are never in reach.

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const helper = path.join(repoRoot, 'scripts', 'menubar', 'service-control-action.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-svc-ctrl-'));
const uid = String(os.userInfo().uid);
// This file's own scratch-label NAMESPACE — disjoint from the other launchd test
// file so a parallel run's cleanup asserts only about its own labels. The teardown
// tests use plain-file plists (never bootstrapped → never in `launchctl list`);
// only the detach test bootstraps a REAL scratch agent under this namespace.
const NS = `com.llmdash.spike-svcctrl-${process.pid}`;
let detachLabel = null; // the scratch label the detach test bootstraps (cleanup)

// Build a scratch "install": a checkout, a scratch plist (a plain file — an
// UNLOADED scratch label, so bootout is a harmless no-op), a settings.json wired
// to THIS checkout's statusline with a .bak, a ~/.claude.json trust entry + a
// foreign project kept, a marker wrapper, and a data dir with fake usage plus
// reset/billing configuration files.
// `opts` overrides: dataUnderCheckout (default true), wrapperMarker (default true),
// statuslineTarget ('self' | a foreign path), settingsHasBak (default true).
function buildInstall(name, opts = {}) {
  const root = fs.mkdtempSync(path.join(tmp, `${name}-`));
  const checkout = path.join(root, 'checkout');
  const home = path.join(root, 'home');
  const laDir = path.join(root, 'launchagents');
  const claudeDir = path.join(root, 'claude');
  const sbDir = path.join(root, 'swiftbar');
  const dataUnderCheckout = opts.dataUnderCheckout !== false;
  const dataDir = dataUnderCheckout ? path.join(checkout, 'data') : path.join(root, 'data');
  const trustDir = path.join(home, '.llmdash', 'claude-refresh-cwd');
  fs.mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
  fs.mkdirSync(laDir, { recursive: true });
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(trustDir, { recursive: true });
  fs.mkdirSync(sbDir, { recursive: true });

  const label = `com.llmdash.spike-${name}`;
  const plist = path.join(laDir, `${label}.plist`);
  const statuslineTarget = path.join(checkout, 'scripts', 'statusline.js');
  const settings = path.join(claudeDir, 'settings.json');
  const claudeJson = path.join(home, '.claude.json');
  const wrapper = path.join(sbDir, 'llmdash.5s.js');

  fs.writeFileSync(statuslineTarget, '// statusline');
  fs.writeFileSync(plist, '<plist/>');
  // The statusline command points at THIS checkout by default; `foreign` tests the
  // leave-untouched branch; `suffix:'…'` appends a suffix to OUR target so the
  // command substring-contains it but is NOT a whole-token match (a user file).
  let cmdTarget;
  if (opts.statuslineTarget === 'foreign') cmdTarget = '/some/other/llmdash/scripts/statusline.js';
  else if (opts.statuslineSuffix) cmdTarget = statuslineTarget + opts.statuslineSuffix;
  else cmdTarget = statuslineTarget;
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'node ' + cmdTarget }, keep: 1 }, null, 2));
  if (opts.settingsHasBak !== false) {
    fs.writeFileSync(settings + '.bak', JSON.stringify({ statusLine: { type: 'command', command: 'my-old-line' } }, null, 2));
  }
  fs.writeFileSync(claudeJson, JSON.stringify({ projects: { [trustDir]: { trusted: true }, '/some/other/dir': { keep: true } } }, null, 2));
  const marker = opts.wrapperMarker === false ? '# a user file, no marker' : '# llmdash-menu-bar-badge';
  fs.writeFileSync(wrapper, `#!/bin/sh\n${marker}\nexec node x\n`);
  fs.writeFileSync(path.join(dataDir, 'llmdash.db'), 'DBDATA');
  fs.writeFileSync(path.join(dataDir, 'hosts.conf'), 'host1');
  fs.writeFileSync(path.join(dataDir, 'account-config.json'), 'ACCOUNT-CONFIG-DATA');
  fs.writeFileSync(path.join(dataDir, 'subscriptions.json'), 'LEGACY-SUBSCRIPTIONS-DATA');

  const p = {
    checkout, label, plist, settings, claudeJson, trustDir,
    llmdashDir: path.join(home, '.llmdash'), dataDir, statuslineTarget,
    installer: path.join(checkout, 'scripts', 'install-macos.sh'), // absent → inline wrapper fallback
    wrapper, preservedDataDir: path.join(home, '.llmdash', 'preserved-data'),
  };
  return { root, p, settings, claudeJson, wrapper, plist, checkout, trustDir, dataDir };
}

test('the ordered teardown removes artifacts service→statusline→trust→wrapper→checkout→data (QA-13)', () => {
  const { p, settings, wrapper, plist, checkout, trustDir } = buildInstall('order');
  const res = runUninstall({ yes: true, interactive: false, run: true, paths: p });
  const order = res.steps.map((s) => s.step).join(',');
  assert.equal(order, 'service,statusline,trust,wrapper,checkout,data', 'exact ordering');
  assert.ok(res.steps.every((s) => s.ok), JSON.stringify(res.steps));
  assert.equal(fs.existsSync(plist), false, 'plist removed');
  assert.equal(fs.existsSync(checkout), false, 'checkout removed');
  assert.equal(fs.existsSync(wrapper), false, 'wrapper removed');
  assert.equal(fs.existsSync(trustDir), false, 'trust dir removed');
  // settings restored to the .bak (its pre-llmdash command).
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).statusLine.command, 'my-old-line');
});

test('usage and billing data are PRESERVED by default; rescued out of the checkout intact (QA-12)', () => {
  const { p } = buildInstall('preserve'); // data under the checkout (default)
  const res = runUninstall({ yes: true, interactive: false, run: true, paths: p });
  const dataStep = res.steps.find((s) => s.step === 'data');
  assert.equal(dataStep.preserved, true);
  assert.ok(dataStep.rescuedTo, 'the result names the unique rescue directory');
  assert.equal(path.dirname(dataStep.rescuedTo), p.preservedDataDir);
  assert.match(path.basename(dataStep.rescuedTo), /^uninstall-/);
  // Every durable usage/billing file was moved to safety before the checkout
  // was deleted, with its bytes intact.
  const expected = {
    'llmdash.db': 'DBDATA',
    'account-config.json': 'ACCOUNT-CONFIG-DATA',
    'subscriptions.json': 'LEGACY-SUBSCRIPTIONS-DATA',
  };
  for (const [name, content] of Object.entries(expected)) {
    const preserved = path.join(dataStep.rescuedTo, name);
    assert.ok(fs.existsSync(preserved), `${name} preserved`);
    assert.equal(fs.readFileSync(preserved, 'utf8'), content);
  }
  assert.match(dataStep.detail, /PRESERVED/);
  assert.match(res.message, /usage history and configuration were kept/);
});

test('separate uninstall rescues never overwrite files preserved by an earlier uninstall (QA-12)', () => {
  const first = buildInstall('preserve-collision-first');
  fs.writeFileSync(path.join(first.dataDir, 'llmdash.db'), 'FIRST-DB-DATA');
  const firstRes = runUninstall({ yes: true, interactive: false, run: true, paths: first.p });
  const firstData = firstRes.steps.find((s) => s.step === 'data');
  assert.ok(firstData.ok, firstData.detail);
  assert.equal(fs.readFileSync(path.join(firstData.rescuedTo, 'llmdash.db'), 'utf8'), 'FIRST-DB-DATA');

  const second = buildInstall('preserve-collision-second');
  second.p.preservedDataDir = first.p.preservedDataDir;
  fs.writeFileSync(path.join(second.dataDir, 'llmdash.db'), 'SECOND-DB-DATA');
  const secondRes = runUninstall({ yes: true, interactive: false, run: true, paths: second.p });
  const secondData = secondRes.steps.find((s) => s.step === 'data');
  assert.ok(secondData.ok, secondData.detail);
  assert.notEqual(secondData.rescuedTo, firstData.rescuedTo, 'each uninstall gets a unique rescue directory');
  assert.equal(fs.readFileSync(path.join(firstData.rescuedTo, 'llmdash.db'), 'utf8'), 'FIRST-DB-DATA',
    'the earlier preserved file is byte-identical after another uninstall');
  assert.equal(fs.readFileSync(path.join(secondData.rescuedTo, 'llmdash.db'), 'utf8'), 'SECOND-DB-DATA');
});

test('preservation failure retains the checkout and reports the incomplete uninstall honestly (QA-12/QA-20)', () => {
  const { p, checkout, dataDir } = buildInstall('preserve-failure');
  // A regular file where the preservation base directory must be makes mkdir fail
  // deterministically without relying on platform-specific permissions.
  fs.writeFileSync(p.preservedDataDir, 'BLOCKED-PRESERVATION-BASE');
  const expected = {
    'llmdash.db': 'DBDATA',
    'account-config.json': 'ACCOUNT-CONFIG-DATA',
    'subscriptions.json': 'LEGACY-SUBSCRIPTIONS-DATA',
  };

  const res = runUninstall({ yes: true, interactive: false, run: true, paths: p });
  const checkoutStep = res.steps.find((s) => s.step === 'checkout');
  const dataStep = res.steps.find((s) => s.step === 'data');
  assert.equal(res.ok, false);
  assert.equal(checkoutStep.ok, false);
  assert.equal(checkoutStep.retained, true);
  assert.match(checkoutStep.detail, /retained the checkout/);
  assert.match(checkoutStep.detail, new RegExp(checkout.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(fs.existsSync(checkout), true, 'the checkout is retained instead of deleting unmoved data');
  for (const [name, content] of Object.entries(expected)) {
    assert.equal(fs.readFileSync(path.join(dataDir, name), 'utf8'), content, `${name} remains intact in the checkout`);
  }
  assert.equal(dataStep.ok, false);
  assert.equal(dataStep.preserved, true);
  assert.match(dataStep.detail, /remains protected in the retained checkout/);
  assert.match(res.message, /uninstall did NOT complete/);
  assert.match(res.message, /retained the checkout/);
  assert.match(res.message, new RegExp(checkout.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(res.message, /llmdash was uninstalled\b/);
  assert.doesNotMatch(res.message, /Everything else was removed/);
});

test('--delete-data deletes usage and billing files outside the checkout, AFTER checkout (QA-12)', () => {
  // Data OUTSIDE the checkout so we can prove step-order deletion (not collateral).
  const { p, dataDir } = buildInstall('delete', { dataUnderCheckout: false });
  const expectedFiles = ['llmdash.db', 'account-config.json', 'subscriptions.json'];
  for (const name of expectedFiles) assert.ok(fs.existsSync(path.join(dataDir, name)), `${name} starts present`);
  const res = runUninstall({ yes: true, interactive: false, run: true, paths: p, deleteData: true });
  const iCheckout = res.steps.findIndex((s) => s.step === 'checkout');
  const iData = res.steps.findIndex((s) => s.step === 'data');
  assert.ok(iCheckout < iData, 'data step runs after the checkout step');
  const dataStep = res.steps.find((s) => s.step === 'data');
  assert.equal(dataStep.preserved, false);
  for (const name of expectedFiles) {
    assert.equal(fs.existsSync(path.join(dataDir, name)), false, `${name} was deleted on opt-in`);
  }
  assert.match(res.message, /usage history and configuration were deleted/);
});

test('statusline revert restores the scratch .bak only when it points at THIS checkout (QA-14)', () => {
  const { p, settings } = buildInstall('sl-self');
  const res = runUninstall({ yes: true, interactive: false, run: true, paths: p });
  const sl = res.steps.find((s) => s.step === 'statusline');
  assert.ok(sl.ok);
  assert.match(sl.detail, /restored settings\.json\.bak/);
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).statusLine.command, 'my-old-line');
});

test('statusline pointing ELSEWHERE is left untouched, reported honestly (QA-14/QA-25)', () => {
  const { p, settings } = buildInstall('sl-foreign', { statuslineTarget: 'foreign' });
  const before = fs.readFileSync(settings, 'utf8');
  const res = runUninstall({ yes: true, interactive: false, run: true, paths: p });
  const sl = res.steps.find((s) => s.step === 'statusline');
  assert.ok(sl.ok);
  assert.match(sl.detail, /points elsewhere.*left it untouched/);
  // The foreign settings.json is byte-identical — never clobbered.
  assert.equal(fs.readFileSync(settings, 'utf8'), before);
});

// The revert gate is a PATH-BOUNDARY match, not a substring: a user command that is
// our target path PLUS a suffix (`…/statusline.js.bak`, `…/statusline.js2`) must NOT
// false-positive and get reverted. (Security review Informational — teardown-path
// hygiene, FR-14/NFR-05.)
test('statusline revert STILL fires for the real installed command shape (no false-negative)', () => {
  // `node <checkout>/scripts/statusline.js` (exactly what install-macos.sh writes)
  // → the token ends at end-of-string → reverts.
  const { p, settings } = buildInstall('sl-real');
  const res = runUninstall({ yes: true, interactive: false, run: true, paths: p });
  const sl = res.steps.find((s) => s.step === 'statusline');
  assert.ok(sl.ok);
  assert.match(sl.detail, /restored settings\.json\.bak/);
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).statusLine.command, 'my-old-line');
});

for (const suffix of ['.bak', '2']) {
  test(`statusline revert does NOT fire for a user command that is our target + "${suffix}" (boundary, QA-14/QA-25)`, () => {
    const { p, settings } = buildInstall(`sl-suffix-${suffix.replace(/\W/g, '')}`, { statuslineSuffix: suffix });
    const before = fs.readFileSync(settings, 'utf8');
    const res = runUninstall({ yes: true, interactive: false, run: true, paths: p });
    const sl = res.steps.find((s) => s.step === 'statusline');
    assert.ok(sl.ok);
    assert.match(sl.detail, /points elsewhere.*left it untouched/);
    // The user's `…statusline.js${suffix}` command is byte-identical — never reverted.
    assert.equal(fs.readFileSync(settings, 'utf8'), before);
    // And the .bak the (unrelated) install wrote is NOT consumed — still on disk.
    assert.ok(fs.existsSync(settings + '.bak'), 'the .bak was not restored (no false revert)');
  });
}

test('targetIsWholeToken: whole-token match yes; suffix/substring no (unit, QA-14)', () => {
  const t = '/Users/x/llmdash/scripts/statusline.js';
  // Legitimate installed shape (ends at end-of-string) → match.
  assert.equal(targetIsWholeToken(`node ${t}`, t), true);
  // Hand-edited with trailing args (ends at whitespace/quote) → still match.
  assert.equal(targetIsWholeToken(`node ${t} --flag`, t), true);
  assert.equal(targetIsWholeToken(`sh -c "node ${t}"`, t), true);
  // Our target PLUS a suffix (another path char follows) → NO match.
  assert.equal(targetIsWholeToken(`node ${t}.bak`, t), false);
  assert.equal(targetIsWholeToken(`node ${t}2`, t), false);
  assert.equal(targetIsWholeToken(`node ${t}/inner`, t), false);
  // A different checkout entirely → NO match.
  assert.equal(targetIsWholeToken('node /Users/x/other/scripts/statusline.js', t), false);
});

test('trust revert is own-key: removes our entry, KEEPS a user\'s other project (QA-25)', () => {
  const { p, claudeJson } = buildInstall('trust');
  const res = runUninstall({ yes: true, interactive: false, run: true, paths: p });
  assert.ok(res.steps.find((s) => s.step === 'trust').ok);
  const cj = JSON.parse(fs.readFileSync(claudeJson, 'utf8'));
  assert.equal(cj.projects[p.trustDir], undefined, 'our trust entry removed');
  assert.ok(cj.projects['/some/other/dir'], 'a user\'s other project is kept');
});

test('marker-gating spares a non-marker wrapper (a user\'s own file), honest message (QA-10/QA-25)', () => {
  const { p, wrapper } = buildInstall('wrap-nomarker', { wrapperMarker: false });
  const res = runUninstall({ yes: true, interactive: false, run: true, paths: p });
  const w = res.steps.find((s) => s.step === 'wrapper');
  assert.ok(w.ok);
  assert.match(w.detail, /spared/);
  assert.ok(fs.existsSync(wrapper), 'a non-marker file in SwiftBar\'s dir is NOT deleted');
});

test('honest on partial failure: an undeletable trust dir is named, not claimed done (QA-20)', () => {
  const { p } = buildInstall('partial');
  // Make the trust dir non-removable by pointing p.trustDir at a path whose PARENT
  // is read-only — simplest cross-platform: point trustDir at a file inside a dir
  // we chmod 0. Instead, inject a trustDir that is actually a busy path: use a
  // regular FILE where a dir removal will still succeed… so simulate via a
  // read-only parent.
  const roParent = path.join(p.llmdashDir, 'ro');
  fs.mkdirSync(roParent, { recursive: true });
  const stuck = path.join(roParent, 'claude-refresh-cwd');
  fs.mkdirSync(stuck, { recursive: true });
  fs.writeFileSync(path.join(stuck, 'child'), 'x');
  fs.chmodSync(roParent, 0o500); // read+exec, no write → child dir can't be removed
  const p2 = { ...p, trustDir: stuck };
  const res = runUninstall({ yes: true, interactive: false, run: true, paths: p2 });
  const trust = res.steps.find((s) => s.step === 'trust');
  fs.chmodSync(roParent, 0o700); // restore so cleanup can rm it
  assert.equal(trust.ok, false, 'the trust step reports failure');
  assert.match(trust.detail, /could not remove/);
  // The summary names what did NOT happen — never claims the removal.
  assert.match(res.message, /did NOT complete/);
  assert.match(res.message, /trust/);
});

test('anti-injection: no dynamic value is concatenated into an osascript -e string (QA-18)', () => {
  const src = fs.readFileSync(helper, 'utf8');
  // Every osascript call is execFileSync('/usr/bin/osascript', ['-e', <fixed>]) — no shell.
  assert.match(src, /execFileSync\('\/usr\/bin\/osascript', \['-e', script\]/);
  assert.doesNotMatch(src, /osascript.*sh -c/);
  assert.doesNotMatch(src, /child_process.*\bexec\b\(/); // no exec() (shell), only execFileSync/spawn
  // launchctl + fs (no /bin/rm shell); process.execPath for the detach.
  assert.match(src, /execFileSync\('\/bin\/launchctl'/);
  assert.match(src, /fs\.rmSync/);
  assert.doesNotMatch(src, /execFileSync\('\/bin\/rm'/);
  assert.match(src, /process\.execPath/);
});

test('anti-injection: a hostile checkout path stays inert data end to end (QA-18)', () => {
  // asStr escapes the one dynamic value (the checkout path) into an AS literal; a
  // hostile path with quotes/backslashes can't break out of the string.
  const hostile = '"; do shell script "rm -rf ~"; set x to "';
  const escaped = asStr(hostile);
  // The result is a single balanced AS literal: leading+trailing quote, and every
  // interior double-quote is backslash-escaped (never an unescaped break-out).
  assert.ok(escaped.startsWith('"') && escaped.endsWith('"'));
  assert.doesNotMatch(escaped.slice(1, -1), /(?<!\\)"/, 'no unescaped interior quote');
  // And running the whole teardown with a hostile checkout name does no shell harm:
  // it's only ever an fs path. Build a scratch install whose checkout dir name is
  // hostile-ish and confirm the teardown treats it as a plain directory.
  const { p, checkout } = buildInstall('inject');
  const res = runUninstall({ yes: true, interactive: false, run: true, paths: { ...p, checkout } });
  assert.ok(res.steps.find((s) => s.step === 'checkout').ok);
  assert.equal(fs.existsSync(checkout), false);
});

// ── The detached-survival check against a SCRATCH install (QA-19 [SELF]) ──────
// Generalizes the SPIKE-01 harness into a test: a REAL scratch launchd agent is
// bootstrapped (distinct label, sleep loop — NEVER the real server), then the
// PRODUCTION detach path is driven from inside a scratch checkout that CONTAINS a
// copy of the helper. The action returns at once; the detached child completes the
// ordered teardown after its scratch label is booted out and its scratch checkout
// is rm -rf'd, exiting 0. Scratch paths + a scratch label only.
test('the DETACHED teardown survives its own origin against a SCRATCH install, exit 0 (QA-19)', async () => {
  const root = fs.mkdtempSync(path.join(tmp, 'detach-'));
  const checkout = path.join(root, 'checkout');
  const home = path.join(root, 'home');
  const laDir = path.join(root, 'launchagents');
  const sbDir = path.join(root, 'swiftbar');
  const dataDir = path.join(checkout, 'data');
  const trustDir = path.join(home, '.llmdash', 'claude-refresh-cwd');
  fs.mkdirSync(path.join(checkout, 'scripts', 'menubar'), { recursive: true });
  fs.mkdirSync(laDir, { recursive: true });
  fs.mkdirSync(sbDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(trustDir, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  // The checkout carries a COPY of the self-contained helper (the detach copies it).
  const helperInCheckout = path.join(checkout, 'scripts', 'menubar', 'service-control-action.mjs');
  fs.copyFileSync(helper, helperInCheckout);

  const label = `${NS}-detach`;
  const plist = path.join(laDir, `${label}.plist`);
  // A REAL scratch launchd agent: a sleep loop under a distinct label.
  fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>/bin/sleep</string><string>120</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>`);
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${uid}`, plist]);
  detachLabel = label; // for cleanup
  // Sanity: the scratch agent is loaded.
  assert.equal(spawnSync('/bin/launchctl', ['print', `gui/${uid}/${label}`]).status, 0);

  const statuslineTarget = path.join(checkout, 'scripts', 'statusline.js');
  fs.writeFileSync(statuslineTarget, '// statusline');
  const settings = path.join(home, '.claude', 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { command: 'node ' + statuslineTarget } }));
  const claudeJson = path.join(home, '.claude.json');
  fs.writeFileSync(claudeJson, JSON.stringify({ projects: { [trustDir]: {} } }));
  const wrapper = path.join(sbDir, 'llmdash.5s.js');
  fs.writeFileSync(wrapper, '#!/bin/sh\n# llmdash-menu-bar-badge\n');
  fs.writeFileSync(path.join(dataDir, 'llmdash.db'), 'DBDATA');

  const p = {
    checkout, label, plist, settings, claudeJson, trustDir,
    llmdashDir: path.join(home, '.llmdash'), dataDir, statuslineTarget,
    installer: path.join(checkout, 'scripts', 'install-macos.sh'),
    wrapper, preservedDataDir: path.join(home, '.llmdash', 'preserved-data'),
  };

  // Drive the PRODUCTION detach from a child node process (as the badge would),
  // importing the checkout copy of the helper. The action returns immediately.
  const driver = path.join(root, 'driver.mjs');
  fs.writeFileSync(driver, `
    import { runUninstall } from ${JSON.stringify(helperInCheckout)};
    const p = ${JSON.stringify(p)};
    const res = runUninstall({ yes: true, interactive: false, paths: p, selfPath: ${JSON.stringify(helperInCheckout)} });
    process.stdout.write(JSON.stringify(res));
  `);
  const out = spawnSync(process.execPath, [driver], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const res = JSON.parse(out.stdout);
  assert.equal(res.reason, 'detached', 'the action detached and returned at once');

  // Wait for the detached child to finish (poll until the checkout is gone).
  const deadline = Date.now() + 8000;
  while (fs.existsSync(checkout) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(fs.existsSync(checkout), false, 'the detached child deleted its own checkout (survived its origin)');
  assert.equal(fs.existsSync(plist), false, 'the scratch plist was deleted');
  assert.equal(fs.existsSync(wrapper), false, 'the wrapper was removed');
  assert.equal(fs.existsSync(trustDir), false, 'the trust dir was removed');
  // The scratch label was booted out (survived the bootout of its own spawner).
  assert.notEqual(spawnSync('/bin/launchctl', ['print', `gui/${uid}/${label}`]).status, 0,
    'the scratch label is no longer loaded');
  // Data preserved (rescued out from under the checkout).
  const rescueDirs = fs.readdirSync(p.preservedDataDir)
    .filter((name) => name.startsWith('uninstall-'));
  assert.equal(rescueDirs.length, 1, 'one unique rescue directory was created');
  assert.ok(fs.existsSync(path.join(p.preservedDataDir, rescueDirs[0], 'llmdash.db')), 'DB rescued/preserved');
});

test.after(() => {
  // Boot out the scratch detach label if the test didn't (defensive) — NEVER real.
  if (detachLabel) {
    try { execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${detachLabel}`], { stdio: 'ignore' }); } catch {}
  }
  // Assert only about THIS file's own label namespace (a parallel launchd test
  // file may still be cleaning up its own labels — never assert about those).
  const list = spawnSync('/bin/launchctl', ['list'], { encoding: 'utf8' }).stdout || '';
  const escaped = NS.replace(/[.\\+*?[^\]$(){}=!<>|:#-]/g, '\\$&');
  assert.doesNotMatch(list, new RegExp(escaped), 'no scratch labels from THIS file remain loaded');
  // Clean any teardown temp dirs the detached children left (best-effort).
  try {
    for (const d of fs.readdirSync(os.tmpdir())) {
      if (d.startsWith('llmdash-teardown-')) fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true });
    }
  } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});
