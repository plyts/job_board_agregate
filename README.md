# JobPilot AI

Plateforme personnelle de recherche d'emploi : importer des offres, les analyser, les comparer à un profil professionnel vérifié, adapter et versionner le CV, recontrôler la correspondance, puis suivre chaque candidature jusqu'à la réponse.

> **État : MVP en construction.** Livré : socle, authentification, plateforme (file de tâches, IA multi-fournisseurs dont offres gratuites), import, dédoublonnage et analyse des offres. Voir [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Démarrage

Prérequis : Node.js 22, PostgreSQL 16.

```bash
npm install
cp .env.example .env.local          # puis renseigner DATABASE_URL
npm run db:migrate
JOBPILOT_PASSWORD='…' npm run user:create -- --email moi@exemple.fr --name "Mon nom"
npm run dev                          # http://localhost:3000
npm run worker                       # traitements en arrière-plan (autre terminal)
```

Héberger gratuitement (test local avec Docker, accès privé depuis le téléphone, VM gratuite ; GitHub Pages ne convient pas) : [`docs/DEPLOIEMENT-GRATUIT.md`](docs/DEPLOIEMENT-GRATUIT.md).

IA : renseigner au moins un fournisseur dans `.env.local` (par exemple `GROQ_API_KEY` et `GROQ_MODEL`), puis `npm run llm:check`. Les offres gratuites sont essayées avant l'API payante ; voir [`docs/DECISIONS/0006-fournisseurs-ia-multiples.md`](docs/DECISIONS/0006-fournisseurs-ia-multiples.md).

| Commande | Rôle |
|---|---|
| `npm run lint` / `typecheck` | Qualité |
| `npm test` | Tests unitaires et d'intégration (base `DATABASE_URL_TEST`, vidée à chaque test) |
| `npm run test:e2e` | Parcours Playwright, bureau et mobile (base `jobpilot_e2e`) |
| `npm run db:generate` | Génère une migration après modification de `src/db/schema` |
| `npm run llm:check` | Vérifie chaque fournisseur IA configuré (clé, modèle, sortie JSON) |
| `bash scripts/init-env.sh` | Prépare `.env` pour Docker Compose : génère les secrets encore vides, sans jamais remplacer une valeur |
| `npm run sources:check [-- --email moi@exemple.fr]` | Confronte les connecteurs France Travail et Adzuna aux vraies API (format des offres, mots-clés, codes postaux, filtres) |
| `npm run test:imap` | Lecture des alertes e-mail contre un vrai serveur IMAP (GreenMail, voir `docs/TESTING.md`) |
| `npm run eval:offers -- --yes [--provider groq]` | Mesure la qualité d'extraction sur le jeu d'évaluation, par fournisseur |

## Principes non négociables

1. L'IA prépare, l'utilisateur décide. Aucune candidature n'est marquée « envoyée » sans confirmation explicite.
2. Rien n'est inventé : chaque phrase d'un CV personnalisé est reliée à une source du profil maître.
3. Trois documents distincts : CV maître, CV personnalisé, CV effectivement envoyé (immuable).
4. Pas de collecte non autorisée : un connecteur n'existe qu'après vérification de l'API, des CGU et des limites.
5. Le volume (offres traitées) et les résultats (envois, entretiens) sont toujours mesurés séparément.

## Documentation

| Document | Contenu |
|---|---|
| [`docs/AUDIT.md`](docs/AUDIT.md) | Étapes 1–2 : état de l'environnement, diagnostic produit, risques |
| [`docs/PRD.md`](docs/PRD.md) | Vision, personas, périmètre MVP, user stories, critères d'acceptation, métriques |
| [`docs/UI.md`](docs/UI.md) | Les 10 écrans du MVP, états, parcours, accessibilité |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Monolithe modulaire, modules, flux asynchrones, IA |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Entités, relations, invariants de traçabilité |
| [`docs/API.md`](docs/API.md) | Contrats HTTP, schémas d'extraction, interface des connecteurs |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Menaces, contrôles, données personnelles |
| [`docs/TESTING.md`](docs/TESTING.md) | Stratégie de test et jeu d'évaluation |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Backlog priorisé et tâches ordonnées avec critères d'acceptation |
| [`docs/DECISIONS/`](docs/DECISIONS/) | ADR (décisions d'architecture) |
