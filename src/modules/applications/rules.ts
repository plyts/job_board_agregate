export const APPLICATION_STATUSES = [
  "new_offer",
  "to_analyze",
  "qualified",
  "cv_to_adapt",
  "ready",
  "sent",
  "followed_up",
  "hr_interview",
  "tech_interview",
  "offer_received",
  "rejected",
  "abandoned",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Étapes qui supposent un envoi confirmé (date, canal, fichier figé). */
export const POST_SEND: ReadonlySet<ApplicationStatus> = new Set(["sent", "followed_up", "hr_interview", "tech_interview", "offer_received"]);
const PRE_SEND: ReadonlySet<ApplicationStatus> = new Set(["new_offer", "to_analyze", "qualified", "cv_to_adapt", "ready"]);
/** Candidature close : une nouvelle candidature active peut être ouverte sur la même offre. */
export const CLOSED: ReadonlySet<ApplicationStatus> = new Set(["rejected", "abandoned"]);

export const SEND_REQUIRED = "Confirme d'abord l'envoi depuis la fiche de la candidature : date, canal et fichier envoyé.";
export const ALREADY_SENT = "Candidature déjà envoyée : elle ne revient pas à une étape d'avant l'envoi.";

/** Déplacement autorisé ? Renvoie la raison du refus, ou null. Seule la confirmation d'envoi fait passer à « Envoyée ». */
export function moveRefusal(to: ApplicationStatus, sent: boolean): string | null {
  if (POST_SEND.has(to) && !sent) return SEND_REQUIRED;
  if (PRE_SEND.has(to) && sent) return ALREADY_SENT;
  return null;
}

/** Colonne de départ d'une candidature, déduite de l'état réel de l'offre et du CV. */
export function initialStatus(offerStatus: string, hasFinalizedCv: boolean, hasCvDraft: boolean): ApplicationStatus {
  if (hasFinalizedCv) return "ready";
  if (offerStatus === "queued" || offerStatus === "analyzing" || offerStatus === "failed") return "to_analyze";
  if (hasCvDraft) return "cv_to_adapt";
  if (offerStatus === "qualified") return "qualified";
  return "new_offer";
}

/** Date du jour (AAAA-MM-JJ) dans le fuseau de l'utilisateur. */
export function localDate(at: Date = new Date(), timeZone = process.env.APP_TIME_ZONE ?? "Europe/Paris"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Relance ou action en retard : échéance passée (la veille ou avant). */
export function isOverdue(nextActionAt: string | null, today: string): boolean {
  return nextActionAt !== null && nextActionAt < today;
}
