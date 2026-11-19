# Notes for coding agents

Sumi's rules are in [CONTRIBUTING](.github/CONTRIBUTING.md): start with [How the code is laid out](.github/CONTRIBUTING.md#how-the-code-is-laid-out) and [What I look at in review](.github/CONTRIBUTING.md#what-i-look-at-in-review). How the island looks and moves is in [docs/design.md](docs/design.md).

Pull requests target `dev`, from a `type/what` branch such as `fix/click-through-win10`, with a [Conventional Commit](https://www.conventionalcommits.org) title ([Branches](.github/CONTRIBUTING.md#branches)). Before you finish, run what CI runs ([Before you push](.github/CONTRIBUTING.md#before-you-push)):

```bash
npm run lint && npm run check && npm test
npm run build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

A change users can see updates, in the same pull request and in both languages: the feature's page in the site's docs, the README when what users can do changes, and `docs/design.md` when a value changes (with the OK below). A release also updates the site's roadmap and home page, its notes open with a GIF of what's new, and the README's demo GIF is recorded again to show it: see [docs/releasing.md](docs/releasing.md).

Never:

- `unwrap()` a Windows call: when one fails, the module hides and the app keeps running.
- Add a dependency, a Tauri capability or a network request without an issue that agreed on it.
- Log or write to a file anything the island shows.
- Leave anything running at rest: no timer or animation while nothing changes.
- Change a value in `docs/design.md` without the maintainer's OK.
- Change one language alone: `README.md` and `README.fr.md`, the site's English and French pages, and `.github/CONTRIBUTING.md` and `site/src/content/docs/fr/docs/contribute.mdx` change together.
- Push to `main`.
