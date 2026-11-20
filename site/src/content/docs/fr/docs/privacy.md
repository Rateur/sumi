---
title: Confidentialité
description: Sumi ne collecte rien.
---

Sumi n'a ni compte, ni télémétrie, ni statistiques d'usage. Ce qu'il affiche vient de Windows et reste sur votre PC : le titre, l'artiste et la pochette de la musique, les apps qui utilisent le micro ou la caméra, et la batterie de votre PC et de vos appareils Bluetooth.

## Le réseau

La météo est la première et la seule requête réseau de Sumi, et il faut l'autoriser à chaque session :

- Rien n'est envoyé tant que vous ne demandez pas la météo dans la barre de commande en appuyant sur Entrée. La première fois après le lancement de Sumi, la barre dit ce qui sera envoyé et attend votre oui ; Échap vaut non.
- [Open-Meteo](https://open-meteo.com) reçoit alors la ville tapée, ses coordonnées et, comme tout site, votre adresse IP, qu'il garde dans ses journaux jusqu'à 90 jours : voir ses [conditions](https://open-meteo.com/en/terms). Jamais votre propre position.
- Votre oui et la ville trouvée restent en mémoire jusqu'à ce que Sumi se ferme. Les réponses ne sont jamais mises en cache ni écrites sur le disque.

Voir [Météo](../weather/). La recherche de mises à jour, dans une version suivante, demandera la dernière version à GitHub, et restera désactivée tant que vous ne l'activez pas.

## Sur votre PC

Ce que l'île affiche de votre PC n'est jamais écrit dans un journal ou un fichier. Les niveaux de batterie sont lus quand Windows dit qu'ils ont changé, et ne sont jamais gardés.

La barre de commande ouvre l'app ou le site que vous choisissez avec votre question ; Sumi ne l'envoie nulle part, et la liste des apps reste en mémoire.

## Ce site

Ce site est hébergé par GitHub Pages, sert ses propres polices et ne charge aucun traceur.
