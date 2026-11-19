---
title: Code signing policy
description: How Sumi's Windows installer is built, checked and signed.
---

Every Windows release of Sumi is built from the public source of [this repository](https://github.com/Rateur/sumi) by its release workflow, on GitHub's own runners. Nothing is built or uploaded by hand, and each installer carries a build attestation from GitHub that ties it to the commit it came from.

## Signing

The installer on GitHub isn't signed yet, so Windows warns about an unknown publisher. A Microsoft Store version is on its way: the Store signs the apps it distributes, so installing Sumi from it brings no warning.

Until then, you can check that an installer was built by this repository's release workflow, from its public source:

```bash
gh attestation verify Sumi-setup.exe -R Rateur/sumi
```

## Team roles

- **Committers and reviewers:** [Rateur](https://github.com/Rateur). Changes from anyone else come as pull requests that Rateur reviews before they are merged.
- **Approvers:** [Rateur](https://github.com/Rateur), who approves each release.

Every member uses two-factor authentication on GitHub.

## Privacy

Sumi doesn't send any information to another computer unless you ask it to. See the [privacy page](../privacy/).
