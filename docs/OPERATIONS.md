# Exploitation

## Worker

`npm run worker` traite les files (analyse d'offre, extraction de CV, matching, suggestions de CV) et le balayage planifié des tâches bloquées.

| Variable | Défaut | Rôle |
|---|---|---|
| `WORKER_POLL_SECONDS` | 0,5 | Intervalle de relève des files (0,5 minimum). La valeur par défaut de pg-boss (2 s) limitait le débit à environ 30 analyses par minute. |
| `WORKER_CONCURRENCY` | 2 | Tâches en parallèle par file (1 à 16). Les limites par minute et par jour des fournisseurs restent appliquées par le routeur ; le budget journalier peut être dépassé d'au plus un appel par tâche en parallèle. |

## Test de charge (100 offres)

`DATABASE_URL=postgres://…/jobpilot_load npm run test:load -- --yes --offers 100 --latency 800`

Le script importe les offres d'un coup, puis les fait analyser par le vrai worker (pg-boss, PostgreSQL) avec un modèle simulé : latence réglable, aucun appel réseau, aucun coût. La base doit contenir « load » dans son nom.

Mesures du 18/10/2026, sur la machine de développement, avec PostgreSQL 16 local :

| Réglage | Latence simulée du modèle | Durée pour 100 offres | Débit | Analyses en double | Doublons ré-importés détectés |
|---|---|---|---|---|---|
| Relève 2 s, 1 tâche (avant) | 0,8 s (p50 0,79 s) | 199 s | 30 / min | 0 | 10 / 10 |
| Relève 0,5 s, 2 tâches (défaut actuel) | 0,8 s (p50 0,77 s) | 41 s | 147 / min | 0 | 10 / 10 |
| Relève 0,5 s, 2 tâches | 3 s (p50 2,9 s) | 150 s | 40 / min | 0 | 10 / 10 |

L'import des 100 offres prend environ 0,25 s.

Ce que ces mesures ne disent pas :
- **la latence réelle des fournisseurs** : aucune clé n'est configurée ;
- **leurs quotas gratuits** : par exemple 30 requêtes par minute chez Groq, ce qui plafonnera le débit réel ;
- **le coût réel**.

## Sauvegardes

- `scripts/backup.sh` produit une seule archive par exécution :
  - contenu : la base (`pg_dump`, format custom) et les fichiers stockés, avec les empreintes SHA-256 ;
  - chiffrement : AES-256, clé dérivée de `BACKUP_PASSPHRASE` (PBKDF2, 200 000 itérations) ;
  - rétention : les archives de plus de `BACKUP_RETENTION_DAYS` jours (30 par défaut) sont supprimées ;
  - à planifier chaque jour.
- `scripts/restore.sh <archive>` :
  - restaure dans une base vide et refuse une base qui contient déjà des tables ;
  - vérifie les empreintes avant d'écrire ;
  - échoue si la phrase de passe est mauvaise.
- `npm run backup:check` (`SOURCE_URL`, `ADMIN_URL`) enchaîne une sauvegarde et une restauration dans une base neuve, puis compare le nombre de lignes de chaque table et l'empreinte de chaque fichier.
  - Exécuté le 18/10/2026 sur la base e2e : 20 tables, 46 fichiers, tout identique après restauration (archive de 304 Ko).
- La phrase de passe se conserve hors de l'hébergement : sans elle, les archives sont illisibles.

## Données d'un compte

« Réglages › Mon compte » propose :
- **l'export complet** : un ZIP avec toutes les données en JSON et les fichiers stockés, sans mot de passe ni jeton ;
- **la suppression définitive** : confirmée par l'e-mail et le mot de passe. Elle supprime toutes les lignes, y compris les documents envoyés (les triggers d'immuabilité laissent passer la seule suppression du compte), puis les fichiers.
