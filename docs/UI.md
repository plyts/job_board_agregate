# Interfaces du MVP

Maquettes cliquables (canvas privé) : https://claude.ai/artifact/LYDDx9xfumQWvmAnoh9gUq — toutes les données y sont fictives (persona « Camille Martin », entreprises inventées).

Design system : **Franklin KN** — fond `#f7f8fa`, encre `#0e1726`, accent sarcelle `#0f6e66`, ambre `#8a5a0b` pour « à vérifier », rouge `#a3342b` pour incompatibilité ou retard ; Inter pour le texte, IBM Plex Mono pour les statuts et sur-titres. Écart assumé par rapport au système : cartes sur fond blanc (meilleure lisibilité des tableaux denses).

## Parcours critique

```
Profil maître (7) ─┐
                   ▼
Offres (4) → Analyse (5) → Matching (6) → Éditeur (8) → Recontrôle (9) → Candidature (3) → Kanban (2)
                                                                                      ▲
                                                       Tableau de bord (1) ───────────┘
```

## Écrans

| # | Écran | Modules | Fonction | Interactions maquettées |
|---|---|---|---|---|
| 1 | Tableau de bord quotidien | J | Objectif « offres traitées », résultats réels séparés, entonnoir par étape, santé du pipeline, actions du jour, résultats par source | Bascule Aujourd'hui / 7 jours |
| 2 | Candidatures — Kanban | I | 12 colonnes, cartes avec score et prochaine action, filtres, sélecteur de vue (Kanban, tableau, calendrier, entreprise, aujourd'hui) | Changement de vue |
| 3 | Détail d'une candidature | H | Trois documents (maître, personnalisé, envoyé), envoi manuel confirmé, historique, prochaine action, contacts, notes | Confirmation d'envoi : le CV envoyé est figé et l'historique s'enrichit |
| 4 | Offres | A, B | Import URL / texte / fichier, recherches enregistrées, filtres, tableau avec état d'analyse (en file, échec, doublon, écartée), actions groupées | Onglets d'import, sélection multiple |
| 5 | Analyse d'une offre | D | Texte source à gauche, champs extraits à droite (explicite, déduit, incertain), coût et durée de l'analyse | Clic sur un champ → surlignage de l'extrait source |
| 6 | Matching CV / offre | E | Score et facteurs pondérés, résumé « correspond / réduit / inconnu », exigence par exigence avec preuve et action | Filtre par catégorie |
| 7 | Profil maître | C | Résultat d'import, champs incertains à trancher, expériences avec extrait source, compétences par niveau de preuve, préférences | Filtre par niveau |
| 8 | Éditeur de CV | F | Annonce / CV personnalisé avec diff / suggestions sourcées ; suggestion bloquée par le garde-fou | Accepter, refuser, modifier, annuler ; le CV se met à jour |
| 9 | Recontrôle | G | Score avant/après et cause de l'écart, exigences mieux couvertes, lacunes persistantes, vérification des faits, finaliser | — |
| 10 | Sources et recherches | A, B | Connecteurs avec méthode autorisée et état réel, recherches enregistrées, journal de synchronisation | Activer une recherche périodique |

## États à implémenter sur chaque écran

| État | Règle |
|---|---|
| Chargement | Squelettes à la forme du contenu ; jamais de tableau vide pendant le chargement |
| Vide | Message + action principale (ex. « Aucune offre. Importer une offre ») |
| Erreur | Message compréhensible, cause, action (« Réessayer », « Coller le texte ») ; l'identifiant de corrélation est copiable |
| Traitement asynchrone | Statut explicite par élément (en file, en cours, échec + heure du prochain essai) |
| Succès | Confirmation discrète (`aria-live="polite"`), pas de toast bloquant |
| Irréversible | Confirmation explicite (envoi, suppression d'une version) |

## Accessibilité et clavier

- Statuts toujours doublés d'un libellé et d'un symbole (✓ ◐ ? ○ ! –), jamais la couleur seule. Le symbole est masqué aux lecteurs d'écran (composant `Glyph`) : le libellé porte le sens.
- Traitements asynchrones (matching, recontrôle, suggestions, lettre) : une région d'état persistante annonce la fin et le résultat.
- Raccourcis : `Ctrl K` recherche globale, `I` importer, `←/→` déplacer une carte Kanban sélectionnée, `A`/`R` accepter/refuser la suggestion active.
- Cibles tactiles ≥ 40 px, contrastes AA mesurés dans le design system.
- Sous 640 px : navigation au-dessus du contenu, Kanban en liste par colonne, tableaux défilables dans leur cadre.
