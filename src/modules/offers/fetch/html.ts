import { parse, type HTMLElement } from "node-html-parser";
import { cleanText } from "../normalize";

export type ExtractedPage = {
  text: string;
  title: string | null;
  company: string | null;
  location: string | null;
  publishedAt: Date | null;
  /** « json-ld » quand la page publie une annonce structurée schema.org JobPosting. */
  method: "json-ld" | "html";
};

type Json = Record<string, unknown>;

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

function findJobPosting(node: unknown): Json | null {
  for (const item of asArray(node)) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Json;
    const types = asArray(obj["@type"]).map(String);
    if (types.includes("JobPosting")) return obj;
    const nested = findJobPosting(obj["@graph"]);
    if (nested) return nested;
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function htmlToText(html: string): string {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
  return cleanText(root.structuredText);
}

function fromJsonLd(root: HTMLElement): ExtractedPage | null {
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try {
      data = JSON.parse(script.rawText);
    } catch {
      continue;
    }
    const job = findJobPosting(data);
    const description = job && str(job.description);
    if (!job || !description) continue;
    const org = job.hiringOrganization as Json | undefined;
    const place = asArray(job.jobLocation)[0] as Json | undefined;
    const address = place?.address as Json | undefined;
    const posted = str(job.datePosted);
    const date = posted ? new Date(posted) : null;
    const title = str(job.title);
    const body = htmlToText(description);
    return {
      text: cleanText([title, str(org?.name), body].filter(Boolean).join("\n\n")),
      title,
      company: str(org?.name),
      location: str(address?.addressLocality),
      publishedAt: date && !Number.isNaN(date.getTime()) ? date : null,
      method: "json-ld",
    };
  }
  return null;
}

/** Extrait le texte utile d'une page d'annonce. Le HTML reste une donnée : rien n'est exécuté. */
export function extractJobPage(html: string): ExtractedPage {
  const root = parse(html);
  const structured = fromJsonLd(root);
  if (structured) return structured;

  for (const el of root.querySelectorAll("script, style, noscript, svg, nav, footer, header, form, iframe")) el.remove();
  const main = root.querySelector("main") ?? root.querySelector("article") ?? root.querySelector("body") ?? root;
  const h1 = str(root.querySelector("h1")?.text);
  const title = h1 ?? str(root.querySelector("title")?.text);
  return { text: cleanText(main.structuredText), title, company: null, location: null, publishedAt: null, method: "html" };
}
