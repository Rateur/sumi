---
title: Politique de signature du code
description: Comment l'installateur Windows de Sumi est construit, vérifié et signé.
---

Chaque version Windows de Sumi est construite à partir du code public de [ce dépôt](https://github.com/Rateur/sumi) par son workflow de publication, sur les machines de GitHub. Rien n'est construit ni déposé à la main, et chaque installateur porte une attestation de build de GitHub qui le relie au commit dont il vient.

## Signature

Sumi a demandé à [SignPath Foundation](https://signpath.org) une signature gratuite du code. En attendant son accord, l'installateur n'est pas signé et Windows signale un éditeur inconnu. Une fois la demande acceptée, chaque version suivante sera signée :

> Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Seuls les fichiers construits à partir de ce dépôt par son workflow de publication sont signés, et chaque demande de signature est approuvée à la main.

## Rôles

- **Auteurs et relecteurs :** [Rateur](https://github.com/Rateur). Les changements des autres arrivent par pull request, que Rateur relit avant de les fusionner.
- **Approbateurs :** [Rateur](https://github.com/Rateur), qui approuve chaque version et chaque demande de signature.

Chaque membre utilise la double authentification sur GitHub et sur SignPath.

## Confidentialité

Sumi n'envoie aucune information à un autre ordinateur sans que vous le demandiez. Voir la [page Confidentialité](../privacy/).
