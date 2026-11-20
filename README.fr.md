<div align="center">
  <img src=".github/assets/logo.svg" width="112" height="112" alt="">
  <h1>Sumi</h1>
  <p>Une île gratuite et open source en haut de votre écran Windows.</p>
  <p>
    <a href="https://github.com/Rateur/sumi/releases/latest"><img alt="Dernière version" src="https://img.shields.io/github/v/release/Rateur/sumi?style=flat-square&color=0B0B0F"></a>
    <a href="https://github.com/Rateur/sumi/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Rateur/sumi/ci.yml?branch=dev&style=flat-square&label=CI"></a>
    <img alt="Windows 10 et 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?style=flat-square">
    <a href="LICENSE"><img alt="Licence MIT" src="https://img.shields.io/github/license/Rateur/sumi?style=flat-square&color=8B5CF6"></a>
  </p>
  <p><a href="README.md">English</a> · <b>Français</b></p>
</div>

![Sumi en haut de l'écran : l'heure, la date sous le curseur, une chanson et son lecteur, le disque du micro et sa carte, puis la barre de commande qui lance un minuteur](.github/assets/demo.gif)

Sumi affiche une petite pilule noire en haut de l'écran. Elle donne l'heure, puis change quand il se passe quelque chose : une chanson démarre, une app allume votre micro, un minuteur se termine. Un clic dessus affiche les commandes.

> [!NOTE]
> Sumi est en début de développement. La version 0.6.0 affiche l'heure, ajoute la date quand le curseur se pose dessus, s'ouvre en panneau au clic, se masque quand un jeu ou une vidéo est en plein écran, affiche votre musique avec ses commandes, met un point à côté de l'île quand une app utilise votre micro ou votre caméra et ouvre une barre de commande pour un minuteur, une app ou une question. Suivez le dépôt (Watch → Custom → Releases) pour être prévenu des nouvelles versions.

## Télécharger

[**Télécharger Sumi pour Windows**](https://github.com/Rateur/sumi/releases/latest/download/Sumi-setup.exe) (10 et 11, 64 bits), ou choisissez une version sur la [page des releases](https://github.com/Rateur/sumi/releases).

L'installateur n'est pas encore signé. Votre navigateur peut le retenir comme peu téléchargé : conservez-le depuis sa liste de téléchargements. Windows signale ensuite un éditeur inconnu : cliquez sur **Informations complémentaires**, puis **Exécuter quand même**. Une version Microsoft Store, signée par Microsoft, arrive : voir la [politique de signature du code](https://sumi.rateur.fr/fr/docs/code-signing/). Pour quitter Sumi, passez par son icône dans la zone de notification.

## Feuille de route

Chaque étape sort dans sa propre version. La 1.0 sera prête quand toutes les cases seront cochées.

- [x] L'île en haut de l'écran, avec l'heure (0.1.0)
- [x] Les animations à ressort : posez le curseur sur l'île et elle s'élargit, cliquez et elle s'ouvre (0.2.0)
- [x] Elle se masque quand un jeu ou une vidéo est en plein écran (0.3.0)
- [x] La musique de toute app que Windows sait piloter (Spotify, navigateurs, VLC…) : pochette, précédent, lecture/pause, suivant, progression ; l'heure passe dans une bulle à côté (0.4.0)
- [x] Un point orange ou vert quand une app utilise le micro ou la caméra, avec l'app et un bouton muet sous le curseur (0.5.0)
- [x] Une barre de commande (`Win+Alt+S`) : un minuteur, une app, une question pour Claude, ChatGPT, Gemini, Perplexity ou un moteur de recherche ; des minuteurs sur l'île, dès `25m` (0.6.0)
- [ ] Ranger l'île en un fin trait en haut d'un défilement vers le haut, et une icône vivante dans la barre des tâches qui la range ou la fait revenir
- [ ] La météo d'[Open-Meteo](https://open-meteo.com), et sur portable des alertes de charge et de batterie faible
- [ ] Les réglages (écran, thème, langue, raccourcis), les mises à jour automatiques et un installateur signé

## Comment c'est fait

<p>
  <img alt="Rust" src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri_2-24C8DB?style=flat-square&logo=tauri&logoColor=white">
  <img alt="Svelte 5" src="https://img.shields.io/badge/Svelte_5-FF3E00?style=flat-square&logo=svelte&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white">
</p>

Sumi est une app [Tauri 2](https://v2.tauri.app). Un cœur en Rust dialogue avec Windows : il place la fenêtre, laisse passer les clics, lit l'état des médias, du micro et de la caméra, et lira bientôt celui de la batterie. Une interface en [Svelte 5](https://svelte.dev) et TypeScript dessine l'île dans WebView2, le moteur de navigateur déjà intégré à Windows : Sumi n'embarque donc pas son propre navigateur, et l'installateur reste léger.

## Confidentialité

Sumi ne collecte rien. Les fonctions qui ont besoin du réseau resteront désactivées tant que vous ne les activez pas.

## Contribuer

Le code arrive d'abord sur la branche `dev`. Lisez [le guide de contribution](https://sumi.rateur.fr/fr/docs/contribute/) avant d'ouvrir une pull request : il liste ce que vérifie une relecture, du nommage à la doc dans les deux langues. [Fonctionnement de l'île](https://sumi.rateur.fr/fr/docs/design/) décrit le comportement de l'île, et les agents de code commencent par [AGENTS.md](AGENTS.md) (en anglais). Questions et retours sont les bienvenus dans les [Discussions](https://github.com/Rateur/sumi/discussions).

## Licence

[MIT](LICENSE).
