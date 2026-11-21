---
title: Capture
description: Appuyez sur Win+Alt+C pour copier une couleur, un texte ou un code QR depuis l'écran.
---

Appuyez sur `Win+Alt+C` et l'écran se fige tel quel. Rien ne s'assombrit, et les clics n'atteignent plus vos apps. Une loupe ronde suit le curseur, et l'île affiche la couleur dessous. Si une autre app utilise déjà le raccourci, c'est `Alt+Maj+C`. Vous pouvez aussi taper `capture` ou `pipette` dans la barre de commande.

## Une couleur

- **Cliquez** pour copier la couleur sous la loupe, en HEX : `#1E90FF`. L'île affiche « Couleur copiée », et une goutte de votre couleur en tombe pendant 3 secondes.
- **Maj+clic** copie la couleur du texte voisin plutôt que celle du fond, sur une app claire comme sur une app sombre. Tant que vous tenez Maj, l'île affiche « couleur du texte ».
- **Les flèches** déplacent la loupe d'un pixel à la fois.

## Un texte ou un code QR

- **Tracez un cadre** autour d'un texte et relâchez. Sumi le lit avec la reconnaissance de texte de Windows et le copie. L'île affiche « Texte copié · 42 mots ».
- **Un cadre autour d'un code QR entier** copie plutôt ce qu'il contient. Pour un lien, l'île nomme son site : « Lien copié · example.com ».
- Si le cadre ne contient aucun texte, l'île affiche « Aucun texte trouvé » et rien n'est copié.

Windows lit le texte dans les langues installées avec leur reconnaissance de texte, la vôtre d'abord. S'il n'y en a aucune, l'île affiche « Aucune langue OCR installée ». Ajoutez une langue dans Paramètres > Heure et langue > Langue et région.

## Annuler

Appuyez sur Échap, ou à nouveau sur `Win+Alt+C`. L'écran revient et rien n'est copié.

## Ce que Sumi garde

- **L'écran figé** reste en mémoire, jamais sur le disque, et disparaît dès la fin de la capture. Sumi n'enregistre aucune capture d'écran.
- **Le texte** est lu sur ce PC par Windows. Rien n'est envoyé nulle part.
- **Ce que vous copiez** va dans le presse-papiers, et dans votre [historique du presse-papiers](../clipboard/) s'il est activé.
- **Caché des captures d'écran** : la loupe et l'écran figé n'apparaissent jamais sur une capture d'écran ni sur un écran partagé, et l'île non plus pendant la capture.

## Limites

- La reconnaissance de texte peut mal lire du code et les longs nombres. Vérifiez ce que vous collez.
- Sur un écran HDR, une couleur peut différer de ce que vous voyez. Une vidéo protégée peut se figer en noir.
- Tant que l'île est cachée en plein écran, le raccourci ne fait rien.
