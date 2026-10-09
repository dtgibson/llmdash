# Spool deployment — five-build release

**Result:** Verified live on this development Mac, with the configured remote peer blocked by persistent runtime containment. No physical device or live peer was accessed.

Production HTTPS: https://hephaestus-developer.giraffe-chuckwalla.ts.net:8983/
Existing production HTTP: http://hephaestus-developer.giraffe-chuckwalla.ts.net:8787/
Verified: `2026-10-09T04:46:51.893524+00:00`. Tailnet-only Tailscale Serve HTTPS; no public Funnel. Requests were pinned to this Mac's own Tailscale address `100.70.220.2`, with certificate verification enabled. Existing preview HTTPS8982 was preserved.

## HTTP bookmark compatibility correction

The initial deployment put Tailscale Serve HTTPS on the existing HTTP port8787,
causing HTTP bookmarks to return400. The HTTPS proxy now uses separate port8983;
the8787Serve entry was removed so the application's original HTTP listener is
reachable again. Hostname and own-Mac Tailscale-IP HTTP roots return200, the new
HTTPS root returns200, and constructor-range API checks return200/canonical7d
over both protocols. Every other Serve route, including preview8982, is unchanged.
There was no application or service restart; peer containment remains active.
Correction evidence is in ignored `data/weft-http-compat-latest.json` and its
referenced directory. The original deployment evidence below records the earlier
HTTPS verification; the URLs above describe the current routing.

## Release and authorization

The user explicitly selected Ship (`1`) for all five builds on `2026-10-09T04:26:06.541969+00:00`. No additional sign-off was requested. Target: `/Users/developer/llmdash`, main, `com.llmdash.dashboard`, local port8787; manual-local deployment, no staging or configured CI workflows. GitHub run lookup returned no runs.

| Boundary | SHA |
|---|---|
| Previous production / rollback source | `1fccae6da77404be1c4af8ab6699c3f54bb20c44` |
| Complete tested application checkpoint | `6ff6db8` |
| Pushed and deployed release source | `5433f976ca126e1a767f2279e11b6c8f78c5332c` |

First-step reconciliation fetched origin/main `07b5b6992107d3df53422352914137e0e27534fb`; no remote movement or conflict. Main was clean and ahead by seven commits: five approved builds, release sign-off bookkeeping and the deterministic Spool merge. Only release documentation differed from the tested application checkpoint. Push succeeded without force; production was clean and fast-forwarded from its previous SHA. Later closeout-only heads are separate from this deployed application/source boundary.

The complete bundle already passed 940 tests:938passed,0failed,2expected installer simulation skips; baseline new=0/known=0/resolved=0. No application source changed afterward, and the suite was not repeated. Each build's independent QA and security record was reviewed. The earlier Claude FIFO-open finding is resolved by its security/QA addenda.

## Safe reload and runtime containment

Production's readable `data/hosts.conf` contains one remote entry on port8787. The saved file always overrides `LLMDASH_HOSTS`, including a nonempty localhost override; there is no supported peer-off environment setting. A normal restart would initiate remote polling.

The exact tested macOS profile is active at `/Users/developer/llmdash/data/weft-runtime/spool-peer-containment.sb`:

```scheme
(version 1)
(allow default)
(deny network-outbound (remote ip "*:8787"))
(allow network-outbound (remote ip "localhost:*"))
```

Profile SHA256: `6e002a9b5c86af3e5eb23f79fed89ef98d84301b7b595b091cdf319538db0d80`. A local-only feasibility check demonstrated the8787deny with EPERM, the localhost exception with a successful connection, and public GitHub HTTPS200. CIDR filters were rejected by this Mac's sandbox implementation. The narrower port rule preserves provider HTTPS permissions and inbound serving. `pollPeers` passes the saved port directly to a single `/api/state` request; redirects are rejected and no alternate-port retry occurs. No denied peer was contacted to test the rule.

Exact original LaunchAgent bytes were backed up to `/Users/developer/devwork/llmdash/data/weft-spool-deploy-20261009-044224/original-launchagent.plist` and `/Users/developer/llmdash/data/weft-runtime/original-launchagent-before-spool.plist`. Original SHA256 `0796412c336485e5b6f8c244a8e98b6f0a891bf38c5982778a98002f03a3f9a7`. All plist fields were preserved except the command now starts with `sandbox-exec -f <profile>` before the original Node arguments. Confined plist SHA256 `8ade7e37f175921ff7db8f30937cf8eb16792bfa48e49b87df6fb3a7d1e7dc52`. The contained plist stays on disk, so KeepAlive and future automatic loads retain containment; the backup is available for a deliberate user-operated restoration. The standard installer would replace this command, so agents must recheck and preserve containment before any future reload.

The previous service was stopped and observed absent before source update. After fast-forward, saved host hash/count/port were rechecked immediately before bootstrap. The installer's shared bounded loader and HTTP readiness functions performed the confined reload. No updated process launched uncontained. Final service state `running`, PID `21237`, and loaded LaunchAgent arguments confirmed the profile.

A preparatory Bash process-substitution read failed before bootout/source update with missing `service_uid` (exit127). The prior PID/source remained running. It was diagnosed and corrected by directly sourcing an exact, ignored copy of installer function definitions before command dispatch; those functions were confirmed before retry. The corrected deploy completed with exit0. No application/source fix or production rollback was needed.

**Limitation:** The configured remote peer remains unavailable under containment. No multi-host/live-device check was performed. Provider HTTPS is allowed; no separate provider probe was initiated for verification. Future user-added peers on other ports are outside this8787rule and must not be agent-tested. This is a reversible local runtime restriction, not a source or host-list change.

## Health and acceptance evidence

Eleven loopback page/API checks all returned200: root, actual app.js, state, hosts,30dinsights, all three canonical trend ranges, constructor/__proto__ range fallbacks and the rate-card settings resource. Trend requests took at most66.53ms during cold scanning. The app script contains the deployed scan-error renderer. The first observation honestly showed Codex warming; final HTTPS observation showed Claude and Codex ready. Root/trends/hosts also passed three own-Mac HTTPS checks; maximum HTTPS root time154.78ms. The local combined view had a reachable local host and no reachable remote host; verification read cache-only routes and never invoked a peer poll directly. Authentication/error monitoring changes are not part of this build; no monitoring integration is configured.

| Approved build | Local deployment acceptance evidence |
|---|---|
| bound-expiry-horizon | Deployed helper smoke accepts inclusive ten-year ceiling, rejects+1ms/year9999 and yields honest standing absence. Independent QA/full bundle proves count preservation and local/peer normalization with synthetic fixtures; no provider data was altered. |
| dev-rate-card-hardlink | Development and production cards remain byte-identical, one link,0644,uid502. Deployed reader is valid with16rates; fixed-resource read is200. This build repaired only development file identity; production was preserved. |
| claude-trends-background-cache | Deployed all-range Claude responses are ready and cached request handlers stay responsive during background cold scan. Bounded/atomic refresh, last-good and FIFO race behavior retain approved isolated QA/security coverage; no production failure injection. |
| trends-range-guard | Deployed loopback constructor and __proto__ both return200 with canonical7d; HTTPS constructor likewise200/7d. Remaining prototype/unknown/duplicate query matrix is covered by approved local QA. |
| trends-warming-scan-state | Deployed Codex moves from warming to ready, all trend endpoints respond promptly, and actual scan-error client code is served. Exact2-second warming TTL, immediate invalidation, retained-time failure/recovery and retry behavior are covered by the approved isolated QA/VM phases and passing full bundle. No production log corruption or browser/layout claim. |

User runtime configuration was preserved byte-for-byte: hosts.conf, account-config.json and subscriptions.json retained their prior existence and SHA256. Existing database/history was retained; this bundle has no migration. Both rate-card SHA256 values remain `04717bf2e8974693977b01c55e58c77098ad07edb7e25dd5c5d096521e24ebea`. Runtime snapshot writes continue through the normal poller; no host-list, credential or secret was rewritten for testing.

## Evidence and rollback

Machine-readable deployment/health evidence: `/Users/developer/devwork/llmdash/data/weft-spool-deploy-20261009-044224/record.json`. Deploy output and runner/function copy are in the same ignored directory. Approved bundle verification/approval and five-run closure metadata are preserved in the durable [release manifest](spool-release-manifest.json), copied from `data/weft-spool-release.json` without modifying that runtime registry.

If rollback becomes necessary, switch production source to `1fccae6da77404be1c4af8ab6699c3f54bb20c44` and reload with this same contained plist and the shared bounded loader/readiness functions. Preserve runtime data and the saved host/config files. Never invoke the ordinary uncontained `--service install` during an agent rollback. No rollback was performed.

The Deployer made no session or idea transition. After verified deployment, the Guide closed all five runs and marked all five ideas built; closure was verified at `2026-10-09T04:51:00.507665+00:00`. Consolidated documentation is complete. Later record-only checkout updates require no production restart and do not change the deployed application/source boundary `5433f976`.
