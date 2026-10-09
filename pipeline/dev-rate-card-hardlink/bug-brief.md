# Bug Brief — dev-rate-card-hardlink

## What is broken
The development checkout's `config/api-rates.json` has inode 249837371 and two hard links; the secure reader correctly rejects it with `SECURE_TARGET_INVALID`.
The tracked rate-card test returns `invalid` instead of `valid`; the fixed-resource API test receives HTTP 409 `resource_unavailable` for `rate-card` instead of 200.
The 8,974 bytes parse as a valid rate card with 16 accepted rates and no diagnostics; SHA-256 is `04717bf2e8974693977b01c55e58c77098ad07edb7e25dd5c5d096521e24ebea`.

## Steps to reproduce
1. In `/Users/developer/devwork/llmdash`, run `stat -f 'inode=%i links=%l bytes=%z' config/api-rates.json`; observe `links=2`.
2. Run `node --test tests/rate-card.test.js tests/reset-billing-api.test.js`; observe 17 passes and the two failures above out of 19 tests.
3. Run both files together: filtering only the API test skips earlier account-config setup and produces an unrelated 404.

## Expected behavior
The development file is an independent regular file with one link, identical bytes and valid pricing; the two focused files pass all 19 tests.
The secure reader continues rejecting hard links, symlinks, unsafe ownership/modes, and identity changes.

## Blast radius
Repair only this development Mac's checkout path using a fresh same-directory file and atomic replacement; do not write through the shared inode.
Preserve bytes, safe permissions, ownership, and all reader protections; introduce no product behavior or pricing changes.
No production checkout, remote peer, other device, baseline repair, broad suite, usage corpus, or browser work is in scope.
The other hard-link path and the cause of its creation remain uninvestigated; locating them is unnecessary for this repair.

## What done looks like
The path has a new inode, one link, and the recorded SHA-256; `readRateCard()` is valid and the two focused files pass 19/19.
The secure reader's existing hard-link rejection remains intact, and `config/api-rates.json` has no content diff.
