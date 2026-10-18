# Architecture

## Vue d'ensemble

Monolithe modulaire en TypeScript : une seule base de code, deux processus.

```
┌──────────────────────── Navigateur ────────────────────────┐
│ Next.js (App Router) · React · Tailwind                    │
└──────────────┬─────────────────────────────────────────────┘
               │ HTTPS, cookie de session
┌──────────────▼─────────────── Processus web ───────────────┐
│ Route handlers / Server Actions  →  modules métier         │
│ (validation Zod, auth, autorisation par user_id)           │
└──────┬───────────────────────────────┬─────────────────────┘
       │ SQL (transactions)            │ enqueue (même transaction)
┌──────▼──────────┐          ┌─────────▼──────── Processus worker ─┐
│ PostgreSQL 16   │◄────────►│ pg-boss : analyse, matching,        │
│ données + file  │          │ export PDF, nettoyage, tâches bloq. │
└─────────────────┘          └──────┬───────────────┬──────────────┘
                                    │               │
                           ┌────────▼───┐   ┌───────▼────────┐
                           │ Stockage   │   │ API Claude     │
                           │ objet (S3) │   │ (sorties JSON  │
                           │ CV, offres │   │  validées Zod) │
                           └────────────┘   └────────────────┘
```

## Choix structurants

| Besoin | Options étudiées | Choix | Compromis | Changer si… |
|---|---|---|---|---|
| Application | Next.js seul ; Next + API Go ; Next + FastAPI | **Next.js 16 + TypeScript, un seul langage** (ADR 0001) | Moins adapté au calcul lourd | Besoin d'OCR, de modèles locaux ou de parsing PDF hors portée de JS |
| Données | PostgreSQL ; SQLite ; MongoDB | **PostgreSQL 16** | Une instance à exploiter | — |
| Accès BD | Prisma ; Drizzle ; SQL brut | **Drizzle ORM + migrations SQL versionnées** | Moins de magie que Prisma | Équipe plus large habituée à Prisma |
| Tâches asynchrones | Airflow ; BullMQ + Redis ; pg-boss | **pg-boss** sur PostgreSQL (ADR 0002) | Débit limité (largement suffisant : ~10³ tâches/jour) | > 50 tâches/s soutenues ou DAG complexes |
| Documents | Disque local ; S3 compatible | **S3 compatible** (disque local en dev, même interface) | Une dépendance de plus en prod | — |
| IA | Claude ; autre fournisseur ; modèle local | **Claude via SDK officiel**, sorties structurées validées par Zod, derrière une interface `LlmClient` | Dépendance fournisseur | Coût ou qualité insuffisants mesurés sur le jeu d'évaluation |
| Recherche | Postgres full-text ; pgvector ; moteur dédié | **Postgres full-text + trigrammes** au MVP | Pas de sémantique | Mesure sur jeu d'évaluation montrant un gain de rappel (V2 : pgvector) |
| Export CV | react-pdf ; HTML → PDF via Chromium ; DOCX | **Gabarit HTML → PDF (Chromium) + DOCX (lib `docx`)** | Chromium dans le worker | — |
| Auth | Maison ; bibliothèque éprouvée | **Bibliothèque éprouvée** (Auth.js ou Better Auth, choix en T1 après vérification de compatibilité Next 16), sessions en base, cookie `HttpOnly; Secure; SameSite=Lax` | — | — |

## Modules

Chaque module expose une API TypeScript (`src/modules/<nom>/index.ts`) ; les autres modules ne lisent jamais ses tables directement.

| Module | Responsabilité | Tables principales |
|---|---|---|
| `identity` | Auth, sessions, consentements | `users`, `sessions`, `consents` |
| `profile` | Import du CV, extraction, versions du profil maître, compétences et preuves | `candidate_profiles`, `profile_versions`, `experiences`, `skills`, `skill_evidence` |
| `offers` | Import, normalisation, dédoublonnage, entreprises | `job_offers`, `companies`, `job_sources`, `sync_runs` |
| `analysis` | Extraction structurée des offres | `job_requirements`, `offer_analyses` |
| `matching` | Évaluation par exigence, score | `match_analyses`, `match_items` |
| `cv` | Versions personnalisées, suggestions, diff, export, recontrôle | `cv_versions`, `cv_suggestions` |
| `applications` | Candidatures, documents envoyés, événements, relances, Kanban | `applications`, `application_documents`, `application_events`, `reminders`, `board_columns` |
| `metrics` | Agrégats du tableau de bord à partir des événements | vues SQL |
| `connectors` | Interface commune des sources (V2) | `job_sources`, `sync_runs` |
| `platform` | LLM, stockage, file, logs, budget | `llm_calls`, `pgboss.*` |

## Flux asynchrones

| Tâche | Déclencheur | Idempotence | Échec |
|---|---|---|---|
| `offer.fetch` | Import par URL | Clé = URL canonique | Refus robots/CGU → état « texte requis », pas de nouvel essai |
| `offer.analyze` | Offre nouvelle | Clé = `sha256(texte normalisé) + version du schéma + version du prompt` ; résultat en cache | 3 essais, temporisation 30 s / 2 min / 10 min, puis « échec » visible |
| `profile.extract` | Import de CV | Clé = empreinte du fichier | idem |
| `match.compute` | Analyse terminée, nouvelle version de profil ou de CV | Clé = (offre, version de document) | idem |
| `cv.export` | Demande d'export | Clé = (version, format) | idem |
| `jobs.watchdog` | Toutes les 5 min | — | Tâche active > 5 min → remise en file + log |
| `reminders.due` | Tous les matins | — | — |

L'enregistrement métier et la mise en file se font dans **la même transaction** (pg-boss partage la base) : pas de tâche orpheline ni d'offre sans analyse planifiée.

## Pipeline IA

1. **Entrée non fiable** : le texte importé est placé dans un bloc délimité ; le prompt système précise qu'il s'agit de données. Aucun outil n'est exposé au modèle.
2. **Sortie structurée** : schéma JSON imposé, validé par Zod ; une sortie invalide est une erreur (nouvel essai), jamais corrigée « à la main ».
3. **Ancrage** : chaque champ extrait porte un `quote` ; le serveur vérifie que la citation existe réellement dans le texte source (correspondance normalisée), sinon le champ passe en INCERTAIN.
4. **Matching en deux temps** : règles déterministes (années à partir des dates, lieu, contrat, exclusions) puis jugement du modèle exigence par exigence, avec obligation de citer des identifiants d'éléments du profil. Le **score est calculé par le code** à partir des catégories et des poids.
5. **Garde-fou CV** : une suggestion doit référencer des éléments du profil ; le serveur rejette toute suggestion qui introduit une compétence, un chiffre, une date ou un niveau absent de ces éléments.
6. **Traçabilité** : chaque appel est journalisé dans `llm_calls` (modèle, versions de prompt et schéma, tokens, coût, durée, empreinte d'entrée) sans le contenu personnel.

## Observabilité

Logs JSON structurés (pino) avec identifiant de corrélation propagé du web au worker ; métriques dérivées des tables (`llm_calls`, `sync_runs`, `application_events`) ; pas de service tiers au MVP.

## Déploiement (à confirmer)

Un conteneur web + un conteneur worker + PostgreSQL managé + stockage objet. Cible proposée : un PaaS européen ou Cloud Run + Cloud SQL en région UE. **Décision en attente** (budget, voir PROGRESS.md).
