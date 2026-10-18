# PRD — JobPilot AI (MVP)

## Vision

Transformer une recherche d'emploi dispersée en un flux unique et pilotable : chaque offre est analysée, comparée à un profil vérifié, et ne devient une candidature qu'avec un CV adapté dont chaque phrase est prouvée.

## Persona principal

**Le candidat expérimenté qui postule de façon ciblée** (toi, MVP mono-utilisateur). Cherche un poste tech confirmé ou senior, lit 20 à 100 offres par jour, en retient quelques-unes, veut adapter son CV sans y glisser d'inexactitude, et perd aujourd'hui le fil des relances.

Scénarios :
1. *Matin* — « J'ai 15 offres ouvertes dans mon navigateur : je les colle, je vois en 2 minutes lesquelles valent la peine et pourquoi. »
2. *Adaptation* — « Pour Nordwave, je veux un CV qui mette en avant BigQuery sans prétendre que je maîtrise Spark. »
3. *Suivi* — « Qui dois-je relancer aujourd'hui ? Quel CV ai-je envoyé à Helio Santé il y a 9 jours ? »

## Périmètre MVP (Must)

| Module | Inclus dans le MVP |
|---|---|
| C — Profil maître | Import PDF/DOCX, extraction structurée, correction champ par champ, compétences avec niveau et preuve, versionnement |
| A — Offres | Import par URL (si autorisé), texte collé, fichier PDF/.eml ; URL d'origine conservée ; dédoublonnage par empreinte |
| D — Analyse | Extraction structurée avec extrait source, statut explicite / déduit / incertain |
| E — Matching | Catégories par exigence, preuves citées, score déterministe et pondéré, explication |
| F — Éditeur | Suggestions sourcées (accepter, refuser, modifier), réordonnancement, diff, versions, restauration, export PDF et DOCX |
| G — Recontrôle | Nouveau score, exigences mieux couvertes, lacunes, vérification des faits, finaliser / poursuivre / annuler |
| H/I — Candidatures | Fiche candidature, confirmation manuelle d'envoi, fichier envoyé figé, Kanban 12 colonnes, vue tableau, relances |
| J — Tableau de bord | Entonnoir mesuré étape par étape, objectif quotidien, relances en retard, coût IA |
| Socle | Auth, isolation par utilisateur, file de tâches avec reprises, logs structurés, budget IA |

## Exclu du MVP (explicitement)

Connecteurs automatiques (France Travail, ATS, alertes e-mail), synchronisation planifiée, recherche sémantique, vues calendrier et par entreprise, envoi automatisé, multi-utilisateur, OCR de PDF scannés, lettres de motivation générées (brouillon manuel seulement), application mobile native.

Les écrans maquettés de ces fonctions (Sources, vues calendrier) existent pour valider la navigation ; ils seront livrés en V2.

## User stories et critères d'acceptation

Format : *En tant que candidat, je veux… afin de…* — critères vérifiables par test.

**US1 — Importer mon CV.**
- Un PDF ou DOCX ≤ 10 Mo est accepté ; autre format ou taille → erreur explicite, rien n'est créé.
- L'extraction produit une proposition de version (pas encore la source de vérité) ; chaque champ a un extrait source.
- Les champs à faible confiance sont marqués « incertain » et bloquent la validation tant qu'ils ne sont pas tranchés.
- Valider crée une nouvelle version immuable du profil ; la version précédente reste consultable.

**US2 — Qualifier mes compétences.**
- Chaque compétence a un niveau parmi : maîtrisée, ponctuelle, en apprentissage, non confirmée.
- Une compétence sans preuve liée est « non confirmée » par défaut, quel que soit le texte du CV.

**US3 — Importer une offre.**
- URL : la page n'est récupérée que si robots.txt l'autorise ; sinon l'utilisateur est invité à coller le texte, l'URL est conservée.
- Une offre déjà importée (même URL canonique ou même empreinte de texte normalisé) est marquée doublon et renvoie à l'originale ; aucune analyse n'est relancée.
- L'import retourne immédiatement ; l'analyse est asynchrone avec état visible (en file, en cours, analysée, échec + prochain essai).

**US4 — Voir l'analyse d'une offre.**
- Chaque champ extrait est EXPLICITE (avec extrait du texte), DÉDUIT (avec justification) ou INCERTAIN.
- Un champ absent du texte (ex. salaire) est « non communiqué », jamais estimé.
- L'utilisateur peut corriger un champ ; la correction est journalisée.

**US5 — Comprendre la compatibilité.**
- Chaque exigence reçoit une catégorie parmi six ; toute catégorie « confirmée » ou « partielle » cite au moins un élément du profil.
- Le score est recalculable à partir des catégories et des poids affichés ; modifier les poids recalcule sans nouvel appel IA.
- L'écran répond aux trois questions : ce qui correspond (avec preuves), ce qui réduit le score, ce qui est inconnu.

**US6 — Adapter mon CV.**
- Une suggestion sans référence à un élément du profil est rejetée côté serveur et n'est jamais affichée.
- Accepter, refuser, modifier, annuler sont possibles pour chaque suggestion ; l'état est persistant.
- Toute modification crée une version ; deux versions sont comparables (diff) ; une version antérieure est restaurable.
- Le profil maître n'est jamais modifié par l'éditeur.

**US7 — Recontrôler.**
- Après validation, le score est recalculé et l'écart affiché, avec la liste des exigences dont la catégorie a changé.
- Les dates, chiffres et niveaux du CV personnalisé sont comparés au profil maître ; tout écart bloque la finalisation.

**US8 — Suivre mes candidatures.**
- Une candidature ne passe à « Envoyée » que par la confirmation explicite (date, canal, fichier).
- Le fichier envoyé est copié, haché (SHA-256) et ne peut plus être modifié ni supprimé par l'application.
- Le Kanban permet de déplacer une carte à la souris et au clavier ; chaque déplacement crée un événement d'historique.
- Une même offre ne peut pas avoir deux candidatures actives ; une même entreprise peut en avoir plusieurs.

**US9 — Piloter ma journée.**
- Le tableau de bord distingue collectées, nouvelles, analysées, qualifiées, CV adaptés, préparées, envoyées, entretiens, refus, relances en retard.
- Chaque chiffre est calculé à partir d'événements datés, pas d'un compteur incrémenté.

## Exigences non fonctionnelles

| Exigence | Cible MVP |
|---|---|
| Capacité | 100 offres analysées / jour sans intervention ; mesurée par test de charge ciblé |
| Latence | Import < 1 s ; analyse d'offre p95 < 30 s ; matching p95 < 20 s ; changement de poids < 200 ms |
| Fiabilité | Tâches idempotentes ; 3 essais avec temporisation exponentielle ; détection des tâches bloquées > 5 min |
| Coût | Budget IA journalier configurable, bloquant ; coût par analyse mesuré et affiché |
| Sécurité | Voir SECURITY.md |
| Accessibilité | WCAG 2.2 AA : contrastes, clavier complet, lecteurs d'écran, statut jamais porté par la seule couleur |
| Responsive | Utilisable à 360 px de large (consultation, Kanban en liste) |

## Métriques produit

- **Volume** : offres traitées / jour (analysée puis qualifiée ou écartée).
- **Qualité** : taux de qualification, part des suggestions acceptées, corrections utilisateur par analyse.
- **Résultat** : candidatures envoyées, taux de réponse, entretiens / envois.
- **Santé** : taux d'échec d'analyse, latence p95, coût par analyse, taux de doublons.
