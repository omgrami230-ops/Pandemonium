LE PANDEMONIUM - version Railway avec tournoi PARTAGÉ

Tout le monde voit le même tournoi en direct (tirage, minuteur, points, classement).
Seul le Ministère Art & Tradition (qui a le mot de passe) peut modifier. Les visiteurs sont en lecture seule.

Contenu
  public/index.html   le site (4 pages : Équipes, Tirage & combat, Points, Classement)
  server.js           serveur + sauvegarde du tournoi (aucune dépendance)
  package.json        commande de démarrage (npm start)

MISE EN LIGNE
  1. Crée un dépôt GitHub (ou réutilise celui du Registre) et envoie-y le CONTENU de ce dossier :
     server.js, package.json et le dossier public/ (avec index.html dedans) à la racine du dépôt.
  2. Sur Railway : New Project > Deploy from GitHub repo > choisis le dépôt.
  3. Service > Variables > ajoute :
        ADMIN_PASSWORD = un mot de passe de ton choix (long, que tu gardes pour toi)
  4. Service > Settings > Networking > Generate Domain pour obtenir l'adresse du site.
  5. Ajoute un VOLUME (sinon les données sont effacées à chaque déploiement) :
        bouton "+ New" > Volume > rattache-le au service, chemin de montage : /data
     Railway fournit le chemin au serveur automatiquement, rien d'autre à régler.
  6. Attends la fin du déploiement, ouvre l'adresse.

UTILISATION
  - Clique sur "Accès Ministère", entre le mot de passe : les boutons d'édition apparaissent.
  - Les autres personnes voient les changements en 2 à 3 secondes, sans recharger.
  - Le minuteur de 5 minutes est synchronisé sur l'horloge du serveur : tout le monde voit le même temps.
  - Bestiaire (noms et points des monstres, nombre de numéros, durée du combat) :
    page "Tirage & combat", section "Bestiaire et réglages" en bas.

NOTES
  - Plusieurs membres du Ministère peuvent modifier en même temps sans conflit.
  - Pour changer le mot de passe : modifie ADMIN_PASSWORD dans Railway (redéploiement automatique).
  - Les noms des monstres sont lisibles par un visiteur qui inspecte le site : le mystère est visuel.
  - Si une bannière "Aucun volume" apparaît, le volume n'est pas rattaché : refais l'étape 5.
