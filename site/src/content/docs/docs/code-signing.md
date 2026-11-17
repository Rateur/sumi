---
title: Code signing policy
description: How Sumi's Windows installer is built, checked and signed.
---

Every Windows release of Sumi is built from the public source of [this repository](https://github.com/Rateur/sumi) by its release workflow, on GitHub's own runners. Nothing is built or uploaded by hand, and each installer carries a build attestation from GitHub that ties it to the commit it came from.

## Signing

Sumi has applied to [SignPath Foundation](https://signpath.org) for free code signing. Until it is approved, the installer is unsigned and Windows warns about an unknown publisher. Once approved, every release from then on will be signed:

> Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Only files built from this repository by its release workflow are signed, and each signing request is approved by hand.

## Team roles

- **Committers and reviewers:** [Rateur](https://github.com/Rateur). Changes from anyone else come as pull requests that Rateur reviews before they are merged.
- **Approvers:** [Rateur](https://github.com/Rateur), who approves each release and each signing request.

Every member uses two-factor authentication on GitHub and on SignPath.

## Privacy

Sumi doesn't send any information to another computer unless you ask it to. See the [privacy page](../privacy/).
