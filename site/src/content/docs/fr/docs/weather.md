---
title: Météo
description: La météo d'une ville, quand vous la demandez dans la barre de commande.
---

Tapez `météo à Lyon` dans la barre de commande et appuyez sur Entrée. L'île affiche la météo un instant, puis reprend ce qu'elle faisait. Rien ne s'y installe au repos, et rien n'est demandé tant que vous ne demandez pas.

## Que taper

- **Une ville** : `météo Lyon`, `météo à Lyon`, ou en anglais `weather in Paris`.
- **Demain** : ajoutez `demain` ou `tomorrow` : `météo Lyon demain`.
- **La même ville** : `météo` seul, une fois qu'une ville a été trouvée pendant la session. Avant, la pastille dit « Météo · tapez une ville » et Entrée ne fait rien.

La pastille montre ce que demandera Entrée, comme « Météo Lyon demain », avant que rien ne soit envoyé. `temps` et des questions comme `quel temps fait-il à Rome` restent des questions pour Claude.

## La première fois

La première fois que vous appuyez sur Entrée pour la météo après avoir lancé Sumi, rien n'est encore envoyé. La barre dit « Open-Meteo recevra « Lyon » et votre IP. » et la pastille « Autoriser ». Appuyez sur Entrée pour autoriser, ou sur Échap pour fermer la barre : rien n'est alors envoyé ni gardé. Sumi redemande après chaque redémarrage.

## Le coup d'œil

Pendant 4 secondes, un pictogramme, puis « Lyon · 12° · Nuageux » et dessous la minimale et la maximale du jour, « 10° / 14° ». Quand la pluie est probable plus tard dans la journée, à 50 % ou plus dans une heure encore à venir, la deuxième ligne dit plutôt « Pluie vers 14 h ». Demain s'affiche « Lyon demain · Averses », puis sa minimale et sa maximale.

- **Six pictogrammes** : soleil, lune par une nuit dégagée, nuage (le brouillard aussi), pluie, neige et orage.
- **« Ville introuvable »** ou **« Pas de réseau »** s'affiche 2 secondes quand Open-Meteo ne connaît pas la ville ou ne répond pas.
- **Les degrés** sont en Celsius, ou en Fahrenheit quand Windows est en anglais (États-Unis).
- **Open-Meteo**, en bas à droite, ouvre leur site.

## Confidentialité

La météo est la seule chose dans Sumi qui utilise le réseau, et seulement une fois que vous l'avez autorisée.

- **Ce qui quitte votre PC** : la ville tapée part vers le service de géocodage d'Open-Meteo, puis ses coordonnées, jamais votre propre position, vers leur service de prévisions. Comme tout site, Open-Meteo voit votre adresse IP, et la garde dans ses journaux jusqu'à 90 jours : voir leurs [conditions](https://open-meteo.com/en/terms).
- **Ce que Sumi garde** : votre oui et la ville trouvée, en mémoire seulement, jusqu'à ce que Sumi se ferme. Rien n'est écrit sur le disque ni dans un journal, et les réponses ne sont jamais mises en cache.
- Rien n'est envoyé pendant la frappe, et rien au lancement.

## Limites

- Une seule ville par nom : celle qu'Open-Meteo trouve en premier, en général la plus connue. Le coup d'œil n'affiche que son nom, pas son pays.
- Pas encore de météo au repos, d'alertes ni de vue heure par heure.

## Crédits

Données météo d'[Open-Meteo](https://open-meteo.com), sous licence [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.fr).
