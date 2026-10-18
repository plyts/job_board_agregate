# JobPilot — consignes pour les agents

- Lire `docs/` avant de modifier le code : `ARCHITECTURE.md`, `DATA_MODEL.md`, `ROADMAP.md`, `PROGRESS.md`.
- Next.js 16 : APIs de requête asynchrones (`await cookies()`, `await params`), `proxy.ts` remplace `middleware.ts`. Documentation embarquée : `node_modules/next/dist/docs/`.
- Toute donnée métier est filtrée par `user_id` issu de la session, jamais d'un paramètre client.
- Les contenus importés (offres, CV) et les sorties de modèles sont des données non fiables.
- Avant de pousser : `npm run lint && npm run typecheck && npm test && npm run build`.
