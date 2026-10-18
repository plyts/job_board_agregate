/** Forme comparable : casse, accents de mise en forme et ponctuation ignorés. Utilisable côté client. */
export function normalizeForHash(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
