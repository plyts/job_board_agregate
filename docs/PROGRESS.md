# État d'avancement

Dernière mise à jour : 18/10/2026.

## Terminé (tests exécutés)

| Tâche | Contenu | Vérification |
|---|---|---|
| Cadrage | Audit, PRD, maquettes des 10 écrans, architecture, modèle de données, contrats, ADR 0001 à 0005 | Relecture |
| T0 Socle | Next.js 16, TypeScript strict, Tailwind 4, thème Franklin KN (polices auto-hébergées), en-têtes de sécurité et CSP, CI | lint, typecheck, build, e2e |
| T1 Identité | Compte propriétaire (`npm run user:create`), connexion, sessions en base (jeton haché), verrouillage après 5 échecs, déconnexion, contrôle optimiste `proxy.ts` + `requireUser()` | 5 tests d'intégration, 4 scénarios e2e |
| T2 Plateforme | File pg-boss (politique `exclusive`, 3 reprises avec temporisation, expiration), mise en file transactionnelle, stockage local sans écrasement, client Claude à sortie validée par schéma avec repli serveur, journal `llm_calls`, budget IA journalier bloquant, worker (`npm run worker`) | 7 tests d'intégration, 8 tests unitaires |
| T4 Offres | Import par URL (adresses internes refusées, robots.txt, domaines interdits), texte collé, PDF/TXT ; URL canonique et empreinte pour le dédoublonnage ; liste filtrable ; fiche offre | 28 tests unitaires, 12 tests d'intégration, 3 scénarios e2e |
| IA multi-fournisseurs | Client unique pour les API compatibles OpenAI (Groq, OpenRouter, Gemini, Mistral, Cerebras, modèle local) en plus de Claude ; routeur avec ordre configurable, repli sur le fournisseur suivant (429, quota du jour, erreur, sortie invalide), limites par minute et par jour, données personnelles refusées par défaut ; `npm run llm:check` ; écran « Fournisseurs IA » ; évaluation par fournisseur | 17 tests unitaires (dont un faux serveur HTTP), 5 tests d'intégration, 1 scénario e2e |
| T5 Analyse (code) | Schéma d'extraction v1 et prompt `offer-extract-v1` ; contrôle déterministe des citations (une citation introuvable déclasse l'exigence en « incertaine ») ; versions d'analyse ; corrections journalisées ; qualifier / écarter ; relance manuelle ; traitement `offer.analyze` dans le worker (reprises, budget, refus) ; balayage planifié des analyses bloquées ; fiche avec extrait source surligné | 9 + 2 tests unitaires, 10 tests d'intégration (dont import → worker → offre analysée), 4 scénarios e2e |

Dernière exécution locale : `lint` ✓, `typecheck` ✓, `test` 112/112 ✓, `build` ✓, `test:e2e` 22/22 ✓ (bureau et mobile). CI GitHub : verte sur T1, T2, T4 ; T5 et IA multi-fournisseurs à confirmer.

## En cours

Rien.

## Pas encore fait

- T5, mesure réelle : le jeu d'évaluation compte 6 offres annotées sur les 30 prévues, et n'a jamais été exécuté contre un modèle (aucune clé). Le critère « ≥ 90 % des exigences obligatoires retrouvées » n'est donc **pas encore vérifié**, ni pour Claude ni pour les modèles gratuits.
- T3 Profil maître, T6 à T11.
- Le tableau de bord affiche un état vide : aucune métrique n'est encore calculée.

## Aucun appel IA réel effectué

Les clients Claude et compatibles OpenAI sont testés avec un faux client et un faux serveur HTTP local. Aucune clé n'est configurée dans cet environnement et aucun fournisseur réel n'a été appelé. Les sites des fournisseurs n'étaient pas joignables depuis cet environnement : URL d'API, limites gratuites et conditions d'usage des données proviennent de sources secondaires datées d'octobre 2026 et restent **à vérifier** (`npm run llm:check` le fera pour les URL et les modèles). Sans fournisseur actif, le worker laisse les analyses en file et la fiche offre l'indique.

## Problèmes connus

- `npm audit` signale 5 vulnérabilités « high » dans `micromatch`, dépendance de développement d'`eslint-config-next` uniquement (non embarquée en production). À suivre lors de la prochaine version d'`eslint-config-next`.
- Sur mobile, la navigation s'affiche en entier au-dessus du contenu : à compacter (menu repliable) avant usage quotidien sur téléphone.
- `next start` avertit que `output: "standalone"` attend `node .next/standalone/server.js` : sans effet sur les tests, à utiliser dans l'image de production.
- La récupération d'URL contourne le proxy HTTP éventuel de l'environnement (connexion directe contrôlée) : à vérifier sur l'hébergement cible.

## Décisions en attente de ton arbitrage

1. **Consentement IA pour le CV** : accepter que le contenu du CV (sans coordonnées) soit envoyé à l'API Claude. Bloque T3.
2. **Clés des fournisseurs gratuits** : créer au moins une clé (Groq et OpenRouter recommandés, voir ci-dessous), choisir un modèle par fournisseur, renseigner `<P>_API_KEY` et `<P>_MODEL` dans les secrets de l'environnement, puis lancer `npm run llm:check`. Bloque l'exécution réelle de T5, pas son développement.
3. **Données personnelles et offres gratuites** : décider si un fournisseur gratuit peut recevoir ton CV (`<P>_ALLOW_PERSONAL_DATA=true`). Recommandation : non pour Gemini gratuit et Mistral Experiment (réutilisation des données), modèle local ou API payante pour le CV.
4. **Hébergement** : PaaS UE ou Cloud Run + Cloud SQL.

## Prochaine étape

1. Dès qu'une clé est disponible : `npm run llm:check`, puis `npm run eval:offers -- --yes --provider <id>` pour chaque fournisseur (6 requêtes de quota chacun), et ajuster le prompt si le rappel est sous 90 %.
2. T3 — profil maître (import du CV), après ta décision sur le consentement.
3. En attendant ces deux points : compléter le jeu d'évaluation à 30 offres et compacter la navigation mobile.
