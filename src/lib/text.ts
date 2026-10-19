/** Forme comparable : casse, accents de mise en forme et ponctuation ignorés. Utilisable côté client. */
export function normalizeForHash(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Forme de rapprochement : comme `normalizeForHash`, accents compris (« Rhône » = « rhone », « Saint-Étienne » = « saint etienne »). */
export function fold(input: string): string {
  return normalizeForHash(input.normalize("NFD").replace(/\p{Diacritic}/gu, ""));
}
