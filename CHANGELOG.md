# Changelog

What changed in each release, in plain words. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.9.1] - 2026-11-22

Fixes for the music player, the microphone card and the island.

### Fixed

- The song's two times tick with the song and add up to its length: a 3:00 song starts at 0:00 and -3:00. After sleep, the bar and the times no longer jump to the end.
- A paused song stays while its panel is open, and leaves a minute after you close it. Before, it could turn into the clock under your cursor.
- A drag on the progress bar no longer stays held after you let go.
- The microphone and camera card no longer jumps sideways when it closes, and a quick click or Esc no longer leaves it half open.
- Resting the cursor on the bubble no longer grows the island. A press near either end of the island opens it, and a click on the bubble while it joins the island is no longer lost.
- Screen readers hear the song or the timer the island shows, and when an app starts using your microphone or camera. Each text is read in its own language.
- In a light Windows contrast theme, the microphone and camera dots and the equalizer stay visible, and the progress bar shows in every contrast theme.

### Known limits

- The history keeps text only, no files or images.
- The capture was tried on one screen only.
- The island still shows on the main screen only.
- No settings yet. Until 0.10, the tray menu pauses or clears the history and forgets the weather.
- No automatic updates. Install new versions by hand.
- The installer isn't signed yet. Your browser may hold the download, and Windows warns about an unknown publisher.

## [0.9.0] - 2026-11-21

Your clipboard history in the command bar, and a capture that copies a colour, text or a QR code from the screen.

### Added

- Press `Win+Alt+V` for your clipboard history in the command bar, newest first. Pick an item and press Enter. Sumi pastes it into the app you were in, and the island says "Pasted". Shift+Enter pastes it as plain text. Type to filter the list.
- The first time, the bar asks before Sumi keeps anything. Once you allow it, Sumi keeps up to 100 text items, even after a restart, in a file on this PC encrypted by Windows for your account. What an app marks as private, as password managers do, is never kept. The history never leaves the PC.
- Tab offers what fits each item. A link opens in your browser, or pastes without its trackers. A colour turns to HEX, RGB or HSL. A file or a folder opens File Explorer with it selected. An email address opens a new message. Code pastes as plain text.
- Press `Win+Alt+C` to copy from the screen. The screen freezes, and the island shows the colour under the loupe. A click copies that colour as HEX, and Shift+click the colour of the text nearby. A box around text copies the text, read on this PC by Windows. A box around a QR code copies what it holds. An ink drop falls from the island with what you copied.
- The frozen screen stays in memory and is freed as soon as the capture ends. While the history is open or a capture runs, the island doesn't show in screenshots or on a shared screen.
- Right-click Sumi's icon by the clock to pause the clipboard history or to clear it.

### Changed

- The weather remembers your yes and the last city after Sumi restarts, encrypted on this PC. "Forget the weather" in the tray menu forgets both.

### Known limits

- The history keeps text only, no files or images.
- The capture was tried on one screen only.
- The island still shows on the main screen only.
- No settings yet. Until 0.10, the tray menu pauses or clears the history and forgets the weather.
- No automatic updates. Install new versions by hand.
- The installer isn't signed yet. Your browser may hold the download, and Windows warns about an unknown publisher.

## [0.8.0] - 2026-11-21

The batteries of your PC and your devices, even ones Windows doesn't show, and the weather from the command bar.

### Added

- Type `battery`, or just `bat`, in the command bar and press Enter: a panel with one ring per battery, the PC first, then your headsets, speakers, controllers, mice and keyboards. Green is fine, amber is energy saver, red is 20 % or less. A bolt on the PC's ring while it's plugged in. Click a ring for its detail, with the time left or until full.
- Peeks when you plug in, when the battery reaches 20 %, and when a headset, a speaker or a controller connects, with its level and a ring, or leaves: "Disconnected". A tucked island comes out of its line for them, then goes back. A click on a peek opens the batteries panel.
- Batteries Windows doesn't show: JBL speakers, 27 models, which Sumi asks over Bluetooth LE as JBL's app does, thanks to [JBLControl](https://github.com/ffrafat/JBLControl) and [OpenJBL](https://github.com/NiceDayZc/openjbl) (MIT); earbuds and headphones with Google Fast Pair; the Switch Pro Controller, the DualShock 4 and the DualSense on Bluetooth; Xbox controllers on the Xbox Wireless Adapter.
- Type `weather in Paris`, `météo Lyon` or `weather Paris tomorrow` and press Enter: the island shows the sky, the temperature and the day's low and high, or the rain to come, for 4 seconds. Through [Open-Meteo](https://open-meteo.com), weather data under CC BY 4.0.
- The first time after Sumi starts, the bar says what Open-Meteo will get, the city and your IP, and waits for your yes. Esc sends nothing. Your yes and the city are forgotten when Sumi quits.
- The bar's own words answer from their first letters: `bat` the battery, `heu` or `tim` the time, `dat` the date, `mét` or `weat` the weather. An app that starts the same way is one Tab away.

### Known limits

- Of the batteries Windows doesn't show, only a JBL speaker was tried on a real device. Fast Pair earbuds and the controllers weren't yet.
- The DualShock 4 and the DualSense give their level only while Steam or a game turns on their full reports.
- The newest JBL speakers, such as the Go 5, Grip and Xtreme 5, speak a newer protocol and show without a level.
- Still main screen only, with no settings and no automatic updates: install new versions by hand.
- The installer isn't signed yet: your browser may hold the download, and Windows warns about an unknown publisher.

## [0.7.0] - 2026-11-20

Tuck the island into a line at the top, and a tray icon that shows what it has.

### Added

- Swipe the island away and it tucks into a thin line under the top edge: rest the cursor on it, then scroll or swipe the touchpad, in any direction. Or press it and drag it away. The edge draws it up as a drop of ink, which spreads into the line.
- An open panel tucks the same way, its ink drained up into the edge. A drag on the music's progress bar still moves the song.
- To bring it back, rest the cursor on the line, click it, scroll or pull down on it, or press the command bar's shortcut. Something new that stays brings it back too: music that starts, a call, a timer that ends, an app using the microphone or the camera.
- Showing only the time or a running timer, the island tucks itself after 10 seconds at rest, or 1 second after a click elsewhere. A timer comes back out when it rings. Music, the microphone and camera dot, calls and the command bar keep it out.
- While you move or resize a window, the island tucks so Snap layouts has the top of the screen, and comes back when you let go.
- Sumi's tray icon shows what the island has: an orange dot for the microphone, a green one for the camera, three bars while music plays. Its tooltip names the app or the song. A left click tucks the island or brings it back, and the menu speaks the island's language.

### Fixed

- When the music or timer panel closes, its progress bar and buttons fade where they are instead of jumping.

### Known limits

- The scroll reaches the island through Windows' **Scroll inactive windows when I hover over them** setting, on by default. With it off, drag the island or use the tray icon.
- The line catches the cursor 12 px down from the top edge, in the middle of the screen: a cursor resting over a maximized browser's middle tab brings the island back.
- Still main screen only, with no settings and no automatic updates: install new versions by hand.
- The installer isn't signed yet: your browser may hold the download, and Windows warns about an unknown publisher.

## [0.6.0] - 2026-11-19

A command bar for a timer, an app or a question, and timers on the island.

### Added

- Press `Win+Alt+S`, or `Alt+Shift+S` when another app has it, and the island becomes a bar. Type, check the chip that says what Enter will do, then press Enter.
- Type `25m`, `1h30` or `10 min pasta` for a timer, an app's name or `open discord` for an app from Start, or `what time is it` for the time and date in the island.
- Anything else is a question for Claude, in its app when it's installed. Start with ChatGPT, Gemini, Perplexity or `search` to pick another. The question is filled in, never sent: you send it from there.
- French and English both work, and typos are forgiven.
- Timers: an amber ring and the time left on the island. Click it to pause or cancel, or type `pause`, `+5 min` or `stop` in the bar.
- When a timer ends, a soft chime plays and the island swells with its name, then folds into a small pill that counts the time since until you dismiss it.
- The island drops in at every start. At the first launch, it says hello and shows the bar's shortcut.

### Fixed

- Starting Sumi again no longer opens a second island.
- Mute now mutes every microphone in use, not only the default one.
- Every song shows its own artwork.
- Sumi does less work at rest, and after a game in exclusive fullscreen the island comes back in its place.

### Known limits

- Timers live in memory: quitting Sumi or restarting Windows ends them. The chime can't be turned off yet.
- Still main screen only, with no settings and no automatic updates: install new versions by hand.
- The installer isn't signed yet: your browser may hold the download, and Windows warns about an unknown publisher.

## [0.5.0] - 2026-11-19

Who uses your microphone or your camera, in a small disc beside the island.

### Added

- While an app uses the microphone or the camera, a small black disc splits off beside the island, with an orange dot for the microphone and a green one for the camera, as on the iPhone. The island and its music never move for it.
- Rest the cursor on the disc and it opens into a card: each app with its icon, what it uses, and for how long. It closes once the cursor leaves.
- Mute the microphone for every app from the card. While it's muted, a crossed microphone stays in the disc.
- Windows can't turn the camera off for every app without admin rights. The card's camera button, or a click on an app, brings that app's window forward, where its own camera button is.
- The card also opens Windows' privacy settings for the camera or the microphone.

### Known limits

- An app that captures sound or video outside Windows' audio and camera layers isn't seen.
- The mute is Windows' mute of the default microphone. An app's own mute button, in Discord or Teams for example, doesn't show.
- Still main screen only, with no settings and no automatic updates: install new versions by hand.
- The installer isn't signed yet: your browser may hold the download, and Windows warns about an unknown publisher.

## [0.4.0] - 2026-11-17

Your music on the island, from any player, with the time in a bubble beside it.

### Added

- Music from any app that Windows' media controls can see, such as Spotify, browsers or VLC. The island shows the artwork and an equalizer in its colour. Click it for the title and artist, the progress, and previous, play or pause and next.
- Drag the progress bar to move through the song, in players that allow it.
- While music plays, the time moves to a bubble beside the island. Click the bubble to bring the time back, and the artwork takes its place. Click again for the music.
- Two players at once share the island and the bubble, and the time waits. Click the bubble to swap them.
- A new song in the bubble swells it a little.
- A new song swells the island, unless Windows says you're busy. Paused music stays a minute, then the time comes back.

### Known limits

- A browser shows one player, the tab it last played, and often without artwork.
- Some players don't let other apps move through the song: the bar then stays put.
- Still main screen only, with no settings and no automatic updates: install new versions by hand.
- The installer isn't signed yet: your browser may hold the download, and Windows warns about an unknown publisher.

## [0.3.0] - 2026-11-17

The island gets out of the way of games, videos and slideshows.

### Added

- The island slides up out of the way while a game, a video or a slideshow fills the main screen, and drops back when it ends. It never takes focus.

### Known limits

- F11 and fullscreen video in a browser take up to a second to hide the island.
- A game in exclusive fullscreen hides the island whichever screen it's on, because Windows reports it for the whole PC.
- With touch or a pen, it takes two taps to open the island: the first one reaches the app underneath.
- While an elevated app such as Task Manager has focus, Esc and clicks don't close the panel. Switching apps does.
- Still main screen only, with no settings and no automatic updates: install new versions by hand.
- Windows still warns about an unknown publisher, because the installer isn't signed yet.

## [0.2.0] - 2026-11-17

The island moves. Rest the cursor on it and it widens, click it and it opens. The rest of the time, it stays out of your way.

### Added

- The island springs between its shapes. Rest the cursor on it and it widens to add the date. Click it and it opens at once into a panel with the time and the full date.
- The motion feels alive: width and height spring on their own, content comes in from a blur, the time glides to its new place, and changed digits roll over. The island gives under a press.
- Esc or a click elsewhere closes the panel. Both still reach the app underneath.
- A tab, a text selection or a window dragged across the top of the screen passes over the island.
- With reduced motion turned on in Windows, sizes change at once and the content crossfades.
- With a contrast theme turned on in Windows, the island is outlined in the theme's colors.

### Known limits

- With touch or a pen, it takes two taps to open the island: the first one reaches the app underneath.
- While an elevated app such as Task Manager has focus, Esc and clicks don't close the panel. Switching apps does.
- Still main screen only, with no settings and no automatic updates: install new versions by hand.
- Windows still warns about an unknown publisher, because the installer isn't signed yet.

## [0.1.0] - 2026-11-12

The first build. It does one thing: a black island at the top of your screen that shows the time.

### Added

- The island, centered at the top of your main screen. Clicks beside it reach the window underneath, and it never takes focus from the app you're using.
- The time, in your language's format.
- A tray icon to quit.

### Known limits

- Main screen only.
- No settings and no automatic updates yet: install new versions by hand.
- Windows warns about an unknown publisher, because the installer isn't signed yet.

[Unreleased]: https://github.com/Rateur/sumi/compare/v0.9.1...HEAD
[0.9.1]: https://github.com/Rateur/sumi/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/Rateur/sumi/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/Rateur/sumi/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/Rateur/sumi/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Rateur/sumi/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Rateur/sumi/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Rateur/sumi/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Rateur/sumi/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Rateur/sumi/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Rateur/sumi/releases/tag/v0.1.0
