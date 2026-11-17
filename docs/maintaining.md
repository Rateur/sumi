# Maintaining

For the maintainer: how outside contributions are handled. The rules contributors follow are in the [contributing guide](https://github.com/Rateur/sumi/blob/dev/.github/CONTRIBUTING.md).

## A pull request from outside

1. If it targets `main`, change its base to `dev` (**Edit** next to the title). The **Target branch** check fails until then.
2. Read the whole diff before approving its CI run, and first the files that run code on your machine or in CI: `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, any `build.rs`, `src-tauri/capabilities/`, `src-tauri/tauri.conf.json` and `.github/`.
3. Approve the run. CI checks it, but doesn't offer its installer for download.
4. To try it, check it out (`gh pr checkout <number>`), build it and run it in [Windows Sandbox](https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/), not in your own session.
5. Squash-merge into `dev`, with a Conventional Commit title.

## Labels

| Label | Meaning |
|---|---|
| `needs triage` | New, not read yet. Remove it on the first reply. |
| `help wanted` | Agreed: a pull request is welcome. |
| `good first issue` | Small, and the issue names the file, the expected behaviour and the test. |
| `needs info` | Waiting for the reporter. |
| `wontfix`, `duplicate`, `invalid` | Closed, with a one-line reason. |
| `spam` | Closed without discussion, and the account blocked. |

## When it gets busy

Change nothing ahead of time. If a wave comes, go one step at a time and undo it once it calms down:

1. Many throwaway accounts: **Settings → Moderation options → Interaction limits → Limit to existing users** for 3 days.
2. An active attack: **Limit to prior contributors** for 24 hours.
3. Flooding for days: restrict issues or pull requests to collaborators in **Settings → General → Features**.

Spam: close it, label it `spam`, and block the account (**Settings → Moderation → Blocked users**, with a private note). Report harassment to GitHub. The code of conduct is for how people treat each other, not for code quality.

## Short replies

- **No issue first:** "Thanks for the pull request. Anything beyond a small fix needs an issue first, so we agree before code is written. Please open one and link it here. I'm closing this until then."
- **Wrong base:** "Please change the base branch to `dev` (Edit, next to the title). `main` only changes at a release."
- **Out of scope:** "Thanks for the idea. It's outside what Sumi does before 1.0, so I'm closing it for now. The roadmap is in the README."
- **Needs info:** "Thanks. Which Sumi and Windows versions, and can you list the steps that make it happen? I'll look as soon as I can reproduce it."
