export type NavItem = { href: string; label: string; section: "pilotage" | "travail" | "reglages" };

/** Seules les sections réellement livrées apparaissent dans la navigation. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Tableau de bord", section: "pilotage" },
  { href: "/offres", label: "Offres", section: "travail" },
  { href: "/profil", label: "Profil maître", section: "travail" },
  { href: "/reglages/ia", label: "Fournisseurs IA", section: "reglages" },
];
