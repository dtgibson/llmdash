# Claude trends background cache

Claude daily trends now publish 24h, 7d, and 30d together from the poller. Cold
requests report `warming`; requests never traverse/read Claude transcripts or
aggregate Claude daily records. Failed or incomplete refreshes retain the last
complete publication. Successful refreshes invalidate the existing response cache.

## Implementation

- `src/claude-trend-cache.js`: descriptor-validated, no-follow, 64 KiB streaming
  reads; bounded direct-project discovery; reduced per-file usage cache; completed
  files survive bounded passes so later polls can converge.
- `src/trends.js`: reuses `stats.aggregate` and the existing daily bucketing logic,
  adds cooperative grouping and one immutable publication for all three ranges.
- `src/poller.js`: refreshes Claude trends on the existing single-flight tick;
  startup still starts that tick after the listener binds.
- `tests/trends.test.js`: extends the existing surface with exact legacy parity,
  cold/warm request scan and aggregation guards, cooperative convergence, atomic
  publication, retention/recovery, and finite resource ceilings.
- The documented Claude trend request-scan exception is closed in
  `CLAUDE.md`, `PRODUCT_CONTEXT.md`, and `ROADMAP.md`.

The legacy reader's direct-file scope, duplicate records, model pricing, additive
token/cache accounting, local-day boundaries, ascending day order, inclusive
rolling timestamp cutoffs, and file-mtime cutoff remain intact. Streamed directory
discovery restores the former sorted project/file order, preserving even
floating-point cost addition order. No persisted data, dependency, or UI changes.

## Bounds

Each scan allows at most 512 directories, 20,000 entries, 10,000 eligible files,
128 MiB per file, 256 MiB read per pass, 8 MiB per line, 2,000,000 events,
175,000 result/cache records, 96 MiB estimated cache occupancy, and 10 seconds.
Cooperative work uses the existing 20 ms pacer. Published daily output is bounded
to 96 rows per range, 288 rows across all ranges. Hitting a ceiling fails closed;
there is no partial result labeled ready. A missing root is authoritative empty.

Final-file symlinks and descriptor/path identity changes are rejected. Ancestor
directories remain a same-user trusted boundary, matching the existing local-log
readers; this does not claim descriptor-relative ancestor traversal.

## Verification

Focused command: `node --test tests/trends.test.js tests/stats.test.js
tests/claude-monitor-lifecycle.test.js tests/server.test.js` — **45 passed**.
The run used temporary data/Claude/Codex directories, an empty `hosts.conf`,
`LLMDASH_HOSTS=''`, `LLMDASH_CLAUDE_AUTOREFRESH=0`, and a loopback-only listener.
`node --check` passed for all three changed source modules; `git diff --check`
passed. The cumulative suite is deferred to the bundle flush.

A fresh `node --expose-gc --input-type=module` process checked the development
Mac's read-only Claude corpus through terminal convergence, with an isolated
loopback HTTP server and empty hosts/autorefresh disabled. It compared each
published daily array with `dailySeries(readUsageRecords(since), aggregate)`:

| Range | Published days | Tokens | Exact legacy parity |
| --- | ---: | ---: | --- |
| 24h | 2 | 136,432,542 | Passed |
| 7d | 8 | 1,415,883,639 | Passed |
| 30d | 27 | 4,886,746,394 | Passed |

One pass completed: 63 files, 189,277,616 bytes, 51,279 events, 13,692 records.
The complete check, including legacy reconciliation, took 1.43 seconds. Published
occupancy was 37 rows, below the 288-row ceiling. Cache occupancy was 13,692
records / 5,709,684 estimated bytes, below 175,000 / 96 MiB.

Nine live HTTP trend probes during refresh had a maximum latency of **42.86 ms**,
below the explicit 250 ms ceiling. Isolated `/api/state` readiness was **34.40 ms**
against a 1,000 ms ceiling; the cold trend request was 0.84 ms and reported warming.
After forced GC, heap was **12,023,344 bytes**. Its declared proportional ceiling
was baseline heap + 6 × cache estimate + 48 MiB = **93,239,488 bytes**
(baseline 8,649,736 bytes).

## PR description

### What this does
Moves `claude-trends-background-cache` transcript scanning and daily aggregation
to bounded cooperative poller refresh. All three ranges publish atomically;
requests read only published daily aggregates, with honest cold warming and
last-good retention after failures.

### How to test
Run the focused command above with isolated data and no peers. On the bundle's
verified tailnet HTTPS preview, choose 24h, 7d, and 30d in Trends and confirm the
existing charts/totals; a cold process shows the existing loading presentation
until its first complete publication.

### Notes for reviewer
The prototype-key range guard and warming-response cache/Codex failure-state work
remain separate builds 4 and 5. Claude activity cards and Codex ingestion retain
their existing behavior. No design lint run was needed because no UI changed.

## Seeing the change

The orchestrator supplies the bundle's verified tailnet-only HTTPS preview; local
filesystem and localhost access are unnecessary. Open that preview, scroll to
Claude Trends, and select each of the three ranges. The existing charts keep their
layout and calculations; data refreshes in the background. The orchestrator owns
preview setup and verification at the bundle handoff.

## Security remediation addendum — 2026-10-08

The reader now includes `O_NONBLOCK` alongside `O_RDONLY | O_NOFOLLOW`. If a
discovered regular `.jsonl` becomes a FIFO before open, the descriptor opens
without waiting for a writer and the existing regular-file/identity validation
rejects it before any read or cache insertion. The descriptor still closes in
`finally`; ordinary regular-file reads retain their existing behavior.

The focused regression in `tests/trends.test.js` creates a FIFO only in an
isolated temporary tree and replaces the discovered regular file immediately
before the real open. Its child process has a 2-second timeout and `SIGKILL`
fallback so the former blocking behavior cannot hang the runner. It verifies
prompt cold rejection, descriptor closure, zero cached files/records/bytes, no
publication, regular-file recovery, and unchanged last-good daily arrays/cache
occupancy after a second replacement against a warm publication.

Verification: `node --test tests/trends.test.js` — **9 passed**, including the
FIFO regression in **67.22 ms**. `node --check src/claude-trend-cache.js` and
`node --check tests/trends.test.js` passed. This errand used local temporary
fixtures only; the cumulative suite remains reserved for the bundle flush.
