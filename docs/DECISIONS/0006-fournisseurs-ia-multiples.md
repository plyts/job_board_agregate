# ADR 0006 — Plusieurs fournisseurs IA, offres gratuites en priorité

- Statut : accepté
- Date : 18/10/2026

## Contexte

Tu veux utiliser les offres gratuites (Groq, OpenRouter, Gemini, Mistral, Cerebras…) plutôt qu'une API payante. Ces offres ont trois limites qui conditionnent l'architecture :

1. **Quotas faibles et changeants** : de l'ordre de 20 à 30 requêtes par minute et de 50 à 1 000 par jour selon le fournisseur (sources secondaires, octobre 2026). Une seule offre gratuite ne suffit pas toujours pour 100 offres par jour.
2. **Modèles qui changent** : les modèles gratuits apparaissent et disparaissent sans préavis.
3. **Usage des données** : plusieurs offres gratuites autorisent le fournisseur à réutiliser les contenus (Gemini gratuit, Mistral Experiment, certains hébergeurs OpenRouter `:free`).

## Décision

- Un client unique pour toutes les API **compatibles OpenAI Chat Completions** (`OpenAICompatibleLlmClient`), plus le client Anthropic existant. Ajouter un fournisseur = un préréglage (URL, préfixe des variables d'environnement), sans code métier.
- Un **routeur** essaie les fournisseurs dans l'ordre de `LLM_PROVIDERS` (par défaut : local, Groq, Cerebras, Gemini, Mistral, OpenRouter, puis Anthropic payant). Un fournisseur saturé (429, limite par minute), en quota journalier épuisé, en échec ou dont la sortie est invalide laisse la place au suivant. Chaque tentative est journalisée dans `llm_calls` avec son fournisseur.
- **Données personnelles** : chaque requête déclare `dataClass` (`public` pour une annonce, `personal` pour un CV). Un fournisseur ne reçoit des données personnelles que si `<FOURNISSEUR>_ALLOW_PERSONAL_DATA=true` ; refus par défaut, sauf pour un modèle local.
- **Aucun identifiant de modèle figé** dans le code : `<FOURNISSEUR>_MODEL` est obligatoire. `npm run llm:check` vérifie chaque fournisseur configuré.
- **Sortie structurée** : `json_schema` strict (schéma dérivé de Zod), avec repli automatique en `json_object` et schéma dans le prompt si le modèle refuse. La sortie est toujours validée par Zod, puis par le contrôle déterministe des citations (ADR 0003).
- **Quotas** : limite par minute en mémoire du worker ; limite journalière vérifiée en base, persistante. Quand tous les quotas sont épuisés, l'analyse est reportée (statut « En file ») et reprise par le balayage planifié.

## Conséquences

- Coût direct nul possible pour l'analyse des offres ; qualité à mesurer fournisseur par fournisseur avec `npm run eval:offers -- --yes --provider <id>`.
- Les modèles ouverts suivent moins bien les consignes : le contrôle des citations et la validation du schéma deviennent essentiels, et un taux d'exigences « incertaines » plus élevé est attendu.
- Les limites par défaut sont indicatives : à vérifier sur la console de chaque fournisseur.
- À revoir si : un fournisseur gratuit change ses conditions de données, ou si la qualité mesurée est insuffisante pour le matching (T6), qui manipule des données personnelles.
