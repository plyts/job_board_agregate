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
| IA | Claude seul ; plusieurs fournisseurs ; modèle local | **Routeur multi-fournisseurs** (ADR 0006) : API compatibles OpenAI (Groq, OpenRouter, Gemini, Mistral, Cerebras, local) et Claude, essayés dans un ordre configurable, sorties validées par Zod | Qualité variable selon le modèle, quotas gratuits | Qualité mesurée insuffisante sur le jeu d'évaluation |
| Recherche | Postgres full-text ; pgvector ; moteur dédié | **Postgres full-text + trigrammes** au MVP | Pas de sémantique | Mesure sur jeu d'évaluation montrant un gain de rappel (V2 : pgvector) |
| Export CV | react-pdf ; HTML → PDF via Chromium ; DOCX ; `pdf-lib` | **PDF texte par `pdf-lib` + DOCX (`docx`), générés à la demande** (ADR 0008) | Mise en page simple, une colonne | — |
| Auth | Auth.js, Better Auth ; sessions en base | **Sessions en base, sans inscription publique** (ADR 0005), cookie `HttpOnly; Secure; SameSite=Lax`, scrypt | Pas d'OAuth ni de MFA au MVP | Passage au multi-utilisateur ou exposition publique |

## Modules

Interfaces utilisateur : pages en Server Components, mutations en Server Actions (vérification de session dans chaque action). Les contrats de `API.md` décrivent les entrées et sorties de ces actions ; une API HTTP publique n'est pas exposée au MVP.

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
| *(synchrone)* récupération d'URL | Import par URL | URL canonique vérifiée avant tout appel réseau | Faite pendant la requête (5 s max) pour un retour immédiat ; refus robots/CGU/adresse interne → l'utilisateur colle le texte, l'URL est conservée |
| `offer.analyze` | Offre nouvelle | Clé = `sha256(texte normalisé) + version du schéma + version du prompt` ; résultat en cache | 3 essais, temporisation 30 s / 2 min / 10 min, puis « échec » visible |
| `profile.extract` | Import de CV | Clé = empreinte du fichier | idem |
| `match.compute` | Matching demandé, ou recontrôle d'une version de CV (`cv_version_id`) | Clé = matching | idem |
| `cv.suggest` | Demande de suggestions dans l'éditeur | Clé = brouillon | idem ; sans fournisseur autorisé pour le CV, échec immédiat et message clair (l'éditeur reste utilisable à la main) |
| *(pg-boss)* expiration | Continu | — | Une tâche active au-delà de `expireInSeconds` est reprise ou marquée en échec par pg-boss : pas de watchdog maison |
| `reminders.due` | Tous les matins | — | — |

L'enregistrement métier et la mise en file se font dans **la même transaction** (pg-boss reçoit la connexion de la transaction) : pas de tâche orpheline ni d'offre sans analyse planifiée. Les files utilisent la politique `exclusive` avec `singletonKey` : au plus une tâche en attente ou en cours par objet.

## Récupération d'une page (import par URL)

- Adresse vérifiée **au moment de la connexion** (résolution DNS contrôlée dans l'agent HTTP) : seules les adresses unicast publiques sont joignables, y compris après redirection ; ports 80/443 uniquement.
- `robots.txt` respecté pour l'agent `JobPilotBot` ; domaines dont les conditions interdisent la collecte (LinkedIn, Indeed) refusés d'office.
- 5 s de délai, 2 Mo maximum, 3 redirections, contenu HTML ou texte uniquement.
- Extraction : annonce structurée schema.org `JobPosting` (JSON-LD) en priorité, sinon contenu principal de la page sans scripts ni navigation.

## Pipeline IA

1. **Entrée non fiable** : le texte importé est placé dans un bloc délimité ; le prompt système précise qu'il s'agit de données. Aucun outil n'est exposé au modèle.
2. **Sortie structurée** : schéma JSON imposé, validé par Zod ; une sortie invalide est une erreur (nouvel essai), jamais corrigée « à la main ».
3. **Ancrage** : chaque champ extrait porte un `quote` ; le serveur vérifie que la citation existe réellement dans le texte source (correspondance normalisée), sinon le champ passe en INCERTAIN.
4. **Matching en deux temps** : règles déterministes (années à partir des dates, lieu, contrat, exclusions) puis jugement du modèle exigence par exigence, avec obligation de citer des identifiants d'éléments du profil. Le **score est calculé par le code** à partir des catégories et des poids.
5. **Garde-fou CV** (ADR 0008) : une suggestion doit référencer des éléments du profil, sinon elle est écartée sans être affichée (et refusée par une contrainte SQL) ; celle qui ajoute un chiffre ou un mot-clé technique de l'offre absent de sa source est bloquée et affichée avec sa raison. Le même contrôle des faits, déterministe, tourne dans l'éditeur et avant la finalisation.
6. **Traçabilité** : chaque tentative est journalisée dans `llm_calls` (fournisseur, modèle, versions de prompt et schéma, jetons, coût, durée, empreinte d'entrée) sans le contenu.
7. **Routage** : fournisseurs essayés dans l'ordre de `LLM_PROVIDERS` ; repli sur le suivant en cas de 429, quota journalier atteint, erreur ou sortie invalide ; données personnelles réservées aux fournisseurs autorisés.

## Observabilité

Logs JSON structurés (pino) avec identifiant de corrélation propagé du web au worker ; métriques dérivées des tables (`llm_calls`, `sync_runs`, `application_events`) ; pas de service tiers au MVP.

## Déploiement (à confirmer)

Un conteneur web + un conteneur worker + PostgreSQL managé + stockage objet. Cible proposée : un PaaS européen ou Cloud Run + Cloud SQL en région UE. **Décision en attente** (budget, voir PROGRESS.md).
