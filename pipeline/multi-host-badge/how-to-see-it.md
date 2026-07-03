# Seeing multi-host-badge locally

This walks you through the new menu-bar badge behavior on your own Mac. You need
SwiftBar (a free menu-bar app) already installed and the llmdash badge set up — if
you've used the badge before, you're ready.

## First: the single-machine case costs you nothing

1. Open a terminal in your project folder.

2. Start the dashboard if it isn't already running:
   ```
   npm start
   ```

3. Look at the llmdash badge in your menu bar. With no other machines configured, it
   looks **exactly as it always has** — `▪ C 46%` (or whichever tool/number is
   tightest). No host names, no new chrome. Nothing changed for a single machine.

You can also preview the badge output without SwiftBar, straight in the terminal:
```
node scripts/menubar/llmdash.5s.js
```
The first line is the glyph; everything after `---` is the dropdown.

## Add a machine to watch — from the badge

4. Click the badge to open its dropdown. Near the bottom you'll see three new
   actions: **＋ Add host…**, **－ Remove host…**, and **☰ Watching: N hosts**.

5. Click **＋ Add host…**. A small macOS dialog appears asking for a machine.
   Type another tailnet machine that runs llmdash — a hostname or IP, optionally
   with a port and a label, e.g.:
   ```
   100.64.0.7:8788=Desktop
   ```
   Click **Add**. If it's valid, you'll see "Added … — it'll appear on the next
   update." (A malformed or duplicate entry is rejected with an honest message and
   nothing is written.)

6. Wait for the next poll (up to your poll interval — a minute by default), then
   click the badge again. You should now see:
   - The glyph names **which machine is tightest**: `▪ Desktop·C 12%` means
     Desktop's Claude 5-hour window is the most constrained across every machine you
     watch. (A long machine name is shortened to 10 characters in the glyph; the
     full name is always in the dropdown.)
   - The dropdown has **one section per machine**, the tightest machine first, each
     with its own Claude/Codex rows and its own freshness state.

## What an unreachable machine looks like

7. Add a machine that's asleep or not running llmdash (or stop llmdash on one you
   already added). On the next update, that machine appears in the dropdown with a
   **named** line — e.g. "Studio VM is unreachable — no response within 3s. Check
   the machine is awake and llmdash is running on …" — never a fake `0%`, never a
   stale number shown as fresh. The other machines are unaffected.

## Remove a machine

8. Click **－ Remove host…**. A submenu lists the machines you watch (never *This
   machine* — the local host is always included). Pick one, confirm, and it's
   dropped from the list. On the next update it's gone from the badge.

## The monitoring-station case

9. If you run the badge on a Mac that does **no** Claude or Codex work of its own —
   it only watches your other machines — that machine's empty local reading is
   automatically **de-emphasized**: kept out of the glyph and the headline (so the
   machines you're actually watching stay loudest), but still shown at the bottom of
   the dropdown, honestly labeled "no local activity." No zeros are invented.

   To control this by hand, edit the config file (next section) and add a directive
   line: `!local=exclude` (always de-emphasize this machine), `!local=include`
   (always show it in the glyph), or `!local=auto` (the default, auto-detect).

## Where the watched-host list lives

10. The list is a plain text file you can also hand-edit:
    ```
    ~/llmdash/data/hosts.conf
    ```
    (or `$LLMDASH_DATA_DIR/hosts.conf` if you set a custom data dir). One
    `host[:port][=label]` per line, `#` for comments. Once this file exists it's the
    source of truth; the badge's Add/Remove actions edit it for you. Every edit is a
    **local file write** — never an HTTP request — and applies on the next poll.

## If you set LLMDASH_HOSTS before

11. If you previously set the `LLMDASH_HOSTS` environment variable, it now **seeds**
    `hosts.conf` once on first run and then steps aside — the file is authoritative
    after that (the startup log says so). Editing `LLMDASH_HOSTS` afterward does
    nothing; edit the file (via the badge or by hand) instead. With neither the file
    nor `LLMDASH_HOSTS` set, you get today's single-host badge, exactly.
