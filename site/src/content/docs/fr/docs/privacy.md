---
title: Confidentialité
description: Sumi ne collecte rien.
---

Sumi n'a ni compte, ni télémétrie, ni statistiques d'usage. Ce qu'il affiche vient de Windows et reste sur votre PC : le titre, l'artiste et la pochette de la musique, les apps qui utilisent le micro ou la caméra, et la batterie de votre PC et de vos appareils Bluetooth. Pour la batterie d'une enceinte JBL, Sumi se connecte un instant à votre propre enceinte en Bluetooth LE ; rien ne quitte le PC.

## Le réseau

La météo est la première et la seule requête réseau de Sumi, et il faut l'autoriser à chaque session :

- Rien n'est envoyé tant que vous ne demandez pas la météo dans la barre de commande en appuyant sur Entrée. La première fois après le lancement de Sumi, la barre dit ce qui sera envoyé et attend votre oui ; Échap vaut non.
- [Open-Meteo](https://open-meteo.com) reçoit alors la ville tapée, ses coordonnées et, comme tout site, votre adresse IP, qu'il garde dans ses journaux jusqu'à 90 jours : voir ses [conditions](https://open-meteo.com/en/terms). Jamais votre propre position.
- Votre oui et la ville trouvée restent en mémoire jusqu'à ce que Sumi se ferme. Les réponses ne sont jamais mises en cache ni écrites sur le disque.

Voir [Météo](../weather/). La recherche de mises à jour, dans une version suivante, demandera la dernière version à GitHub, et restera désactivée tant que vous ne l'activez pas.

## Sur votre PC

Rien de ce que l'île affiche n'est écrit dans un journal. Seul l'historique du presse-papiers va dans un fichier, une fois que vous l'avez autorisé : il reste sur ce PC, chiffré par Windows pour votre compte, et n'est envoyé nulle part. Voir [Historique du presse-papiers](../clipboard/). L'écran figé de la capture reste en mémoire, jamais sur le disque, et disparaît dès la fin de la capture. Son texte est lu sur ce PC par Windows. Voir [Capture](../capture/). Les niveaux de batterie sont lus quand Windows dit qu'ils ont changé, et ne sont jamais gardés. Les quelques-uns que Sumi lit lui-même, d'écouteurs Fast Pair et de manettes, ne passent qu'en Bluetooth ou par l'adaptateur Xbox, entre l'appareil et votre PC.

La barre de commande ouvre l'app ou le site que vous choisissez avec votre question ; Sumi ne l'envoie nulle part, et la liste des apps reste en mémoire. L'historique du presse-papiers n'ouvre un lien dans votre navigateur, un nouveau message dans votre app de messagerie ou un dossier dans l'Explorateur de fichiers que si vous le choisissez avec Tab et Entrée.

## Ce site

Ce site est hébergé par GitHub Pages, sert ses propres polices et ne charge aucun traceur.
