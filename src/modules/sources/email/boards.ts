/**
 * Jobboards dont les alertes e-mail sont reconnues. Pour chacun :
 * - les domaines d'expéditeur (l'alerte doit venir du jobboard lui-même) ;
 * - la forme des liens d'offre, et l'adresse canonique de l'offre (identifiant stable, sans paramètres de suivi) ;
 * - les domaines de redirection de suivi, résolus pour retrouver le lien d'offre.
 *
 * Formes relevées le 19/10/2026 d'après les adresses publiques des offres, pas sur de vraies alertes :
 * à valider avec les alertes reçues (les e-mails non reconnus sont comptés dans l'écran Sources).
 */
export type Board = {
  id: string;
  label: string;
  senders: RegExp;
  /** Lien d'offre → identifiant ; l'adresse canonique est reconstruite à partir de l'identifiant. */
  offer: RegExp;
  canonical: (m: RegExpExecArray) => { id: string; url: string };
  /** Domaines de redirection de suivi propres au jobboard (ou à son routeur d'e-mails). */
  tracking?: RegExp;
  /** Les conditions du site interdisent la récupération automatique de la page (texte à coller). */
  noFetch?: boolean;
};

export const BOARDS: Board[] = [
  {
    id: "linkedin",
    label: "LinkedIn",
    senders: /(^|\.)linkedin\.com$/i,
    offer: /linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^/?#]*-)?(\d{6,})/i,
    canonical: (m) => ({ id: m[1]!, url: `https://www.linkedin.com/jobs/view/${m[1]}` }),
    noFetch: true,
  },
  {
    id: "indeed",
    label: "Indeed",
    senders: /(^|\.)indeed\.(com|fr)$/i,
    offer: /indeed\.(?:com|fr)\/[^\s"'<>]*?[?&](?:jk|vjk)=([0-9a-f]{16})/i,
    canonical: (m) => ({ id: m[1]!.toLowerCase(), url: `https://fr.indeed.com/viewjob?jk=${m[1]!.toLowerCase()}` }),
    noFetch: true,
  },
  {
    id: "wttj",
    label: "Welcome to the Jungle",
    senders: /(^|\.)welcometothejungle\.(com|co)$/i,
    offer: /welcometothejungle\.com\/(?:fr|en|es|cs|sk)\/companies\/([a-z0-9-]+)\/jobs\/([a-z0-9_-]+)/i,
    canonical: (m) => ({ id: `${m[1]}/${m[2]}`.toLowerCase(), url: `https://www.welcometothejungle.com/fr/companies/${m[1]!.toLowerCase()}/jobs/${m[2]!.toLowerCase()}` }),
  },
  {
    id: "hellowork",
    label: "HelloWork",
    senders: /(^|\.)hellowork\.(com|fr)$/i,
    offer: /hellowork\.com\/fr-fr\/emplois\/(\d+)\.html/i,
    canonical: (m) => ({ id: m[1]!, url: `https://www.hellowork.com/fr-fr/emplois/${m[1]}.html` }),
  },
  {
    id: "cadremploi",
    label: "Cadremploi",
    senders: /(^|\.)cadremploi\.fr$/i,
    offer: /cadremploi\.fr\/emploi\/detail_offre\?(?:[^"'<>\s]*&)?offreId=(\d+)/i,
    canonical: (m) => ({ id: m[1]!, url: `https://www.cadremploi.fr/emploi/detail_offre?offreId=${m[1]}` }),
  },
  {
    id: "meteojob",
    label: "Meteojob",
    senders: /(^|\.)meteojob\.com$/i,
    offer: /meteojob\.com\/(?:candidat\/offres\/)?(offre-d-emploi-[a-z0-9-]*?-(\d+))\.html/i,
    canonical: (m) => ({ id: m[2]!, url: `https://www.meteojob.com/candidat/offres/${m[1]!.toLowerCase()}.html` }),
  },
  {
    id: "jobteaser",
    label: "JobTeaser",
    senders: /(^|\.)jobteaser\.com$/i,
    offer: /jobteaser\.com\/(?:fr|en)\/job-offers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    canonical: (m) => ({ id: m[1]!.toLowerCase(), url: `https://www.jobteaser.com/fr/job-offers/${m[1]!.toLowerCase()}` }),
  },
  {
    id: "apec",
    label: "APEC",
    senders: /(^|\.)apec\.fr$/i,
    offer: /apec\.fr\/candidat\/recherche-emploi\.html\/emploi\/detail-offre\/([0-9A-Z]+)/i,
    canonical: (m) => ({ id: m[1]!.toUpperCase(), url: `https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${m[1]!.toUpperCase()}` }),
  },
  {
    id: "france_travail",
    label: "France Travail",
    senders: /(^|\.)(francetravail|pole-emploi)\.fr$/i,
    offer: /candidat\.(?:francetravail|pole-emploi)\.fr\/offres\/recherche\/detail\/([0-9A-Z]+)/i,
    canonical: (m) => ({ id: m[1]!.toUpperCase(), url: `https://candidat.francetravail.fr/offres/recherche/detail/${m[1]!.toUpperCase()}` }),
  },
];

/** Jobboard d'un expéditeur (domaine de l'adresse), ou null si l'e-mail ne vient pas d'un jobboard reconnu. */
export function boardForSender(address: string | null | undefined): Board | null {
  const domain = address?.split("@").pop()?.toLowerCase().replace(/>$/, "");
  if (!domain) return null;
  return BOARDS.find((b) => b.senders.test(domain)) ?? null;
}

/** Lien d'offre reconnu, quel que soit le jobboard (un e-mail LinkedIn peut pointer vers LinkedIn seulement). */
export function matchOffer(board: Board, href: string): { id: string; url: string } | null {
  const m = board.offer.exec(href);
  return m ? board.canonical(m) : null;
}
