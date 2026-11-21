---
title: Historique du presse-papiers
description: Appuyez sur Win+Alt+V pour retrouver ce que vous avez copié, puis sur Entrée pour le coller là où vous étiez.
---

Appuyez sur `Win+Alt+V` et la barre de commande s'ouvre sur l'historique du presse-papiers, le plus récent en haut. Choisissez un élément et appuyez sur Entrée. Sumi le colle dans l'app où vous étiez. Appuyez à nouveau sur le raccourci ou sur Échap pour refermer la liste. Si une autre app l'utilise déjà, le raccourci est `Alt+Maj+V`. Vous pouvez aussi taper `presse-papiers` ou `historique` dans la barre de commande.

## La première fois

La première fois, la barre affiche « Historique du presse-papiers, chiffré sur ce PC. » et la pastille « Autoriser ». Appuyez sur Entrée pour accepter, ou sur Échap pour refermer la barre. Après Échap, rien n'est gardé, et Sumi redemande au prochain `Win+Alt+V`, avec « Activer ». Une fois votre accord donné, Sumi s'en souvient après un redémarrage.

La liste commence par ce que contient le presse-papiers au moment de votre accord. Rien de ce que vous avez copié avant n'y figure.

## Dans la liste

- **Tapez** pour filtrer. Les majuscules et les accents ne comptent pas. Le compteur à droite devient « 2 sur 12 ». Tapez `couleur`, `lien`, `dossier`, `e-mail` ou `code` pour retrouver ces éléments.
- **↑ et ↓** déplacent la surbrillance. Au-delà de la cinquième ligne, la liste défile.
- **Entrée** colle l'élément dans l'app où vous étiez. L'île affiche « Collé » un instant, jamais ce qui a été collé.
- **Maj+Entrée** le colle en texte brut, sans la mise en forme d'origine. Tant que vous tenez Maj, la pastille affiche « Texte brut ».
- L'élément collé remonte en haut de la liste.

Si l'app où vous étiez tourne en administrateur, Windows empêche Sumi d'y taper. L'élément est copié, l'île affiche « Copié · Ctrl+V », et vous le collez vous-même.

Copier ne réveille jamais l'île. Rien ne s'affiche avant `Win+Alt+V`.

## Tab

Chaque ligne montre ce qu'elle contient : un lien, une couleur, un fichier ou un dossier, une adresse e-mail, du code ou du texte. Le mot discret à droite dit ce que donne Tab. La pastille dit ce que fait Entrée.

- **Un lien** : Tab donne « Ouvrir », qui l'ouvre dans votre navigateur. Quand le lien a des traqueurs comme `utm_source`, `fbclid` ou `gclid`, Tab donne ensuite « Sans traqueurs », qui le colle sans eux. Le reste du lien ne change pas.
- **Une couleur**, comme `#1E90FF`, `rgb(30, 144, 255)` ou `hsl(210, 100%, 56%)` : Tab la fait passer en HEX, RGB et HSL. Entrée colle celle qui s'affiche.
- **Un fichier ou un dossier** de ce PC : Tab donne « Dossier », qui ouvre l'Explorateur de fichiers sur son dossier, avec lui sélectionné. Sumi n'ouvre et ne lance jamais le fichier.
- **Une adresse e-mail** : Tab donne « Écrire », qui ouvre un nouveau message à cette adresse dans votre app de messagerie.
- **Du code** s'affiche en chasse fixe, avec son nombre de lignes. Entrée le colle en texte brut.

Maj+Tab revient en arrière. Une ligne que vous quittez revient à sa première action. L'île affiche un instant le domaine du lien, le nom du dossier ou « Nouveau message ».

Sumi relit l'élément avant d'ouvrir quoi que ce soit. Seuls les liens http et https s'ouvrent.

## Ce que Sumi garde

- **Du texte seulement** : jusqu'à 100 éléments, et les plus anciens partent en premier. Un texte copié de plus de 64 Ko, comme un journal entier, n'est pas gardé.
- **Jamais gardé** : ce qu'une app marque comme privé, comme le font des gestionnaires de mots de passe tels que KeePass.
- **Où** : dans un fichier du dossier de Sumi sur ce PC, `%LOCALAPPDATA%\io.github.rateur.sumi`, chiffré par Windows pour votre compte (DPAPI). Un autre compte Windows ne peut pas le lire. Verrouiller le PC ou le mettre en veille ne l'efface pas.
- **Rien ne quitte le PC** : l'historique n'est envoyé nulle part, et Sumi n'a pas de télémétrie.
- **Caché des captures** : tant que la liste est ouverte, l'île n'apparaît ni sur les captures d'écran ni sur un écran partagé.

## Le mettre en pause ou l'effacer

Faites un clic droit sur l'icône de Sumi, près de l'horloge :

- **Mettre en pause l'historique du presse-papiers** : Sumi arrête de garder ce que vous copiez et oublie votre accord. L'historique reste, chiffré. Au prochain `Win+Alt+V`, la barre redemande, et votre accord fait revenir l'historique.
- **Effacer l'historique du presse-papiers** : vide l'historique et supprime son fichier.

## Limites

- Du texte seulement : pas encore d'images ni de fichiers.
- Seule l'app d'où vous copiez peut marquer un élément comme privé. Sumi garde ce qu'elle ne marque pas.
- Seul l'élément le plus récent, tant qu'il est encore dans le presse-papiers, garde sa mise en forme d'origine. Les autres se collent en texte brut.
- Seules les adresses sans accents ont « Écrire ». Un chemin réseau, comme `\\serveur\partage` ou un chemin sur un lecteur réseau connecté, n'a pas « Dossier ». Les couleurs avec transparence, comme `rgba()`, restent du texte.
- Tant que l'île est masquée en plein écran, le raccourci ne fait rien.
