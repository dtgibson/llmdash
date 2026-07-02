# Seeing the menu-bar badge locally

The badge puts your most-constrained remaining-usage % in the macOS menu bar,
updating on its own. It needs one thing you install yourself: **SwiftBar**, a
free menu-bar app. (llmdash never installs it for you — that stays your choice.)

You can also preview the badge's output in a terminal *without* SwiftBar (step 5),
which is handy to see the different states quickly.

---

## Part 1 — Preview it in a terminal (no SwiftBar needed)

1. **Make sure the dashboard is running.** In a terminal, in your project folder:
   ```
   npm start
   ```
   Leave it running. (If it's already running as a service, skip this.)

2. **Open a second terminal** in the project folder and run the badge plugin:
   ```
   node scripts/menubar/llmdash.5s.js
   ```

3. **Read the output.** The first line is what would appear in your menu bar,
   for example:
   ```
   ▪ C 45% | color=#f0a94b
   ```
   - `▪` is the llmdash mark.
   - `C` means **Claude Code** is the tightest tool right now (`X` would mean
     Codex — think code**X**).
   - `45%` is the lowest remaining % across both tools' windows.

   Everything after the `---` is the dropdown you'd see when you click the badge:
   both tools, both windows, reset countdowns, and the *Open dashboard* / *Refresh*
   actions.

4. **See the "offline" state.** Stop the dashboard (Ctrl-C in the first terminal),
   then run the plugin again. Now it shows — never a fake number:
   ```
   ▪ llmdash ⚠ | color=#8b8b8b
   ```
   Restart the dashboard (`npm start`) when you're done.

---

## Part 2 — See it live in your menu bar (needs SwiftBar)

5. **Install SwiftBar** (one time, your choice — llmdash never does this for you):
   ```
   brew install --cask swiftbar
   ```
   Open SwiftBar once. It asks you to pick a **plugin folder** — pick one (the
   common default is `~/Library/Application Support/SwiftBar/Plugins`).

6. **Install the plugin.** One command writes a tiny **wrapper** into SwiftBar's
   folder that runs the plugin with the correct absolute `node` path (the menu bar
   spawns it with a stripped-down PATH where a plain `node` won't be found):
   ```
   ~/llmdash/scripts/install-macos.sh --setup-badge
   ```
   It prints exactly what it did and anything left for you to do. (If you cloned
   somewhere other than `~/llmdash`, use that path.) The wrapper points at the
   plugin in your checkout, so **your checkout is never modified** — re-running the
   installer or `git pull` stays clean and the badge updates itself when you pull.

7. **Look at your menu bar.** Within about 5 seconds a small `▪ C 45%`-style badge
   appears near the clock. Click it to open the dropdown; click **Open dashboard**
   to jump to the full view.

8. **Point it at a different machine (optional).** If your dashboard runs on
   another computer over Tailscale, edit the two lines at the top of
   `~/llmdash/scripts/menubar/llmdash.5s.js`:
   ```js
   const HOST = process.env.LLMDASH_BADGE_HOST || '127.0.0.1';  // e.g. '100.101.102.103'
   const PORT = process.env.LLMDASH_PORT || '8787';
   ```
   Both the badge's reading and its *Open dashboard* link follow whatever you set.

---

## Removing the badge (symmetric with install)

One command each way. To take the badge out of your menu bar:
```
~/llmdash/scripts/install-macos.sh --remove-badge
```
It removes only llmdash's own wrapper from SwiftBar's folder (it recognizes it by
a marker line) — it never deletes the copy in your llmdash checkout, and it never
removes a file you put there yourself. It's safe to run even if the badge isn't
installed (it just says "nothing to remove").

That removes the badge, **not SwiftBar**. If you want the menu-bar app gone too,
that's your call — llmdash never uninstalls it for you:
```
brew uninstall --cask swiftbar
```

---

## What the glyph is telling you

| You see | It means |
|---|---|
| `▪ C 46%` (plain, colored) | **Fresh.** A confident number; Claude is tightest at 46%. |
| `▪ C 78%·` (dimmed, trailing dot) | **Aging.** The reading is getting old, but you still see how much. |
| `▪ C 78% ⚠` (amber) | **Stale.** Old enough that the number may have moved — flagged, not hidden. |
| `▪ —` (a dash) | **No reading yet.** Never a fake number; the dropdown says why per tool. |
| `▪ llmdash ⚠` | **Offline.** The dashboard isn't reachable — unmistakably "no server," never headroom. |

Green / amber / red on the number is the same "how much is left" scale the
dashboard uses (green ≥ 50%, amber 20–49%, red < 20%).

> The **live in-menu-bar view is the one part that needs SwiftBar** (Part 2).
> Everything else — including seeing every state — you can do from the terminal
> in Part 1.
