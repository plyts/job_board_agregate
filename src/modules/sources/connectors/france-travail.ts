import type { IncomingOffer } from "@/modules/offers";
import { date, requestJson, str } from "../http";
import { SourceError, type SearchConnector, type SearchOutcome, type SearchQuery } from "../types";
import { departementCode, departementOfPostalCode, fold } from "./departements";
import { searchEachGroup } from "./keywords";

/**
 * API officielle « Offres d'emploi v2 » de France Travail (francetravail.io), en OAuth2 « client credentials ».
 * Détails relevés le 19/10/2026 sur des sources secondaires, la documentation officielle n'étant pas joignable
 * depuis l'environnement de développement : à revérifier sur francetravail.io.
 * - jeton : realm /partenaire, portée « api_offresdemploiv2 o2dsoffre » ;
 * - recherche : 150 offres au plus par appel (`range` 0-149), indice maximal 1149 ;
 * - 200 = tout, 206 = page partielle (en-tête Content-Range « offres a-b/total »), 204 = aucune offre.
 */
export const FRANCE_TRAVAIL = {
  tokenUrl: "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire",
  apiUrl: "https://api.francetravail.io/partenaire/offresdemploi/v2",
  scope: "api_offresdemploiv2 o2dsoffre",
  pageSize: 150,
  maxIndex: 1149,
  /** Intervalle minimal entre deux appels (limite annoncée : quelques appels par seconde). */
  intervalMs: 400,
};

export type FranceTravailCredentials = { clientId: string; clientSecret: string };
type Endpoints = { tokenUrl: string; apiUrl: string };

const tokens = new Map<string, { token: string; expiresAt: number }>();

/** Jeton d'accès OAuth2 (client credentials), gardé en mémoire jusqu'à 30 s avant son expiration. */
export async function franceTravailToken(creds: FranceTravailCredentials, endpoints: Endpoints = FRANCE_TRAVAIL): Promise<string> {
  const cached = tokens.get(creds.clientId);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
  const res = await requestJson(endpoints.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: creds.clientId, client_secret: creds.clientSecret, scope: FRANCE_TRAVAIL.scope }).toString(),
  }).catch((err) => {
    // 400 ou 401 sur le jeton : identifiants refusés.
    if (err instanceof SourceError && (err.kind === "invalid" || err.kind === "auth")) throw new SourceError("France Travail refuse les identifiants (client_id ou client_secret)", "auth");
    throw err;
  });
  const body = res.body as { access_token?: string; expires_in?: number } | null;
  if (!body?.access_token) throw new SourceError("France Travail n'a pas délivré de jeton d'accès", "auth");
  tokens.set(creds.clientId, { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 1400) * 1000 });
  return body.access_token;
}

/** Durées acceptées par le filtre « publiée depuis » (jours). */
const PUBLISHED_STEPS = [1, 3, 7, 14, 31];

type Commune = { code: string; libelle: string; codePostal?: string };

/** Référentiel des communes : par nom, par code postal (s'il est fourni) et par code INSEE. */
type Communes = { byName: Map<string, string>; byPostal: Map<string, string>; codes: Set<string> };
let communes: { at: number; data: Communes } | null = null;

async function loadCommunes(token: string, endpoints: Endpoints): Promise<Communes> {
  if (!communes || Date.now() - communes.at > 24 * 60 * 60 * 1000) {
    const res = await requestJson(`${endpoints.apiUrl}/referentiel/communes`, { headers: { authorization: `Bearer ${token}` }, intervalMs: FRANCE_TRAVAIL.intervalMs });
    const list = Array.isArray(res.body) ? (res.body as Commune[]) : [];
    const data: Communes = { byName: new Map(), byPostal: new Map(), codes: new Set() };
    // Le premier code l'emporte pour les homonymes ; « Paris », « Lyon », « Marseille » visent la commune entière.
    for (const c of list) {
      if (!c.code) continue;
      data.codes.add(c.code.toUpperCase());
      if (c.libelle && !data.byName.has(fold(c.libelle))) data.byName.set(fold(c.libelle), c.code);
      if (c.codePostal && !data.byPostal.has(c.codePostal)) data.byPostal.set(c.codePostal, c.code);
    }
    communes = { at: Date.now(), data };
  }
  return communes.data;
}

/** Traduction d'un lieu saisi en commune France Travail (code INSEE), chargée à la demande. */
export type Places = {
  byName(name: string): Promise<string | null>;
  /** Code postal → code INSEE ; null si le référentiel ne le connaît pas. */
  byPostalCode(cp: string): Promise<string | null>;
  isCommuneCode(code: string): Promise<boolean>;
};

/** Paramètres de recherche France Travail à partir des critères communs (une seule variante de mots-clés). */
export async function searchParams(query: SearchQuery, places: Places): Promise<URLSearchParams> {
  const params = new URLSearchParams({ sort: "1" });
  // France Travail combine ses mots-clés (séparés par des virgules) : les mots d'une variante sont tous exigés.
  const words = query.keywords
    .split(/[\s,]+/)
    .map((k) => k.trim())
    .filter((k) => k.length >= 2);
  if (words.length) params.set("motsCles", words.join(","));
  if (query.location?.trim()) {
    const loc = query.location.trim();
    if (/^\d{5}$/.test(loc) || /^2[AB]\d{3}$/i.test(loc)) {
      // Cinq chiffres : un code postal (« 69003 », Lyon 3e), jamais lu comme code INSEE, qui désignerait une autre commune
      // (69003 : Albigny-sur-Saône). Seuls les codes INSEE corses (2A…, 2B…) se reconnaissent à coup sûr.
      const corsicanInsee = /^2[AB]\d{3}$/i.test(loc);
      const code = corsicanInsee ? ((await places.isCommuneCode(loc.toUpperCase())) ? loc.toUpperCase() : null) : await places.byPostalCode(loc);
      const dept = departementOfPostalCode(loc);
      if (code) params.set("commune", code);
      else if (dept) params.set("departement", dept);
      else throw new SourceError(`France Travail ne connaît pas le code « ${loc} » : indique la ville`, "invalid");
    } else {
      const dept = departementCode(loc);
      if (dept && !/^(paris|lyon|marseille)$/i.test(fold(loc))) params.set("departement", dept);
      else {
        const code = await places.byName(loc);
        if (code) params.set("commune", code);
        else if (dept) params.set("departement", dept);
        else throw new SourceError(`France Travail ne connaît pas le lieu « ${loc} » : indique une commune, un code postal ou un département`, "invalid");
      }
    }
    if (params.has("commune") && query.radiusKm) params.set("distance", String(Math.min(Math.max(query.radiusKm, 0), 100)));
  }
  const types = query.contracts.filter((c) => c !== "ALT");
  if (types.length) params.set("typeContrat", types.join(","));
  if (query.contracts.includes("ALT")) params.set("natureContrat", "E2,FS");
  if (query.publishedWithinDays) params.set("publieeDepuis", String(PUBLISHED_STEPS.find((d) => d >= query.publishedWithinDays!) ?? 31));
  return params;
}

type FtOffer = Record<string, unknown> & {
  id?: string;
  intitule?: string;
  description?: string;
  lieuTravail?: { libelle?: string };
  entreprise?: { nom?: string; description?: string };
  origineOffre?: { urlOrigine?: string; partenaires?: { url?: string }[] };
  salaire?: { libelle?: string; commentaire?: string };
  competences?: { libelle?: string; exigence?: string }[];
  formations?: { niveauLibelle?: string; domaineLibelle?: string }[];
  langues?: { libelle?: string }[];
};

/** « 69 - LYON 03 » → « Lyon 03 (69) ». */
function place(libelle: string | null): string | null {
  if (!libelle) return null;
  const m = /^(\d[\dAB]{1,2})\s*-\s*(.+)$/i.exec(libelle);
  const city = (m ? m[2]! : libelle).toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase());
  return m ? `${city} (${m[1]})` : city;
}

/** Offre France Travail → offre JobPilot : description complète et faits de l'annonce, sans rien inventer. */
export function normalizeFranceTravail(o: FtOffer): IncomingOffer | null {
  const id = str(o.id);
  const title = str(o.intitule);
  if (!id || !title) return null;
  const facts = [
    ["Entreprise", str(o.entreprise?.nom)],
    ["Lieu", str(o.lieuTravail?.libelle)],
    ["Contrat", [str(o.typeContratLibelle), str(o.dureeTravailLibelle)].filter(Boolean).join(" · ") || null],
    ["Expérience", str(o.experienceLibelle)],
    ["Qualification", str(o.qualificationLibelle)],
    ["Salaire", [str(o.salaire?.libelle), str(o.salaire?.commentaire)].filter(Boolean).join(" · ") || null],
    ["Secteur", str(o.secteurActiviteLibelle)],
    ["Compétences", (o.competences ?? []).map((c) => `${c.libelle ?? ""}${c.exigence === "E" ? " (exigée)" : ""}`).filter((c) => c.trim()).join(" ; ") || null],
    ["Formation", (o.formations ?? []).map((f) => [f.niveauLibelle, f.domaineLibelle].filter(Boolean).join(" ")).filter(Boolean).join(" ; ") || null],
    ["Langues", (o.langues ?? []).map((l) => l.libelle).filter(Boolean).join(" ; ") || null],
  ].filter((f): f is [string, string] => Boolean(f[1]));
  const description = str(o.description) ?? "";
  const about = str(o.entreprise?.description);
  const text = [title, "", description, "", ...facts.map(([k, v]) => `${k} : ${v}`), about ? `\nÀ propos de l'entreprise : ${about}` : ""].join("\n");
  return {
    origin: "france_travail",
    board: "france_travail",
    externalId: id,
    url: `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(id)}`,
    relatedUrls: [str(o.origineOffre?.urlOrigine), ...(o.origineOffre?.partenaires ?? []).map((p) => str(p.url))].filter((u): u is string => Boolean(u)),
    title,
    company: str(o.entreprise?.nom),
    location: place(str(o.lieuTravail?.libelle)),
    publishedAt: date(o.dateCreation),
    text,
    complete: description.length >= 80,
  };
}

export function franceTravailConnector(creds: FranceTravailCredentials, endpoints: Endpoints = FRANCE_TRAVAIL): SearchConnector {
  const authed = async () => ({ authorization: `Bearer ${await franceTravailToken(creds, endpoints)}` });
  return {
    async test() {
      tokens.delete(creds.clientId);
      const headers = await authed();
      await requestJson(`${endpoints.apiUrl}/offres/search?range=0-0`, { headers, intervalMs: FRANCE_TRAVAIL.intervalMs });
    },
    async search(query): Promise<SearchOutcome> {
      const headers = await authed();
      const token = headers.authorization.slice(7);
      const places: Places = {
        byName: async (name) => (await loadCommunes(token, endpoints)).byName.get(fold(name)) ?? null,
        byPostalCode: async (cp) => (await loadCommunes(token, endpoints)).byPostal.get(cp) ?? null,
        isCommuneCode: async (code) => (await loadCommunes(token, endpoints)).codes.has(code),
      };
      return searchEachGroup(query, async (keywords, limit) => {
        const params = await searchParams({ ...query, keywords }, places);
        const offers: IncomingOffer[] = [];
        let total: number | null = null;
        const wanted = Math.min(limit, FRANCE_TRAVAIL.maxIndex + 1);
        for (let start = 0; start < wanted; start += FRANCE_TRAVAIL.pageSize) {
          const end = Math.min(start + FRANCE_TRAVAIL.pageSize, wanted) - 1;
          params.set("range", `${start}-${end}`);
          const res = await requestJson(`${endpoints.apiUrl}/offres/search?${params}`, { headers, intervalMs: FRANCE_TRAVAIL.intervalMs });
          if (res.status === 204) break;
          const m = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "");
          if (m) total = Number(m[1]);
          const page = ((res.body as { resultats?: FtOffer[] } | null)?.resultats ?? []).map(normalizeFranceTravail).filter((o): o is IncomingOffer => o !== null);
          offers.push(...page);
          if (res.status === 200 || page.length < end - start + 1 || (total !== null && end + 1 >= total)) break;
        }
        return { offers, total: total ?? offers.length };
      });
    },
  };
}

/** En test : vider le cache des jetons et du référentiel des communes. */
export function resetFranceTravailCache() {
  tokens.clear();
  communes = null;
}
