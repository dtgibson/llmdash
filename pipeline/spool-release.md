# Spool release — shipped

Status: all five builds shipped, all five runs closed, and consolidated documentation complete. The user explicitly approved Ship (`1`); deployment was verified at `5433f976ca126e1a767f2279e11b6c8f78c5332c`.
Build branch: `weft-spool/20261009-022224`, landed on main. Application bundle checkpoint: `6ff6db8`.
Production: https://hephaestus-developer.giraffe-chuckwalla.ts.net:8787/
Durable records: [deployment and rollback](spool-deployment.md), [release manifest](spool-release-manifest.json).

| Build | Lane | Idea | Checkpoint |
|---|---|---|---|
| bound-expiry-horizon | maintain | e177e2c3-8b72-4972-985c-1a1896d3669f | 60bcd4b |
| dev-rate-card-hardlink | fix | 04cdfb34-d7bc-4316-aaa4-9746f06e94e0 | 6d4d37b |
| claude-trends-background-cache | maintain | f3bb102c-f385-411c-9573-0ca6d62523da | 2d40b25 |
| trends-range-guard | fix | 2ddf2d5b-b0f6-4bda-a538-1351b86ef144 | 7ff4088 |
| trends-warming-scan-state | maintain | cbc966f5-ad6a-461d-9659-2304f294f2af | 6ff6db8 |

Each build has its own approved brief and implementation under `pipeline/<build>/`; independent QA and security run records remain on disk and are ignored by git. All five completed deploy stage 5 and closeout stage 6 with no design pass. The Claude reader FIFO finding was fixed and independently verified by Engineer → Tester → Auditor; no unresolved security findings from this release remain. The separate expiry-field and observation-clock/null-clear decisions remain open.

## Complete-bundle verification

`npm test`: 940 tests, 938 passed, zero failed/cancelled, two skipped,37.28seconds. The skips cover installer failure simulation when no Node executable can resolve; this Mac has a system-wide Node executable. Baseline check: new=0,known=0,resolved=0. This closes the cumulative Tier2 QA floor for the full bundle.

An initial complete-suite run imposed LLMDASH_PORT=0 and failed two menu-bar default8787 assertions. Removing that harness override made the full suite pass; no application or test source changed between runs. Both logs and exact runtime metadata are retained in ignored `data/` via `data/weft-spool-release.json`; the durable manifest preserves the release metadata.

The development rate card remains byte-identical, one link, mode0644,uid502; SHA256 `04717bf2e8974693977b01c55e58c77098ad07edb7e25dd5c5d096521e24ebea`.

## Preview evidence

https://hephaestus-developer.giraffe-chuckwalla.ts.net:8982/

Owned isolated process91538; loopback8982 behind Tailscale Serve HTTPS, no public Funnel, one local host, no peer polling or live provider probes. Eleven page/API checks passed; both Claude and Codex trend states ready; prototype names normalize to7d; trend latency at most47.09ms. Final HTTPS/root/trends/hosts checks also passed after the suite. Actual client renderer content and retry behavior were checked in VM DOM fixtures; browser layout/interaction/screenshots were not verified. No layout/style change was made.

## Shipment and closeout

The user selected Ship (`1`) for final gate `spool-bundle-release-20261009-022224` at `2026-10-09T04:26:06.541969+00:00`. All five builds landed and deployed together. The release sign-off bookkeeping checkpoint and deterministic merge are additional commits, not additional builds.

Deployment passed eleven loopback and three own-Mac HTTPS checks at `2026-10-09T04:46:51.893524+00:00`; both tools' final HTTPS trend states were ready. The contained local LaunchAgent preserves the saved host/account/subscription configuration byte-for-byte and blocks outbound peer port 8787. Provider HTTPS remains allowed. No physical-device, live-peer, multi-host, or browser-layout verification is claimed.

All five runs were closed in manifest order and all five ideas marked built, verified at `2026-10-09T04:51:00.507665+00:00`; session state is closed. One consolidated documentation pass updated current context, meaningful decisions, the remaining roadmap work, and the final handoff. The closeout is record-only; the deployed application/source boundary remains `5433f976` and its tested application checkpoint remains `6ff6db8`.

All five builds are shipped and closed; documentation is complete.
