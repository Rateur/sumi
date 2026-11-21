---
title: Clipboard history
description: Press Win+Alt+V for what you copied, and Enter to paste it where you were.
---

Press `Win+Alt+V` and the command bar opens on your clipboard history, newest first. Pick an item and press Enter. Sumi pastes it into the app you were in. Press the shortcut again or Esc to close it. If another app already uses it, the shortcut is `Alt+Shift+V`. You can also type `clipboard` or `clipboard history` in the command bar.

## The first time

The first time, the bar says "Clipboard history, encrypted on this PC." and the chip says "Allow". Press Enter to allow it, or Esc to close the bar. After Esc nothing is kept, and Sumi asks again at your next `Win+Alt+V`, with "Turn on". Once you allow it, Sumi remembers your yes after a restart.

The list starts with what the clipboard holds as you allow it. Nothing you copied before is in it.

## In the list

- **Type** to filter. Capitals and accents don't count. The count on the right becomes "2 of 12". Type `colour`, `link`, `folder`, `email` or `code` to keep only those items.
- **↑ and ↓** move the highlight. Past the fifth row, the list scrolls.
- **Enter** pastes the item into the app you were in. The island says "Pasted" for a moment, never what was pasted.
- **Shift+Enter** pastes it as plain text, without the formatting it was copied with. While you hold Shift, the chip says "Plain text".
- The item you paste moves to the top.

If the app you were in runs as administrator, Windows doesn't let Sumi type into it. The item is copied, the island says "Copied · Ctrl+V", and you paste it yourself.

Copying never wakes the island. Nothing shows until you press `Win+Alt+V`.

## Tab

Each row shows what it holds: a link, a colour, a file or a folder, an email address, code or text. The dim word on the right says what Tab gives. The chip says what Enter does.

- **A link**: Tab gives "Open", which opens it in your browser. When the link has trackers such as `utm_source`, `fbclid` or `gclid`, Tab then gives "No trackers", which pastes it without them. The rest of the link stays.
- **A colour**, such as `#1E90FF`, `rgb(30, 144, 255)` or `hsl(210, 100%, 56%)`: Tab turns it to HEX, RGB and HSL. Enter pastes the one shown.
- **A file or a folder** on this PC: Tab gives "Folder", which opens File Explorer on its folder with it selected. Sumi never opens or runs the file.
- **An email address**: Tab gives "Compose", which opens a new message to it in your mail app.
- **Code** shows in a fixed-width font with its number of lines. Enter pastes it as plain text.

Shift+Tab goes back. A row you leave goes back to its first action. The island shows the link's domain, the folder's name or "New message" for a moment.

Sumi reads the item again before it opens anything. Only http and https links open.

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
- Only addresses without accents get "Compose". A network path, such as `\\server\share`, gets no "Folder". Colours with transparency, such as `rgba()`, stay text.
- While the island is hidden in fullscreen, the shortcut does nothing.
