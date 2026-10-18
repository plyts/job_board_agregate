# Contrats d'interface

> **Implémentation au MVP** : l'interface appelle des Server Actions Next.js qui exposent les mêmes entrées et sorties que les routes ci-dessous ; seules `/api/health` et les futurs téléchargements de fichiers sont de vraies routes HTTP. Implémenté à ce jour : connexion/déconnexion, `importOfferAction` (≈ `POST /api/offers` et `/api/offers/files`), liste et détail des offres.

Toutes les routes exigent une session ; toute entrée est validée par un schéma Zod partagé (`src/contracts`). Erreurs au format :

```json
{ "error": { "code": "OFFER_DUPLICATE", "message": "Cette offre existe déjà.", "details": { "duplicateOf": "uuid" }, "correlationId": "…" } }
```

## Routes HTTP (MVP)

| Méthode | Route | Rôle | Réponse |
|---|---|---|---|
| POST | `/api/profile/imports` | Téléverse un CV (multipart, PDF/DOCX ≤ 10 Mo) | `202 { importId, profileVersionId (draft) }` |
| GET | `/api/profile/versions/:id` | Version du profil avec champs incertains | `200 ProfileVersion` |
| PATCH | `/api/profile/versions/:id/fields` | Corrige un ou plusieurs champs d'un brouillon | `200` |
| POST | `/api/profile/versions/:id/validate` | Valide le brouillon (refusé s'il reste des champs incertains) | `200` / `409 UNRESOLVED_FIELDS` |
| POST | `/api/offers` | Import `{ mode: "url" \| "text", url?, text? }` | `202 { offerId, status }` / `409 OFFER_DUPLICATE` / `422 FETCH_NOT_ALLOWED` |
| POST | `/api/offers/files` | Import de fichier(s) PDF/.eml | `202 { offers: [...] }` |
| GET | `/api/offers` | Liste filtrée (`q`, `status`, `contract`, `remote`, `seniority`, `publishedAfter`, `minScore`, `cursor`) | `200 { items, nextCursor }` |
| GET | `/api/offers/:id` | Offre + analyse courante + exigences | `200` |
| PATCH | `/api/offers/:id/requirements/:reqId` | Correction utilisateur | `200` |
| POST | `/api/offers/:id/decision` | `{ decision: "qualify" \| "discard", reason? }` | `200` |
| POST | `/api/offers/:id/analyze` | Relance manuelle (idempotente) | `202` |
| POST | `/api/matches` | `{ offerId, cvVersionId?, weights? }` | `202 { matchId }` ou `200` si en cache |
| GET | `/api/matches/:id` | Score, facteurs, items | `200 MatchAnalysis` |
| POST | `/api/cv-versions` | Crée un brouillon pour une offre à partir du profil courant | `201` |
| GET | `/api/cv-versions/:id` | Contenu + suggestions | `200` |
| PATCH | `/api/cv-versions/:id/suggestions/:sid` | `{ state, after? }` | `200` / `422 SUGGESTION_UNSOURCED` |
| PATCH | `/api/cv-versions/:id/content` | Réordonnancement, édition libre (vérifiée au recontrôle) | `200` |
| GET | `/api/cv-versions/:a/diff/:b` | Diff structuré | `200` |
| POST | `/api/cv-versions/:id/recheck` | Recontrôle (score + vérification des faits) | `202` |
| POST | `/api/cv-versions/:id/finalize` | Fige la version (refusé si vérification en échec) | `200` / `409 FACT_CHECK_FAILED` |
| POST | `/api/cv-versions/:id/exports` | `{ format: "pdf" \| "docx" }` | `202 { exportId }` |
| POST | `/api/applications` | `{ offerId, cvVersionId? }` | `201` / `409 APPLICATION_EXISTS` |
| PATCH | `/api/applications/:id` | Statut, prochaine action, notes | `200` (crée un événement) |
| POST | `/api/applications/:id/send-confirmation` | `{ sentAt, channel, documentId }` — fige le document | `200` |
| GET | `/api/board` | Colonnes + cartes | `200` |
| GET | `/api/dashboard?period=day\|week` | Agrégats | `200` |

## Schéma d'extraction d'une offre (extrait)

```ts
const Provenance = z.enum(["explicit", "inferred", "uncertain"]);

const Requirement = z.object({
  kind: z.enum(["mission", "hard_skill", "soft_skill", "tech", "years", "seniority", "degree",
                "cert", "language", "contract", "location", "remote", "availability", "salary", "clearance"]),
  importance: z.enum(["mandatory", "preferred", "condition"]),
  label: z.string().min(1).max(120),
  value: z.unknown(),                  // typé par `kind` (ex. years → { min: number })
  provenance: Provenance,
  quote: z.string().max(400).nullable(), // obligatoire si explicit, vérifiée dans le texte
  rationale: z.string().max(300).nullable(), // obligatoire si inferred ou uncertain
});

const OfferExtraction = z.object({
  schemaVersion: z.literal(1),
  title: z.string(), company: z.string().nullable(),
  requirements: z.array(Requirement).max(60),
  notMentioned: z.array(z.string()),  // champs absents du texte : jamais estimés
});
```

## Interface commune des connecteurs (V2, définie dès le MVP)

```ts
interface JobConnector {
  readonly id: string;                         // "manual-url", "france-travail", …
  readonly access: {
    method: "official_api" | "public_feed" | "user_forwarded_email" | "user_input";
    termsUrl: string; verifiedAt: string;      // date de la vérification des CGU
    rateLimit: { requests: number; perSeconds: number };
  };
  connectionStatus(ctx: ConnectorContext): Promise<"connected" | "not_connected" | "revoked" | "error">;
  fetchPage(query: SearchQuery, cursor: string | null, ctx: ConnectorContext):
    Promise<{ items: RawOffer[]; nextCursor: string | null }>;
  normalize(raw: RawOffer): NormalizedOffer;   // fonction pure, testée sur fixtures
}
```

Le cœur métier ne connaît que `NormalizedOffer`. Ajouter une source = ajouter un fichier de connecteur, ses fixtures et ses tests, sans toucher aux modules `offers` ou `analysis`. Le planificateur applique la limite de débit, les reprises et enregistre un `SyncRun` par exécution.
