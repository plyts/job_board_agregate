# Stratégie de test

Priorité aux comportements critiques, pas à la couverture.

| Niveau | Outil | Cible |
|---|---|---|
| Unitaires | Vitest | Normalisation et empreinte des offres, calcul des années d'expérience, score pondéré, garde-fou des suggestions, vérification des citations, diff de CV, transitions de statut |
| Intégration | Vitest + PostgreSQL réel | Repositories, contraintes et triggers (document envoyé immuable, unicité des candidatures), isolation par `user_id`, file de tâches (idempotence, reprises, watchdog) |
| Contrats | Vitest + schémas Zod | Chaque route : entrée invalide → 400, non authentifié → 401, ressource d'un autre utilisateur → 404 |
| Migrations | CI | Montée sur base vide et sur instantané N-1 |
| IA (hors CI par défaut) | Script d'évaluation | Extraction et matching sur le jeu de référence ; LLM simulé en CI à partir de réponses enregistrées |
| End-to-end | Playwright | Parcours : importer un CV → importer une offre → matching → adapter → recontrôler → confirmer l'envoi → Kanban |
| Sécurité | Tests ciblés | SSRF (IP privées, redirections), types de fichiers, CSRF, injection de prompt (offres piégées du jeu de test) |
| Charge | Script | 100 offres importées d'un coup : toutes analysées, aucun doublon d'analyse, coût et durée mesurés |
| Accessibilité | axe-core dans Playwright | Écrans du parcours critique |

## Jeu d'évaluation

`eval/fixtures/` : 30 offres fictives ou anonymisées (dont 5 piégées : injection, salaire absent, exigences ambiguës, offre en anglais, doublon reformulé) et 3 profils fictifs, annotés à la main (exigences attendues, catégorie attendue par couple).

Indicateurs suivis à chaque changement de prompt, de schéma ou de modèle : précision et rappel par type d'exigence, taux de citations invalides, accord de catégorie de matching, coût et latence moyens. Un changement n'est retenu que s'il n'est pas pire sur ces indicateurs.
