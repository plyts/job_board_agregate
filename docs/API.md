# Contrats d'interface

> **Implémentation au MVP** : l'interface appelle des Server Actions Next.js qui exposent les mêmes entrées et sorties que les routes ci-dessous ; seules `/api/health` et les futurs téléchargements de fichiers sont de vraies routes HTTP. Implémenté à ce jour : connexion/déconnexion, `importOfferAction` (≈ `POST /api/offers` et `/api/offers/files`), liste et détail des offres.

Toutes les routes exigent une session ; toute entrée est validée par un schéma Zod partagé (`src/contracts`). Erreurs au format :

```json
{ "error": { "code": "OFFER_DUPLICATE", "message": "Cette offre existe déjà.", "details": { "duplicateOf": "uuid" }, "correlationId": "…" } }
```

## Routes HTTP (MVP)

Implémentation actuelle : les candidatures (`src/app/(app)/candidatures/actions.ts` : créer depuis une offre, déplacer, confirmer l'envoi avec date, canal et fichier, prochaine action, notes) et l'éditeur de CV passent par des Server Actions (`src/app/(app)/offres/[id]/cv/actions.ts`), validées par Zod et filtrées par la session : créer le brouillon, l'enregistrer (`revision` attendue, refus si périmée), demander des suggestions, accepter / modifier / refuser / annuler une suggestion (refus avec message si le contrôle des faits échoue), restaurer une version, repartir du profil courant, recontrôler (fige une version puis lance son matching), finaliser (refus avec la liste des écarts). Les routes ci-dessous restent le contrat cible pour un client externe.

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
| GET | `/api/cv/:versionId/export?format=pdf\|docx` | Télécharge une version enregistrée ou finalisée (jamais un brouillon), en pièce jointe | `200` fichier / `400 INVALID_FORMAT` / `401` / `404` (brouillon, version d'un autre compte) |
| GET | `/api/applications/documents/:documentId` | Fichier réellement envoyé, en pièce jointe, après vérification de son SHA-256 | `200` fichier / `401` / `404` / `409 INTEGRITY_CHECK_FAILED` (fichier altéré ou absent) |
| GET | `/api/applications/:applicationId/letter?format=pdf\|docx` | Aperçu de la lettre de motivation en brouillon, en pièce jointe | `200` fichier / `400` / `401` / `404` |
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

## Interface commune des connecteurs (implémentée, ADR 0011)

```ts
// src/modules/sources/types.ts
interface SearchConnector {                    // France Travail, Adzuna, pages carrières
  search(query: SearchQuery): Promise<{ offers: IncomingOffer[]; total: number | null }>;
  test(): Promise<void>;                       // appel minimal avant d'enregistrer la source
}
type SearchQuery = { keywords: string; location: string | null; radiusKm: number | null;
  contracts: string[]; publishedWithinDays: number | null; limit: number };

// src/modules/offers/ingest.ts
type IncomingOffer = { origin: ConnectedOrigin; board: string; externalId: string | null;
  url: string | null; relatedUrls?: string[]; title: string; company: string | null;
  location: string | null; publishedAt: Date | null; text: string; complete: boolean };
ingestOffer(deps, userId, offer): Promise<{ kind: "created" | "duplicate" | "seen" | "skipped"; … }>;
```

Chaque connecteur est une fonction pure de normalisation testée sur fixtures, plus un client HTTP qui respecte le débit de la source (`throttle`) et traduit ses erreurs en `SourceError` (`auth`, `quota`, `unavailable`, `invalid`, message sans secret). Les alertes e-mail ne sont pas un `SearchConnector` : `syncEmailAlerts` lit la boîte IMAP depuis le dernier UID traité et passe chaque message à `extractOffers` (`src/modules/sources/email/`).

`ingestOffer` est le seul point d'entrée vers les offres : dédoublonnage (même site et identifiant → « vue », URL canonique, empreinte ou intitulé + entreprise + ville sur 90 jours → doublon), création en transaction avec mise en file de l'analyse si le texte est complet, sinon statut `incomplete`. Ajouter une source = un fichier de connecteur, ses fixtures et ses tests, sans toucher aux modules `offers` ou `analysis`. Chaque recherche, recherche enregistrée ou relève de boîte enregistre un `sync_runs`.
