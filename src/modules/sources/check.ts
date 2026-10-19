import { ADZUNA, normalizeAdzuna } from "./connectors/adzuna";
import { FRANCE_TRAVAIL, franceTravailToken, normalizeFranceTravail, type FranceTravailCredentials } from "./connectors/france-travail";
import { requestJson } from "./http";
import { SourceError } from "./types";

/**
 * Vérification des API réelles (`npm run sources:check`) : les adresses, paramètres et formats des connecteurs
 * viennent de sources secondaires ; chaque contrôle confronte une hypothèse du code à la réponse de l'API.
 * Une dizaine de requêtes par API, sans rien enregistrer.
 */
export type CheckLine = { level: "ok" | "warn" | "fail"; label: string; detail: string };

/** Champs lus par les normaliseurs : un champ absent de toutes les offres reçues signale un format différent. */
export const FT_FIELDS = ["id", "intitule", "description", "dateCreation", "lieuTravail.libelle", "entreprise.nom", "typeContratLibelle", "origineOffre.urlOrigine"] as const;
export const ADZUNA_FIELDS = ["id", "title", "description", "redirect_url", "created", "company.display_name", "location.display_name"] as const;

function at(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), value);
}

/** Champs attendus absents de toutes les offres reçues. */
export function missingFields(items: unknown[], fields: readonly string[]): string[] {
  return fields.filter((f) => !items.some((it) => {
    const v = at(it, f);
    return v !== undefined && v !== null && v !== "";
  }));
}

/** Combinaison de deux mots-clés par l'API, d'après les totaux : « et » réduit, « ou » élargit. */
export function keywordLogic(a: number, b: number, both: number): "et" | "ou" | "indéterminé" {
  if (both < Math.max(a, b) && both <= Math.min(a, b)) return "et";
  if (both > Math.min(a, b) && both >= Math.max(a, b)) return "ou";
  return "indéterminé";
}

const message = (err: unknown) => (err instanceof SourceError || err instanceof Error ? err.message : String(err));

type FtEndpoints = { tokenUrl: string; apiUrl: string };

export async function checkFranceTravail(creds: FranceTravailCredentials, endpoints: FtEndpoints = FRANCE_TRAVAIL): Promise<CheckLine[]> {
  const lines: CheckLine[] = [];
  let token: string;
  try {
    token = await franceTravailToken(creds, endpoints);
    lines.push({ level: "ok", label: "Jeton OAuth2", detail: `délivré (portée « ${FRANCE_TRAVAIL.scope} »)` });
  } catch (err) {
    return [{ level: "fail", label: "Jeton OAuth2", detail: message(err) }];
  }
  const get = (query: string) =>
    requestJson(`${endpoints.apiUrl}/offres/search?${query}`, { headers: { authorization: `Bearer ${token}` }, intervalMs: FRANCE_TRAVAIL.intervalMs });
  const total = async (query: string) => {
    const res = await get(`${query}&range=0-0`);
    if (res.status === 204) return 0;
    const m = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "");
    if (!m) throw new Error("en-tête Content-Range absent ou différent de « offres a-b/total »");
    return Number(m[1]);
  };

  try {
    const res = await get("motsCles=developpeur&range=0-19");
    const items = ((res.body as { resultats?: unknown[] } | null)?.resultats ?? []) as Record<string, unknown>[];
    const missing = missingFields(items, FT_FIELDS);
    const normalized = items.map((o) => normalizeFranceTravail(o)).filter(Boolean).length;
    lines.push({
      level: !items.length || missing.length || normalized < items.length ? "warn" : "ok",
      label: "Format des offres",
      detail: `${items.length} offres reçues (statut ${res.status}), ${normalized} normalisées${missing.length ? ` ; champs absents : ${missing.join(", ")}` : ""}`,
    });
    lines.push({ level: res.headers.get("content-range") ? "ok" : "warn", label: "Pagination", detail: `Content-Range : ${res.headers.get("content-range") ?? "absent"}` });
  } catch (err) {
    lines.push({ level: "fail", label: "Recherche d'offres", detail: message(err) });
    return lines;
  }

  try {
    const [a, b, both] = [await total("motsCles=developpeur"), await total("motsCles=java"), await total("motsCles=developpeur,java")];
    const logic = keywordLogic(a, b, both);
    lines.push({
      level: logic === "et" ? "ok" : "warn",
      label: "Mots-clés séparés par des virgules",
      detail: `« developpeur » ${a}, « java » ${b}, « developpeur,java » ${both} : combinés en « ${logic} »${logic === "et" ? " (attendu : chaque variante est cherchée séparément)" : " ; le code suppose « et » (src/modules/sources/connectors/france-travail.ts)"}`,
    });
  } catch (err) {
    lines.push({ level: "fail", label: "Mots-clés séparés par des virgules", detail: message(err) });
  }

  try {
    const res = await requestJson(`${endpoints.apiUrl}/referentiel/communes`, { headers: { authorization: `Bearer ${token}` }, intervalMs: FRANCE_TRAVAIL.intervalMs });
    const list = Array.isArray(res.body) ? (res.body as Record<string, unknown>[]) : [];
    const withPostal = list.filter((c) => typeof c.codePostal === "string").length;
    lines.push({
      level: list.length && withPostal ? "ok" : "warn",
      label: "Référentiel des communes",
      detail: `${list.length} communes, ${withPostal} avec code postal${withPostal ? "" : " : un code postal saisi ne visera que son département"}`,
    });
  } catch (err) {
    lines.push({ level: "fail", label: "Référentiel des communes", detail: message(err) });
  }

  for (const [label, query] of [
    ["Alternance (natureContrat=E2,FS)", "natureContrat=E2,FS"],
    ["Fraîcheur (publieeDepuis=7)", "publieeDepuis=7"],
    ["Contrat (typeContrat=CDI)", "typeContrat=CDI"],
    ["Département (departement=69)", "departement=69"],
  ] as const) {
    try {
      lines.push({ level: "ok", label, detail: `accepté, ${await total(query)} offres` });
    } catch (err) {
      lines.push({ level: "fail", label, detail: message(err) });
    }
  }
  return lines;
}

export async function checkAdzuna(creds: { appId: string; appKey: string }, apiUrl: string = ADZUNA.apiUrl): Promise<CheckLine[]> {
  const lines: CheckLine[] = [];
  const search = (params: Record<string, string>) =>
    requestJson(`${apiUrl}/search/1?${new URLSearchParams({ app_id: creds.appId, app_key: creds.appKey, "content-type": "application/json", ...params })}`, {
      intervalMs: ADZUNA.intervalMs,
    });
  const count = async (params: Record<string, string>) => Number((((await search({ results_per_page: "1", ...params })).body ?? {}) as { count?: number }).count ?? NaN);

  try {
    const res = await search({ what: "developpeur", results_per_page: "20" });
    const body = (res.body ?? {}) as { results?: unknown[]; count?: number };
    const items = (body.results ?? []) as Record<string, unknown>[];
    const missing = missingFields(items, ADZUNA_FIELDS);
    const normalized = items.map((o) => normalizeAdzuna(o)).filter(Boolean).length;
    lines.push({
      level: !items.length || missing.length || normalized < items.length ? "warn" : "ok",
      label: "Format des offres",
      detail: `${items.length} offres reçues sur ${body.count ?? "?"}, ${normalized} normalisées${missing.length ? ` ; champs absents : ${missing.join(", ")}` : ""}`,
    });
  } catch (err) {
    return [{ level: "fail", label: "Recherche d'offres", detail: message(err) }];
  }

  try {
    const [a, b, both] = [await count({ what: "developpeur" }), await count({ what: "java" }), await count({ what: "developpeur java" })];
    const logic = keywordLogic(a, b, both);
    lines.push({ level: logic === "et" ? "ok" : "warn", label: "Plusieurs mots dans « what »", detail: `« developpeur » ${a}, « java » ${b}, « developpeur java » ${both} : combinés en « ${logic} »` });
  } catch (err) {
    lines.push({ level: "fail", label: "Plusieurs mots dans « what »", detail: message(err) });
  }

  for (const [label, params] of [
    ["Lieu et rayon (where=Lyon, distance=10)", { where: "Lyon", distance: "10" }],
    ["Fraîcheur (max_days_old=7)", { max_days_old: "7" }],
    ["CDI (permanent=1)", { permanent: "1" }],
  ] as const) {
    try {
      lines.push({ level: "ok", label, detail: `accepté, ${await count({ what: "developpeur", ...params })} offres` });
    } catch (err) {
      lines.push({ level: "fail", label, detail: message(err) });
    }
  }
  return lines;
}
