---
title: Installer
description: Télécharger et installer Sumi sur Windows 10 ou 11.
---

Sumi fonctionne sur Windows 10 et 11, 64 bits.

1. Téléchargez [Sumi-setup.exe](https://github.com/Rateur/sumi/releases/latest/download/Sumi-setup.exe). Si votre navigateur le retient comme peu téléchargé, ouvrez sa liste de téléchargements et choisissez de conserver le fichier.
2. Lancez-le. Windows signale un éditeur inconnu : sélectionnez **Informations complémentaires**, puis **Exécuter quand même**.
3. Ouvrez Sumi depuis le menu Démarrer. L'île apparaît en haut de votre écran principal.

Au premier lancement, l'île dit bonjour et montre le raccourci de la barre de commande, puis l'heure. Un clic dessus passe directement à l'heure. Le raccourci reste dans l'info-bulle de l'icône Sumi, dans la zone de notification.

:::note[Pourquoi cet avertissement ?]
L'installateur n'est pas encore signé. Une version Microsoft Store, signée par Microsoft, arrive : voir la [politique de signature du code](../code-signing/).
:::

## Quitter

Clic droit sur l'icône Sumi dans la zone de notification, puis **Quit Sumi**.

## Désinstaller

**Paramètres** › **Applications** › **Applications installées** (sous Windows 10 et la première version de Windows 11 : **Applications et fonctionnalités**) › **Sumi** › **Désinstaller**.

## Configuration requise

- Windows 10 ou 11, 64 bits.
- WebView2. Il est intégré à Windows 11 ; sur Windows 10, l'installateur l'ajoute s'il manque.
- 1,4 Mo pour Sumi-setup.exe. Sumi utilise le WebView2 intégré à Windows au lieu d'apporter le sien.
