# Déploiement (VM dans l'UE, Docker Compose)

Choix et raisons : ADR 0010. Ce guide suppose une VM Debian ou Ubuntu récente, avec Docker et le plugin Compose.

## 1. Préparer la VM

- Pare-feu : ouvrir 22 (SSH), 80 et 443 (HTTPS) seulement. Le web écoute sur 127.0.0.1:3000 ; PostgreSQL n'est pas publié.
- Mises à jour de sécurité automatiques du système (`unattended-upgrades` sous Debian et Ubuntu).

## 2. Configurer

```sh
git clone <dépôt> jobpilot && cd jobpilot
cp .env.example .env && chmod 600 .env
```

Dans `.env`, au minimum :

| Variable | Rôle |
|---|---|
| `POSTGRES_PASSWORD` | Mot de passe de la base (longue chaîne aléatoire) |
| `BACKUP_PASSPHRASE` | Phrase de passe des archives. **À conserver aussi hors de la VM** : sans elle, aucune restauration n'est possible |
| `JOBPILOT_SECRETS_KEY` | Clé de chiffrement des identifiants des sources (`openssl rand -base64 32`) ; à conserver avec la phrase de passe des sauvegardes |
| `APP_TIME_ZONE` | Fuseau du tableau de bord et de l'heure des sauvegardes (`Europe/Paris` par défaut) |
| `RCLONE_CONFIG_HORSSITE_*`, `BACKUP_COPY_COMMAND` | Copie hors site de chaque archive (voir ci-dessous) |
| Clés IA | Facultatives (voir `.env.example`) ; le CV ne part que vers un fournisseur autorisé **et** consenti |

`DATABASE_URL`, `STORAGE_DIR` et `BACKUP_DIR` sont fixés par `compose.yaml`.

### Copie hors site

Créer un bucket privé dans **une autre région** que la VM (par exemple Amsterdam pour une VM à Paris), avec une clé d'accès limitée à ce bucket. Exemple pour un stockage objet compatible S3 (valeurs à adapter à l'hébergeur) :

```sh
RCLONE_CONFIG_HORSSITE_TYPE=s3
RCLONE_CONFIG_HORSSITE_PROVIDER=Scaleway
RCLONE_CONFIG_HORSSITE_REGION=nl-ams
RCLONE_CONFIG_HORSSITE_ENDPOINT=s3.nl-ams.scw.cloud
RCLONE_CONFIG_HORSSITE_ACCESS_KEY_ID=…
RCLONE_CONFIG_HORSSITE_SECRET_ACCESS_KEY=…
BACKUP_COPY_COMMAND='rclone copyto "$1" horssite:jobpilot-sauvegardes/"$(basename "$1")"'
```

- Les guillemets simples empêchent `.env` d'interpréter `$1`.
- Une règle de cycle de vie sur le bucket (suppression après 30 à 90 jours) borne la durée de conservation hors site. Elle est à reporter dans docs/RGPD.md.

## 3. Démarrer

```sh
docker compose up -d --build
docker compose ps        # db healthy, migrate exited (0), web healthy, worker up
docker compose exec -e JOBPILOT_PASSWORD='…' worker npm run user:create -- --email moi@exemple.fr --name "Mon nom"
```

## 4. HTTPS

Le cookie de session exige HTTPS. Avec Caddy installé sur la VM (certificat automatique) :

```
# /etc/caddy/Caddyfile
jobpilot.mon-domaine.fr {
  reverse_proxy 127.0.0.1:3000
}
```

## 5. Vérifier les sauvegardes

- « Réglages › Sauvegardes » doit afficher une planification **active** et la prochaine échéance (03:15).
- La copie hors site doit être **configurée**.
- Lancer « Sauvegarder maintenant » : la ligne doit passer à « Réussie » et l'archive doit apparaître dans le bucket.
- Une fois par trimestre, restaurer dans une base vide pour vérifier une archive :

```sh
docker compose exec db psql -U jobpilot -c "create database jobpilot_verif"
docker compose exec worker sh -c 'DATABASE_URL=postgres://jobpilot:$POSTGRES_PASSWORD@db:5432/jobpilot_verif STORAGE_DIR=/tmp/verif scripts/restore.sh /backups/<archive>.tar.enc'
docker compose exec db psql -U jobpilot -c "drop database jobpilot_verif"
```

(`POSTGRES_PASSWORD` est disponible dans le conteneur par `.env`.)

## Restaurer après une perte de la VM

1. Nouvelle VM, mêmes étapes 1 et 2 (même `BACKUP_PASSPHRASE`).
2. `docker compose up -d db`, puis récupérer la dernière archive du bucket (`rclone copy horssite:jobpilot-sauvegardes/<archive> .`).
3. Restaurer dans la base vide :

```sh
docker compose run --rm --no-deps -v "$PWD":/restauration worker sh -c 'scripts/restore.sh /restauration/<archive>.tar.enc'
```

   `--no-deps` évite de lancer `migrate` : la base `jobpilot` doit rester vide, la restauration crée tout.
4. `docker compose up -d`.

## Mettre à jour

```sh
git pull && docker compose up -d --build   # les migrations passent avant le redémarrage du web et du worker
```
