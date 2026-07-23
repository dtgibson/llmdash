#!/usr/bin/env node
// llmdash — the badge's service-toggle + two-tier-uninstall helper
// (menubar-service-controls, FR-17–FR-21).
//
// Invoked by the SwiftBar dropdown actions under the wrapper's ABSOLUTE node:
//   ＋ Install the local service | shell="$ABS_NODE" param1=".../service-control-action.mjs" param2=install
//   － Remove the local service  | shell="$ABS_NODE" param1=".../service-control-action.mjs" param2=remove
//   ▬ Remove the menu-bar badge only | … param2=remove-badge
//   ⊘ Uninstall llmdash completely…  | … param2=uninstall
// (terminal=false windowless, refresh=true so the dropdown reflects the new state.)
//
// Every mutation is a LOCAL launchctl / filesystem op in THIS badge/helper process
// — NO HTTP mutation, so the dashboard's serve-only/405 posture is preserved
// (NFR-04). Node builtins + macOS launchctl/osascript only (no npm dep, no build
// step — NFR-09).
//
// ── SELF-CONTAINED, so the DETACHED teardown survives its own origin (SPIKE-01) ─
// This file imports NOTHING from ../../src or ../../config (only node: builtins).
// The complete-uninstall copies THIS file to os.tmpdir(), cd's out of the checkout,
// and re-spawns the copy detached; the detached child reads EVERY path up front
// from ARGV and deletes the checkout LAST as a leaf. A lazy `import` from the
// (now-deleted) checkout would throw ERR_MODULE_NOT_FOUND (spike Hazard E) — so
// there is none: everything the teardown needs is a Node builtin or an ARGV value.
//
// ── ANTI-INJECTION (mirrors host-config-action.mjs verbatim, for the Auditor) ──
// Every AppleScript is a FIXED LITERAL. The ONLY dynamic value in a dialog is the
// resolved checkout path, escaped into the string via asStr() (an AppleScript
// string escaper) — never re-fed as script. osascript/launchctl are run via
// execFileSync with an ARGV array — NO shell, no sh -c, no eval. File removals use
// fs.rmSync (never a /bin/rm shell). Runs under process.execPath / $ABS_NODE (a
// bare "node" is dead under the minimal spawn PATH — the standing lesson).

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── VERBATIM confirmation copy (design-spec §Binding copy) ────────────────────
// Enumeration first, honesty note, data preserved-by-default, SwiftBar-never-
// removed. In every dialog the DEFAULT (macOS-blue) button is the SAFE choice.

const UNINSTALL_TITLE = 'Uninstall llmdash from this Mac?';
const uninstallBody = (dir) =>
  'This will remove:\n'
  + '  • the launchd service (com.llmdash.dashboard) and its plist\n'
  + '  • the menu-bar badge wrapper (in SwiftBar\'s plugin folder)\n'
  + `  • the app checkout at ${dir}\n`
  + '  • the Claude Code statusline wiring (restoring your settings.json.bak if present)\n'
  + '  • the auto-refresh trust folder (~/.llmdash/claude-refresh-cwd) and its ~/.claude.json entry\n'
  + '\n'
  + 'Your local data is PRESERVED by default: usage history (llmdash.db), reset and\n'
  + 'billing configuration (account-config.json), and legacy fixed periods\n'
  + '(subscriptions.json). These can\'t be rebuilt, so they\'re kept unless you say\n'
  + 'otherwise on the next step.\n'
  + 'SwiftBar is not removed — uninstall it yourself with: brew uninstall --cask swiftbar';

const DATA_TITLE = 'Also delete your local data?';
const DATA_BODY =
  'This deletes your snapshot history (llmdash.db), reset and recurring billing\n'
  + 'configuration (account-config.json), and legacy fixed periods\n'
  + '(subscriptions.json). Removing llmdash doesn\'t need to delete them, and this\n'
  + 'can\'t be undone. Keep them unless you\'re sure.';

const SERVICE_REMOVE_TITLE = 'Remove the local llmdash service?';
const SERVICE_REMOVE_BODY =
  'This Mac will stop running its own local monitor — the launchd agent is unloaded\n'
  + 'and its plist deleted. If this badge watches remote machines, it keeps working off\n'
  + 'those; only the local reading stops. You can re-install the service from this menu any time.';

const SERVICE_INSTALL_TITLE = 'Install the local llmdash service on this Mac?';
const SERVICE_INSTALL_BODY =
  'This regenerates the launchd agent with fresh paths and loads it so llmdash runs at login and restarts on crash.';

// ── Path resolution — the ONE copy of config's path logic (self-contained) ────
// The helper must not import ../../config.js (a lazy checkout read is Hazard E).
// These mirror config.js exactly (dataDir default = <checkout>/data; claudeDir
// default = ~/.claude; claudeRefreshCwd = ~/.llmdash/claude-refresh-cwd). Env
// overrides honored so a customized install (or a test) resolves the same paths
// config.js would. Production passes NONE of the scratch opts → these real paths.
function realPaths(checkoutDir, env = process.env) {
  const home = os.homedir();
  const claudeDir = env.LLMDASH_CLAUDE_DIR || path.join(home, '.claude');
  const dataDir = env.LLMDASH_DATA_DIR || path.join(checkoutDir, 'data');
  const laDir = env.LLMDASH_LAUNCH_AGENTS_DIR || path.join(home, 'Library', 'LaunchAgents');
  const label = env.LLMDASH_SERVICE_LABEL || 'com.llmdash.dashboard';
  return {
    checkout: checkoutDir,
    label,
    plist: path.join(laDir, `${label}.plist`),
    settings: path.join(claudeDir, 'settings.json'),
    claudeJson: path.join(home, '.claude.json'),
    trustDir: path.join(home, '.llmdash', 'claude-refresh-cwd'),
    llmdashDir: path.join(home, '.llmdash'),
    dataDir,
    statuslineTarget: path.join(checkoutDir, 'scripts', 'statusline.js'),
    installer: path.join(checkoutDir, 'scripts', 'install-macos.sh'),
  };
}

// ── Fixed-literal AppleScript helpers (never built from an untrusted value) ────

// Escape a string into an AppleScript double-quoted literal — used ONLY for OUR
// fixed copy + the resolved checkout path (the one dynamic value), never to smuggle
// arbitrary input back into a script. Backslash + double-quote are the only AS
// string metacharacters. (Verbatim from host-config-action.mjs.)
export function asStr(s) {
  return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// Confirm dialog: returns true iff the user clicked the affirmative (destructive)
// button. `okButton` is the destructive label; `defaultButton` is the SAFE choice
// so a reflexive Return never destroys anything. Fixed-literal, no shell.
function confirm(title, body, okButton, cancelButton, defaultButton) {
  const script =
    'display dialog ' + asStr(body) + ' with title ' + asStr(title) + ' '
    + 'buttons {' + asStr(cancelButton) + ', ' + asStr(okButton) + '} '
    + 'default button ' + asStr(defaultButton) + '\n'
    + 'return button returned of result';
  try {
    const out = execFileSync('/usr/bin/osascript', ['-e', script], { encoding: 'utf8' });
    return out.replace(/\n$/, '') === okButton;
  } catch {
    return false; // Cancel / any failure → do nothing
  }
}

// A fixed message dialog (post-action honesty). OUR copy, escaped via asStr().
function showMessage(msg) {
  const script = 'display dialog ' + asStr(msg) + ' with title "llmdash" buttons {"OK"} default button "OK"';
  try { execFileSync('/usr/bin/osascript', ['-e', script], { encoding: 'utf8' }); } catch {}
}

// ── Ordered teardown STEPS — each self-contained, marker-gated, honest ────────
// Every step returns { ok, detail } and NEVER throws (a thrown step would strand
// the sequence). The ordering (FR-13, proven in SPIKE-01) is enforced by the
// caller: service → statusline → trust → wrapper → checkout LAST → data (opt-in).
// `p` is the resolved-paths object; all reads happen against it (no checkout import).

// 1. service: bootout gui/<uid>/<label> + delete the plist (marker-gated: only
//    THIS label's plist file). Idempotent — an absent label/plist is a no-op.
function stepService(p) {
  const uid = String(os.userInfo().uid);
  let bootedOut = false;
  try {
    execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${p.label}`], { stdio: 'ignore' });
    bootedOut = true;
  } catch { /* already gone → fine (idempotent) */ }
  let plistDeleted = false;
  try {
    if (fs.existsSync(p.plist)) { fs.rmSync(p.plist, { force: true }); plistDeleted = true; }
  } catch (e) {
    return { ok: false, detail: `the plist at ${p.plist} could not be deleted (${e.code || e.message})` };
  }
  return { ok: true, detail: `service unregistered${bootedOut ? '' : ' (was already unloaded)'}${plistDeleted ? ', plist deleted' : ', no plist on disk'}` };
}

// Does `cmd` reference `target` (this checkout's scripts/statusline.js) as a WHOLE
// path token — not a substring? True only when every occurrence of `target` is
// bounded on the right by end-of-string, whitespace, or a quote (`"`/`'`) — never
// another path character (so `…/statusline.js.bak`, `…/statusline.js2`, or
// `…/statusline.js/x` do NOT match). The installer writes exactly
// `node <dir>/scripts/statusline.js`, so the legitimate command ends the token at
// end-of-string; a hand-edited command with trailing args ends it at whitespace/
// quote — both still revert. Path-boundary, not substring (teardown-path hygiene).
export function targetIsWholeToken(cmd, target) {
  if (!target) return false;
  let from = 0;
  for (;;) {
    const i = cmd.indexOf(target, from);
    if (i === -1) return false;
    const after = cmd[i + target.length];
    // Right boundary: end-of-string, whitespace, or a quote — never a path char.
    if (after === undefined || /[\s"']/.test(after)) return true;
    from = i + 1; // this occurrence had a trailing path char (e.g. `.bak`) — keep scanning
  }
}

// 2. statusline: revert ~/.claude/settings.json ONLY if statusLine.command points
//    at THIS checkout's scripts/statusline.js. Restore settings.json.bak if
//    present, else delete the statusLine key we added. Points ELSEWHERE → untouched
//    (a different install / a user's own command), honest report. (FR-14/NFR-05.)
function stepStatusline(p) {
  let raw;
  try { raw = fs.readFileSync(p.settings, 'utf8'); }
  catch { return { ok: true, detail: 'no ~/.claude/settings.json — nothing to revert' }; }
  let s;
  try { s = JSON.parse(raw); }
  catch { return { ok: false, detail: `~/.claude/settings.json is not valid JSON — left it untouched (revert the statusline by hand)` }; }
  const cmd = s && s.statusLine && s.statusLine.command;
  // PATH-BOUNDARY match, not a substring: the installer writes the command as
  // exactly `node <dir>/scripts/statusline.js` (install-macos.sh step 6). Revert
  // only when the command references THIS checkout's statusline.js as a whole path
  // token — the target immediately followed by end-of-string, whitespace, or a
  // quote — never another path char (`.`/`2`/`/`). A user command that is our
  // target PLUS a suffix (`…/statusline.js.bak`, `…/statusline.js2`) is NOT ours
  // and must be left untouched. (Anchored on the installed shape so the real
  // `node <dir>/scripts/statusline.js` still reverts — no false-negative.)
  if (!cmd || !targetIsWholeToken(String(cmd), p.statuslineTarget)) {
    return { ok: true, detail: 'the Claude statusline points elsewhere (a different install or your own command) — left it untouched' };
  }
  // It's ours. Prefer restoring the .bak the installer wrote; else drop the key.
  const bak = p.settings + '.bak';
  try {
    if (fs.existsSync(bak)) {
      fs.copyFileSync(bak, p.settings);
      fs.rmSync(bak, { force: true });
      return { ok: true, detail: 'restored settings.json.bak (your pre-llmdash statusline)' };
    }
    delete s.statusLine;
    fs.writeFileSync(p.settings, JSON.stringify(s, null, 2) + '\n');
    return { ok: true, detail: 'removed the llmdash statusLine entry (no backup was present)' };
  } catch (e) {
    return { ok: false, detail: `could not rewrite ~/.claude/settings.json (${e.code || e.message}) — revert the statusline by hand` };
  }
}

// 3. trust: delete ~/.claude.json projects[<trustDir>] (own-key check) + rm the
//    ~/.llmdash/claude-refresh-cwd dir. Other projects entries are untouched. The
//    ~/.llmdash dir is removed only if empty after the refresh-cwd is gone.
function stepTrust(p) {
  const details = [];
  // The own-key project entry in ~/.claude.json.
  try {
    if (fs.existsSync(p.claudeJson)) {
      const j = JSON.parse(fs.readFileSync(p.claudeJson, 'utf8'));
      if (j && j.projects && Object.prototype.hasOwnProperty.call(j.projects, p.trustDir)) {
        delete j.projects[p.trustDir];
        fs.writeFileSync(p.claudeJson, JSON.stringify(j, null, 2) + '\n');
        details.push('removed the ~/.claude.json trust entry');
      }
    }
  } catch (e) {
    details.push(`could not edit ~/.claude.json (${e.code || e.message}) — remove the trust entry by hand`);
  }
  // The trust cwd dir.
  try {
    if (fs.existsSync(p.trustDir)) { fs.rmSync(p.trustDir, { recursive: true, force: true }); details.push('removed the trust folder'); }
  } catch (e) {
    return { ok: false, detail: `could not remove ${p.trustDir} (${e.code || e.message})` };
  }
  // ~/.llmdash only if now empty (a user may keep other things there).
  try {
    if (fs.existsSync(p.llmdashDir) && fs.readdirSync(p.llmdashDir).length === 0) {
      fs.rmdirSync(p.llmdashDir);
      details.push('removed the now-empty ~/.llmdash');
    }
  } catch { /* non-empty or busy → leave it, not an error */ }
  return { ok: true, detail: details.length ? details.join('; ') : 'no trust artifacts to remove' };
}

// 4. wrapper: remove the SwiftBar wrapper ONLY if it carries the
//    `llmdash-menu-bar-badge` marker (a non-marker user file is spared, honest).
//    Delegated to the installer's remove_badge BEFORE the checkout is deleted (a
//    read-up-front shell-out that must not happen after step 5). If the installer
//    is already gone (edge), fall back to inline marker-gated removal.
const BADGE_WRAPPER_MARKER = 'llmdash-menu-bar-badge';
function stepWrapper(p, env) {
  // Prefer the installer's remove_badge (single source of truth) while the
  // checkout still exists — it also handles the legacy symlink + the SwiftBar-dir
  // detection + the "no marker → spared" message.
  if (fs.existsSync(p.installer)) {
    try {
      const out = execFileSync('/bin/sh', [p.installer, '--remove-badge', p.checkout], {
        encoding: 'utf8', env,
      });
      // remove_badge prints an honest message; surface a compact detail.
      const spared = /not a llmdash wrapper/.test(out);
      return { ok: true, detail: spared ? 'a non-llmdash file in SwiftBar\'s dir was spared (no marker)' : 'removed the menu-bar wrapper (marker-gated)' };
    } catch (e) {
      return { ok: false, detail: `--remove-badge failed (${e.code || e.message}) — remove the SwiftBar wrapper by hand` };
    }
  }
  // Fallback: inline marker-gated removal against an injected wrapper path (tests).
  const wrapper = p.wrapper;
  if (!wrapper) return { ok: true, detail: 'no SwiftBar wrapper path known — nothing to remove' };
  try {
    const st = fs.existsSync(wrapper) ? fs.lstatSync(wrapper) : null;
    if (!st) return { ok: true, detail: 'no SwiftBar wrapper present — nothing to remove' };
    if (st.isSymbolicLink()) { fs.rmSync(wrapper, { force: true }); return { ok: true, detail: 'removed the legacy wrapper symlink' }; }
    const body = fs.readFileSync(wrapper, 'utf8');
    if (body.includes(BADGE_WRAPPER_MARKER)) { fs.rmSync(wrapper, { force: true }); return { ok: true, detail: 'removed the menu-bar wrapper (marker-gated)' }; }
    return { ok: true, detail: 'a non-llmdash file in SwiftBar\'s dir was spared (no marker)' };
  } catch (e) {
    return { ok: false, detail: `could not remove the SwiftBar wrapper (${e.code || e.message})` };
  }
}

// The llmdash-owned files under the data dir (own-file names only — a data-delete
// never blindly rm's the whole dir, which a user may point elsewhere). Keep the
// active reset/billing history and legacy fixed periods in the same lifecycle as
// the usage database: preserve them by default, delete them only on explicit
// --delete-data.
const DATA_FILES = [
  'llmdash.db',
  'llmdash.db-wal',
  'llmdash.db-shm',
  'claude-ratelimits.json',
  'hosts.conf',
  'account-config.json',
  'subscriptions.json',
];

// Is childPath inside (or equal to) parentDir? Used to detect a data dir that
// lives UNDER the checkout (config.js's default: dataDir = <checkout>/data), which
// a blind checkout rm would collateral-delete.
function isUnder(childPath, parentDir) {
  const rel = path.relative(parentDir, childPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Unlike existsSync, do not turn a permission/I/O error into "missing" while a
// preservation decision is being made. Only a definite absent path is false;
// every other error fails the rescue closed so the checkout is retained.
function rescuePathExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return false;
    throw e;
  }
}

// Pre-checkout data rescue (FR-12): when PRESERVING data and the data dir lives
// UNDER the checkout, move the llmdash-owned files to a fresh private directory
// below ~/.llmdash/preserved-data BEFORE the checkout is deleted — otherwise the
// "preserved by default" promise would be silently broken. A unique directory per
// uninstall means an older rescue is never overwritten. Returns the rescued
// location (or null when no rescue was needed). NEVER throws.
function rescueDataIfNeeded(p, deleteData) {
  if (deleteData) return { ok: true, rescuedTo: null, moved: [] }; // deletion path: no rescue
  if (!isUnder(p.dataDir, p.checkout)) return { ok: true, rescuedTo: null, moved: [] }; // data is safe outside the checkout
  const base = p.preservedDataDir || path.join(p.llmdashDir, 'preserved-data');
  let dest = null;
  const moved = [];
  let sources = [];
  try {
    if (!rescuePathExists(p.dataDir)) return { ok: true, rescuedTo: null, moved };
    sources = DATA_FILES.filter((f) => rescuePathExists(path.join(p.dataDir, f)));
    if (!sources.length) return { ok: true, rescuedTo: null, moved };
    if (isUnder(path.resolve(base), path.resolve(p.checkout))) {
      const error = new Error('the preservation directory is inside the checkout');
      error.code = 'EINVAL';
      throw error;
    }
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    // Resolve symlinks after creating the base. A lexical path outside the
    // checkout is not safe if it ultimately points back inside the checkout.
    if (isUnder(fs.realpathSync(base), fs.realpathSync(p.checkout))) {
      const error = new Error('the preservation directory resolves inside the checkout');
      error.code = 'EINVAL';
      throw error;
    }
    dest = fs.mkdtempSync(path.join(base, 'uninstall-'));
    for (const f of sources) {
      const src = path.join(p.dataDir, f);
      const target = path.join(dest, f);
      // mkdtemp gives this uninstall an empty directory. Keep an explicit
      // collision refusal too: renameSync replaces an existing file on POSIX.
      if (rescuePathExists(target)) {
        const error = new Error(`refusing to overwrite ${target}`);
        error.code = 'EEXIST';
        throw error;
      }
      fs.renameSync(src, target);
      moved.push(f);
    }
    return { ok: true, rescuedTo: moved.length ? dest : null, moved };
  } catch (e) {
    const attempted = dest || base;
    const remaining = sources.filter((f) => !moved.includes(f));
    return {
      ok: false,
      detail: `could not preserve all of your local data to ${attempted} (${e.code || e.message})`,
      rescuedTo: dest,
      moved,
      remaining,
    };
  }
}

// 5. checkout: rm -rf the resolved checkout LAST (a leaf; nothing loads after it).
function stepCheckout(p) {
  try {
    if (fs.existsSync(p.checkout)) { fs.rmSync(p.checkout, { recursive: true, force: true }); return { ok: true, detail: `deleted the checkout at ${p.checkout}` }; }
    return { ok: true, detail: 'the checkout was already gone' };
  } catch (e) {
    return { ok: false, detail: `could not delete the checkout at ${p.checkout} (${e.code || e.message}) — delete it by hand` };
  }
}

// 6. data: ONLY if deleteData — rm the llmdash-owned files under dataDir AFTER the
//    checkout (data may live under it). Default: PRESERVED (rescued first if it
//    lived under the checkout). Own-file names only (never a blind rm of the whole
//    dir, which a user may point elsewhere).
function stepData(p, deleteData, rescue = { ok: true, rescuedTo: null }) {
  if (!deleteData) {
    // Preserved. If the data lived under the checkout it was rescued (moved) BEFORE
    // the checkout delete; name where it now lives. If the rescue itself failed,
    // surface that honestly. runTeardown retains the checkout on this path, so
    // unmoved files remain there; files moved before the error remain in the
    // partial unique rescue directory.
    if (!rescue.ok) {
      const partial = rescue.rescuedTo && rescue.moved && rescue.moved.length
        ? ` Data remains protected between the retained checkout at ${p.checkout} and the partial rescue at ${rescue.rescuedTo} (moved: ${rescue.moved.join(', ')}).`
        : ` Your local data remains protected in the retained checkout at ${p.checkout}.`;
      return {
        ok: false,
        detail: `${rescue.detail || 'could not preserve all of your local data'}.${partial}`,
        preserved: true,
        rescuedTo: rescue.rescuedTo,
        moved: rescue.moved || [],
      };
    }
    const where = rescue.rescuedTo
      ? ` — the named data files now live at ${rescue.rescuedTo} (they were under the checkout, so they were moved to safety before the checkout was deleted)`
      : '';
    return { ok: true, detail: `PRESERVED your local usage history and configuration${where}`, preserved: true, rescuedTo: rescue.rescuedTo };
  }
  // If the data dir lived UNDER the checkout, the checkout rm (step 5) already
  // deleted it — the deletion the user asked for is done; say so honestly rather
  // than "nothing to delete."
  const dataWasUnderCheckout = isUnder(p.dataDir, p.checkout);
  const removed = [];
  try {
    for (const f of DATA_FILES) {
      const fp = path.join(p.dataDir, f);
      if (fs.existsSync(fp)) { fs.rmSync(fp, { force: true }); removed.push(f); }
    }
    // The dataDir itself only if now empty (never blind — a user may share it).
    try {
      if (fs.existsSync(p.dataDir) && fs.readdirSync(p.dataDir).length === 0) fs.rmdirSync(p.dataDir);
    } catch { /* non-empty → leave it */ }
    const detail = removed.length
      ? `deleted your local data (${removed.join(', ')})`
      : (dataWasUnderCheckout ? 'deleted your local data (it lived under the checkout, removed with it)' : 'no llmdash data files to delete');
    return { ok: true, detail, preserved: false };
  } catch (e) {
    return { ok: false, detail: `could not delete some llmdash data files (${e.code || e.message})`, preserved: false };
  }
}

// Run the full ordered teardown against resolved paths. Returns the ordered step
// log. NEVER throws. This is what the detached child executes — self-contained.
export function runTeardown(p, { deleteData = false, env = process.env } = {}) {
  const steps = [];
  steps.push({ step: 'service', ...stepService(p) });
  steps.push({ step: 'statusline', ...stepStatusline(p) });
  steps.push({ step: 'trust', ...stepTrust(p) });
  steps.push({ step: 'wrapper', ...stepWrapper(p, env) });
  // Rescue the data BEFORE deleting the checkout if preserving AND the data lives
  // under the checkout (config's default) — otherwise "preserved by default" would
  // be silently broken by the checkout rm. A no-op when data is outside the checkout
  // or when deleting. Recorded so the summary can name where the data now lives.
  const rescue = rescueDataIfNeeded(p, deleteData);
  if (!rescue.ok) {
    // Fail closed: the rescue may have moved only some files. Deleting the
    // checkout now would destroy the rest, so retain it for manual recovery.
    steps.push({
      step: 'checkout',
      ok: false,
      retained: true,
      detail: `retained the checkout at ${p.checkout} because local-data preservation did not complete`,
    });
  } else {
    steps.push({ step: 'checkout', ...stepCheckout(p) });    // LAST destructive-of-self
  }
  steps.push({ step: 'data', ...stepData(p, deleteData, rescue) });   // after the checkout
  return steps;
}

// Compose the honest post-uninstall message from the step log (FR-20): name every
// step that did NOT complete; never claim a removal that didn't happen.
export function summarizeTeardown(steps) {
  const failed = steps.filter((s) => !s.ok);
  const dataStep = steps.find((s) => s.step === 'data');
  const kept = dataStep && dataStep.preserved;
  if (!failed.length) {
    return `llmdash was uninstalled. ${kept ? 'Your local usage history and configuration were kept.' : 'Your local usage history and configuration were deleted, as you chose.'} SwiftBar was not removed (uninstall it with: brew uninstall --cask swiftbar).`;
  }
  const lines = failed.map((s) => `  • ${s.step}: ${s.detail}`);
  const dataOutcome = dataStep && !dataStep.ok
    ? (kept
      ? 'Your local data remains protected; review the data step above for its location or locations.'
      : 'Some local data may remain because the requested deletion did not complete.')
    : (kept
      ? 'Your local usage history and configuration were kept.'
      : 'Your local usage history and configuration were deleted, as you chose.');
  return 'The llmdash uninstall did NOT complete:\n'
    + lines.join('\n')
    + `\nOther teardown steps completed. ${dataOutcome}`;
}

// ── The detach: copy self to temp, cd out of the checkout, re-spawn detached ───
// The action (invoked from inside the checkout by the badge) does ONLY this and
// returns — exactly as the badge action expects. The detached child (--run)
// executes runTeardown from the temp copy, surviving the checkout's deletion
// (SPIKE-01). Every path it needs is on ARGV (JSON), so it reads NOTHING from the
// checkout lazily (Hazard E). `p` = resolved paths; `deleteData` = the opt-in.
function detachTeardown(p, deleteData, selfPath, env) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-teardown-'));
  const tmpSelf = path.join(tmpDir, 'teardown.mjs');
  fs.copyFileSync(selfPath, tmpSelf);
  const payload = JSON.stringify({ p, deleteData });
  const child = spawn(process.execPath, [tmpSelf, '--run', '--payload', payload], {
    cwd: tmpDir,        // cd OUT of the checkout so its deletion can't strand cwd
    detached: true,     // new session — outlives the parent + the spawning service
    stdio: 'ignore',
    env,
  });
  child.unref();
  return { ok: true, reason: 'detached', tmpDir };
}

// ── The verbs ─────────────────────────────────────────────────────────────────
// install / remove delegate to install-macos.sh (the single source of truth for
// launchctl/plist). remove-badge delegates to --remove-badge. uninstall runs the
// enumerate+confirm+opt-in dialogs then the detached teardown.

// Resolve the checkout dir the badge is running from. In production that's the
// helper's own directory's parent-parent (scripts/menubar/ → checkout). Injectable.
function resolveCheckout(opts, env) {
  if (opts.checkout) return opts.checkout;
  if (env.LLMDASH_DIR) return env.LLMDASH_DIR;
  try {
    const selfDir = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(selfDir, '..', '..');
  } catch { return process.cwd(); }
}

function runInstaller(checkout, args, env) {
  const installer = path.join(checkout, 'scripts', 'install-macos.sh');
  return execFileSync('/bin/sh', [installer, ...args], { encoding: 'utf8', env });
}

export function runInstall(opts = {}, env = process.env) {
  const checkout = resolveCheckout(opts, env);
  const interactive = opts.interactive !== false && env.LLMDASH_ACTION_NONINTERACTIVE !== '1';
  if (interactive && !opts.yes) {
    if (!confirm(SERVICE_INSTALL_TITLE, SERVICE_INSTALL_BODY, 'Install', 'Cancel', 'Cancel')) {
      return { ok: false, reason: 'cancelled' };
    }
  }
  try {
    const out = runInstaller(checkout, ['--service', 'install', checkout], env);
    if (interactive) showMessage('The local llmdash service is installed and running.');
    return { ok: true, reason: 'installed', detail: out.trim() };
  } catch (e) {
    if (interactive) showMessage(`Couldn't install the service — ${e.message}. Nothing was changed.`);
    return { ok: false, reason: 'installer-failed', detail: e.message };
  }
}

export function runRemoveService(opts = {}, env = process.env) {
  const checkout = resolveCheckout(opts, env);
  const interactive = opts.interactive !== false && env.LLMDASH_ACTION_NONINTERACTIVE !== '1';
  if (interactive && !opts.yes) {
    if (!confirm(SERVICE_REMOVE_TITLE, SERVICE_REMOVE_BODY, 'Remove the service', 'Cancel', 'Cancel')) {
      return { ok: false, reason: 'cancelled' };
    }
  }
  try {
    const out = runInstaller(checkout, ['--service', 'remove'], env);
    return { ok: true, reason: 'removed', detail: out.trim() };
  } catch (e) {
    if (interactive) showMessage(`Couldn't remove the service — ${e.message}. Nothing was changed.`);
    return { ok: false, reason: 'installer-failed', detail: e.message };
  }
}

export function runRemoveBadge(opts = {}, env = process.env) {
  const checkout = resolveCheckout(opts, env);
  try {
    const out = runInstaller(checkout, ['--remove-badge', checkout], env);
    return { ok: true, reason: 'badge-removed', detail: out.trim() };
  } catch (e) {
    return { ok: false, reason: 'installer-failed', detail: e.message };
  }
}

// The complete uninstall: enumerate+confirm → data opt-in → detached teardown.
// In tests (interactive:false, or LLMDASH_ACTION_NONINTERACTIVE=1) the dialogs are
// bypassed and the flags drive it: `--yes` skips the confirm, `--delete-data`/
// `--keep-data` set the opt-in. `opts.run` runs the teardown INLINE (no detach) so
// tests can assert the ordered step log directly against scratch paths.
export function runUninstall(opts = {}, env = process.env) {
  const checkout = resolveCheckout(opts, env);
  const interactive = opts.interactive !== false && env.LLMDASH_ACTION_NONINTERACTIVE !== '1';
  // Resolve every path up front (production: realPaths; tests: injected p).
  const p = opts.paths || realPaths(checkout, env);

  // Dialog 1: the enumerated confirm. Cancel changes nothing.
  if (interactive && !opts.yes) {
    if (!confirm(UNINSTALL_TITLE, uninstallBody(p.checkout), 'Uninstall', 'Cancel', 'Cancel')) {
      return { ok: false, reason: 'cancelled' };
    }
  }
  // Dialog 2 (only after confirming step 1): the data opt-in. Default = Keep.
  let deleteData = opts.deleteData === true;
  if (interactive && !opts.yes) {
    deleteData = confirm(DATA_TITLE, DATA_BODY, 'Delete my data', 'Keep my data', 'Keep my data');
  }

  // Inline mode (tests): run the ordered teardown here and return the step log.
  if (opts.run) {
    const steps = runTeardown(p, { deleteData, env });
    return { ok: steps.every((s) => s.ok), reason: 'torn-down', steps, message: summarizeTeardown(steps) };
  }
  // Production: detach a temp copy of THIS self-contained file and return at once.
  const selfPath = opts.selfPath || fileURLToPath(import.meta.url);
  return detachTeardown(p, deleteData, selfPath, env);
}

// ── CLI entry ─────────────────────────────────────────────────────────────────
// The detached child arrives as `--run --payload <json>` and executes the
// teardown directly (it is the temp copy, outside the checkout). Otherwise a
// normal verb dispatch.
export function runCli(argv = process.argv.slice(2), env = process.env, opts = {}) {
  // Detached child: run the pre-resolved teardown from the temp copy.
  if (argv.includes('--run')) {
    const i = argv.indexOf('--payload');
    let payload = {};
    try { payload = JSON.parse(argv[i + 1]); } catch {}
    const steps = runTeardown(payload.p, { deleteData: !!payload.deleteData, env });
    // Self-clean the temp dir this copy runs from — the very LAST act, after all
    // teardown (the running copy stays resident on APFS once unlinked, so this is
    // safe; it leaves no llmdash-teardown-* litter in os.tmpdir()).
    try {
      const selfDir = path.dirname(fs.realpathSync(process.argv[1]));
      if (path.basename(selfDir).startsWith('llmdash-teardown-')) fs.rmSync(selfDir, { recursive: true, force: true });
    } catch { /* best-effort — never fail the teardown over temp litter */ }
    return { ok: steps.every((s) => s.ok), reason: 'torn-down', steps };
  }

  const [action, ...rest] = argv;
  const yes = rest.includes('--yes');
  const deleteData = rest.includes('--delete-data');
  const nonInteractive = env.LLMDASH_ACTION_NONINTERACTIVE === '1';
  const interactive = !nonInteractive;
  const base = { ...opts, yes, interactive };

  if (action === 'install') return runInstall(base, env);
  if (action === 'remove') return runRemoveService(base, env);
  if (action === 'remove-badge') return runRemoveBadge(base, env);
  if (action === 'uninstall') return runUninstall({ ...base, deleteData }, env);
  return { ok: false, reason: 'unknown-action' };
}

// Run only when invoked directly (not when imported by tests). Compare REAL paths
// so a symlinked invocation still fires, mirroring the plugin's run-guard.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (invokedDirectly()) {
  const res = runCli();
  // Exit non-zero on a hard failure so the caller (SwiftBar) can tell, but never
  // throw (that would surface the host's own error dialog). A user cancel is 0.
  if (!res || (!res.ok && res.reason !== 'cancelled' && res.reason !== 'detached')) process.exitCode = 1;
}
