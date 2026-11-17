# Changelog

What changed in each release, in plain words. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- Music from any app that Windows' media controls can see, such as Spotify, browsers or VLC. The island shows the artwork and an equalizer in its colour. Click it for the title and artist, the progress, and previous, play or pause and next.
- Drag the progress bar to move through the song, in players that allow it.
- While music plays, the time moves to a bubble beside the island. Click the bubble to bring the time back, and the artwork takes its place. Click again for the music.
- Two players at once share the island and the bubble, and the time waits. Click the bubble to swap them.
- A new song in the bubble swells it a little.
- A new song swells the island, unless Windows says you're busy. Paused music stays a minute, then the time comes back.

### Known limits

- A browser shows one player, the tab it last played, and often without artwork.

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

[Unreleased]: https://github.com/Rateur/sumi/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Rateur/sumi/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Rateur/sumi/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Rateur/sumi/releases/tag/v0.1.0
