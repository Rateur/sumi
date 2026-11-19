---
title: Politique de signature du code
description: Comment l'installateur Windows de Sumi est construit, vérifié et signé.
---

Chaque version Windows de Sumi est construite à partir du code public de [ce dépôt](https://github.com/Rateur/sumi) par son workflow de publication, sur les machines de GitHub. Rien n'est construit ni déposé à la main, et chaque installateur porte une attestation de build de GitHub qui le relie au commit dont il vient.

## Signature

L'installateur de GitHub n'est pas encore signé : Windows signale donc un éditeur inconnu. Une version Microsoft Store arrive : le Store signe les apps qu'il distribue, et installer Sumi depuis le Store ne provoque aucun avertissement.

D'ici là, vous pouvez vérifier qu'un installateur a bien été construit par le workflow de publication de ce dépôt, à partir de son code public :

```bash
gh attestation verify Sumi-setup.exe -R Rateur/sumi
```

## Rôles

- **Auteurs et relecteurs :** [Rateur](https://github.com/Rateur). Les changements des autres arrivent par pull request, que Rateur relit avant de les fusionner.
- **Approbateurs :** [Rateur](https://github.com/Rateur), qui approuve chaque version.

Chaque membre utilise la double authentification sur GitHub.

## Confidentialité

Sumi n'envoie aucune information à un autre ordinateur sans que vous le demandiez. Voir la [page Confidentialité](../privacy/).
