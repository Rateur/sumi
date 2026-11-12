<div align="center">
  <img src=".github/assets/logo.svg" width="112" height="112" alt="">
  <h1>Sumi</h1>
  <p>Une île gratuite et open source en haut de votre écran Windows.</p>
  <p>
    <a href="https://github.com/Rateur/sumi/releases/latest"><img alt="Dernière version" src="https://img.shields.io/github/v/release/Rateur/sumi?style=flat-square&color=0B0B0F"></a>
    <a href="https://github.com/Rateur/sumi/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Rateur/sumi/ci.yml?branch=dev&style=flat-square&label=CI"></a>
    <img alt="Windows 10 et 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?style=flat-square">
    <img alt="Fait avec Tauri 2" src="https://img.shields.io/badge/built%20with-Tauri%202-24C8DB?style=flat-square&logo=tauri&logoColor=white">
    <a href="LICENSE"><img alt="Licence MIT" src="https://img.shields.io/github/license/Rateur/sumi?style=flat-square&color=8B5CF6"></a>
  </p>
  <p><a href="README.md">English</a> · <b>Français</b></p>
</div>

![L'île pendant la musique, le panneau musique et la barre de commande](.github/assets/hero.png)

Sumi affiche une petite pilule noire en haut de l'écran. Elle donne l'heure, puis change quand il se passe quelque chose : une chanson démarre, une app allume votre micro, un minuteur se termine. Un clic dessus affiche les commandes.

> [!NOTE]
> Sumi est en début de développement. La version 0.1.0 affiche l'heure, rien de plus pour l'instant ; les images ci-dessus sont des maquettes de la suite. Suivez le dépôt (Watch → Custom → Releases) pour être prévenu des nouvelles versions.

## Télécharger

[**Télécharger Sumi pour Windows**](https://github.com/Rateur/sumi/releases/latest/download/Sumi-setup.exe) (10 et 11, 64 bits), ou choisissez une version sur la [page des releases](https://github.com/Rateur/sumi/releases).

L'installateur n'est pas encore signé, donc Windows signale un éditeur inconnu : cliquez sur **Informations complémentaires**, puis **Exécuter quand même**. Pour quitter Sumi, passez par son icône dans la zone de notification.

## Feuille de route

Chaque étape sort dans sa propre version. La 1.0 sera prête quand toutes les cases seront cochées.

- [x] L'île en haut de l'écran, avec l'heure (0.1.0)
- [ ] Les animations à ressort : l'île grandit quand il se passe quelque chose
- [ ] La musique de toute app que Windows sait piloter (Spotify, navigateurs, VLC…) : pochette, lecture/pause, progression
- [ ] Un point orange ou vert quand une app utilise le micro ou la caméra
- [ ] Une barre de commande (`Ctrl+Alt+Espace`) qui envoie votre question à Claude, ChatGPT, Gemini, Perplexity ou à un moteur de recherche
- [ ] Des minuteurs : tapez `25m`
- [ ] La météo d'[Open-Meteo](https://open-meteo.com), et sur portable des alertes de charge et de batterie faible
- [ ] Elle se masque quand un jeu ou une vidéo est en plein écran
- [ ] Les réglages, les mises à jour automatiques et un installateur signé

Après la 1.0 : notifications, Bluetooth, agenda, historique du presse-papiers, texte depuis une capture d'écran, étagère à fichiers et statut de Claude Code.

## Gratuit et privé

Pas de compte, pas de version payante, pas de télémétrie. Tout tourne sur votre PC. Les seules requêtes réseau sont celles que vous activez : météo, agenda et mises à jour.

## Contribuer

Le code arrive d'abord sur la branche `dev`. Lisez [le guide de contribution](.github/CONTRIBUTING.md) avant d'ouvrir une pull request, et [docs/design.md](docs/design.md) pour le comportement de l'île (en anglais). Idées et retours sont les bienvenus dans les [Discussions](https://github.com/Rateur/sumi/discussions).

## Licence

[MIT](LICENSE). Sumi n'est affilié ni à Apple ni à Microsoft.
