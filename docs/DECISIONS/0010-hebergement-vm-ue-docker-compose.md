# ADR 0010 — Hébergement : une VM dans l'UE avec Docker Compose, sauvegardes planifiées par le worker

- Statut : accepté (le choix de l'hébergeur reste à confirmer au moment de la commande)
- Date : 18/10/2026

## Contexte

- JobPilot sert d'abord une seule personne.
- Il traite des données personnelles (CV, candidatures) : hébergement dans l'UE (docs/RGPD.md).
- Il lui faut :
  - un serveur web Next.js ;
  - un worker permanent (pg-boss) ;
  - PostgreSQL 16 ;
  - un stockage de fichiers, aujourd'hui sur disque (`LocalFsStorage`, pas encore de stockage objet) ;
  - des sauvegardes quotidiennes chiffrées, avec un `pg_dump` de la même version majeure que le serveur.
- Budget minimal.

## Décision

**Hébergement.**
- Une VM Linux dans un centre de données de l'UE, chez un hébergeur européen.
  - Recommandé : Scaleway, Paris. Alternatives équivalentes : OVHcloud, Hetzner.
  - Prix et gabarits à vérifier au moment de la commande.
- Pour un utilisateur, 2 vCPU et 4 Go de mémoire suffisent a priori. À confirmer avec un vrai fournisseur IA (docs/OPERATIONS.md).

**Déploiement** (`Dockerfile`, `compose.yaml`, guide dans `docs/DEPLOIEMENT.md`).
- Une seule image, qui sert au web, au worker, aux migrations et aux sauvegardes.
  - Base : l'image officielle `postgres:16`. Elle fournit `pg_dump` 16, `bash`, `tar` et `openssl`.
  - Node.js 22 et rclone y sont copiés depuis leurs images officielles.
- Services Docker Compose :
  - `db` (PostgreSQL 16) ;
  - `migrate` : s'exécute une fois à chaque démarrage, avant le web et le worker ;
  - `web` : publié sur 127.0.0.1 uniquement, derrière un reverse proxy HTTPS (Caddy). HTTPS est requis pour le cookie `Secure` ;
  - `worker`.
- Volumes persistants : base, fichiers, sauvegardes.

**Sauvegardes.**
- Planification : par le worker (pg-boss), pas par un cron de la machine.
  - Tous les jours à 03:15, heure d'`APP_TIME_ZONE` (`BACKUP_CRON`).
  - Une échéance manquée pendant un arrêt est rattrapée une fois au redémarrage.
  - Ce mode marche sur n'importe quel hébergement capable de faire tourner le worker, sans accès à la crontab.
- Journal : chaque exécution est inscrite dans `backup_runs`, avec l'archive, sa taille, son SHA-256 et l'erreur éventuelle sans secret.
- Suivi : la page « Réglages › Sauvegardes » affiche la planification et la prochaine échéance. Elle signale aussi une sauvegarde trop ancienne et permet d'en lancer une à la demande.
- Archive : chiffrée AES-256 sur le volume `backups`, gardée 30 jours.
- Copie hors site de chaque archive : rclone vers un stockage objet S3 dans une autre région (par exemple Amsterdam pour une VM à Paris), défini uniquement par variables (`RCLONE_CONFIG_*`, `BACKUP_COPY_COMMAND`). Un échec de copie fait échouer la sauvegarde.
- La phrase de passe est conservée hors de la VM (gestionnaire de mots de passe) : sans elle, les archives sont illisibles.

## Options écartées

- **Cloud Run et Cloud SQL** :
  - le worker permanent ne profite pas de la mise à l'échelle jusqu'à zéro ;
  - le stockage de fichiers devrait passer sur GCS (non implémenté) ;
  - coût fixe de Cloud SQL ;
  - fournisseur soumis au droit américain.
- **PaaS avec PostgreSQL managé** :
  - possible, mais les tâches planifiées et la version de `pg_dump` dépendent de chaque plateforme ;
  - la planification dans le worker et l'image ci-dessus restent utilisables si l'on change d'avis.

## Conséquences

- Une seule machine, donc un point unique de défaillance : acceptable pour un usage personnel.
  - Perte maximale : 24 heures de données.
  - Restauration manuelle documentée (`scripts/restore.sh`).
  - Les instantanés de VM de l'hébergeur peuvent compléter le dispositif.
- Les mises à jour du système et de Docker sont à la charge de l'utilisateur.
- Image d'environ 1,2 Go. L'image PostgreSQL déclare un `VOLUME` que les conteneurs applicatifs n'utilisent pas.
- Vérifié le 18/10/2026, dans cet environnement :
  - construction de l'image ;
  - `docker compose up` : migrations, web en bonne santé, worker ;
  - planification à 03:15 Europe/Paris ;
  - sauvegarde à la demande depuis l'interface ;
  - copie par rclone (remote défini par variables, de type `local` faute de compte S3) ;
  - restauration dans une base vide ;
  - procédure de reprise après perte de la VM (`docs/DEPLOIEMENT.md`) : volumes supprimés, archive restaurée, connexion avec le compte d'origine.
- Non vérifié :
  - une vraie VM chez l'hébergeur ;
  - la copie vers un vrai stockage S3 ;
  - Caddy et HTTPS.
