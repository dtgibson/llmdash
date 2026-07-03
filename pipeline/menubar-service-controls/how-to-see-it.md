# Seeing menubar-service-controls locally

This feature lives entirely in the **macOS menu-bar badge dropdown**. Here's how
to see it and what each control does. (You need the badge set up in SwiftBar — see
the README's "Menu-bar badge" section — but you can also preview all the lines from
a terminal without SwiftBar, shown at the end.)

## 1. Make sure the dashboard is running

The badge reads your local dashboard. Start it if it isn't already:

1. Open a terminal in your project folder.
2. Run: `npm start`
3. You should see `llmdash running at http://0.0.0.0:8787`. (If you use the launchd
   service, it's already running — you can skip this.)

## 2. Open the badge dropdown

Click the llmdash badge (`▪ …`) in your menu bar. Below the per-tool usage rows
and the host actions you'll see the two new controls.

## 3. The local-service toggle

This is a single item that shows the **live state** of this Mac's llmdash service
and offers the honest action for it:

- **`－ Remove the local service · running`** (or `· stopped`) — when the service
  is installed. Picking it confirms, then unloads the launchd agent **and deletes
  its plist** (a true remove — not a pause a `KeepAlive` agent would undo). If your
  badge also watches other machines, it keeps working off those; only this Mac's
  local reading stops.
- **`＋ Install the local service`** — when it isn't installed. Picking it confirms,
  regenerates the launchd agent with fresh absolute paths, and loads it (runs at
  login, restarts on crash).

The `· running` / `· stopped` suffix is a small dim locator — the state is read
live each time the dropdown renders, never faked.

## 4. The Uninstall llmdash… submenu

`⊘ Uninstall llmdash…` opens a submenu with two deliberately different tiers:

- **Remove the menu-bar badge only** — takes the badge off the bar and nothing
  more. The service keeps running, the app and your data are untouched, and the
  badge just disappears on the next refresh. (A file you put in SwiftBar's folder
  yourself is left alone — llmdash only removes its own marked wrapper.)
- **Uninstall llmdash completely…** — the `…` means it opens a dialog first. That
  dialog **lists every single thing it will remove** — the launchd service and its
  plist, the badge wrapper, the app checkout, the Claude statusline wiring (it
  restores your backup if one exists), and the auto-refresh trust folder — so you
  approve the exact scope before anything happens. Cancel changes nothing.

## 5. Your usage history is kept by default

The complete uninstall then asks a **separate** question: *Also delete your usage
history?* Your snapshot database (`llmdash.db`) is the one thing here that can't be
rebuilt — there's no backfill — so it's **kept unless you explicitly choose "Delete
history too,"** which is warned as permanent and is never the default button.

If your data lives inside the app folder (the default, `~/llmdash/data`), the
database is automatically moved to `~/.llmdash/preserved-data` before the folder is
deleted, and the final message tells you exactly where it went — so a complete
uninstall never quietly takes your history with it.

## 6. SwiftBar is never removed

llmdash never uninstalls SwiftBar (it's a separate app you installed). Both the
uninstall dialog and the finishing message point you to the manual step, if you
want it gone too:

```
brew uninstall --cask swiftbar
```

## Previewing the lines without SwiftBar

You don't need SwiftBar to see the new items — the plugin prints the same lines to
a terminal:

```
node scripts/menubar/llmdash.5s.js
```

Look for `－ Remove the local service · running` (or `＋ Install the local
service`) and the `⊘ Uninstall llmdash…` block with its two sub-items. They appear
whether you watch one machine or several.

Prefer the terminal for the actions themselves? The same powers are:

```
scripts/install-macos.sh --service install|remove|status
scripts/install-macos.sh --uninstall
```
