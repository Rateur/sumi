# Contributing

<!-- The French version is site/src/content/docs/fr/docs/contribute.mdx: update both. -->

Thanks for helping. Sumi has one maintainer, so here is what gets merged.

## Before you start

- Typos, broken links and small bug fixes can go straight to a pull request.
- Anything bigger needs an issue first, and a yes on it. When an issue is open for a pull request, it gets the `help wanted` label. A large pull request without one will be closed.
- Until 1.0, Sumi builds what's on the [roadmap](https://github.com/Rateur/sumi#roadmap). Ideas outside it are welcome in an issue, and decided case by case.
- How the island looks and moves is set in the [design page](https://github.com/Rateur/sumi/blob/dev/docs/design.md). A change to a size, a colour, a spring or a timing needs my OK in an issue first.
- To take an issue, say so in a comment and I'll assign it to you. One person per issue.
- One change per pull request, with no reformatting or renames on the side.

## Branches

`main` is what users get. It only changes when `dev` is merged for a release.

`dev` is where work lands. Open your pull request against `dev`, from a branch named after what it does: `feat/media-module`, `fix/click-through-win10`, `docs/shortcuts`, `refactor/rust-cleanups`, `chore/release-0.5.0`.

Pull requests into `dev` are squash-merged, so the PR title becomes the commit message. Write it as a [Conventional Commit](https://www.conventionalcommits.org): `feat: show album art in the island`, `fix: keep focus on the game when a timer ends`.

## Setup

You need Windows 10 or 11 with Node.js 24, Rust and the Microsoft C++ Build Tools. From a terminal:

```bash
winget install OpenJS.NodeJS.LTS --version 24.22.1
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

The exact Rust and Node versions are pinned in `rust-toolchain.toml` and `.node-version`; Rust installs the right one on the first build. Windows 10 may also need [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/).

Then, in the repository:

```bash
npm install
npm run tauri dev
```

The island appears at the top of your primary screen. Quit it from the tray icon. Changes to the frontend reload instantly; changes to Rust restart the app.

## How the code is laid out

- `src-tauri/src/lib.rs` starts the app: the tray icon, the list of commands the page can call, and each module's watcher.
- `src-tauri/src/island.rs` keeps the window at the top of the screen, lets clicks through everywhere but the island, and closes the panel.
- `src-tauri/src/fullscreen.rs` hides the island while a game, a video or a slideshow fills the primary screen.
- `src-tauri/src/media.rs` reads the players Windows' media controls can see, and plays, pauses, skips and seeks.
- `src-tauri/src/privacy.rs` finds the apps using the microphone or the camera, and mutes the microphone.
- `src-tauri/src/apps.rs` reads Start's apps, opens the one picked in the command bar, and opens a question in an assistant or the search engine.
- `src-tauri/src/bar.rs` registers the command bar's shortcut, and gives focus to the bar and back.
- `src/Island.svelte` draws the island and is the only file that talks to Rust.
- `src/lib/*.ts` is the logic without the DOM: who gets the island, sizes, springs, music, privacy. Each file but `demo.ts` has its Vitest tests beside it (`*.test.ts`).
- `src/lib/demo.ts` plays every state from the keyboard, in a browser without Rust, and runs the site's live examples (`npm run showcase`).
- `site/` is the website, in Astro and Starlight. Its English contributing page imports this file.

The page calls Rust with `invoke()` and listens to its events with `listen()`. Each Rust type has a TypeScript twin: change both together. TypeScript types without a file are written inline in `src/Island.svelte`.

| Name | Direction | Rust | TypeScript |
|---|---|---|---|
| `set_island_rects` | page → Rust | `rects: Vec<Rect>` (`island.rs`) | `{ x, y, width, height, radius }[]` |
| `set_island_expanded` | page → Rust | `expanded: bool` | `boolean` |
| `media_control` | page → Rust | `id: String`, `action: Action` (`media.rs`) | `'play'`, `'pause'`, `'next'` or `'previous'` |
| `media_seek` | page → Rust | `id: String`, `ms: i64` | `number` |
| `media_players` | page → Rust | returns `Snapshot` (`media.rs`) | `{ players: Player[]; artwork: Record<string, string> }` |
| `privacy_state` | page → Rust | returns `Privacy` (`privacy.rs`) | `Privacy` (`src/lib/privacy.ts`) |
| `privacy_mute` | page → Rust | `muted: bool` | `boolean` |
| `privacy_settings` | page → Rust | `camera: bool` | `boolean` |
| `privacy_show` | page → Rust | `name: String`, returns `bool` | `boolean` |
| `apps_list` | page → Rust | returns `Vec<App>` (`apps.rs`) | `{ name: string; id: string }[]` |
| `has_claude` | page → Rust | returns `bool` | `boolean` |
| `app_icon` | page → Rust | `id: String`, returns `Option<Icon>` (`privacy.rs`) | `{ side, rgba }` or `null` |
| `app_launch` | page → Rust | `id: String`, returns `bool` | `boolean` |
| `assistant_open` | page → Rust | `target: Target` (`apps.rs`), `query: String`, returns `bool` | `Target` (`src/lib/intent.ts`), `string` |
| `bar_shortcut` | page → Rust | returns `Option<&str>` (`bar.rs`) | `string` or `null` |
| `bar_focus` | page → Rust | `open: bool` | `boolean` |
| `island://presence` | Rust → page | `Presence` (`fullscreen.rs`) | `Presence` (`src/lib/activities.ts`) |
| `island://pointer` | Rust → page | `Option<u32>`: the hover time in ms, `None` when the cursor leaves | `number` or `null` |
| `island://dismiss` | Rust → page | nothing | nothing |
| `bar://toggle` | Rust → page | nothing | nothing |
| `media://players` | Rust → page | `Vec<Player>` (`media.rs`) | `Player[]` (`src/lib/music.ts`) |
| `media://artwork` | Rust → page | `json!({ id, url })`, with `url: Option<String>` | `{ id, url }`, with `url` a `data:` URL or `null` |
| `privacy://state` | Rust → page | `Privacy` (`privacy.rs`) | `Privacy` (`src/lib/privacy.ts`) |

## Before you push

Run what CI runs:

```bash
npm run lint && npm run check && npm test
npm run build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

TypeScript and Svelte have no formatter: match the surrounding style (single quotes, no semicolons, 2 spaces) and don't run Prettier.

To try your change as users will get it, build the installer with `npm run tauri build`.

On your first pull request, CI starts once I approve it. Leave **Allow edits by maintainers** on, so I can bring your branch up to date.

## What I look at in review

- It does one thing, with tests for the logic.
- It fails quietly. If a Windows API call fails, the module hides and the app keeps running. No `unwrap()` on Windows calls.
- It costs nothing at rest: no timer or animation running when nothing changes.
- It keeps your PC private. Nothing the island shows is written to a log or a file, and nothing leaves the PC unless the user turns that feature on. No telemetry, analytics or crash reports.
- It adds no dependency, network request or Tauri permission (`src-tauri/capabilities/`) unless the issue agreed on it. Every package is code that each user runs.
- The UI works with reduced motion and keeps AA contrast.

## AI tools

Use them if they help. You answer for every line: you ran it on Windows, you understand it and you can explain it in review. Pull requests and issues that look generated and untested are closed without review.

## Translations

Sumi's README and site are in English and French. Please don't open a pull request for another language yet: I can't review text I can't read, and every release would need it updated. Open a discussion if you'd like one.

## Licence

By sending a pull request, you agree that your work is released under the MIT licence, like the rest of Sumi, and that you have the right to share it. Don't paste code from other projects unless their licence allows it.

New to pull requests? [First Contributions](https://github.com/firstcontributions/first-contributions) walks you through your first one.
