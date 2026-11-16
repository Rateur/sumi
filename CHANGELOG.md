# Changelog

What changed in each release, in plain words. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- The island springs between its shapes. Rest the cursor on it and it widens to add the date. Click it and it opens at once into a panel with the time and the full date.
- Esc or a click elsewhere closes the panel. Both still reach the app underneath.
- With reduced motion turned on in Windows, sizes change at once and the content crossfades.

### Known limits

- With touch or a pen, it takes two taps to open the island: the first one reaches the app underneath.
- While an elevated app such as Task Manager has focus, Esc and clicks don't close the panel. Switching apps does.

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

[Unreleased]: https://github.com/Rateur/sumi/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Rateur/sumi/releases/tag/v0.1.0
