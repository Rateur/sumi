# Contributing

Thanks for helping. Small fixes can go straight to a pull request. For a new feature, open an issue or a discussion first, so we agree on the design before you write code.

## Branches

`main` is what users get. It only changes when `dev` is merged for a release.

`dev` is where work lands. Open your pull request against `dev`, from a branch named after what it does: `feat/media-module`, `fix/click-through-win10`, `docs/shortcuts`.

Pull requests into `dev` are squash-merged, so the PR title becomes the commit message. Write it as a [Conventional Commit](https://www.conventionalcommits.org): `feat: show album art in the island`, `fix: keep focus on the game when a timer ends`.

## Setup

Instructions arrive with the first code, along with the commands CI runs.

## What I look at in review

- It does one thing, with tests for the logic.
- It fails quietly. If a Windows API call fails, the module hides and the app keeps running. No `unwrap()` on Windows calls.
- It costs nothing at rest: no timer or animation running when nothing changes.
- It logs nothing private. Notification and clipboard content never reach a log.
- The UI works with reduced motion and keeps AA contrast.

New to pull requests? [First Contributions](https://github.com/firstcontributions/first-contributions) walks you through your first one.
