# Audit de l'environnement et diagnostic produit

Date : 18/10/2026. Réalisé avant toute ligne de code.

## 1. Audit

### Dépôts accessibles

| Dépôt | Contenu | Rôle pour JobPilot |
|---|---|---|
| `plyts/job_board_agregate` | **Vide** (aucun commit, aucune branche distante) | Dépôt cible de JobPilot AI |
| `plyts/yamela` | Application Next.js 16 / React 19 / TypeScript / Tailwind 4 / Zod / SDK Anthropic, tests Vitest + Playwright, CI GitHub Actions | Sans lien fonctionnel. Sert de **référence de conventions** : stack que tu maîtrises déjà, CI éprouvée, usage de l'IA par sorties structurées validées par Zod |

Conséquence : pas d'architecture existante à préserver. On peut poser une structure propre, alignée sur les conventions de Yamela pour réduire la courbe d'apprentissage et réutiliser la CI.

Point d'attention relevé dans Yamela : `AGENTS.md` signale que Next.js 16 comporte des changements incompatibles avec les versions antérieures ; la doc embarquée (`node_modules/next/dist/docs/`) devra être lue avant d'écrire le code Next de JobPilot.

### Outils disponibles dans l'environnement de développement

| Outil | État |
|---|---|
| Node.js 22, npm 10 | Disponibles |
| PostgreSQL 16 (client `psql`) | Client présent, **aucun serveur lancé** ; à démarrer localement pour les tests d'intégration |
| Docker | **Indisponible** (démon absent) : les tests d'intégration utiliseront un PostgreSQL local, pas des conteneurs |
| Go 1.24, Python 3.13 | Disponibles, non requis par l'architecture retenue |
| Chromium (Playwright) | Disponible : tests e2e et rendu PDF des CV |

### Intégrations externes réellement vérifiées

Aucune. Rien n'a été connecté, synchronisé ni testé contre un jobboard. Le tableau ci-dessous est un **plan de vérification**, pas un constat d'accès.

| Source | Hypothèse à vérifier | Statut |
|---|---|---|
| Import manuel (URL, texte, PDF) | Ne dépend d'aucun tiers ; récupération d'URL soumise à robots.txt et CGU de la page | Retenu pour le MVP |
| France Travail | API publique « Offres d'emploi » avec inscription développeur | À vérifier (V2) |
| Alertes e-mail | Transfert manuel vers une adresse dédiée, sans accès à la boîte de l'utilisateur | À concevoir (V2) |
| Flux publics d'ATS (sites carrières) | Certains ATS publient des flux d'offres publics | À évaluer ATS par ATS (V2) |
| LinkedIn, Indeed, Welcome to the Jungle, Apec, HelloWork, Cadremploi, Meteojob, JobTeaser | Aucune API de collecte ouverte connue pour un usage individuel ; le scraping est généralement interdit par les CGU | **Non retenu** sans accord ou API officielle vérifiée ; import manuel uniquement |

## 2. Diagnostic produit

### Décisions déjà prises

- Mono-utilisateur pour le MVP (toi), mais toutes les données sont rattachées à un `user_id` et protégées par une authentification réelle.
- Interface en français, design system « Franklin KN » (encre et sarcelle, Inter, IBM Plex Mono).
- Maquettes validées avant code (ce livrable).

### Hypothèses à valider

| # | Hypothèse | Comment la valider | Quand |
|---|---|---|---|
| H1 | L'extraction structurée d'une offre par LLM est fiable à ≥ 90 % sur les champs obligatoires | Jeu d'évaluation de 30 offres annotées à la main | T5 |
| H2 | Le matching par exigence avec preuve citée est jugé juste dans ≥ 80 % des cas | 15 couples CV/offre annotés | T7 |
| H3 | Le coût IA reste sous ~2 € / jour pour 100 offres | Mesure réelle des tokens par analyse | T5 |
| H4 | L'import manuel suffit pour démontrer la valeur, avant tout connecteur | Usage réel pendant 2 semaines | Après MVP |
| H5 | L'objectif « 100 offres traitées / jour » est atteignable seulement avec des sources automatisées | Mesure du temps d'import manuel | Après MVP |

### Risques majeurs

| Risque | Impact | Parade |
|---|---|---|
| Hallucination dans le CV personnalisé | Critique (crédibilité) | Chaque modification porte un `source_ref` vers un élément du profil ; validation serveur qui rejette toute suggestion sans source ; recontrôle factuel |
| Injection de prompt via le texte d'une offre | Élevé | Texte importé encapsulé comme donnée, aucun outil exécutable exposé au modèle, sortie validée par schéma |
| Accès aux jobboards refusé ou interdit | Élevé pour le volume | MVP sans dépendance ; connecteurs derrière une interface commune, activés source par source |
| Faux positifs de matching (mot-clé ≠ compétence) | Élevé | Niveaux de preuve ; score calculé de façon déterministe à partir des catégories, pas par le modèle |
| Données personnelles (CV) envoyées à un fournisseur IA | Moyen | Consentement explicite, minimisation (pas de coordonnées envoyées), journalisation sans contenu |
| Coût IA non maîtrisé | Moyen | Cache par empreinte de contenu, budget journalier bloquant, déduplication avant analyse |
| Périmètre trop large | Élevé | MVP strict (voir PRD), V2/V3 explicitement exclus |

### Ce que le prompt demande et que je déconseille

- **Airflow** : inutile au MVP. Une file de tâches sur PostgreSQL (pg-boss) couvre reprises, délais et planification sans infrastructure supplémentaire (ADR 0002).
- **Base vectorielle / pgvector dès le départ** : la recherche sémantique n'apporte pas de valeur mesurable tant qu'il y a quelques centaines d'offres. Réévaluer en V2 avec pgvector, jamais une base dédiée.
- **Backend Go ou Python séparé** : un seul langage (TypeScript) suffit pour le MVP ; un service Python ne se justifierait que pour de l'OCR ou un parsing de PDF que les bibliothèques JS ne savent pas faire.
- **« Envoyer 100 candidatures par jour »** : contraire au principe de pertinence et souvent aux CGU des plateformes. Le produit mesure les offres traitées, pas les envois.
