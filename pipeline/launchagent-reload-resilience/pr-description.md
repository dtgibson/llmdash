## LaunchAgent Reload Resilience

### What this does
The shared macOS reload path now gives each `launchctl bootout`, absence
`print`, `bootstrap`, and PATH-resolved poll/retry `sleep` its own hard
wall-clock deadline. The Bash 3.2-compatible watchdog runs the command and an
absolute `/bin/sleep` timer as direct children, returns the command's exact
status, and terminates and reaps the losing child by exact PID. A parent-shell
capture wrapper uses a secure stock-macOS temporary file and a separate timeout
flag, so a prompt child status `124` remains distinguishable from watchdog
expiry even though both return `124` to the caller. It uses no new dependency,
GNU timeout utility, PID probe, or process-group kill.

Command success requires an ordered observation: the command is no longer
running and the deadline child is then still running. Deadline completion and
the ambiguous case where both children finish between polls return `124`. This
is intentionally conservative within the 10-millisecond observation interval,
so a command that crosses its deadline cannot be reported as successful.

`bootout` output and status are retained while absence is checked. A bootout
timeout stops immediately. Other bootout failures remain friendly when
`launchctl print` status `113` confirms the job is absent; if absence cannot be
confirmed, the original bootout diagnostic and status are emitted before the
terminal absence failure. Bootstrap remains blocked whenever prior state is
uncertain. Natural launchctl status `124` follows those normal nonzero rules and
retains its raw diagnostic without being mislabeled as a timeout.

Both the main installer and `--service install` inherit the behavior from the
same `load_service` function. Removal, status reads, plist generation, menu
controls, APIs, data, and non-macOS behavior are unchanged.

### How to test
1. Run `bash -n scripts/install-macos.sh`.
2. Run `node --check tests/install-service-hooks.test.js`.
3. Run `node --test tests/install-service-hooks.test.js`.
4. Run `node --test tests/install-macos.test.js tests/menubar-install.test.js tests/menubar-service-control.test.js tests/menubar-uninstall-dropdown.test.js`.
5. Run `npm test`.
6. Run `git diff --check`.

### Notes for reviewer
The focused suite uses accelerated copies of the production timeout constants
plus PATH-injected fake commands. Exec'd `/bin/sleep` children ignore `TERM`,
forcing the watchdog's bounded `KILL` path for hanging bootout, repeated print,
both bootstrap positions, absence-poll sleep, and bootstrap-retry sleep. Every
case records the direct command PID, verifies that process is reaped, and checks
that no secure capture file remains.

A direct Bash 3.2 boundary regression uses a dedicated extracted helper with a
one-second observation interval, a 100-millisecond timer, and a 200-millisecond
command. Both children therefore finish before the next poll: the former
command-first tie logic would deterministically accept the command, while the
timer-authoritative implementation returns `124`. Three repetitions leave no
recorded PID. Fast commands and exact statuses `113` and `5` use a wide
five-second test deadline and still pass through unchanged under concurrent
load.

Prompt launchctl status `124` is covered separately for bootout, print, and
bootstrap. Bootout remains idempotent after print `113`; print and bootstrap
return raw status `124` and diagnostics without timeout copy. The watchdog
tracks only its direct child. It intentionally does not discover or signal
arbitrary descendants created by a same-user PATH wrapper; stock `launchctl`
and `sleep`, and the exec'd sleeper fixtures, keep the tracked process as the
relevant lifecycle boundary.

The same secure regular-file capture now wraps the complete absence check, not
only individual launchctl calls. A test poll-sleep wrapper forks a descendant
that inherits its output descriptor: the installer still returns on the direct
child deadline because no command-substitution pipe remains. The descendant is
outside the exact-child signal boundary and is explicitly cleaned by the test.

The suite retains the exact status predicates: only print status `113`
confirms absence, and only bootstrap status `5` is retried once. All lifecycle
coverage uses process-specific `com.llmdash.spike-svchooks-*` labels and scratch
LaunchAgents directories; it never targets the real `com.llmdash.dashboard`
agent or plist.
