## LaunchAgent Reload Hardening

### What this does
The shared macOS service loader now waits up to five seconds for the prior user-domain LaunchAgent registration to disappear after `bootout` before it calls `bootstrap`. Launchctl print status `0` means the job is still present, while status `113` alone confirms absence; any other print status fails loudly without bootstrapping. If bootstrap returns launchctl exit status `5`, it waits 200 milliseconds and retries once. Persistent status `5`, any other bootstrap status, or a job that never disappears still exits nonzero with the terminal diagnostic.

Both the main installer and `--service install` continue to use the same `load_service` path. Plist generation, service removal, menu controls, APIs, data, and non-macOS behavior are unchanged.

### How to test
1. Run `bash -n scripts/install-macos.sh`.
2. Run `node --check tests/install-service-hooks.test.js`.
3. Run `node --test tests/install-service-hooks.test.js`.
4. Run `node --test tests/install-macos.test.js tests/menubar-install.test.js tests/menubar-service-control.test.js tests/menubar-uninstall-dropdown.test.js`.
5. Run `npm test`.

### Notes for reviewer
The focused suite uses PATH-injected fake `launchctl` and `sleep` commands for deterministic delayed-unregister and failure branches. Its live lifecycle coverage still uses only process-specific `com.llmdash.spike-svchooks-*` labels and scratch plist directories; it never targets `com.llmdash.dashboard` or the real `~/Library/LaunchAgents` plist.

The production predicates use exact launchctl process statuses, not error text. Only print status `113` confirms absence, and only bootstrap status `5` receives one retry; non-5 bootstrap failures make one bootstrap call, and persistent status `5` makes exactly two.
