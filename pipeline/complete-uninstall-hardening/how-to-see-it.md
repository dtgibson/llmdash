## Seeing Complete Uninstall Hardening locally

1. Open a terminal in the llmdash project folder.

2. Run the focused scratch-install checks:

   `node --test tests/menubar-service-control.test.js`

3. Look for all 21 checks to pass. The named checks show that uncertain service shutdown removes nothing, exact status `113` allows teardown, the rollback journal is preserved or deleted with the database, and the detached-child path reports its result and every recovery directory, including a partial explicit-delete failure.

4. Run the complete regression suite:

   `npm test`

5. Confirm the summary reports 733 passing, 0 failing, and 2 skipped tests. These tests use isolated scratch checkouts and distinct scratch launchd labels; they do not touch the installed llmdash checkout, production data, or production service label.
