# ADR 0003 — Score calculé par le code, jugements du modèle ancrés sur des preuves citées

- Statut : proposé
- Date : 18/10/2026

## Contexte

Le matching doit être explicable, reproductible et résistant aux faux positifs (« mot-clé présent ≠ compétence maîtrisée »). Un score produit directement par un LLM n'est ni stable ni justifiable.

## Décision

- Les règles vérifiables (années calculées à partir des dates, lieu, contrat, télétravail, exclusions) sont évaluées par du code.
- Le modèle ne fait que classer chaque exigence dans une des six catégories, en citant les identifiants d'éléments du profil qui la justifient. Le serveur vérifie que ces éléments existent et que les citations correspondent.
- Le score est une moyenne pondérée calculée par le code à partir des catégories (confirmée = 1, partielle = 0,5, à confirmer = 0,25, non démontrée = 0, incompatibilité = 0 et signalement, non applicable = exclu ; valeurs initiales réglables) et des poids affichés.
- Les informations inconnues ne pénalisent pas le score ; elles sont listées à part.

## Conséquences

- Changer les poids recalcule le score instantanément, sans appel IA.
- Le même couple (profil, offre, poids) donne toujours le même score une fois les catégories établies.
- La qualité dépend de la classification : elle est mesurée sur le jeu d'évaluation.
