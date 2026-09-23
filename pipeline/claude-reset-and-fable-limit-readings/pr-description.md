## Claude Reset and Fable Limit Readings

### What this does
Newer Claude account percentages retain each earlier provider reset while that reset is still in the future, with the original reset observation shown separately from the percentage capture. During active Claude use, the `/usage` probe checks model caps every 15 minutes even if account captures remain fresh or no cap remains; it also accepts the dropped weekly-title glyph observed in the current pane. A fresh Fable percentage can keep an earlier future reset if its new reset text is unreadable.
The SwiftBar dropdown shows Claude account and Fable percentage capture ages and, when applicable, the separate age of an earlier provider reset.

### How to test
1. Run `npm test`.
2. Feed a newer statusline reading with null reset fields after a reading with future 5-hour and weekly resets. Confirm both future resets remain, the percentages update, and the earlier reset observation appears in the dashboard and menu output.
3. Move either retained reset past the current time. Confirm that window shows an unavailable reset while the other window stays intact.
4. With Claude activity, a fresh account reading, and a 52-minute-old Fable cap, confirm the probe refreshes Fable. Confirm the same gate checks again after 15 minutes when no active cap remains and does no work while idle.
5. Compare `/api/state`, `/api/hosts`, the dashboard, and the menu output after a fresh `/usage` capture. The Fable and account percentages, reset countdowns, and separate capture ages should agree.

### Notes for reviewer
The verified development preview is tailnet-only at `https://hephaestus-developer.giraffe-chuckwalla.ts.net:8920/`. It uses a separate data directory and a copy of the current Claude reading. A live `/usage` probe on 2026-09-23 succeeded after the parser fix: account use was 4% / 38%, and Fable use was 40%. The current Fable reset text had an unreadable time zone, so the existing future provider reset was retained and labeled with its earlier observation. Codex handling and the owner-configured weekly fallback are unchanged.
