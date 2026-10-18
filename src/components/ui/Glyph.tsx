import type { ReactNode } from "react";

/**
 * Symbole visuel (✓, ○, ◐, !, →) masqué aux lecteurs d'écran : sans lui, « coche Confirmée » ou
 * « cercle blanc Non démontrée » serait lu. Le sens doit être porté par le texte voisin.
 */
export function Glyph({ children }: { children: ReactNode }) {
  return <span aria-hidden="true">{children}</span>;
}
