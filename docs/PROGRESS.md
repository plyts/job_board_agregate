# État d'avancement

Dernière mise à jour : 18/10/2026.

## Terminé

- Audit de l'environnement et diagnostic produit (`AUDIT.md`).
- Spécification MVP, critères d'acceptation, métriques (`PRD.md`).
- Maquettes des 10 écrans du MVP, cliquables, données fictives (`UI.md`).
- Architecture, modèle de données, contrats d'API, interface des connecteurs, sécurité, stratégie de test, ADR 0001 à 0004.

## En cours

Rien. En attente de ta validation des maquettes avant T0.

## Bloqué

Rien.

## Tests exécutés

Aucun : il n'existe pas encore de code. Les maquettes n'ont pas été testées automatiquement (ni accessibilité outillée, ni rendu mobile vérifié).

## Décisions en attente de ton arbitrage

1. **Validation des maquettes** : écrans, vocabulaire, priorités visibles.
2. **Hébergement et budget mensuel** : PaaS UE (simple) ou Cloud Run + Cloud SQL (que tu connais via GCP).
3. **Fournisseur IA et consentement** : Claude par défaut ; accepter que le contenu du CV (sans coordonnées) soit envoyé à l'API.
4. **Budget IA journalier** : proposition 2 € / jour, à confirmer après la mesure réelle en T5.

## Prochaine étape

T0 — socle du dépôt (Next.js 16, TypeScript, CI), dès validation des maquettes.
