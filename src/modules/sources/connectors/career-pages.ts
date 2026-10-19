import type { IncomingOffer } from "@/modules/offers";
import { date, escapedHtmlToText, htmlToText, requestJson, str } from "../http";
import { SourceError, type SearchConnector, type SearchOutcome, type SearchQuery } from "../types";
import { DEPARTEMENTS, departementCode, departementOfPostalCode, fold, PREFECTURES } from "./departements";

/**
 * Flux publics des pages carrières (offres que l'entreprise publie elle-même), sans identifiant :
 * Greenhouse (Job Board API), Lever (Postings API), Ashby (Posting API), Recruitee (Careers Site API),
 * SmartRecruiters (Posting API). Adresses relevées le 19/10/2026 sur des sources secondaires : à revérifier.
 */
export const CAREER_PROVIDERS = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  recruitee: "Recruitee",
  smartrecruiters: "SmartRecruiters",
} as const;
export type CareerProvider = keyof typeof CAREER_PROVIDERS;
export type CareerPage = { provider: CareerProvider; token: string; region?: "eu" };

const SLUG = /^[a-z0-9][a-z0-9_-]{0,99}$/i;

/** Fournisseur et identifiant d'une page carrières à partir de son adresse ; null si non reconnue. */
export function detectCareerPage(input: string): CareerPage | null {
  let url: URL;
  try {
    url = new URL(input.trim().startsWith("http") ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
  const page = (provider: CareerProvider, token: string, region?: "eu"): CareerPage | null => (SLUG.test(token) ? { provider, token, ...(region ? { region } : {}) } : null);
  if (/^(boards|job-boards)(\.eu)?\.greenhouse\.io$/.test(host)) return page("greenhouse", url.searchParams.get("for") ?? first);
  if (host === "boards-api.greenhouse.io") return page("greenhouse", url.pathname.split("/")[3] ?? "");
  if (host === "jobs.lever.co") return page("lever", first);
  if (host === "jobs.eu.lever.co") return page("lever", first, "eu");
  if (host === "jobs.ashbyhq.com") return page("ashby", first);
  const recruitee = /^([a-z0-9-]+)\.recruitee\.com$/.exec(host);
  if (recruitee) return page("recruitee", recruitee[1]!);
  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") return page("smartrecruiters", first);
  return null;
}

export function careerPageUrl(p: CareerPage): string {
  switch (p.provider) {
    case "greenhouse":
      return `https://job-boards.greenhouse.io/${p.token}`;
    case "lever":
      return `https://jobs${p.region === "eu" ? ".eu" : ""}.lever.co/${p.token}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${p.token}`;
    case "recruitee":
      return `https://${p.token}.recruitee.com`;
    case "smartrecruiters":
      return `https://jobs.smartrecruiters.com/${p.token}`;
  }
}

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});

function offer(board: CareerProvider, company: string | null, fields: { id: unknown; title: unknown; url: unknown; location: unknown; publishedAt: unknown; text: string }): IncomingOffer | null {
  const id = fields.id !== undefined && fields.id !== null ? String(fields.id) : null;
  const title = str(fields.title);
  if (!id || !title) return null;
  const body = fields.text.trim();
  return {
    origin: "career_page",
    board,
    externalId: id,
    url: str(fields.url),
    title,
    company,
    location: str(fields.location),
    publishedAt: date(fields.publishedAt),
    text: [title, company ? `Entreprise : ${company}` : "", str(fields.location) ? `Lieu : ${str(fields.location)}` : "", "", body].filter((l, i) => l || i === 3).join("\n"),
    complete: body.length >= 80,
  };
}

export function normalizeGreenhouse(j: Raw, company: string | null): IncomingOffer | null {
  return offer("greenhouse", str(j.company_name) ?? company, {
    id: j.id,
    title: j.title,
    url: j.absolute_url,
    location: rec(j.location).name,
    publishedAt: j.first_published ?? j.updated_at,
    text: escapedHtmlToText(str(j.content)),
  });
}

export function normalizeLever(j: Raw, company: string | null): IncomingOffer | null {
  const cats = rec(j.categories);
  const lists = Array.isArray(j.lists) ? j.lists.map(rec) : [];
  const text = [
    str(j.descriptionPlain) ?? htmlToText(str(j.description)),
    ...lists.map((l) => `${str(l.text) ?? ""}\n${htmlToText(str(l.content))}`),
    str(j.additionalPlain) ?? htmlToText(str(j.additional)),
    str(cats.commitment) ? `Contrat : ${str(cats.commitment)}` : "",
  ].join("\n\n");
  return offer("lever", company, { id: j.id, title: j.text, url: j.hostedUrl, location: cats.location, publishedAt: j.createdAt, text });
}

export function normalizeAshby(j: Raw, company: string | null): IncomingOffer | null {
  if (j.isListed === false) return null;
  const text = [str(j.descriptionPlain) ?? htmlToText(str(j.descriptionHtml)), str(j.employmentType) ? `Contrat : ${str(j.employmentType)}` : "", j.isRemote ? "Télétravail possible" : ""].join("\n\n");
  return offer("ashby", company, { id: j.id, title: j.title, url: j.jobUrl, location: j.location, publishedAt: j.publishedAt, text });
}

export function normalizeRecruitee(j: Raw, company: string | null): IncomingOffer | null {
  const text = [htmlToText(str(j.description)), htmlToText(str(j.requirements))].join("\n\n");
  const location = str(j.location) ?? [str(j.city), str(j.country)].filter(Boolean).join(", ");
  return offer("recruitee", str(j.company_name) ?? company, { id: j.id, title: j.title, url: j.careers_url, location, publishedAt: j.published_at ?? j.created_at, text });
}

export function normalizeSmartRecruiters(j: Raw, detail: Raw | null, page: CareerPage, company: string | null): IncomingOffer | null {
  const loc = rec(j.location);
  const sections = rec(rec(rec(detail).jobAd).sections);
  const text = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"]
    .map((k) => {
      const s = rec(sections[k]);
      return [str(s.title), htmlToText(str(s.text))].filter(Boolean).join("\n");
    })
    .join("\n\n");
  return offer("smartrecruiters", str(rec(j.company).name) ?? company, {
    id: j.id,
    title: j.name,
    url: str(rec(detail).postingUrl) ?? `https://jobs.smartrecruiters.com/${page.token}/${String(j.id ?? "")}`,
    location: str(loc.fullLocation) ?? [str(loc.city), str(loc.country)].filter(Boolean).join(", "),
    publishedAt: j.releasedDate,
    text,
  });
}

/** Filtre local (les flux renvoient toutes les offres de l'entreprise) : tous les mots-clés d'un groupe, lieu, fraîcheur. */
/** Mot ou groupe de mots entier dans un texte replié : « var » ne trouve pas « Varces ». */
function hasWords(haystack: string, needle: string): boolean {
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Lieu demandé : une ville (comparée au lieu de l'offre), ou un département (« 69 », « Rhône », ou un code postal
 * faute de pouvoir situer sa commune) : son nom, son code ou sa préfecture doivent figurer dans le lieu de l'offre.
 */
export function locationMatches(offerLocation: string | null, wanted: string): boolean {
  const where = fold(offerLocation ?? "");
  const w = wanted.trim();
  const dept = departementOfPostalCode(w) ?? departementCode(w);
  if (!dept) return hasWords(where, fold(w));
  const code = dept.toLowerCase();
  return [DEPARTEMENTS[dept]!, ...(PREFECTURES[dept] ?? [])].some((n) => hasWords(where, fold(n))) || new RegExp(`(^| )${code}(\\d{3})?( |$)`).test(where);
}

export function matchesQuery(o: IncomingOffer, query: SearchQuery, now = new Date()): boolean {
  const haystack = fold(`${o.title}\n${o.text}`);
  const groups = query.keywords.split(",").map((g) => fold(g).split(" ").filter(Boolean)).filter((g) => g.length);
  if (groups.length && !groups.some((words) => words.every((w) => haystack.includes(w)))) return false;
  if (query.location?.trim() && !locationMatches(o.location, query.location)) {
    const remote = /teletravail|remote|full remote/.test(fold(`${o.location ?? ""} ${o.text}`));
    if (!remote) return false;
  }
  if (query.publishedWithinDays && o.publishedAt && now.getTime() - o.publishedAt.getTime() > query.publishedWithinDays * 24 * 60 * 60 * 1000) return false;
  return true;
}

export type CareerEndpoints = Partial<Record<CareerProvider, string>>;

function endpoint(p: CareerPage, endpoints: CareerEndpoints): string {
  const override = endpoints[p.provider];
  switch (p.provider) {
    case "greenhouse":
      return `${override ?? "https://boards-api.greenhouse.io"}/v1/boards/${p.token}/jobs?content=true`;
    case "lever":
      return `${override ?? `https://api${p.region === "eu" ? ".eu" : ""}.lever.co`}/v0/postings/${p.token}?mode=json`;
    case "ashby":
      return `${override ?? "https://api.ashbyhq.com"}/posting-api/job-board/${p.token}`;
    case "recruitee":
      return `${override ?? `https://${p.token}.recruitee.com`}/api/offers/`;
    case "smartrecruiters":
      return `${override ?? "https://api.smartrecruiters.com"}/v1/companies/${p.token}/postings?limit=100`;
  }
}

/** Toutes les offres publiées par l'entreprise (SmartRecruiters : détail chargé pour les offres retenues seulement). */
async function listAll(p: CareerPage, company: string | null, endpoints: CareerEndpoints, keep: (o: IncomingOffer) => boolean): Promise<IncomingOffer[]> {
  const res = await requestJson(endpoint(p, endpoints), { intervalMs: 500 });
  const body = res.body;
  const pick = (list: unknown, f: (j: Raw) => IncomingOffer | null) => (Array.isArray(list) ? list.map(rec).map(f).filter((o): o is IncomingOffer => o !== null) : []);
  switch (p.provider) {
    case "greenhouse":
      return pick(rec(body).jobs, (j) => normalizeGreenhouse(j, company));
    case "lever":
      return pick(body, (j) => normalizeLever(j, company));
    case "ashby":
      return pick(rec(body).jobs, (j) => normalizeAshby(j, company));
    case "recruitee":
      return pick(rec(body).offers, (j) => normalizeRecruitee(j, company));
    case "smartrecruiters": {
      const items = Array.isArray(rec(body).content) ? (rec(body).content as unknown[]).map(rec) : [];
      const out: IncomingOffer[] = [];
      for (const item of items) {
        const brief = normalizeSmartRecruiters(item, null, p, company);
        // Filtre sur l'intitulé avant de charger le détail (un appel par offre).
        if (!brief || !keep({ ...brief, text: brief.title })) continue;
        if (out.length >= 25) break;
        const detail = await requestJson(`${endpoint(p, endpoints).split("?")[0]}/${encodeURIComponent(String(item.id))}`, { intervalMs: 500 });
        const full = normalizeSmartRecruiters(item, rec(detail.body), p, company);
        if (full) out.push(full);
      }
      return out;
    }
  }
}

export function careerPageConnector(page: CareerPage, company: string | null, endpoints: CareerEndpoints = {}): SearchConnector {
  return {
    async test() {
      await requestJson(endpoint(page, endpoints), { intervalMs: 500 });
    },
    async search(query): Promise<SearchOutcome> {
      if (!SLUG.test(page.token)) throw new SourceError("Identifiant de page carrières invalide", "invalid");
      const titleOnly: SearchQuery = { ...query, location: null, publishedWithinDays: null };
      const all = await listAll(page, company, endpoints, (o) => matchesQuery(o, titleOnly));
      const offers = all.filter((o) => matchesQuery(o, query)).slice(0, query.limit);
      return { offers, total: offers.length };
    },
  };
}
