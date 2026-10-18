# Conformité RGPD

État au 18/10/2026. Ce document décrit ce que fait le code. Ce n'est pas un avis juridique : un déploiement ouvert à d'autres personnes que soi doit être relu par un juriste ou un DPO.

## Cadre

- **Usage visé : mono-utilisateur, auto-hébergé.** La personne qui installe JobPilot et y gère sa propre recherche d'emploi relève a priori de l'exemption « activité strictement personnelle ou domestique » (RGPD, art. 2.2.c). Le code applique quand même les règles ci-dessous, pour deux raisons : les données partent vers des fournisseurs tiers, et un déploiement à plusieurs comptes sort de cette exemption.
- **Déploiement pour d'autres personnes.** La personne qui héberge devient responsable du traitement. Elle doit tenir le registre (art. 30), informer les utilisateurs (art. 13), signer un accord de sous-traitance avec l'hébergeur et chaque fournisseur IA (art. 28), et évaluer le besoin d'une analyse d'impact (art. 35).
- **Masquer n'est pas anonymiser.** Le texte masqué reste une donnée personnelle pseudonymisée (art. 4.5) : employeurs, dates et missions permettent souvent de retrouver la personne. C'est pourquoi un consentement reste exigé avant tout envoi à un fournisseur externe.
- **Règlement européen sur l'IA.** Les systèmes IA qui servent à recruter ou évaluer des candidats sont à haut risque (annexe III, point 4). JobPilot sert le candidat lui-même et ne décide de rien à sa place, mais ce classement est à revérifier si l'usage change.

## Registre des traitements

| Traitement | Données | Finalité | Base légale (déploiement multi-utilisateur) | Destinataires |
|---|---|---|---|---|
| Compte et connexion | e-mail, nom affiché, empreinte du mot de passe (scrypt), sessions, tentatives de connexion | accès sécurisé | exécution du service (art. 6.1.b) ; intérêt légitime pour l'anti force brute (art. 6.1.f) | aucun |
| Offres importées | texte des annonces, URL, entreprise | analyse des exigences | exécution du service | fournisseur IA (données publiques, sans consentement) |
| Profil maître (import de CV) | CV PDF/DOCX, identité, coordonnées, expériences, formations, compétences | construire le profil sourcé | exécution du service | fournisseur IA, **texte masqué et sur consentement** (`profile.extract`) |
| Matching | profil sans coordonnées, exigences de l'offre | mesurer l'adéquation | exécution du service | fournisseur IA, masqué et sur consentement (`match.judge`) |
| CV personnalisé | sélection du profil, reformulations | adapter le CV à l'offre | exécution du service | fournisseur IA, masqué et sur consentement (`cv.suggest`) |
| Candidatures | étapes, dates, notes, lettre, documents réellement envoyés | suivi | exécution du service | aucun |
| Contacts de recruteurs | nom, rôle, e-mail, téléphone, lien | suivi des échanges | intérêt légitime (art. 6.1.f) ; données de tiers, minimales | aucun, jamais envoyés à un modèle |
| Journal des appels IA | fournisseur, modèle, finalité, jetons, coût, décomptes de masquage, empreinte de l'entrée | budget, quotas, preuve de minimisation | intérêt légitime | aucun ; **aucun contenu stocké** |
| Consentements IA | fournisseur, date de consentement et de retrait | preuve du consentement (art. 7.1) | obligation légale de preuve | aucun |
| Sauvegardes | base et fichiers, chiffrés AES-256 | continuité | intérêt légitime | hébergeur des sauvegardes |

## Envois aux modèles d'IA

Tout appel portant des données personnelles passe par une seule frontière, `generateJournaled` (`src/modules/platform/llm/journal.ts`). Les modules métier ne peuvent pas la contourner.

1. **Avant l'envoi : masquage local** (`src/modules/privacy/pii.ts`, règles versionnées `PII_RULES_VERSION`).
   - Données remplacées par une étiquette : e-mail, téléphone, adresse, code postal (en-tête du CV), date de naissance, âge, nationalité, situation familiale, n° de sécurité sociale, IBAN, liens personnels (LinkedIn, GitHub, site), nom et prénom.
   - Données sensibles de l'article 9 (santé, handicap, RQTH, religion, opinions, syndicat, orientation) : remplacées par `[DONNÉE SENSIBLE]`.
   - Le nom est cherché dans l'ordre suivant : nom déclaré à l'import, nom du profil, nom deviné dans l'en-tête du CV.
2. **Choix du fournisseur.** Un fournisseur externe n'est éligible que s'il est autorisé par la configuration (`<P>_ALLOW_PERSONAL_DATA=true`) **et** que l'utilisateur y a consenti (« Réglages › Fournisseurs IA » ou « Confidentialité »). Un modèle local n'a besoin d'aucun consentement. Sans fournisseur éligible, l'appel est refusé avec un message clair et rien ne part.
3. **Après la réponse : inspection.** La même détection est appliquée à la sortie. Ce que le modèle a repris ou inventé est retiré avant tout enregistrement, puis compté dans `llm_calls.pii_in_output`.
4. **Réinjection locale.** Le nom et les coordonnées sont remis dans le profil côté serveur (`restorePlaceholders`). Une étiquette qui reste dans la réponse devient une incertitude à relire.
5. **Rapport.**
   - Chaque import enregistre un `privacy_report` sur la version du profil : décomptes avant et après, données sensibles trouvées, taille du texte envoyé.
   - Le brouillon affiche le texte masqué exact qui a été envoyé.
   - La page « Confidentialité » liste les envois par fournisseur et leur lieu de traitement.

**Limites.**
- La détection est faite par règles : une donnée écrite d'une façon imprévue peut passer. C'est pour cela que le texte envoyé est montré.
- Le masquage s'applique au texte ; le fichier d'origine n'est jamais envoyé à un modèle.

## Transferts hors UE (chapitre V)

| Fournisseur | Lieu de traitement déclaré | Remarque |
|---|---|---|
| Modèle local | ta machine | aucun transfert |
| Mistral | UE (France) | offre gratuite : accord pour l'entraînement requis |
| Groq, Cerebras, Anthropic | États-Unis | cadre UE–États-Unis de protection des données ou clauses contractuelles types, à vérifier |
| Google Gemini | infrastructure mondiale | offre gratuite : contenus réutilisés pour améliorer les produits |
| OpenRouter | États-Unis, puis l'hébergeur du modèle | `OPENROUTER_DATA_COLLECTION=deny` exclut les hébergeurs qui conservent les requêtes |

Ces informations sont celles publiées par les fournisseurs et doivent être revérifiées avant de consentir (`src/modules/platform/llm/providers.ts`, champ `region`). **Recommandation :** pour le CV, utiliser un modèle local ou un fournisseur européen sous contrat payant.

## Durées de conservation

| Donnée | Durée | Mécanisme |
|---|---|---|
| CV importé (fichier et texte brut) | 30 jours après validation (`CV_SOURCE_RETENTION_DAYS`, 0 = immédiat) | `purgeImportedSources`, lancé par le balayage du worker (toutes les 30 minutes). Le trigger SQL n'autorise que cet effacement sur une version validée (migration 0018) |
| Brouillon d'import abandonné | immédiat, fichier compris | `discardDraft` |
| Sessions | 30 jours sans activité | `deleteExpiredSessions` (worker) |
| Tentatives de connexion | 30 jours | `purgeLoginAttempts` (worker) |
| Profil, CV, candidatures, contacts, journal IA, consentements | jusqu'à suppression par l'utilisateur ou du compte | suppression en cascade |
| Documents réellement envoyés | jusqu'à suppression du compte | protégés contre toute autre suppression (preuve) |
| Sauvegardes chiffrées | 30 jours (`BACKUP_RETENTION_DAYS`) | rotation par `scripts/backup.sh` |

Après une suppression de compte, les données restent dans les sauvegardes jusqu'à leur rotation. C'est indiqué à l'utilisateur.

## Droits des personnes

| Droit | Où |
|---|---|
| Accès et portabilité (art. 15 et 20) | « Mon compte › Exporter mes données » : ZIP JSON et fichiers, consentements compris |
| Rectification (art. 16) | profil maître, CV et candidatures modifiables ; chaque version reste datée |
| Effacement (art. 17) | « Mon compte › Supprimer mon compte » : base, fichiers et documents envoyés |
| Retrait du consentement (art. 7.3) | « Confidentialité » ou « Fournisseurs IA », effet immédiat sur les envois suivants |
| Opposition (art. 21) | ne consentir à aucun fournisseur : tout fonctionne sans IA, sauf les suggestions |
| Réclamation (art. 77) | CNIL, https://www.cnil.fr/fr/plaintes, ou l'autorité du pays de résidence |

## Sécurité (art. 32) et protection dès la conception (art. 25)

- Pas de donnée personnelle par défaut vers un tiers : refus par défaut, consentement par fournisseur, masquage systématique.
- Pour le reste, voir `docs/SECURITY.md` :
  - authentification scrypt et sessions à cookie `HttpOnly` ;
  - `user_id` toujours issu de la session ;
  - fichiers vérifiés par signature ;
  - documents envoyés immuables ;
  - sauvegardes chiffrées ;
  - logs sans contenu.

## À faire avant un déploiement multi-utilisateur

- Mentions d'information (art. 13) et politique de confidentialité publique.
- Accords de sous-traitance (art. 28) : hébergeur, stockage, fournisseurs IA payants (les offres gratuites n'en proposent généralement pas).
- Analyse d'impact (art. 35) à évaluer : profilage à grande échelle et transferts hors UE.
- Purge des sauvegardes à la demande ou chiffrement par utilisateur, si l'effacement doit être immédiat partout.
