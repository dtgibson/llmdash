# llmdash — Conventions

## Stack
- Vanilla Node with **zero runtime dependencies**. Use Node builtins only
  (`node:http`, `node:sqlite`, `node:test`). No frameworks, no bundler, no build
  step. Requires Node 24+ (for `node:sqlite`).
- Frontend is plain HTML/CSS/JS served as static files from `public/`.

## Patterns
- Configuration lives in `config.js`, overridable via `LLMDASH_*` env vars.
  **Never ship a dead knob** — an env var that drives nothing is dishonest
  surface.
- Persist only what has no other history: limit **snapshots** go to SQLite
  (deduped). Activity/token stats are derived on demand from Claude Code logs —
  no extra storage.
- **Be honest in the UI.** When a number's source or scope differs from the
  headline data (e.g. account-wide limits vs local-log activity), say so.
- **Surface security-relevant defaults** (e.g. network binding) in the README and
  the startup log — never silently.
- HTTP responses carry baseline security headers (`nosniff`, CSP `default-src
  'self'`, `Referrer-Policy`) and reject non-GET/HEAD with 405.

## Multi-source
- The dashboard is **source-aware**: each tool is a `source` value in
  `usage_snapshots` and a tool block in the UI. Add a new tool as a new source
  flowing through the shared path — don't fork the store or the renderer.
- **Clamp externally-sourced percentages** (limit used %) to 0–100 before storing
  or deriving from them.
- **Normalize externally-sourced timestamps to canonical ISO at ingest**
  (`new Date(Date.parse(v)).toISOString()`) — `Date.parse` validation alone
  doesn't guarantee a clean string. Never default a missing/unparseable
  timestamp to "now"; fall back to file mtime (a now-fallback makes malformed
  data eternally fresh).
- When refactoring a single-source view to multi-source, **diff the rendered stat
  set** so nothing silently drops. When a shared formatting helper changes, the
  diff must enumerate the helper's call sites, not just the feature's own block.
- Read live limits off the interval poller, never per HTTP request (Codex spawns a
  subprocess; keep that off the request path).
- Limit and headroom logic consider **all windows** (5-hour and weekly), not just
  one. Each tool shows a pacing predictor for **both** windows at once; a maxed
  window (≈0 remaining) reads "limit reached" and is binding **per window** (one
  maxed window never suppresses the other's pacing line).
- If a tool genuinely lacks token activity, render an honest "not available" state
  (never fabricated zeros) and omit its activity charts. (Codex *does* record
  activity — `~/.codex/sessions` rollout logs — so it shows full stats.)
- **Codex token accounting is subset-based, not disjoint like Anthropic's.** Codex
  `cached_input_tokens` ⊆ `input_tokens`: total = input + output (never + cached),
  cache hit rate = cached/input, and cached is billed at the cache-read rate
  (non-cached input at the input rate). The Anthropic-style additive sum inflates
  tokens ~2x and cost ~6.6x. Bucket Codex per-day data by **UTC** timestamps (its
  session directories are named in local time).
- Empty/error limit states cross the wire as **enum reason codes**
  (`limitsDiagnostic` in `/api/state`); the client maps codes to copy and escapes
  the few free-form fields. The server knows the cause — the client never guesses.
  A non-null diagnostic can coexist with rendered gauges (`stale-reading`).
  `auto-refresh-failing` / `auto-refresh-disabled` are **reserved** code names
  for a future auto-refresh revival — never reuse them.
- **Freshness thresholds are server-supplied** in the API payload (`freshness`
  on the tool object); the client derives display bands live from them on the
  render tick and never hardcodes threshold values.
- The startup data-source health readout lives in `src/health.js`
  (`healthLines()`): a new tool/source adds a line there naming what's missing,
  why it matters, and the fix. Health probes are cheap fs checks — no subprocess,
  never on the request path.

## Serving & UI
- Responses carry baseline security headers. The CSP allows `style-src
  'unsafe-inline'` (the UI sets dynamic widths/colors via inline styles) while
  `script-src` stays `'self'`. Keep style values to literals or coerced numbers —
  never interpolate untrusted input into a style or raw HTML (escape text).
- Static assets are served `cache-control: no-store` so code changes show on a
  plain refresh.
- Charts are plain SVG built into `innerHTML`. Verify the UI actually **renders**
  (not just that the page loads) — a blank-bar regression once passed a
  "page loads" check.

## Running & Testing
- `npm start` (or the `llmdash.service` systemd user service). Tests: `npm test`
  (node:test).
- Limit data requires Claude Code's statusline pointed at `scripts/statusline.js`.
