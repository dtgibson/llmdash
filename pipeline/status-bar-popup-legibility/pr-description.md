## Status Bar Popup Legibility

### What this does
This improves the SwiftBar/xbar menu-bar badge dropdown without changing the badge glyph, data contracts, or display preferences. Long diagnostic and unavailable-server messages now wrap into bounded menu rows instead of forcing the pop-up to become very wide, and primary dropdown labels use larger default menu text instead of low-contrast gray.

### How to test
1. Run `node --test tests/menubar.test.js`.
2. Run `node --test tests/menubar-degradation.test.js`.
3. Run `node --test tests/menubar-multihost.test.js`.
4. Run `node --test tests/menubar-display.test.js`.
5. Run `npm test`.
6. Preview the offline badge output with a long host value and confirm the unavailable-server message is split across bounded rows while the Open dashboard action remains inert and valid.

### Notes for reviewer
The new `wrapMenuText` helper only formats non-action dropdown text. Action rows, shell params, `href=` rows, glyph computation, `/api/state`, and `/api/hosts` are unchanged. The tests intentionally moved away from pinning tiny gray headers as byte-for-byte output because that exact styling was the legibility bug.
