# Contributing

Thanks for helping. Small fixes can go straight to a pull request. For a new feature, open an issue or a discussion first, so we agree on the design before you write code.

## Branches

`main` is what users get. It only changes when `dev` is merged for a release.

`dev` is where work lands. Open your pull request against `dev`, from a branch named after what it does: `feat/media-module`, `fix/click-through-win10`, `docs/shortcuts`.

Pull requests into `dev` are squash-merged, so the PR title becomes the commit message. Write it as a [Conventional Commit](https://www.conventionalcommits.org): `feat: show album art in the island`, `fix: keep focus on the game when a timer ends`.

## Setup

You need Windows 10 or 11 with Node.js 24, Rust and the Microsoft C++ Build Tools. From a terminal:

```bash
winget install OpenJS.NodeJS.LTS Rustlang.Rustup
winget install Microsoft.VisualStudio.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

The exact Rust and Node versions are pinned in `rust-toolchain.toml` and `.node-version`; Rust installs the right one on the first build. Windows 10 may also need [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/).

Then, in the repository:

```bash
npm install
npm run tauri dev
```

The island appears at the top of your primary screen. Quit it from the tray icon. Changes to the frontend reload instantly; changes to Rust restart the app.

## Before you push

Run what CI runs:

```bash
npm run lint && npm run check && npm test
npm run build
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

Every pull request also builds an installer. Find it under **Checks → CI → Artifacts** to test the change without building it yourself.

## What I look at in review

- It does one thing, with tests for the logic.
- It fails quietly. If a Windows API call fails, the module hides and the app keeps running. No `unwrap()` on Windows calls.
- It costs nothing at rest: no timer or animation running when nothing changes.
- It logs nothing private. Notification and clipboard content never reach a log.
- The UI works with reduced motion and keeps AA contrast.

New to pull requests? [First Contributions](https://github.com/firstcontributions/first-contributions) walks you through your first one.
