# Notes for coding agents

Sumi's rules are in [CONTRIBUTING](.github/CONTRIBUTING.md): start with [How the code is laid out](.github/CONTRIBUTING.md#how-the-code-is-laid-out) and [What I look at in review](.github/CONTRIBUTING.md#what-i-look-at-in-review). How the island looks and moves is in [docs/design.md](docs/design.md).

Pull requests target `dev`, from a `type/what` branch such as `fix/click-through-win10`, with a [Conventional Commit](https://www.conventionalcommits.org) title ([Branches](.github/CONTRIBUTING.md#branches)). Before you finish, run what CI runs ([Before you push](.github/CONTRIBUTING.md#before-you-push)):

```bash
npm run lint && npm run check && npm test
npm run build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

A change users can see updates its page in the site's docs, and the README when what users can do changes, in the same pull request and in English and French. It updates `docs/design.md` and its French page when a value changes, with the OK below. A release does more: follow [docs/releasing.md](docs/releasing.md).

Never:

- `unwrap()` a Windows call: when one fails, the module hides and the app keeps running.
- Add a dependency, a Tauri capability or a network request without an issue that agreed on it.
- Log anything the island shows, or write it to a file. The only files are the clipboard history and the weather's yes and city, each after the user's yes and sealed with DPAPI (`src-tauri/src/clipboard.rs`, `src-tauri/src/weather.rs`). The capture's frozen frame never leaves RAM (`src-tauri/src/capture.rs`).
- Leave anything running at rest: no timer or animation while nothing changes.
- Leave dead code or a `TODO`, or write an `unsafe` block that relies on what the compiler can't check (a raw pointer it reads, `from_raw`, a transmute, a callback's `lparam`) without a `// SAFETY:` comment.
- Add a file, a command or an event without its line in [How the code is laid out](.github/CONTRIBUTING.md#how-the-code-is-laid-out), in both languages.
- Change a value in `docs/design.md` without the maintainer's OK.
- Change one language alone: `README.md` and `README.fr.md`, the site's English and French pages, and `.github/CONTRIBUTING.md` and `site/src/content/docs/fr/docs/contribute.mdx`, and `docs/design.md` and `site/src/content/docs/fr/docs/design.mdx` change together.
- Push to `main`.
