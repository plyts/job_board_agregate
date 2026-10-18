# ADR 0009 — Bonnes pratiques de rédaction, contrôlées et versionnées à chaque couche

- Statut : accepté
- Date : 18/10/2026

## Contexte

Un CV efficace suit des conventions connues : expériences de la plus récente à la plus ancienne, 3 à 5 puces par poste, puces qui commencent par une action, résultats chiffrés, vocabulaire de l'offre. Deux de ces conseils (« chiffrer », « reprendre les mots-clés ») poussent à inventer, ce que le produit interdit.

## Décision

- Un module déterministe (`src/modules/cv/quality.ts`) évalue six règles : ordre antéchronologique, 3 à 5 puces (1 à 3 pour un poste terminé depuis plus de 10 ans), verbe ou nom d'action en tête (formules passives signalées), au moins la moitié des puces chiffrées, une à deux lignes par puce, mots-clés de l'offre.
- **Conseils, jamais blocage.** Seul le contrôle des faits bloque (ADR 0008).
- **Pas d'invention** :
  - une puce sans chiffre reste une recommandation, avec la consigne d'ajouter le chiffre réel au profil maître d'abord (un chiffre absent de la source est bloqué dans le CV) ;
  - un mot-clé de l'offre est classé « repris », « prouvé mais absent » (on indique l'élément qui le prouve) ou « lacune, ne pas ajouter ».
- **Versionné à chaque couche** : les règles portent un numéro (`QUALITY_RULES_VERSION`).
  - Le rapport est figé avec la version de règles à la validation d'une version du profil maître (`profile_versions.quality`) et à l'enregistrement d'une version du CV (`cv_versions.quality`, mots-clés de l'offre compris).
  - Les brouillons sont évalués en direct.
  - Les versions antérieures au contrôle affichent un rapport recalculé, signalé comme tel.
  - La comparaison de deux versions montre l'évolution règle par règle.
- Le prompt des suggestions (`cv-suggest-v2`) reprend ces règles, avec les mêmes interdits.

## Conséquences

- La détection du verbe d'action est lexicale (français et anglais) : une formulation correcte peut être signalée « à vérifier », d'où le statut de recommandation.
- Changer une règle impose d'incrémenter `QUALITY_RULES_VERSION` ; les rapports déjà figés ne changent pas.
