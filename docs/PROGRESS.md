# État d'avancement

Dernière mise à jour : 18/10/2026.

## Terminé (tests exécutés)

| Tâche | Contenu | Vérification |
|---|---|---|
| Cadrage | Audit, PRD, maquettes des 10 écrans, architecture, modèle de données, contrats, ADR 0001 à 0005 | Relecture |
| T0 Socle | Next.js 16, TypeScript strict, Tailwind 4, thème Franklin KN (polices auto-hébergées), en-têtes de sécurité et CSP, CI | lint, typecheck, build, e2e |
| T1 Identité | Compte propriétaire (`npm run user:create`), connexion, sessions en base (jeton haché), verrouillage après 5 échecs, déconnexion, contrôle optimiste `proxy.ts` + `requireUser()` | 5 tests d'intégration, 4 scénarios e2e |
| T2 Plateforme | File pg-boss (politique `exclusive`, 3 reprises avec temporisation, expiration), mise en file transactionnelle, stockage local sans écrasement, client Claude à sortie validée par schéma avec repli serveur, journal `llm_calls`, budget IA journalier bloquant, worker (`npm run worker`) | 7 tests d'intégration, 8 tests unitaires |
| T4 Offres | Import par URL (adresses internes refusées, robots.txt, domaines interdits), texte collé, PDF/TXT ; URL canonique et empreinte pour le dédoublonnage ; liste filtrable ; fiche offre | 28 tests unitaires, 12 tests d'intégration, 3 scénarios e2e |
| IA multi-fournisseurs | Client unique pour les API compatibles OpenAI (Groq, OpenRouter, Gemini, Mistral, Cerebras, modèle local) en plus de Claude ; routeur avec ordre configurable, repli sur le fournisseur suivant (429, quota du jour, erreur, sortie invalide), limites par minute et par jour, données personnelles refusées par défaut ; `npm run llm:check` ; écran « Fournisseurs IA » ; évaluation par fournisseur | 17 tests unitaires (dont un faux serveur HTTP), 5 tests d'intégration, 1 scénario e2e |
| T3 Profil maître | Saisie et correction manuelles (éditeur complet), import PDF/DOCX avec extraction IA réservée aux fournisseurs autorisés pour les données personnelles et coordonnées masquées, signalement des éléments absents du CV source, versions validées immuables (trigger SQL), règle « pas de compétence sans preuve », historique des versions | 11 tests unitaires, 6 tests d'intégration, 2 scénarios e2e |
| T6 Matching | Règles déterministes (années d'expérience calculées sur les dates avec fusion des périodes, critères d'exclusion), jugement du modèle exigence par exigence avec preuves citées, garde-fous (preuve inexistante → « à confirmer », projet personnel seul → « partielle »), score pondéré calculé par le code et figé au moment du matching, poids modifiables sans appel IA, mode « règles seules » signalé sans fournisseur autorisé, synthèse « correspond / réduit / inconnu », filtre par catégorie | 7 + 4 tests unitaires, 4 tests d'intégration, 1 scénario e2e (bureau et mobile) |
| T7-T8 CV personnalisé | Brouillon par offre tiré du profil maître validé (compétences sans preuve exclues par défaut), éditeur par blocs : sélection, ordre des sections, expériences et puces, reformulation ; faits (intitulés, entreprises, dates) relus dans le profil ; contrôle des faits en direct et côté serveur (chiffre absent de la source, mot-clé de l'offre ajouté sans preuve, élément inexistant) ; suggestions IA sourcées (`cv.suggest`) filtrées par le garde-fou, accepter / modifier / refuser / annuler persistants, raccourcis A / R ; versions immuables, comparaison ligne à ligne, restauration ; recontrôle = matching de la version sur ce que le CV montre, score avant/après aux mêmes poids, exigences mieux / moins bien couvertes, lacunes persistantes ; finalisation bloquée par un écart factuel ; export PDF (texte, reproductible) et DOCX ; ADR 0008 | 21 tests unitaires, 8 tests d'intégration, 1 scénario e2e complet (bureau et mobile) |
| T9 Candidatures | Création depuis l'offre (une seule candidature active par offre, colonne de départ déduite de l'état réel), Kanban 12 étapes déplaçable à la souris et au clavier (← →, colonnes vides repliées), vue tableau triable, filtres (relance en retard, score ≥ 60, sans prochaine action) ; « Envoyée » uniquement par confirmation explicite (date ≤ aujourd'hui, canal, fichier) ; fichier envoyé copié, haché SHA-256, immuable (trigger) et revérifié au téléchargement ; relance proposée selon le délai ; historique append-only (trigger) ; prochaine action, notes | 4 tests unitaires, 5 tests d'intégration, 1 scénario e2e (bureau avec glisser-déposer, mobile par la fiche) |
| T5 Analyse (code) | Schéma d'extraction v1 et prompt `offer-extract-v1` ; contrôle déterministe des citations (une citation introuvable déclasse l'exigence en « incertaine ») ; versions d'analyse ; corrections journalisées ; qualifier / écarter ; relance manuelle ; traitement `offer.analyze` dans le worker (reprises, budget, refus) ; balayage planifié des analyses bloquées ; fiche avec extrait source surligné | 9 + 2 tests unitaires, 10 tests d'intégration (dont import → worker → offre analysée), 4 scénarios e2e |

Dernière exécution locale : `lint` ✓, `typecheck` ✓, `test` 182/182 ✓, `build` ✓, `test:e2e` 30/30 ✓ (bureau et mobile, 2 scénarios réservés au bureau ignorés sur mobile). CI GitHub : verte sur T1, T2, T4 ; T5 et IA multi-fournisseurs à confirmer.

## En cours

Rien.

## Pas encore fait

- T5, mesure réelle : le jeu d'évaluation compte les 30 offres annotées prévues, mais n'a jamais été exécuté contre un modèle (aucune clé). Le critère « ≥ 90 % des exigences obligatoires retrouvées » n'est donc **pas encore vérifié**, ni pour Claude ni pour les modèles gratuits.
- Suggestions de CV avec un vrai modèle : jamais exécutées (aucune clé, et aucun fournisseur n'est encore autorisé pour les données personnelles). Sans fournisseur autorisé, l'éditeur fonctionne à la main et le recontrôle en « règles seules ».
- Candidatures : vues calendrier, par entreprise et « aujourd'hui », colonnes configurables, table des contacts, lettre de motivation. Sur téléphone, pas de glisser-déposer : l'étape se change depuis la fiche.
- T10 (tableau de bord), T11 (durcissement).
- Le tableau de bord affiche un état vide : aucune métrique n'est encore calculée.

## Aucun appel IA réel effectué

Les clients Claude et compatibles OpenAI sont testés avec un faux client et un faux serveur HTTP local. Aucune clé n'est configurée dans cet environnement et aucun fournisseur réel n'a été appelé. Les sites des fournisseurs n'étaient pas joignables depuis cet environnement : URL d'API, limites gratuites et conditions d'usage des données proviennent de sources secondaires datées d'octobre 2026 et restent **à vérifier** (`npm run llm:check` le fera pour les URL et les modèles). Sans fournisseur actif, le worker laisse les analyses en file et la fiche offre l'indique.

## Problèmes connus

- Contrôle des faits du CV lexical : il ne voit pas une reformulation qui change le sens sans ajouter de chiffre ni de mot-clé de l'offre. Relecture humaine nécessaire avant l'envoi.
- Export PDF en Helvetica standard : les caractères hors Latin-1 (alphabets non latins, emoji) sont translittérés ou remplacés par « ? ». Le DOCX n'a pas cette limite.

- `npm audit` signale 5 vulnérabilités « high » dans `micromatch`, dépendance de développement d'`eslint-config-next` uniquement (non embarquée en production). À suivre lors de la prochaine version d'`eslint-config-next`.
- Sur mobile, la navigation s'affiche en entier au-dessus du contenu : à compacter (menu repliable) avant usage quotidien sur téléphone.
- `next start` avertit que `output: "standalone"` attend `node .next/standalone/server.js` : sans effet sur les tests, à utiliser dans l'image de production.
- La récupération d'URL contourne le proxy HTTP éventuel de l'environnement (connexion directe contrôlée) : à vérifier sur l'hébergement cible.

## Décisions en attente de ton arbitrage

1. **Consentement IA pour le CV** : accepter que le contenu du CV (sans coordonnées) soit envoyé à un fournisseur (API Claude ou modèle local). Bloque l'extraction automatique du CV importé, le jugement du matching et les suggestions de CV ; la saisie manuelle, le matching « règles seules » et l'édition manuelle du CV fonctionnent sans.
2. **Clés des fournisseurs gratuits** : créer au moins une clé (Groq et OpenRouter recommandés, voir ci-dessous), choisir un modèle par fournisseur, renseigner `<P>_API_KEY` et `<P>_MODEL` dans les secrets de l'environnement, puis lancer `npm run llm:check`. Bloque l'exécution réelle de T5, pas son développement.
3. **Données personnelles et offres gratuites** : décider si un fournisseur gratuit peut recevoir ton CV (`<P>_ALLOW_PERSONAL_DATA=true`). Recommandation : non pour Gemini gratuit et Mistral Experiment (réutilisation des données), modèle local ou API payante pour le CV.
4. **Hébergement** : PaaS UE ou Cloud Run + Cloud SQL.

## Prochaine étape

1. Dès qu'une clé est disponible : `npm run llm:check`, puis `npm run eval:offers -- --yes --provider <id>` pour chaque fournisseur (30 requêtes de quota chacun), et ajuster le prompt si le rappel est sous 90 %.
2. En attendant : T10 (tableau de bord calculé depuis les événements datés), puis T11.
