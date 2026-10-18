# ADR 0008 — CV personnalisé : une sélection du profil maître, contrôlée et versionnée

- Statut : accepté
- Date : 18/10/2026

## Contexte

Le CV adapté à une offre ne doit jamais affirmer ce que le profil maître ne prouve pas, doit rester comparable d'une version à l'autre et doit pouvoir être restauré. L'architecture initiale prévoyait un éditeur de texte libre et un export PDF par Chromium dans le worker.

## Décision

- **Contenu** : le CV est une sélection ordonnée d'éléments du profil maître (`src/modules/cv/content.ts`). Chaque puce, projet ou compétence garde l'identifiant de sa source ; seules les formulations, l'ordre et le choix des éléments changent. Intitulés, entreprises, dates, formations sont toujours relus dans le profil de référence, jamais saisis dans le CV. Un projet personnel ou académique reste étiqueté comme tel, une certification en cours aussi. Une compétence « non confirmée » n'apparaît que si l'utilisateur l'ajoute (avertissement).
- **Contrôle des faits** (`factcheck.ts`, déterministe, exécuté dans le navigateur et sur le serveur) : bloquant si un élément n'existe pas dans le profil, si un chiffre n'apparaît pas dans la source (années de début/fin du poste et durée totale calculée tolérées), si un mot-clé technique de l'offre est ajouté alors que la source ne le contient pas.
- **Suggestions** : le modèle propose (`rephrase`, `summary`, `reorder_items`, `include`) en citant ses sources. Le serveur écarte sans l'afficher toute suggestion sans source vérifiable (et la base le refuse : `CHECK`), écarte celle qui ne s'applique pas, bloque et affiche avec sa raison celle qui ajouterait un fait. Accepter, modifier, refuser, annuler sont persistants ; une formulation modifiée repasse par le contrôle.
- **Versions** : un brouillon modifiable par offre (avec `revision` pour refuser une sauvegarde faite sur un état périmé) ; « Recontrôler » fige le brouillon en version enregistrée immuable (trigger SQL) puis lance le matching de cette version ; « Finaliser » n'est possible qu'après un recontrôle terminé et sans écart factuel bloquant. Écart assumé avec US6 (« toute modification crée une version ») : les modifications du brouillon ne créent pas de version à chaque frappe ; chaque version recontrôlée est conservée, comparable (diff ligne à ligne) et restaurable.
- **Recontrôle** : même moteur de matching, appliqué au profil restreint à ce que montre le CV, avec les poids du matching de référence ; le score de référence est recalculé avec ces mêmes poids à l'affichage.
- **Export** : PDF texte généré par `pdf-lib` (police Helvetica standard, caractères hors WinAnsi translittérés) et DOCX par `docx`, à la demande, sans navigateur. Même version → même PDF octet pour octet. Les coordonnées figurent dans l'export et ne sont jamais envoyées à un modèle.

## Conséquences

- Pas de Chromium dans le worker ni de file `cv.export` : moins de surface d'attaque et d'opérations, mais une mise en page simple (une colonne) et pas de police personnalisée.
- Le contrôle des faits est lexical : il ne détecte pas une reformulation qui change le sens sans ajouter de chiffre ni de mot-clé de l'offre. La relecture humaine reste nécessaire ; l'interface le rappelle.
- Une suggestion acceptée puis l'élément modifié à la main ne peut plus être annulée automatiquement (l'annulation écraserait la saisie) : refus explicite.
