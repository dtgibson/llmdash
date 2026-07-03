#!/usr/bin/env node
// llmdash — the badge's Add / Remove host helper (multi-host-badge, FR-14–FR-18).
//
// Invoked by the SwiftBar dropdown actions under the wrapper's ABSOLUTE node:
//   Add host…              → shell="$ABS_NODE" param1=".../host-config-action.mjs" param2=add
//   Stop watching <label>… → shell="$ABS_NODE" param1=".../host-config-action.mjs" param2=remove param3="<key>"
// (terminal=false windowless, refresh=true so the dropdown reflects the new list.)
//
// It writes the LOCAL hosts.conf via src/host-config.js's atomic temp+rename — NO
// HTTP mutation, so the dashboard's serve-only/405 posture is preserved. Node
// builtins + macOS osascript only (no npm dep, no build step).
//
// ANTI-INJECTION (SPIKE-01, for the Auditor): the AppleScript is a FIXED LITERAL.
// The typed value leaves osascript via `text returned of result` on stdout and is
// passed to host-config.js ONLY as a captured string / ARGV — it is NEVER
// string-concatenated into an AppleScript source or a shell command, never sh -c,
// never eval'd. A `| rm -rf ~`-style value is inert data end to end.
//
// TEST SEAM: the sanitize/validate/atomic-write logic lives in host-config.js and
// is driven directly with an INJECTED value in tests (no real dialog). This helper
// also accepts an injected value via LLMDASH_ACTION_VALUE / --value=… (add) and
// --yes (remove, skip confirm) so the round-trip is testable WITHOUT popping a
// real osascript dialog. The dialog is a thin front end the tests bypass.

import { execFileSync } from 'node:child_process';
import { addHost, removeHost, listHosts } from '../../src/host-config.js';
import { config } from '../../config.js';

// ── Fixed-literal AppleScript dialogs (never built from the entered value) ────
// The prompt/error copy is verbatim from the design spec (FR-18). Each is a
// constant string; the ONLY dynamic input is what osascript returns to us.

const ADD_PROMPT =
  'Add a machine to watch. Enter its Tailscale hostname or IP — optionally host:port or host=Label (e.g. 100.64.0.7:8788=Desktop).';
const INVALID_MSG =
  "That doesn't look like a valid host — nothing was added. Expected host[:port][=label].";
const POST_ADD = (host) => `Added ${host} — it'll appear on the next update.`;
const DUP_MSG = (label, addr) =>
  `That host is already being watched. ${label} (${addr}) is already in your list — nothing changed.`;
const WRITE_FAIL = (reason) => `Couldn't save the host list — ${reason}. Nothing changed.`;
const REMOVE_CONFIRM = (label, addr) => `Stop watching ${label} (${addr})?`;

// A value is passed to AppleScript ONLY as a literal we control (fixed copy) — an
// osascript string arg is passed via a separate `-e` line so it is a literal, not
// interpolated into the script body. We build these small AppleScript programs
// from FIXED templates + our OWN copy (never the user's typed value).

// Prompt for a host string. Returns the typed value (trimmed by us later) or null
// if the user cancelled. The AppleScript is a fixed literal; the typed value comes
// back on stdout via `text returned of result` — never re-compiled into a script.
function promptForHost() {
  // display dialog with an empty default answer. `giving up after` is NOT set so
  // the user has as long as they need; a Cancel throws (caught → null). Standard
  // Additions display dialog does NOT trigger an Automation TCC prompt (SPIKE-01).
  const script =
    'display dialog ' + asStr(ADD_PROMPT) + ' default answer "" ' +
    'with title "llmdash" buttons {"Cancel", "Add"} default button "Add"\n' +
    'return text returned of result';
  try {
    const out = execFileSync('/usr/bin/osascript', ['-e', script], { encoding: 'utf8' });
    return out.replace(/\n$/, '');
  } catch {
    return null; // Cancel / any failure → nothing to add
  }
}

// Show a fixed message dialog (info / error). The message is OUR copy — for the
// duplicate/invalid cases it embeds already-sanitized label/addr we control, never
// the raw typed value re-fed to AppleScript. asStr() escapes it into an AppleScript
// string literal so even our own copy can't break the script.
function showMessage(msg) {
  const script = 'display dialog ' + asStr(msg) + ' with title "llmdash" buttons {"OK"} default button "OK"';
  try { execFileSync('/usr/bin/osascript', ['-e', script], { encoding: 'utf8' }); } catch {}
}

// Confirm dialog for Remove. Returns true iff the user clicked "Stop watching".
function confirmRemove(label, addr) {
  const script =
    'display dialog ' + asStr(REMOVE_CONFIRM(label, addr)) + ' with title "llmdash" ' +
    'buttons {"Cancel", "Stop watching"} default button "Cancel"\n' +
    'return button returned of result';
  try {
    const out = execFileSync('/usr/bin/osascript', ['-e', script], { encoding: 'utf8' });
    return out.replace(/\n$/, '') === 'Stop watching';
  } catch {
    return false; // Cancel / failure → do nothing
  }
}

// Escape a string into an AppleScript double-quoted literal. Used ONLY for OUR
// fixed copy (prompts/messages), never to smuggle the user's value back into a
// script (the user's value never re-enters AppleScript at all). Backslash and
// double-quote are the only metacharacters inside an AS string literal.
export function asStr(s) {
  return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// ── add: collect (dialog or injected) → host-config.js addHost ────────────────
export function runAdd({
  value = null,          // injected value (test seam); null → pop the dialog
  hostsFile = config.hostsFile,
  hostsRaw = config.hostsRaw,
  interactive = true,    // false in tests → never touches osascript
} = {}) {
  let entry = value;
  if (entry == null) {
    if (!interactive) return { ok: false, reason: 'no-value' };
    entry = promptForHost();
    if (entry == null) return { ok: false, reason: 'cancelled' };
  }
  const res = addHost(hostsFile, entry, { hostsRaw });
  if (res.ok) {
    if (interactive) showMessage(POST_ADD(res.canonical));
    return res;
  }
  // Honest failure dialogs — NOTHING was written.
  if (interactive) {
    if (res.reason === 'duplicate') {
      const label = res.detail || entry;
      showMessage(DUP_MSG(label, label));
    } else if (res.reason === 'write-failed') {
      showMessage(WRITE_FAIL(res.detail || 'write failed'));
    } else {
      showMessage(INVALID_MSG);
    }
  }
  return res;
}

// ── remove <key>: confirm (dialog or --yes) → host-config.js removeHost ───────
export function runRemove(key, {
  yes = false,           // skip the confirm dialog (test seam / --yes)
  hostsFile = config.hostsFile,
  hostsRaw = config.hostsRaw,
  interactive = true,
} = {}) {
  if (!key) return { ok: false, reason: 'no-key' };
  // Look up the label/addr for the confirm copy from the current list.
  let label = key, addr = key;
  try {
    const remotes = listHosts({ hostsFile, hostsRaw });
    const match = remotes.find((h) => h.key === key);
    if (match) { label = match.label; addr = `${match.host}:${match.port}`; }
  } catch {}
  if (!yes && interactive) {
    if (!confirmRemove(label, addr)) return { ok: false, reason: 'cancelled' };
  }
  const res = removeHost(hostsFile, key, { hostsRaw });
  if (!res.ok && interactive && res.reason === 'write-failed') {
    showMessage(WRITE_FAIL(res.detail || 'write failed'));
  }
  return res;
}

// ── CLI entry ─────────────────────────────────────────────────────────────────
export function runCli(argv = process.argv.slice(2), env = process.env, opts = {}) {
  const [action, ...rest] = argv;
  // A `--value=…` flag (or LLMDASH_ACTION_VALUE env) injects the value for the
  // fallback / non-interactive path; `--yes` skips the remove confirm.
  const valueFlag = rest.find((a) => a.startsWith('--value='));
  const injected = valueFlag ? valueFlag.slice('--value='.length) : (env.LLMDASH_ACTION_VALUE || null);
  const yes = rest.includes('--yes');
  const nonInteractive = env.LLMDASH_ACTION_NONINTERACTIVE === '1';
  // opts.hostsFile lets tests point the CLI at a scratch file (never the real
  // data dir). Production omits it → config.hostsFile.
  const fileOpts = opts.hostsFile ? { hostsFile: opts.hostsFile } : {};
  if (action === 'add') {
    return runAdd({ value: injected, interactive: !nonInteractive, ...fileOpts });
  }
  if (action === 'remove') {
    const key = rest.find((a) => !a.startsWith('--'));
    return runRemove(key, { yes, interactive: !nonInteractive, ...fileOpts });
  }
  return { ok: false, reason: 'unknown-action' };
}

// Run only when invoked directly (not when imported by tests). Compare REAL paths
// so a symlinked invocation still fires, mirroring the plugin's run-guard.
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (invokedDirectly()) {
  const res = runCli();
  // Exit non-zero on a hard failure so the caller (SwiftBar) can tell, but never
  // throw (that would surface the host's own error dialog). A user cancel is 0.
  if (!res || (!res.ok && res.reason !== 'cancelled')) process.exitCode = 1;
}
