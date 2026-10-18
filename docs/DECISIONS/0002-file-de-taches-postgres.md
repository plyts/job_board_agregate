# ADR 0002 — File de tâches sur PostgreSQL (pg-boss) plutôt qu'Airflow ou Redis

- Statut : proposé
- Date : 18/10/2026

## Contexte

Besoins : analyses asynchrones, reprises avec temporisation, délais, planification quotidienne, idempotence, détection des tâches bloquées. Volume : ~10³ tâches par jour.

## Options

1. Airflow : orchestration de DAG, lourd à exploiter, inadapté aux tâches unitaires déclenchées par l'utilisateur.
2. BullMQ + Redis : robuste, mais un service de plus et pas de transaction commune avec les données.
3. **pg-boss** : file dans PostgreSQL, reprises, planification, clés de singleton.

## Décision

Option 3. La mise en file se fait dans la même transaction que l'écriture métier.

## Conséquences

- Aucune infrastructure supplémentaire ; sauvegardes et supervision communes.
- Débit limité par PostgreSQL, très au-delà du besoin.
- Revoir si > 50 tâches/s soutenues ou dépendances complexes entre étapes.
