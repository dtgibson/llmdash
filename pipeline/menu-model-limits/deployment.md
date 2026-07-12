# Deployment — Menu Model Limits

**Date:** 2026-07-11
**Environment:** Local macOS production checkout at `/Users/developer/llmdash`
**Result:** DEPLOYED

## What Was Deployed
Applied the runtime menu-bar plugin change to:

- `/Users/developer/llmdash/scripts/menubar/llmdash.5s.js`

The SwiftBar wrapper at `~/Library/Application Support/SwiftBar/Plugins/llmdash.5s.js` already points at that tracked plugin file.

## Deployment Steps
1. Confirmed the live checkout was clean and on the same base commit as the working checkout.
2. Applied the runtime plugin diff from this working checkout to `/Users/developer/llmdash`.
3. Attempted to reload the launchd service through the project installer hook:
   `/Users/developer/llmdash/scripts/install-macos.sh --service install /Users/developer/llmdash`
4. The installer hook failed at `launchctl bootstrap` with macOS error 5 after unloading the previous service.
5. Verified the plist was present and valid with `plutil -lint`.
6. Recovered by bootstrapping the valid plist directly:
   `launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.llmdash.dashboard.plist"`

## Post-Deploy Health Check
- Service status: `running`
- Local API: `curl -fsS http://127.0.0.1:8787/api/state` returned successfully.
- Combined host API: `curl -fsS http://127.0.0.1:8787/api/hosts` returned successfully.
- Installed menu-bar plugin: `node /Users/developer/llmdash/scripts/menubar/llmdash.5s.js` rendered the new `Model limits` block under Claude with the current Fable model cap.
- Diff hygiene: `git diff --check` passed in both the working checkout and the live checkout.

## Production URL
- Local: `http://127.0.0.1:8787/`
- Tailnet URL from startup logs: `http://100.70.220.2:8787/`

## Notes
- No cloud deployment, CI/CD pipeline, or staging environment is configured for this project.
- The live checkout is now intentionally dirty with the deployed runtime plugin change.
- Rollback path: reverse the plugin diff in `/Users/developer/llmdash/scripts/menubar/llmdash.5s.js`, then let SwiftBar refresh or run the service bootstrap if the local service needs a reload.
