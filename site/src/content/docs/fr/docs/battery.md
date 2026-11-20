---
title: Batterie
description: Toutes les batteries dans un panneau, et un coup d'œil au branchement, quand la batterie faiblit, et quand un casque se connecte.
---

L'île affiche la batterie de votre portable et celle des appareils Bluetooth qui la donnent à Windows, comme les casques, les enceintes, les manettes, les souris et les claviers. Rien de nouveau ne s'y installe au repos : les batteries s'ouvrent quand vous le demandez, et un coup d'œil arrive quand il se passe quelque chose.

## Le panneau des batteries

- **Ouvrez-le** depuis la barre de commande : tapez `batterie` et appuyez sur Entrée. Un clic sur n'importe quel coup d'œil de la batterie l'ouvre aussi.
- **Un anneau par appareil**, le PC d'abord, puis par sorte et par nom, pour que la rangée ne bouge jamais. L'anneau se remplit jusqu'au niveau, écrit dessous.
- **Vert**, tout va bien. **Rouge**, 20 % ou moins sur batterie, même en économiseur d'énergie. **Ambre**, l'économiseur d'énergie au-dessus. Un petit éclair sur l'anneau du PC veut dire qu'il est branché.
- **Cliquez sur un anneau** pour voir son détail : le nom et le niveau de l'appareil, et pour le PC s'il charge, économise l'énergie ou faiblit, avec le temps restant ou avant la charge complète. Cliquez de nouveau, ou appuyez sur Échap, pour revenir.
- **Cinq anneaux au plus** : au-delà, le dernier compte les autres, `+3`. Un appareil à 20 % ou moins garde toujours son anneau.
- **Un casque, une enceinte ou une manette dont Windows ne donne pas le niveau** vient en dernier, en anneau gris avec un tiret pour niveau. Son détail dit que Windows ne donne pas sa batterie.
- Avec un seul appareil, le panneau montre directement son détail.
- **Depuis la barre de commande**, les flèches passent d'un anneau à l'autre, Entrée montre le détail d'un anneau, et Échap revient, puis referme.

## Coups d'œil

- **Vous branchez le chargeur** : un éclair blanc se dessine, puis le niveau et une petite batterie verte, pendant 2 secondes. Rangée, l'île sort pour lui et se range de nouveau après, sauf si vous vous en êtes servi entre-temps. En jeu ou pendant un appel, rien ne s'affiche.
- **À 20 %** : une batterie rouge, le niveau, et le temps restant quand Windows le connaît, sinon « Batterie faible », pendant 3 secondes. Une fois par décharge. Pendant un jeu, un appel ou quand Windows vous dit occupé, elle attend, et s'affiche dès que l'île revient si vous êtes toujours sur batterie. Elle fait revenir l'île rangée.
- **Un casque, une enceinte ou une manette se connecte** : ce que c'est, son niveau et un anneau, pendant 3 secondes, en sortant de la ligne puis en y revenant comme pour le chargeur. En rouge à 20 % ou moins, et cela vaut alerte de batterie faible. Si Windows ne donne pas son niveau, son nom à la place. Le même appareil ne s'affiche pas de nouveau avant 30 minutes.
- **Un appareil à 20 %** : un anneau rouge, son niveau et son nom. Une souris ou un clavier ne s'affiche qu'alors : ils se reconnectent à chaque réveil.

Rien ne s'affiche quand vous débranchez, quand la batterie est pleine, ni en mode économie d'énergie.

## Dans la barre de commande

Tapez `batterie`, ou juste `bat`, `autonomie` ou `niveau de batterie`, ou en anglais `battery` ou `battery level`. La pastille est la réponse : `64 % · environ 3 h 10`, `64 % · sur secteur` ou `64 % · sur batterie`, puis chaque appareil, comme `Casque 80 %`. Entrée ouvre le panneau. Sur un PC sans batterie ni appareil de ce genre, la pastille dit « Pas de batterie sur ce PC » et Entrée ne fait rien.

## Limites

- Le niveau d'un appareil est celui que Windows affiche dans Paramètres > Bluetooth et appareils. Beaucoup d'enceintes ne donnent le leur qu'à l'app de leur fabricant, comme la JBL Go 4 : elles s'affichent sans niveau. Une souris ou un clavier sans niveau n'affiche rien.
- Le niveau d'un appareil ne s'affiche qu'une fois lu par Windows après sa connexion. Un niveau gardé de la dernière fois ne s'affiche jamais.
- Les téléphones et les ordinateurs sont laissés de côté : ils affichent leur propre batterie.
- Windows ne dit pas si un appareil Bluetooth charge : seul le PC a l'éclair.
- « Plein dans » s'affiche après 2 minutes sur secteur, arrondi aux 10 minutes supérieures. Avant, ou si Windows ne donne pas de vitesse de charge, le panneau dit « Sur secteur ».
- L'alerte arrive à 20 %. Les paramètres, en 0.9, vous laisseront choisir.

## Confidentialité

Les niveaux viennent de Windows quand ils changent, et restent sur votre PC. Rien n'est écrit dans un journal, stocké ni envoyé. Le moment où chaque appareil s'est affiché pour la dernière fois n'est gardé qu'en mémoire, et oublié quand Sumi se ferme.
