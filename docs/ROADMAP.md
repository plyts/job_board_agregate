# Roadmap et plan de livraison

Priorisation MoSCoW. Chaque tâche n'est commencée que si la précédente est verte (tests exécutés).

## Plan de livraison MVP

| # | Tâche | Dépend de | Modules / fichiers | Critères d'acceptation | Tests | Risques |
|---|---|---|---|---|---|---|
| T0 | **Socle du dépôt** : Next.js 16, TS strict, ESLint, Vitest, Playwright, CI, `.env.example`, structure `src/modules` | — | racine, `.github/workflows/ci.yml` | `lint`, `typecheck`, `test`, `build` passent en CI ; page d'accueil sert | Test fumée | Changements de Next 16 : lire la doc embarquée |
| T1 | **Base et auth** : PostgreSQL + Drizzle, première migration (`users`, `sessions`), connexion, middleware d'autorisation | T0 | `src/db`, `src/modules/identity` | Routes protégées → 401 sans session ; migration montée sur base vide | Intégration + contrats | Choix de la lib d'auth |
| T2 | **Plateforme** : file pg-boss + worker, stockage objet, `LlmClient` (timeouts, reprises, budget, journal `llm_calls`), logs structurés | T1 | `src/modules/platform`, `worker/` | Tâche rejouée = un seul effet ; budget dépassé → tâche différée, visible | Intégration (idempotence, reprise, watchdog) | — |
| T3 | **Profil maître** : import PDF/DOCX, extraction, brouillon, correction, validation, versions, compétences et preuves | T2 | `src/modules/profile`, écran 7 | US1, US2 | Unitaires (parsing), éval sur 3 CV fictifs, e2e import | PDF mal structurés |
| T4 | **Import d'offres** : URL (robots.txt, SSRF), texte, fichier ; normalisation, dédoublonnage, liste filtrée | T2 | `src/modules/offers`, écran 4 | US3 | Unitaires (canonisation, empreinte), sécurité SSRF, intégration unicité | CGU des sites |
| T5 | **Analyse structurée** : schéma v1, prompt v1, vérification des citations, corrections, jeu d'évaluation | T4 | `src/modules/analysis`, `eval/`, écran 5 | US4 ; ≥ 90 % des exigences obligatoires du jeu retrouvées ; 0 citation inventée acceptée | Éval + unitaires vérification | Qualité réelle du modèle (H1) |
| T6 | **Matching et score** : règles déterministes, jugement par exigence, score pondéré, explication | T3, T5 | `src/modules/matching`, écran 6 | US5 ; changement de poids sans appel IA | Unitaires score, éval matching (H2) | Faux positifs |
| T7 | **Éditeur de CV** : versions, suggestions sourcées et garde-fou, diff, restauration, réordonnancement | T6 | `src/modules/cv`, écran 8 | US6 ; suggestion non sourcée rejetée (422) | Unitaires garde-fou et diff, e2e | Complexité de l'éditeur : commencer par des blocs, pas de texte riche |
| T8 | **Recontrôle et export** : nouveau score, vérification des faits, finalisation, export PDF/DOCX | T7 | `src/modules/cv`, écran 9 | US7 ; finalisation bloquée si écart factuel | Unitaires vérif, rendu PDF | Chromium dans le worker |
| T9 | **Candidatures et Kanban** : fiche, confirmation d'envoi, documents figés, événements, relances, Kanban 12 colonnes, vue tableau | T8 | `src/modules/applications`, écrans 2-3 | US8 | Intégration triggers, e2e glisser-déposer et clavier | — |
| T10 | **Tableau de bord** : agrégats depuis les événements, objectif quotidien, coût IA | T9 | `src/modules/metrics`, écran 1 | US9 ; chiffres égaux à un recalcul SQL indépendant | Intégration | — |
| T11 | **Durcissement** : test de charge 100 offres, axe-core, sauvegardes, export/suppression du compte | T10 | — | NFR du PRD mesurées et documentées | Charge, a11y | — |

Première tâche exécutable sans ambiguïté : **T0**.

## V2 — Automatisation (Should)

Connecteur France Travail (après vérification de l'API et des CGU), import d'alertes e-mail transférées, flux publics d'ATS, synchronisation planifiée, recherches enregistrées exécutées périodiquement, dédoublonnage par similarité, vues calendrier / entreprise / aujourd'hui, relances avancées, recherche sémantique (pgvector) si le jeu d'évaluation montre un gain.

## V3 — Optimisation (Could)

Connecteurs supplémentaires sous accord, traitement par lots, recommandations, comparaison de modèles, optimisation des coûts, analyses de conversion, aide aux lettres de motivation.

## Won't (sans changement de contexte)

Scraping de plateformes qui l'interdisent, envoi automatique de candidatures sans intégration autorisée, microservices.
