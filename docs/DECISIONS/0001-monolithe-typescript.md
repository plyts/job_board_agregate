# ADR 0001 — Monolithe modulaire en TypeScript (Next.js 16)

- Statut : proposé
- Date : 18/10/2026

## Contexte

Un seul développeur, un seul utilisateur au MVP, volume de l'ordre de 100 offres par jour. Le prompt suggère d'évaluer Go ou Python pour le backend. Le dépôt Yamela montre une maîtrise existante de Next.js 16, TypeScript, Zod et du SDK Anthropic.

## Options

1. Next.js + backend Go : performant, mais deux langages, contrats dupliqués, double CI.
2. Next.js + FastAPI : écosystème IA Python, même inconvénient de duplication.
3. **Next.js seul, modules métier en TypeScript, worker séparé dans la même base de code.**

## Décision

Option 3. Les schémas Zod servent à la fois à la validation des API, aux sorties structurées du modèle et aux types du front.

## Conséquences

- Un seul langage, une seule CI, types partagés de bout en bout.
- Le travail lourd (analyse IA, export PDF) tourne dans le worker, pas dans les requêtes web.
- Revoir si un besoin exige Python (OCR, modèle local) : il serait ajouté comme service isolé appelé par le worker, sans changer le reste.
