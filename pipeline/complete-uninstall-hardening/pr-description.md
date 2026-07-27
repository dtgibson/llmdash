## Complete Uninstall Hardening

### What this does
Complete uninstall now treats launchd status `113` as the only proof that the service is absent and removes nothing when that proof cannot be obtained. It also preserves or deletes `llmdash.db-journal` with the other SQLite files, and the detached child presents its final success or failure with every recovery location.

### How to test
1. Run `node --test tests/menubar-service-control.test.js`.
2. Confirm the service-uncertainty test retains every scratch artifact and the delayed-unload test waits for status `113`.
3. Confirm preserve, explicit-delete, detached-report, and detached-survival tests cover `llmdash.db-journal` and recovery-path copy.
4. Run `npm test` for the full regression suite.

### Notes for reviewer
The helper remains self-contained and imports only Node builtins so its temp copy survives deleting the checkout. Production subprocesses use fixed absolute paths, argv arrays, hard timeouts, and user-domain launchctl targets; the injected runners exist only on the inline scratch-test path. The real llmdash installation is never uninstalled by the tests.
