# Spool release candidate

Status: user explicitly approved Ship (option1). Deployment pending.
Branch: `weft-spool/20261009-022224`. Application bundle checkpoint: `6ff6db8`.

| Build | Lane | Idea | Checkpoint |
|---|---|---|---|
| bound-expiry-horizon | maintain | e177e2c3-8b72-4972-985c-1a1896d3669f | 60bcd4b |
| dev-rate-card-hardlink | fix | 04cdfb34-d7bc-4316-aaa4-9746f06e94e0 | 6d4d37b |
| claude-trends-background-cache | maintain | f3bb102c-f385-411c-9573-0ca6d62523da | 2d40b25 |
| trends-range-guard | fix | 2ddf2d5b-b0f6-4bda-a538-1351b86ef144 | 7ff4088 |
| trends-warming-scan-state | maintain | cbc966f5-ad6a-461d-9659-2304f294f2af | 6ff6db8 |

Each build has its own approved brief, implementation, independent QA and security records under `pipeline/<build>/`. All park at deploy stage5; Chronicle stage6; no design pass. The Claude reader FIFO finding was fixed and independently verified by Engineer → Tester → Auditor; no unresolved security findings remain.

## Complete-bundle verification

`npm test`: 940 tests, 938 passed, zero failed/cancelled, two skipped,37.28seconds. The skips cover installer failure simulation when no Node executable can resolve; this Mac has a system-wide Node executable. Baseline check: new=0,known=0,resolved=0. This closes the cumulative Tier2 QA floor for the full bundle.

An initial complete-suite run imposed LLMDASH_PORT=0 and failed two menu-bar default8787 assertions. Removing that harness override made the full suite pass; no application or test source changed between runs. Both logs and exact runtime metadata are retained in ignored `data/` via `data/weft-spool-release.json`.

The development rate card remains byte-identical, one link, mode0644,uid502; SHA256 `04717bf2e8974693977b01c55e58c77098ad07edb7e25dd5c5d096521e24ebea`.

## Preview evidence

https://hephaestus-developer.giraffe-chuckwalla.ts.net:8982/

Owned isolated process91538; loopback8982 behind Tailscale Serve HTTPS, no public Funnel, one local host, no peer polling or live provider probes. Eleven page/API checks passed; both Claude and Codex trend states ready; prototype names normalize to7d; trend latency at most47.09ms. Final HTTPS/root/trends/hosts checks also passed after the suite. Actual client renderer content and retry behavior were checked in VM DOM fixtures; browser layout/interaction/screenshots were not verified. No layout/style change was made.

## Decision and finish

Final gate `spool-bundle-release-20261009-022224`, stage5, feature `trends-warming-scan-state`, maintain. Ship means all five builds as one production release; Hold preserves the bundle for later. No deploy before explicit Ship.

On Ship clear the final gate, checkpoint the pending release bookkeeping through `weft-spool checkpoint spool-release-signoff`, then `weft-spool land`. The extra checkpoint contains tracked state/handoff/release evidence only; `weft-spool status` counts commits, while this manifest has five actual builds. This avoids the deterministic dirty-tree refusal caused by tracked pause/gate records. Invoke Deployer once from base, with the explicit bundle approval; full pre-deploy reconciliation and local-Mac verification. Never access physical devices or live peers. After verified deployment, close all five runs/ideas in manifest order with deterministic state and MCP telemetry, one consolidated Chronicler pass, then branded close in the same turn. No additional routine approval.

On Hold use standard pause/digest/telemetry and save bookkeeping on this branch; keep ideas building until shipment. Resume with `$weft` here. Runtime manifest and this tracked table preserve all idea IDs and boundaries.
