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
| `match_analyses` | `offer_id`, `profile_version_id`, `cv_version_id null`, `weights jsonb`, `score numeric`, `factor_scores jsonb` | Unique `(offer_id, coalesce(cv_version_id, profile_version_id), weights_hash)` |
| `match_items` | `match_id`, `requirement_id`, `category` (confirmed, partial, to_confirm, not_demonstrated, potential_incompatibility, not_applicable), `evidence jsonb` [{element_id, quote}], `rationale`, `action` | `category ∈ {confirmed, partial}` ⇒ `evidence` non vide |
| `cv_versions` | `base_profile_version_id`, `target_offer_id`, `parent_id`, `version int`, `content jsonb`, `status` (draft, finalized), `content_hash` | `finalized` ⇒ immuable |
| `cv_suggestions` | `cv_version_id`, `kind` (rephrase, reorder, emphasize), `path`, `before`, `after`, `source_refs uuid[]`, `state` (pending, accepted, rejected, edited) | `source_refs` non vide (contrainte `CHECK`) |
| `applications` | `offer_id`, `company_id`, `status`, `cv_version_id`, `match_score`, `next_action`, `next_action_at`, `sent_at null`, `channel` | Unique partielle `(user_id, offer_id) where status not in ('abandoned','rejected')` ; `status = sent` ⇒ `sent_at` et un document `sent` existent |
| `application_documents` | `application_id`, `kind` (cv, cover_letter), `role` (draft, sent), `storage_key`, `sha256`, `cv_version_id` | `role = sent` : ni `UPDATE` ni `DELETE` (trigger) |
| `application_events` | `application_id`, `type`, `from_status`, `to_status`, `payload jsonb`, `occurred_at` | Append-only (trigger) ; source unique des métriques |
| `board_columns` | `key`, `label`, `position`, `maps_to_status` | Les 12 statuts par défaut sont créés à l'inscription |
| `sync_runs` | `source_id`, `started_at`, `finished_at`, `status`, `fetched`, `new`, `duplicates`, `errors jsonb` | — |
| `llm_calls` | `purpose`, `model`, `prompt_version`, `schema_version`, `input_hash`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `latency_ms`, `status` (ok, refused, truncated, invalid_output, api_error, budget_exceeded), `error_code` | Aucun contenu personnel stocké ; coûts en USD (tarifs publics), sans conversion inventée |
| `users`, `sessions`, `login_attempts` | voir ADR 0005 | `sessions.id` = SHA-256 du jeton |

## Dédoublonnage

1. URL canonique : schéma et hôte en minuscules, suppression des paramètres de suivi (`utm_*`, `ref`, …).
2. Empreinte du texte : normalisation (casse, espaces, ponctuation) puis SHA-256.
3. L'URL canonique est vérifiée **avant** toute récupération réseau ; l'empreinte après extraction du texte.
4. V2 : similarité (trigrammes sur titre + entreprise + 500 premiers caractères) proposée à l'utilisateur, jamais fusionnée automatiquement.

## État réel des tables

Créées à ce jour (migrations `drizzle/0000` à `0002`) : `users`, `sessions`, `login_attempts`, `llm_calls`, `companies`, `job_offers`, `offer_imports`. Les autres tables de ce document restent à créer avec leur module.

## Migrations

Fichiers SQL numérotés générés par Drizzle Kit, relus et commités ; la CI les applique sur une base vide et échoue si le schéma TypeScript diverge des migrations commitées. Test sur instantané N-1 : à ajouter dès la première migration modifiant des données existantes. Pas de migration destructive sans étape de copie préalable.
