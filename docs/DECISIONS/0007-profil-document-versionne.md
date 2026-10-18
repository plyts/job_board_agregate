# ADR 0007 — Profil maître : un document JSON versionné et immuable

- Statut : accepté
- Date : 18/10/2026

## Contexte

Le modèle de données initial prévoyait une dizaine de tables (expériences, éléments, compétences, preuves, formations…). Les besoins réels : versionner le profil entier, ne jamais modifier une version validée, citer précisément un élément comme preuve (compétence, matching, CV personnalisé), éditer le profil d'un bloc.

## Décision

- Une table `profile_versions` : une ligne par version, contenu dans une colonne `content` (JSONB) validée par un schéma Zod unique, partagé entre serveur et navigateur (`src/modules/profile/content.ts`).
- Chaque élément citable (expérience, mission ou réalisation, projet, formation, certification) porte un identifiant court et stable, conservé d'une version à l'autre.
- Une version validée est immuable : un trigger SQL interdit sa modification et sa suppression (sauf suppression du compte). Au plus un brouillon par utilisateur (index unique partiel).
- Règles bloquant la validation : nom renseigné, dates cohérentes, identifiants uniques, toute compétence d'un niveau autre que « non confirmée » appuyée par au moins une preuve existante, et aucun doute d'extraction non levé.
- Import de CV : extraction par un fournisseur IA autorisé pour les données personnelles, coordonnées retirées avant l'envoi ; entreprises, certifications ou compétences absentes du CV source signalées « à vérifier ».

## Conséquences

- Versionnement et restauration triviaux ; pas de jointures pour reconstruire un profil.
- Pas de requêtes SQL directes sur les compétences : acceptable en mono-utilisateur, le profil tient en mémoire.
- À revoir si un usage multi-utilisateur demande des recherches transverses sur les compétences.
