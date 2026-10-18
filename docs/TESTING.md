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

## Accessibilité

`tests/e2e/accessibility.spec.ts` passe axe-core (WCAG 2.0, 2.1 et 2.2 niveaux A et AA) sur la connexion et tous les écrans du parcours :
- tableau de bord ;
- offres, analyse, matching ;
- éditeur de CV, recontrôle ;
- candidatures (Kanban, tableau, calendrier, par entreprise), fiche candidature ;
- profil maître, fournisseurs IA.

Le passage est fait sur ordinateur et sur mobile. Défauts trouvés et corrigés :
- `aria-pressed` placé sur des liens ;
- zones à défilement horizontal inaccessibles au clavier.

axe ne couvre pas tout. D'où une relecture au lecteur d'écran.

### Relecture au lecteur d'écran (18/10/2026)

**Méthode.** Relevé automatisé de ce qu'un lecteur d'écran annonce, sur 10 écrans : connexion, tableau de bord, offres, offre, matching, éditeur de CV, Kanban, profil, confidentialité, sauvegardes. Pour chacun :
- titre du document et langue ;
- points de repère et plan des titres ;
- régions d'état ;
- arbre d'accessibilité (`ariaSnapshot`).

**Ce qui était déjà correct :**
- `lang="fr"`, lien « Aller au contenu » ;
- navigation et fil d'Ariane nommés ;
- un seul `h1` par page et des niveaux de titres sans saut ;
- tableaux à en-têtes de colonnes, formulaires étiquetés ;
- annonce des déplacements du Kanban.

**Défauts corrigés :**
- **symboles lus à voix haute.** « ✓ Confirmée », « ○ Non démontrée », « ◐ Partielle », « ! En retard » ou les bascules « ✓ Python » étaient annoncés « coche… », « cercle blanc… ».
  - Les symboles sont désormais masqués (composant `Glyph`) : le libellé porte le sens.
  - Quand le symbole était seul porteur du sens, un texte réservé aux lecteurs d'écran le remplace (« Bloquant : », « À vérifier : », « En retard : »).
- **carte du Kanban.** Son nom ne donnait que le poste, l'entreprise et la colonne. Il annonce aussi le score et la prochaine action (ou le retard).
- **fin des traitements asynchrones non annoncée.** Matching, recontrôle, suggestions de CV, lettre proposée : la région « en cours » disparaissait avec le résultat. Une région d'état persistante annonce maintenant la fin (« Comparaison terminée : score 72 sur 100 », « 3 suggestions à examiner », « Proposition prête : 4 paragraphes, dont 1 non repris »).
- **tableau de bord sans titre propre.** Le changement de page annonçait « JobPilot » seul ; il annonce « Tableau de bord ».

**Garde-fous** (`accessibility.spec.ts`, ordinateur et mobile) :
- titre de la page d'accueil ;
- aucun symbole décoratif dans l'arbre d'accessibilité du matching, de l'éditeur de CV et du tableau des candidatures ;
- nom complet des cartes du Kanban.

**À faire par une personne :** une session réelle avec NVDA et Firefox (Windows), puis VoiceOver et Safari (macOS, iOS). Ce relevé lit l'arbre d'accessibilité calculé par Chromium, pas la voix d'un lecteur d'écran. Il ne juge ni la verbosité, ni l'ordre de lecture ressenti, ni le comportement des modes navigation et formulaire. Parcours à suivre :
1. connexion ;
2. import d'une offre ;
3. matching ;
4. adaptation du CV (accepter une suggestion avec A) ;
5. déplacement d'une carte du Kanban au clavier ;
6. confirmation d'envoi ;
7. consentement IA.

## Charge et sauvegardes

Voir `docs/OPERATIONS.md` : test de charge de 100 offres (script et mesures), vérification sauvegarde-restauration.

## Worker pendant les tests e2e

Le worker ne tourne pas pendant Playwright. Les données nécessaires sont préparées dans `tests/e2e/global-setup.ts` avec un faux client IA rattaché au fournisseur « local » (aucun coût) ; les matchings mis en file par un scénario (recontrôle d'un CV) sont traités par `tests/e2e/worker.ts`, avec le même jugement simulé.

## Jeu d'évaluation

**État réel** : `eval/offers/` contient 30 offres fictives annotées : métiers variés (data, développement, DevOps, sécurité, produit, support), français, anglais et mélange des deux, CDI, CDD, stage, alternance, freelance, temps partiel, 3 injections de consignes, offres vagues, très courtes, très longues ou en listes à puces, salaire absent ou masqué. `npm run eval:offers -- --yes` les soumet au modèle et affiche rappel, accord sur l'importance, citations invalides, contenus interdits et coût. Un test unitaire vérifie que chaque mot-clé attendu figure bien dans l'annonce (annotation vérifiable). Jamais exécuté contre le modèle à ce jour.

Cible :

`eval/fixtures/` : 30 offres fictives ou anonymisées (dont 5 piégées : injection, salaire absent, exigences ambiguës, offre en anglais, doublon reformulé) et 3 profils fictifs, annotés à la main (exigences attendues, catégorie attendue par couple).

Indicateurs suivis à chaque changement de prompt, de schéma ou de modèle : précision et rappel par type d'exigence, taux de citations invalides, accord de catégorie de matching, coût et latence moyens. Un changement n'est retenu que s'il n'est pas pire sur ces indicateurs.
