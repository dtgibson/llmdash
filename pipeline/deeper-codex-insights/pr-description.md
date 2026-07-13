## Deeper Codex Insights

### What this does
Adds a privacy-bounded Codex diagnostic section beneath the existing account
limits. It derives 24-hour, 7-day, and 30-day reasoning, turn/session, model,
effort, tool, context, compaction, and explicit timing insights from structured
local rollout metadata, while carrying live plan and credit status from the
existing account-rate-limit poll.

The implementation also deduplicates repeated Codex token snapshots and feeds
the corrected stream to existing activity/trend calculations. A poller-owned
cache keeps rollout scanning off the new HTTP request path; `/api/state`, peer
fan-out, stored limit snapshots, and the native menu contract remain unchanged.

### How to test
1. Run `npm test` and confirm the full Node test suite passes.
2. Start the app with `npm start` and open `http://localhost:8787`.
3. Confirm `▲ Codex insights` appears after the tool/host activity region and
   before Trends, labeled `This machine`.
4. Switch among 24h, 7d, and 30d and confirm the whole insight view updates while
   account-wide plan/credit facts remain fixed.
5. Inspect `/api/codex-insights?range=7d` and confirm it contains only bounded
   aggregates—no prompt/response text, arguments, paths, email, or raw IDs.
6. Check a narrow viewport and both color schemes; confirm no horizontal scroll,
   range controls remain keyboard operable, and unsupported values say
   `Unavailable` rather than `0`.
7. Run the tracked menu-bar contract suites and confirm their output is
   unchanged.

### Notes for reviewer
- Deeper insights are intentionally local to the llmdash instance serving the
  page. Multi-host dashboards say `This machine`; v1 does not add another peer
  request or combine remote activity.
- Latency comes only from explicit completed-task duration and time-to-first-token
  fields. Aborted/ambiguous records are excluded.
- `cached_input_tokens` remains a subset of Codex input. Total tokens are input +
  output, and cumulative `total_token_usage` is used only to distinguish repeated
  notifications from legitimate same-sized calls.
- Credit balances are opaque strings with no invented currency or billing unit;
  individual spend limits and reset-credit details are ignored.
- No migration or runtime dependency is included.

### Validation completed
- Full regression: 539 tests, 537 passed, 2 intentionally skipped, 0 failed.
- Focused hostile, legacy, cache-failure, accessibility, responsive, and
  request-race fixtures pass.
- Production dashboard rendering was inspected against live local aggregates;
  the 24h/7d/30d control and account/local scope labels render correctly.
- A sanitized scan of the installed Codex rollout shapes detected every supported
  capability while the serialized insight contract contained no raw IDs or paths.
- Weft design lint and `git diff --check` are clean; the menu implementation is
  unchanged and its existing contract suite passes.
