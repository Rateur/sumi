---
title: Clipboard history
description: Press Win+Alt+V for what you copied, and Enter to paste it where you were.
---

Press `Win+Alt+V` and the command bar opens on your clipboard history, newest first. Pick an item and press Enter: it is pasted into the app you were in. Press the shortcut again or Esc to close it. If another app already uses it, the shortcut is `Alt+Shift+V`. You can also type `clipboard` or `clipboard history` in the command bar.

## The first time

The first time, the bar says "Sumi will keep your clipboard history on this PC, encrypted." and the chip says "Allow". Press Enter to allow it, or Esc to close the bar. After Esc nothing is kept, and Sumi asks again at your next `Win+Alt+V`, with "Turn on". Once you allow it, Sumi remembers your yes after a restart.

The list starts with what the clipboard holds as you allow it. Nothing you copied before is in it.

## In the list

- **Type** to filter. Capitals and accents don't count. The count on the right becomes "2 of 12".
- **↑ and ↓** move the highlight. Past the fifth row, the list scrolls.
- **Enter** pastes the item into the app you were in. The island says "Pasted" for a moment, never what was pasted.
- **Shift+Enter** pastes it as plain text, without the formatting it was copied with. While you hold Shift, the chip says "Plain text".
- The item you paste moves to the top.

If the app you were in runs as administrator, Windows doesn't let Sumi type into it. The item is copied, the island says "Copied · Ctrl+V", and you paste it yourself.

Copying never wakes the island. Nothing shows until you press `Win+Alt+V`.

## What Sumi keeps

- **Text only**: up to 100 items, and the oldest go first. A copy over 64 KB, such as a whole log, isn't kept.
- **Never kept**: what an app marks as private, as password managers such as KeePass do.
- **Where**: in a file in Sumi's folder on this PC, `%LOCALAPPDATA%\io.github.rateur.sumi`, encrypted by Windows for your account (DPAPI). Another Windows account can't read it. Locking the PC or putting it to sleep doesn't clear it.
- **Nothing leaves the PC**: the history is never sent anywhere, and Sumi has no telemetry.
- **Hidden from screenshots**: while the list is open, the island doesn't show in screenshots or on a shared screen.

## Pause or clear it

Right-click Sumi's icon by the clock:

- **Pause clipboard history**: Sumi stops keeping what you copy and forgets your yes. The history stays, encrypted. At your next `Win+Alt+V` the bar asks again, and your yes brings the history back.
- **Clear clipboard history**: empties the history and deletes its file.

## Limits

- Text only: no images or files yet.
- Only the app you copy from can mark a copy as private. Sumi keeps what it doesn't mark.
- Only the newest item, while it is still on the clipboard, keeps the formatting it was copied with. The others paste as plain text.
- While the island is hidden in fullscreen, the shortcut does nothing.
