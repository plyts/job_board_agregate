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
| T5 Analyse (code) | Schéma d'extraction v1 et prompt `offer-extract-v1` ; contrôle déterministe des citations (une citation introuvable déclasse l'exigence en « incertaine ») ; versions d'analyse ; corrections journalisées ; qualifier / écarter ; relance manuelle ; traitement `offer.analyze` dans le worker (reprises, budget, refus) ; balayage planifié des analyses bloquées ; fiche avec extrait source surligné | 9 + 2 tests unitaires, 10 tests d'intégration (dont import → worker → offre analysée), 4 scénarios e2e |

Dernière exécution locale : `lint` ✓, `typecheck` ✓, `test` 89/89 ✓, `build` ✓, `test:e2e` 20/20 ✓ (bureau et mobile, deux exécutions consécutives). CI GitHub : verte sur T1, T2 ; T4 et T5 à confirmer.

## En cours

Rien.

## Pas encore fait

- T5, mesure réelle : le jeu d'évaluation compte 6 offres annotées sur les 30 prévues, et n'a jamais été exécuté contre le modèle (aucune clé). Le critère « ≥ 90 % des exigences obligatoires retrouvées » n'est donc **pas encore vérifié**.
- T3 Profil maître, T6 à T11.
- Le tableau de bord affiche un état vide : aucune métrique n'est encore calculée.

## Aucun appel IA réel effectué

Le client Claude est testé avec un faux client. Aucune clé n'est configurée dans cet environnement et aucun appel payant n'a été fait. Sans clé, le worker laisse les analyses en file (aucun échec artificiel) et la fiche offre l'indique.

## Problèmes connus

- `npm audit` signale 5 vulnérabilités « high » dans `micromatch`, dépendance de développement d'`eslint-config-next` uniquement (non embarquée en production). À suivre lors de la prochaine version d'`eslint-config-next`.
- Sur mobile, la navigation s'affiche en entier au-dessus du contenu : à compacter (menu repliable) avant usage quotidien sur téléphone.
- `next start` avertit que `output: "standalone"` attend `node .next/standalone/server.js` : sans effet sur les tests, à utiliser dans l'image de production.
- La récupération d'URL contourne le proxy HTTP éventuel de l'environnement (connexion directe contrôlée) : à vérifier sur l'hébergement cible.

## Décisions en attente de ton arbitrage

1. **Consentement IA pour le CV** : accepter que le contenu du CV (sans coordonnées) soit envoyé à l'API Claude. Bloque T3.
2. **Clé API et budget** : fournir `ANTHROPIC_API_KEY` dans les secrets de l'environnement ; budget proposé 2 USD par jour (`LLM_DAILY_BUDGET_USD`). Bloque l'exécution réelle de T5, pas son développement.
3. **Hébergement** : PaaS UE ou Cloud Run + Cloud SQL.

## Prochaine étape

1. Dès que la clé est disponible : `npm run eval:offers -- --yes` (6 appels, coût affiché à la fin), puis ajuster le prompt si le rappel est sous 90 %.
2. T3 — profil maître (import du CV), après ta décision sur le consentement.
3. En attendant ces deux points : compléter le jeu d'évaluation à 30 offres et compacter la navigation mobile.
