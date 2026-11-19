<!-- Pull requests go into `dev`. The title becomes the commit message: write it as a Conventional Commit, like `fix: keep focus on the game when a timer ends`. -->

Closes #

## What and why

## How to test

- [ ] One change, agreed in the linked issue if it's more than a small fix
- [ ] Tests for new logic; lint, type check, tests, clippy and cargo test pass
- [ ] It reads like the code around it: same naming, short comments that say why, no dead code or `TODO` (a known limit gets `// shortcut:`)
- [ ] A `// SAFETY:` comment on each `unsafe` block that reads a raw pointer, calls `from_raw`, transmutes or casts a callback's `lparam`
- [ ] The code map lists any new file, command or event; a new Rust file opens with `//!`
- [ ] A change users can see updates its docs page, and the README if what users can do changes, in English and French
- [ ] Screenshot or GIF for a visual change, and with reduced motion if it moves
- [ ] No new dependency, network request or Tauri permission, unless the issue agreed on it
- [ ] I ran it on Windows and understand every line, including any written with AI
