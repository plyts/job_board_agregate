# Modèle de données

PostgreSQL 16. Toutes les tables métier ont `id uuid`, `user_id uuid not null` (sauf `users`), `created_at`, `updated_at`. Toute requête applicative filtre par `user_id` côté serveur.

## Entités et relations

```
users 1─┬─* candidate_profiles 1─* profile_versions 1─┬─* experiences 1─* experience_items
        │                                             ├─* skills *─* skill_evidence ─→ (experience_item | project | education | certification | declaration)
        │                                             ├─* educations, certifications, projects, languages
        │                                             └─1 preferences
        ├─* job_sources 1─* sync_runs
        ├─* search_profiles
        ├─* companies 1─* job_offers 1─* job_requirements
        │                     │ 1─* offer_analyses
        │                     └─* match_analyses 1─* match_items ─→ job_requirements, (profile elements)
        ├─* cv_versions ─→ profile_versions (base), job_offers (cible), cv_versions (parent)
        │        └─* cv_suggestions
        └─* applications ─→ job_offers, cv_versions
                 ├─* application_documents   (immuables une fois `sent`)
                 ├─* application_events      (journal append-only)
                 ├─* reminders
                 └─* contacts
llm_calls (journal de tous les appels IA)
```

## Profil maître (ADR 0007)

`profile_versions` (`version`, `status` draft|validated, `content` JSONB, `quality` (rapport de bonnes pratiques figé à la validation, ADR 0009), `uncertainties`, `origin` manual|import|edit, `import_status`, `source_file_key`, `source_text`, `privacy_report` (décomptes de données personnelles masquées avant l'envoi et retirées de la réponse, règles `PII_RULES_VERSION`)) remplace les tables `candidate_profiles`, `experiences`, `skills`, `skill_evidence`, etc. du schéma initial. Invariants : version validée immuable (trigger), à une exception près : l'effacement du CV source (`source_text`, `source_file_key` mis à NULL) après la durée de conservation, tout autre champ restant identique (migration 0018) ; un seul brouillon par utilisateur, preuves des compétences pointant vers des éléments existants.

## Tables clés

| Table | Colonnes notables | Invariants |
|---|---|---|
| `profile_versions` | `profile_id`, `version int`, `status` (draft, validated), `source_file_key`, `extracted_at` | Une version `validated` est immuable ; la version courante = la plus haute validée |
| `skills` | `name`, `normalized_name`, `level` (mastered, occasional, learning, unconfirmed) | `level ≠ unconfirmed` ⇒ au moins une ligne `skill_evidence` |
| `skill_evidence` | `skill_id`, `kind`, `target_id`, `quote` | `target_id` appartient à la même version de profil |
| `job_offers` | `source` (url, text, file), `original_url`, `canonical_url`, `raw_text` (texte nettoyé, 60 000 caractères max), `content_hash`, `source_file_key`, `title`, `company_id`, `location`, `published_at`, `last_checked_at`, `status` (queued, analyzing, analyzed, failed, qualified, discarded), `status_reason` | Unique `(user_id, content_hash)` ; unique partielle `(user_id, canonical_url) where canonical_url is not null`. Un doublon ne crée pas de ligne : il est tracé dans `offer_imports` |
| `offer_imports` | `offer_id`, `source`, `outcome` (created, duplicate) | Une ligne par import tenté : base des métriques « collectées » et « taux de doublons » |
| `companies` | `name`, `normalized_name` | Unique `(user_id, normalized_name)` ; suffixes juridiques ignorés (SAS, SARL…) |
| `job_requirements` | `offer_id`, `analysis_id`, `kind` (mission, hard_skill, soft_skill, tech, years, seniority, degree, cert, language, contract, location, remote, availability, salary, clearance), `importance` (mandatory, preferred, condition), `value jsonb`, `provenance` (explicit, inferred, uncertain), `quote`, `quote_start`, `quote_end` | `provenance = explicit` ⇒ `quote` présente dans le texte source |
| `offer_analyses` | `offer_id`, `schema_version`, `prompt_version`, `model`, `llm_call_id`, `status` | Une seule analyse `current` par offre |
| `offer_events` | `offer_id`, `type` (qualified, discarded), `occurred_at` | Append-only (trigger) ; écrit par la même instruction SQL que la décision ; base des métriques « qualifiées » et « traitées » ; reprise de l'existant à la migration (datée de la dernière mise à jour de l'offre) |
| `match_analyses` | `offer_id`, `offer_analysis_id`, `profile_version_id`, `cv_version_id null`, `state` (current, superseded), `status` (pending, done, failed), `mode` (model, rules_only), `weights jsonb`, `score`, `factors jsonb`, `llm_call_id` | Un seul matching courant par offre ; changer les poids recalcule le score sans appel IA |
| `match_items` | `match_id`, `requirement_id`, `kind` et `importance` figés, `category` (confirmed, partial, to_confirm, not_demonstrated, potential_incompatibility, not_applicable), `evidence jsonb` [{id, label, text}], `rationale`, `action`, `source` (rule, model, guard) | `category ∈ {confirmed, partial}` ⇒ `evidence` non vide (garde-fou serveur) |
| `cv_versions` | `offer_id`, `base_profile_version_id`, `version int`, `status` (draft, saved, finalized), `content jsonb` (sélection ordonnée d'éléments du profil, identifiants sources), `revision`, `suggest_status`, `finalized_at`, `quality` (rapport de bonnes pratiques figé à l'enregistrement, ADR 0009) | Un seul brouillon par offre (unique partielle) ; `(offer_id, version)` unique ; `saved` et `finalized` immuables (trigger), seul le passage `saved → finalized` à contenu identique est permis |
| `cv_suggestions` | `cv_version_id` (brouillon), `position`, `kind` (rephrase, summary, reorder_items, include), `target_id`, `text`, `order`, `source_ids jsonb`, `rationale`, `covers`, `state` (pending, accepted, rejected, edited, blocked), `block_reason`, `before jsonb`, `llm_call_id` | `source_ids` non vide (contrainte `CHECK`) ; `before` permet d'annuler une décision |
| `applications` | `offer_id`, `status` (12 étapes : new_offer, to_analyze, qualified, cv_to_adapt, ready, sent, followed_up, hr_interview, tech_interview, offer_received, rejected, abandoned), `cv_version_id`, `match_score` figé, `next_action`, `next_action_at`, `follow_up_days`, `sent_at`, `channel`, `notes`, `cover_letter` (brouillon de lettre), `letter_status` (none, queued, running, done, failed), `letter_reason`, `letter_proposal jsonb` (paragraphes proposés par l'IA : type, texte, éléments du profil cités, exigences couvertes, signalements ; `llm_call_id`, version du prompt) | Unique partielle `(user_id, offer_id) where status not in ('rejected','abandoned')` ; `CHECK` : étapes d'après l'envoi ⇒ `sent_at` renseignée ; « Envoyée » n'est atteinte que par la confirmation d'envoi, qui crée dans la même transaction le document envoyé et l'événement ; offre liée non supprimable ; la proposition de lettre n'entre dans `cover_letter` que par une action de l'utilisateur, sans les paragraphes signalés |
| `application_documents` | `application_id`, `kind` (cv, cover_letter), `storage_key`, `sha256`, `size_bytes`, `file_name`, `content_type`, `cv_version_id` | Uniquement les fichiers réellement envoyés : ni `UPDATE` ni `DELETE` (trigger), sauf suppression du compte ; empreinte revérifiée à chaque téléchargement |
| `application_events` | `application_id`, `type` (created, status_changed, sent, next_action_set), `from_status`, `to_status`, `payload jsonb`, `occurred_at` | Append-only (trigger) ; source des métriques du tableau de bord |
| `application_contacts` | `application_id`, `name`, `role`, `email`, `phone`, `url` (http/https uniquement), `note` | Données de tiers saisies à la main : jamais envoyées à un modèle ; supprimées avec la candidature ou le compte |
| `board_columns` | — | Non créée : les 12 colonnes sont l'énumération `application_status` (colonnes configurables reportées) |
| `sync_runs` | `source_id`, `started_at`, `finished_at`, `status`, `fetched`, `new`, `duplicates`, `errors jsonb` | — |
| `llm_calls` | `purpose`, `provider`, `model`, `prompt_version`, `schema_version`, `input_hash`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `latency_ms`, `status` (ok, refused, truncated, invalid_output, api_error, rate_limited, budget_exceeded, quota_exhausted, no_provider), `error_code`, `pii_masked`, `pii_in_output` (décomptes, jamais les valeurs) | Une ligne par tentative et par fournisseur ; aucun contenu stocké ; coûts en USD (0 pour une offre gratuite), sans conversion inventée. Base des quotas journaliers par fournisseur |
| `ai_consents` | `provider`, `granted_at`, `revoked_at` | Preuve du consentement (RGPD art. 7) : un seul consentement actif par fournisseur (index unique partiel) ; le retrait date la ligne sans la supprimer ; condition d'envoi de données personnelles à un fournisseur externe (docs/RGPD.md) |
| `users`, `sessions`, `login_attempts` | voir ADR 0005 | `sessions.id` = SHA-256 du jeton ; sessions expirées et tentatives de plus de 30 jours purgées par le worker |

## Dédoublonnage

1. URL canonique : schéma et hôte en minuscules, suppression des paramètres de suivi (`utm_*`, `ref`, …).
2. Empreinte du texte : normalisation (casse, espaces, ponctuation) puis SHA-256.
3. L'URL canonique est vérifiée **avant** toute récupération réseau ; l'empreinte après extraction du texte.
4. V2 : similarité (trigrammes sur titre + entreprise + 500 premiers caractères) proposée à l'utilisateur, jamais fusionnée automatiquement.

## État réel des tables

Créées à ce jour (migrations `drizzle/0000` à `0019`) : `users`, `sessions`, `login_attempts`, `llm_calls`, `companies`, `job_offers`, `offer_imports`, `offer_analyses`, `job_requirements`, `requirement_corrections`, `profile_versions`, `match_analyses` (avec `cv_version_id` pour les recontrôles), `match_items`, `cv_versions`, `cv_suggestions`, `applications`, `application_documents`, `application_events`, `application_contacts`, `offer_events`, `ai_consents`. Pas de table `reminders` : la relance est la prochaine action datée de la candidature (proposée à l'envoi selon `follow_up_days`). Les autres tables de ce document restent à créer avec leur module.

## Métriques (tableau de bord)

Aucun compteur stocké : chaque chiffre est une requête sur des lignes datées, bornée par jour dans le fuseau `APP_TIME_ZONE` (Europe/Paris par défaut). Collectées et nouvelles : `offer_imports` ; analysées : `offer_analyses` ; qualifiées et traitées : `offer_events` ; CV adaptés : `cv_versions.finalized_at` ; préparées, envoyées, entretiens, refus : `application_events` ; relances en retard : `applications.next_action_at` antérieure à aujourd'hui (état courant). Un test d'intégration compare chaque valeur à un recalcul SQL indépendant.

## Migrations

Fichiers SQL numérotés générés par Drizzle Kit, relus et commités ; la CI les applique sur une base vide et échoue si le schéma TypeScript diverge des migrations commitées. Test sur instantané N-1 : à ajouter dès la première migration modifiant des données existantes. Pas de migration destructive sans étape de copie préalable.
