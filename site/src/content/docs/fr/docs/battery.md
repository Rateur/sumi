---
title: Batterie
description: Un coup d'œil au branchement, quand la batterie faiblit, et quand un casque se connecte.
---

Sur un portable, l'île vous prévient quand vous branchez le chargeur et quand la batterie faiblit. Les appareils Bluetooth qui donnent leur batterie à Windows, comme les casques, les souris et les manettes, ont droit à la même chose : un coup d'œil à leur connexion, et une alerte quand ils faiblissent.

## Ce que vous voyez

- **Vous branchez le chargeur** : un éclair blanc se dessine, puis le niveau, `47 %`, pendant 2 secondes. Seulement quand l'île est sortie : rangée, en jeu ou pendant un appel, rien ne s'affiche.
- **À 20 %** : une batterie rouge, le niveau, et le temps restant quand Windows le connaît, sinon « Batterie faible », pendant 3 secondes. Une fois par décharge. Pendant un jeu, un appel ou quand Windows vous dit occupé, elle attend, et s'affiche dès que l'île revient si vous êtes toujours sur batterie. Elle fait revenir l'île rangée.
- **Un appareil se connecte** : ce qu'il est (un casque, une souris ou une manette), son nom et son niveau. À 20 %, la batterie rouge avec son nom, une fois jusqu'à sa prochaine recharge.

Rien ne s'affiche quand vous débranchez, quand la batterie est pleine, ni en mode économie d'énergie.

## Dans la barre de commande

Tapez `batterie`, `autonomie` ou `niveau de batterie`, ou en anglais `battery` ou `battery level`. La pastille est la réponse : `47 % · sur secteur`, `47 % · environ 2 h 10` ou `47 % · sur batterie`, puis chaque appareil connecté, comme `Casque 80 %`. Entrée referme la barre. Sur un PC sans batterie ni appareil de ce genre, elle dit « Pas de batterie sur ce PC ».

## Limites

- Le niveau d'un appareil est celui que Windows affiche dans Paramètres > Bluetooth et appareils. Un appareil qui ne donne pas son niveau à Windows n'affiche rien.
- Un appareil s'affiche avec le premier niveau que Windows lit après sa connexion. Un niveau gardé de la dernière fois ne s'affiche jamais.
- Les téléphones et les ordinateurs sont laissés de côté : ils affichent leur propre batterie.
- « Sur secteur » ne dit pas si la batterie charge : chaque fabricant de PC l'indique à sa façon.
- L'alerte arrive à 20 %. Les paramètres, en 0.9, vous laisseront choisir.

## Confidentialité

Les niveaux viennent de Windows quand ils changent, et restent sur votre PC. Rien n'est écrit dans un journal, stocké ni envoyé.
