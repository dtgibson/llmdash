# Implementation — dev-rate-card-hardlink

Repaired only this development Mac's `config/api-rates.json` at
2026-10-09T02:42:01.533Z. It is now an independent regular file with identical
bytes. No application code, tests, prices, or reader protections changed.

| Evidence | Before | After |
| --- | --- | --- |
| Inode | 249837371 | 328699170 |
| Hard links | 2 | 1 |
| Bytes | 8,974 | 8,974 |
| Mode | 0644 | 0644 |
| Owner UID / group GID | 502 / 20 | 502 / 20 |

Both descriptor-validated reads produced SHA-256
`04717bf2e8974693977b01c55e58c77098ad07edb7e25dd5c5d096521e24ebea`.

The one-time repair opened the source read-only with `O_NOFOLLOW`, bounded the
read, checked regular-file type, safe mode/ownership, parent identities, and
descriptor/path identity and version. It created an exclusive same-directory
temporary file, wrote the verified bytes, preserved mode and owner/group,
fsynced and read-verified the temporary file, revalidated identities, then
atomically renamed it over this checkout's directory entry. The original inode
was never written; its retained read-only descriptor confirmed one remaining
link and unchanged bytes/mode/ownership after replacement. The other path was
not located or accessed.

## Validation and review

- `readRateCard()` returned `valid`, 16 accepted rates, and zero diagnostics.
- `node --test tests/rate-card.test.js tests/reset-billing-api.test.js`: 19/19
  passed, including the fixed-resource API and tracked rate-card checks.
- `node --test --test-name-pattern='^secure reader rejects symlink parents/finals, non-files, hard links, and writable targets$' tests/secure-config-file.test.js`:
  the existing rejection test passed (1/1).
- Both unstaged and staged `git diff --exit-code -- config/api-rates.json`
  checks passed. The tracked working-tree content diff was empty.

To verify this repair on the development Mac, rerun the two focused test files
together with the command above; success is 19 passes and zero failures. The
hard-link rejection command separately verifies the existing safety check.
No browser preview or user walkthrough is needed for this filesystem repair.

This is local filesystem state, not a product patch. No commit, deployment,
production checkout, remote peer, physical device, broad suite, or usage-corpus
work was performed. The cause of the original hard link remains uninvestigated,
as approved in the brief. No new conventions were established.
