# Sécurité et données personnelles

## Menaces principales et contrôles

| Menace | Contrôle |
|---|---|
| Injection de prompt dans une offre ou un CV importé | Contenu délimité et déclaré comme donnée ; aucun outil exposé au modèle ; sortie validée par schéma ; aucune action déclenchée par une sortie de modèle sans action utilisateur |
| Hallucination présentée comme un fait | Citations vérifiées dans la source ; suggestions sans `source_refs` rejetées par le serveur ; recontrôle factuel avant finalisation |
| Accès aux données d'un autre utilisateur | `user_id` issu de la session uniquement, jamais du client ; filtre systématique dans la couche d'accès ; tests d'autorisation par route |
| Fichiers malveillants (PDF, DOCX) | Type vérifié par signature, taille ≤ 10 Mo, parsing dans le worker avec délai limite, jamais servis inline (`Content-Disposition: attachment`) |
| SSRF lors de l'import par URL | Résolution DNS puis refus des adresses privées, de boucle locale et de métadonnées cloud ; HTTPS/HTTP seulement ; 5 s de délai, 2 Mo max, 3 redirections max revalidées |
| XSS via le texte d'une offre | Rendu en texte (échappement React), aucun HTML importé injecté tel quel |
| Vol de session | Cookie `HttpOnly; Secure; SameSite=Lax`, rotation à la connexion, expiration, CSRF sur les mutations |
| Fuite de secrets | Variables d'environnement, jamais dans le dépôt ; clé IA côté serveur uniquement |
| Modification d'un document envoyé | Trigger SQL interdisant `UPDATE`/`DELETE` ; empreinte SHA-256 vérifiée au téléchargement |

## Données personnelles (RGPD)

- Données : CV, coordonnées, historique de candidatures, contacts de recruteurs (saisis manuellement).
- Base légale : usage personnel ; consentement explicite avant le premier envoi de contenu au fournisseur IA, révocable.
- Minimisation : coordonnées retirées du texte envoyé au modèle ; logs sans contenu personnel.
- Fournisseurs IA : chaque requête est classée `public` (annonce) ou `personal` (CV, candidature). Une donnée personnelle n'est envoyée qu'à un fournisseur explicitement autorisé (`<P>_ALLOW_PERSONAL_DATA=true`) ; refus par défaut, sauf modèle local. Plusieurs offres gratuites réutilisent les contenus (ADR 0006).
- Hébergement et fournisseur IA en UE ou avec garanties contractuelles, à confirmer.
- Export complet (JSON + fichiers) et suppression complète du compte disponibles.
- Sauvegardes chiffrées quotidiennes, rétention 30 jours, restauration testée.
