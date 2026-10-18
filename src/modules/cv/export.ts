import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { ProfileContent } from "@/modules/profile/content";
import { renderCv, SECTION_TITLES, type CvContent } from "./content";

export type ExportFormat = "pdf" | "docx";

export type ExportMeta = { version: number; company: string | null; createdAt: Date };

type Block = { kind: "heading" | "bullet" | "text"; text: string };
type Section = { title: string; blocks: Block[] };

/**
 * Contenu exporté : en-tête (nom, titre, coordonnées) puis les sections du CV dans leur ordre.
 * Le recruteur reçoit les coordonnées ; aucun modèle ne les a jamais vues.
 */
export function exportModel(cv: CvContent, profile: ProfileContent) {
  const { identity } = profile;
  const contact = [identity.location, identity.email, identity.phone, ...identity.links].filter((x): x is string => Boolean(x && x.trim()));
  const sections: Section[] = renderCv(cv, profile).map((s) => ({
    title: s.title,
    blocks: s.lines.map((line): Block => {
      if (line.startsWith("• ")) return { kind: "bullet", text: line.slice(2) };
      return { kind: s.title === SECTION_TITLES.experiences ? "heading" : "text", text: line };
    }),
  }));
  return { name: identity.fullName || "CV", headline: cv.headline, contact, sections };
}

export function exportFileName(profile: ProfileContent, meta: ExportMeta, format: ExportFormat): string {
  const slug = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  const parts = ["CV", slug(profile.identity.fullName), meta.company ? slug(meta.company) : null, `v${meta.version}`].filter(Boolean);
  return `${parts.join("-")}.${format}`;
}

// --- DOCX -------------------------------------------------------------------------------------

const TEAL = "0F6E66";

export async function exportDocx(cv: CvContent, profile: ProfileContent, meta: ExportMeta): Promise<Buffer> {
  const m = exportModel(cv, profile);
  const children: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: m.name, bold: true, size: 36 })] }),
    new Paragraph({ children: [new TextRun({ text: m.headline, size: 24 })], spacing: { after: 60 } }),
  ];
  if (m.contact.length) children.push(new Paragraph({ children: [new TextRun({ text: m.contact.join(" · "), size: 18, color: "555555" })], spacing: { after: 200 } }));
  for (const s of m.sections) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: s.title.toUpperCase(), bold: true, size: 20, color: TEAL })],
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: TEAL, space: 2 } },
        spacing: { before: 240, after: 100 },
      }),
    );
    for (const b of s.blocks) {
      if (b.kind === "bullet") children.push(new Paragraph({ children: [new TextRun({ text: b.text, size: 20 })], bullet: { level: 0 } }));
      else children.push(new Paragraph({ children: [new TextRun({ text: b.text, size: 20, bold: b.kind === "heading" })], spacing: { before: b.kind === "heading" ? 120 : 40 }, alignment: AlignmentType.LEFT }));
    }
  }
  const doc = new Document({
    creator: "JobPilot",
    title: `${m.name} — CV v${meta.version}`,
    description: meta.company ? `CV adapté pour ${meta.company}` : "CV adapté",
    styles: { default: { document: { run: { font: "Calibri" } } } },
    sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

// --- PDF --------------------------------------------------------------------------------------

// Caractères de la plage 0x80–0x9F de WinAnsi, seule différence avec Latin-1 que les polices standard savent coder.
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const REPLACEMENTS: Record<string, string> = { "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "≈": "~", "✓": "-", " ": " ", " ": " ", " ": " " };

/** Ramène le texte aux caractères codables par Helvetica (WinAnsi) : accents décomposés si besoin, sinon « ? ». */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else if (code < 0x20) out += " ";
    else {
      const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      out += base && [...base].every((c) => c.codePointAt(0)! <= 0x7e) ? base : "?";
    }
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    // Mot plus long que la ligne (URL) : coupé au caractère.
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 50;
const INK = rgb(0.055, 0.09, 0.149);
const MUTED = rgb(0.33, 0.36, 0.42);
const ACCENT = rgb(0.059, 0.431, 0.4);

/** PDF texte (sélectionnable, lisible par les ATS), sans navigateur. Même version → même fichier. */
export async function exportPdf(cv: CvContent, profile: ProfileContent, meta: ExportMeta): Promise<Uint8Array> {
  const m = exportModel(cv, profile);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(toWinAnsi(`${m.name} — CV v${meta.version}`));
  pdf.setAuthor(toWinAnsi(m.name));
  pdf.setCreator("JobPilot");
  pdf.setProducer("JobPilot");
  pdf.setCreationDate(meta.createdAt);
  pdf.setModificationDate(meta.createdAt);

  const width = A4.width - 2 * MARGIN;
  let page: PDFPage = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;
  const ensure = (h: number) => {
    if (y - h < MARGIN) {
      page = pdf.addPage([A4.width, A4.height]);
      y = A4.height - MARGIN;
    }
  };
  const write = (text: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number; bullet?: boolean }) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10;
    const indent = opts.indent ?? 0;
    const lead = size * 1.35;
    y -= opts.gap ?? 0;
    wrap(toWinAnsi(text), font, size, width - indent).forEach((line, i) => {
      ensure(lead);
      y -= lead;
      if (opts.bullet && i === 0) page.drawText("•", { x: MARGIN + indent - 9, y, size, font, color: opts.color ?? INK });
      page.drawText(line, { x: MARGIN + indent, y, size, font, color: opts.color ?? INK });
    });
  };

  write(m.name, { font: bold, size: 18 });
  if (m.headline) write(m.headline, { size: 11, gap: 2 });
  if (m.contact.length) write(m.contact.join(" · "), { size: 9, color: MUTED, gap: 2 });
  for (const s of m.sections) {
    ensure(40);
    write(s.title.toUpperCase(), { font: bold, size: 10.5, color: ACCENT, gap: 14 });
    y -= 3;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + width, y }, thickness: 0.6, color: ACCENT });
    y -= 2;
    for (const b of s.blocks) {
      if (b.kind === "heading") write(b.text, { font: bold, gap: 6 });
      else if (b.kind === "bullet") write(b.text, { indent: 12, bullet: true, gap: 1 });
      else write(b.text, { gap: 2 });
    }
  }
  return pdf.save({ useObjectStreams: false });
}
