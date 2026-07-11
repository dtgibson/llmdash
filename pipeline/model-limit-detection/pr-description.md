## Model Limit Detection

### What this does
This fixes the Claude model-specific limit capture path so Fable and Sonnet caps do not disappear after ordinary Claude statusline updates. The statusline script now uses the shared newest-wins writer, model cap rows keep their own capture timestamp, and newer account-only readings preserve still-active model caps until their reset time.

The `/usage` auto-refresh probe also waits briefly after the account-wide windows first parse, giving lower model-specific sections time to render before the probe writes the reading.

### How to test
1. Run `node --test tests/claude-refresh-parse.test.js`.
2. Run `node --test tests/statusline-model-merge.test.js`.
3. Run `npm test`.
4. With an existing active model cap in `data/claude-ratelimits.json`, run `node scripts/statusline.js` with a normal Claude statusline payload and confirm `model_limits` remains present when its reset time is still in the future.
5. Let the installed app refresh after deployment and confirm the Claude model-specific meters remain visible after normal Claude Code activity.

### Notes for reviewer
The merge is intentionally conservative: prior model caps are only preserved when their reset time is still in the future. Incoming `/usage` model rows replace older rows for the same model/window, and account-level windows still follow the existing strict newest-`capturedAt` rule.
