# Decisions — Reset and Billing Configuration

## 2026-07-23 — Every billing-bearing file gets a fixed read/download link

The architecture introduced `account-config.json` as the active home for
recurring plans, while `subscriptions.json` remains the legacy fixed-period
input. The PRD originally named only the legacy file and rate card. The active
account configuration is now included in the same fixed-resource read/download
allowlist so the user's request to reach every billing file over Tailscale stays
true without adding arbitrary path access.

## 2026-07-23 — The history count must fit the protected file cap

Implementation review found that 512 full recurring-plan records cannot fit the
approved 32 KiB `account-config.json` boundary. The record ceiling is 120, which
keeps even maximum-width canonical records beneath the byte cap while retaining
roughly ten years of monthly changes. The 32 KiB safety boundary remains
unchanged and every rejected append leaves the prior file untouched.

## 2026-07-23 — A post-rename sync fault is reconciled, not misreported

Once an atomic rename has happened, reporting a normal failed save would be
dishonest because the target may already contain the new version. The writer now
verifies the descriptor-backed target and treats a matching candidate as the
current committed value while emitting a bounded durability warning. A different
later version becomes a conflict and is loaded instead; an unverifiable result is
reported explicitly as indeterminate. Pre-rename failures still leave the prior
file byte-for-byte unchanged.

## 2026-07-23 — Sensitive configuration authorities are socket-bound

Origin/Host equality, Fetch Metadata, CSRF, and ETags do not stop DNS rebinding
because an attacker-controlled origin can obtain all four after its name resolves
to this service. Configuration GET and PUT now reject authorities that do not
match the receiving local IP/port, this machine's host names, loopback, or a
MagicDNS name arriving on a Tailscale address. The check performs no DNS lookup
and runs before returning configuration, resource bytes, ETag, or CSRF material.

## 2026-07-23 — Runtime writes have one supported ownership path

In-app PUTs and poll refreshes share the single Node process and are protected by
version, content, and target-identity checks. Portable Node provides no atomic
compare-and-swap replacement for an unrelated editor racing inside the final
rename call, so simultaneous manual edits while the service runs are not a
supported writer path. Manual recovery remains explicit and service-stopped; this
keeps the user path safe without advertising an impossible cross-process promise.

## 2026-07-23 — Pre-existing uninstall hardening stays a separate follow-up

The security review of the billing-file preservation change exposed three older
weaknesses in the complete-uninstall path: service shutdown is not positively
verified before destructive work, the SQLite rollback-journal sidecar is not in
the preservation set, and the detached teardown does not deliver its outcome or
recovery locations to the operator. None was introduced by reset or recurring
billing configuration. The owner chose to keep this feature scoped to its two
direct request/error-handling findings and capture those uninstall issues as the
next project run rather than expand this release unexpectedly. The narrow change
that preserves `account-config.json` and `subscriptions.json` remains because
otherwise the existing keep-data choice could silently discard the new billing
history.
