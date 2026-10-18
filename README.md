# JobPilot AI

Plateforme personnelle de recherche d'emploi : importer des offres, les analyser, les comparer à un profil professionnel vérifié, adapter et versionner le CV, recontrôler la correspondance, puis suivre chaque candidature jusqu'à la réponse.

> **État : cadrage.** Aucun code applicatif n'existe encore. Ce dépôt contient l'audit, la spécification, l'architecture, le plan de livraison et les maquettes d'interface validées avant développement. Voir [`docs/PROGRESS.md`](docs/PROGRESS.md).

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
