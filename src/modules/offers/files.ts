import { extractText, getDocumentProxy } from "unpdf";
import { cleanText } from "./normalize";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type ExtractedFile = { text: string; kind: "pdf" | "txt"; extension: "pdf" | "txt" };

export class FileImportError extends Error {
  constructor(
    readonly reason: "too_large" | "unsupported_type" | "unreadable" | "empty",
    message: string,
  ) {
    super(message);
    this.name = "FileImportError";
  }
}

function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

function looksLikeText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 4096);
  if (sample.includes(0)) return false;
  return !new TextDecoder("utf-8", { fatal: false }).decode(sample).includes("�");
}

/** Le type est déduit du contenu (signature), jamais du nom ni du type MIME déclarés par le navigateur. */
export async function extractFileText(bytes: Buffer): Promise<ExtractedFile> {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new FileImportError("too_large", "Fichier trop volumineux (10 Mo maximum)");
  let text: string;
  let kind: ExtractedFile["kind"];
  if (isPdf(bytes)) {
    kind = "pdf";
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const result = await extractText(pdf, { mergePages: true });
      text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
    } catch {
      throw new FileImportError("unreadable", "PDF illisible ou protégé");
    }
  } else if (looksLikeText(bytes)) {
    kind = "txt";
    text = bytes.toString("utf8");
  } else {
    throw new FileImportError("unsupported_type", "Format non pris en charge : PDF ou texte uniquement");
  }
  const cleaned = cleanText(text);
  if (cleaned.length < 50) {
    throw new FileImportError("empty", kind === "pdf" ? "Aucun texte trouvé : le PDF est peut-être une image scannée" : "Fichier vide");
  }
  return { text: cleaned, kind, extension: kind };
}
