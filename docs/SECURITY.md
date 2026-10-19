# Sécurité et données personnelles

## Menaces principales et contrôles

| Menace | Contrôle |
|---|---|
| Injection de prompt dans une offre ou un CV importé | Contenu délimité et déclaré comme donnée ; aucun outil exposé au modèle ; sortie validée par schéma ; aucune action déclenchée par une sortie de modèle sans action utilisateur |
| Hallucination présentée comme un fait | Citations vérifiées dans la source ; suggestions sans source écartées par le serveur et refusées par la base (`CHECK`) ; suggestion qui ajoute un chiffre ou un mot-clé de l'offre bloquée ; faits du CV (intitulés, entreprises, dates) toujours relus dans le profil maître ; finalisation refusée tant qu'un écart factuel subsiste |
| Accès aux données d'un autre utilisateur | `user_id` issu de la session uniquement, jamais du client ; filtre systématique dans la couche d'accès ; tests d'autorisation par route |
| Fichiers malveillants (PDF, DOCX) | Type vérifié par signature, taille ≤ 10 Mo, parsing dans le worker avec délai limite, jamais servis inline (`Content-Disposition: attachment`) |
| SSRF lors de l'import par URL | Résolution DNS puis refus des adresses privées, de boucle locale et de métadonnées cloud ; HTTPS/HTTP seulement ; 5 s de délai, 2 Mo max, 3 redirections max revalidées |
| XSS via le texte d'une offre | Rendu en texte (échappement React), aucun HTML importé injecté tel quel |
| Vol de session | Cookie `HttpOnly; Secure; SameSite=Lax`, rotation à la connexion, expiration, CSRF sur les mutations |
| Fuite de secrets | Variables d'environnement, jamais dans le dépôt ; clé IA côté serveur uniquement |
| Identifiants des sources (clés d'API, mot de passe IMAP) | Jamais de mot de passe de compte de jobboard ; chiffrement AES-256-GCM (`JOBPILOT_SECRETS_KEY` hors base, contexte authentifié utilisateur + source) ; jamais affichés, journalisés ni exportés ; connexion testée avant enregistrement |
| Hôte IMAP saisi visant le réseau interne | Résolution DNS puis refus des adresses non publiques ; TLS (993) ou STARTTLS exigé (143), jamais de mot de passe en clair ; lecture seule |
| Liens de suivi des alertes | Requêtes HEAD seulement, protections SSRF de l'import par URL, aucun appel vers un domaine exclu (LinkedIn, Indeed) |
| Modification d'un document envoyé | Trigger SQL interdisant `UPDATE`/`DELETE` ; empreinte SHA-256 vérifiée au téléchargement |

## Données personnelles (RGPD)

Registre des traitements, transferts, durées de conservation et droits : `docs/RGPD.md`. En résumé :

- Données : CV, coordonnées, historique de candidatures, lettres de motivation, contacts de recruteurs (données de tiers, saisies manuellement, jamais envoyées à un modèle, liens limités à http/https).
- Masquage avant et après chaque appel IA portant des données personnelles (`src/modules/privacy/pii.ts`, appliqué dans `generateJournaled`, sans contournement possible par un module métier) : identité, coordonnées, adresse, naissance, âge, nationalité, situation familiale, NIR, IBAN, liens personnels et données sensibles (art. 9) remplacés par une étiquette ; même inspection sur la réponse ; identité réinjectée localement. Le texte masqué envoyé est montré à l'import.
- Envoi à un fournisseur externe seulement s'il est autorisé par la configuration (`<P>_ALLOW_PERSONAL_DATA=true`, refus par défaut sauf modèle local) **et** consenti par l'utilisateur (table `ai_consents`, retrait à tout moment). Le masquage est une pseudonymisation, pas une anonymisation : d'où le consentement.
- Conservation limitée : CV importé effacé 30 jours après validation (`CV_SOURCE_RETENTION_DAYS`), brouillon abandonné effacé avec son fichier, sessions expirées et tentatives de connexion purgées, sauvegardes 30 jours.
- Exports PDF/DOCX servis en pièce jointe, `Cache-Control: private, no-store`, à leur seul propriétaire ; logs sans contenu personnel ; journal IA sans contenu (décomptes de masquage seulement).
- Export complet (ZIP : JSON et fichiers, consentements compris, sans secret) et suppression définitive du compte (confirmée par e-mail et mot de passe), dans « Réglages › Mon compte ». Page « Réglages › Confidentialité » : masquage, consentements, envois par fournisseur et lieu de traitement, durées, droits.
- Sauvegardes : `scripts/backup.sh` (base et fichiers, AES-256, rétention 30 jours, à planifier chaque jour) ; restauration vérifiée par `npm run backup:check` (lignes et fichiers identiques). Voir `docs/OPERATIONS.md`.
