# Deployment Record — Usage Coverage Gaps

## Outcome

- **Status:** Production deployment succeeded
- **Completed at:** 2026-08-27T22:09:02Z
- **Target:** Local macOS LaunchAgent `com.llmdash.dashboard`
- **Production checkout:** `/Users/developer/llmdash`
- **Production URL:** <http://localhost:8787>
- **Release commit:** `73614ec2d0242030396e71db5f3ccd95d38e8f34`
- **Previous good commit:** `cb110beb138c291570c403a34cdefff7834c2120`
- **Staging:** None; this project deploys directly to the local production checkout after explicit confirmation

## Deployment

The user explicitly confirmed the production deployment. The verified local `main` commit was pushed to `origin/main`, the production checkout fast-forwarded cleanly, and the LaunchAgent was regenerated and reloaded with absolute runtime paths.

```sh
git -C /Users/developer/devwork/llmdash push origin main
git -C /Users/developer/llmdash pull --ff-only origin main
/Users/developer/llmdash/scripts/install-macos.sh --service install /Users/developer/llmdash
```

Outcomes:

- Push advanced `origin/main` from `cb110be` to `73614ec`.
- Production advanced by fast-forward from `cb110be` to `73614ec` with no conflicts or local changes.
- The installer regenerated `/Users/developer/Library/LaunchAgents/com.llmdash.dashboard.plist`, loaded `com.llmdash.dashboard`, and reported `running`.
- The first immediate HTTP probe landed during the restart socket window. A bounded readiness probe then succeeded, and the complete health suite passed.

## Production Health

After readiness, every prepared check passed:

| Check | Result |
|---|---|
| LaunchAgent service status | `running` |
| `GET /` | HTTP 200 |
| `GET /api/state` | HTTP 200 |
| `GET /api/hosts` | HTTP 200 |
| `GET /api/codex-insights?range=30d` | HTTP 200 |
| `GET /api/cost-analysis?range=30d` | HTTP 200 |
| Live checkout commit | `73614ec2d0242030396e71db5f3ccd95d38e8f34` |

The deployed code had already passed the complete local release suite: 813 tests, 811 passed, 0 failed, and 2 environment-dependent skips.

## Live Coverage Evidence

At `2026-08-27T22:08:46.458Z`, Claude account evidence was fresh (`capturedAt` `2026-08-27T22:08:43.778Z`) with no limits diagnostic. The provider currently supplied no model-cap rows (`modelLimits: []`), so Fable was honestly absent; the deployment does not invent a cap or reset when provider evidence is unavailable.

At `2026-08-27T22:08:14.501Z`, the production 30-day cost view had published a healthy bounded first pass:

- refresh status `fresh`
- coverage status `partial`, with `denominatorKnown: false`
- 101,789 recognized records and 101,777 comparable records
- 22,172,546,446 recognized tokens and 22,171,850,024 comparable tokens
- reasons `rate_missing` and `scan_budget_total_bytes`
- no `file_too_large` or `record_unsupported` reason

This is the intended cold-start posture: publish bounded partial evidence immediately, then converge through later poller passes. The initial precise omission was 12 `gpt-5.6` records / 696,422 tokens before the reviewed price interval.

## Rollback

Rollback was not required. If a production regression appears, restore the previous good checkout and reload the service:

```sh
git -C /Users/developer/llmdash switch --detach cb110beb138c291570c403a34cdefff7834c2120
/Users/developer/llmdash/scripts/install-macos.sh --service install /Users/developer/llmdash
```

Then repeat the service, homepage, state, hosts, Codex-insights, and cost-analysis health checks above.

## Known Non-Blocking Limits

- `snowravendev-vm` remains operationally unreachable from this machine and is separate from local usage completeness.
- Exact pricing remains partial outside reviewed effective intervals and when older records contain no model context; no neighboring rate is guessed.
- Provider-omitted Fable/model-cap evidence remains unavailable until a real provider row is captured. Reset-less evidence is retained for seven days once observed.
- A cold cost-analysis cache may require several bounded poller passes to establish a known denominator on the current multi-gigabyte corpus.
