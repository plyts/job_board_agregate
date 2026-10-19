# ADR 0011 — Sources connectées : API officielles, pages carrières et alertes e-mail, jamais les comptes des jobboards

- Statut : accepté
- Date : 19/10/2026

## Contexte

L'utilisateur veut chercher en une fois sur tous ses jobboards et suivre les offres :

- Indeed, LinkedIn, JobTeaser, Cadremploi, Welcome to the Jungle, HelloWork, Meteojob ;
- France Travail, Adzuna et les pages carrières d'entreprises.

La demande initiale était de « gérer l'authentification » à tous ces sites. Se connecter avec ses identifiants pour en extraire les offres pose trois problèmes :
- c'est contraire aux conditions de LinkedIn (article 8.2 : robots et extraction interdits) et, selon des sources secondaires, à celles d'Indeed ;
- le compte s'expose à une suspension ;
- conserver des mots de passe de sites tiers est un risque de sécurité.

Le cahier des charges l'exclut aussi : « aucun scraping non autorisé ».

## Décision

Quatre types de sources, chacune dans un connecteur (`src/modules/sources`). Le cœur métier ne reçoit que des offres normalisées (`IncomingOffer`).

| Source | Accès | Texte de l'offre |
|---|---|---|
| France Travail | API officielle « Offres d'emploi v2 », OAuth2 client credentials (identifiants d'une application francetravail.io) | complet |
| Adzuna | API officielle (app_id, app_key) | extrait : offre « à compléter » |
| Pages carrières | flux publics Greenhouse, Lever, Ashby, Recruitee, SmartRecruiters, sans identifiant | complet |
| Alertes e-mail | boîte dédiée lue en IMAP, **lecture seule** (mot de passe d'application) : LinkedIn, Indeed, Welcome to the Jungle, HelloWork, Cadremploi, Meteojob, JobTeaser, APEC, France Travail | extrait ; texte récupéré seulement si robots.txt l'autorise, jamais pour LinkedIn ni Indeed (à coller) |

**Identifiants.**
- Seuls des clés d'API et un mot de passe d'application IMAP sont demandés, jamais le mot de passe d'un compte de jobboard.
- Ils sont chiffrés en AES-256-GCM avec `JOBPILOT_SECRETS_KEY` (variable d'environnement, hors base).
  - Contexte authentifié : utilisateur et source.
  - Chaque connexion est testée avant d'être enregistrée.
  - Les identifiants ne sont ni affichés ni exportés.

**Recherche combinée** (« Recherche »).
- Les sources interrogeables sont appelées en parallèle. Une source en échec n'empêche pas les autres.
- Les résultats sont fusionnés : une même annonce n'apparaît qu'une fois, avec la liste des jobboards où elle a été vue.
  - Même URL, y compris l'URL du partenaire donnée par France Travail.
  - Ou même intitulé, entreprise et ville, sauf deux identifiants différents d'un même site (intérim, postes multiples).
- Mots-clés : une virgule sépare des variantes (5 au plus), cherchées chacune par une requête ; les résultats sont réunis. Les API combinent leurs mots-clés en « et » (à vérifier pour France Travail).
- Lieu : ville, code postal (jamais lu comme code INSEE) ou département. Les pages carrières ne reconnaissent d'un département que son nom, son code et sa préfecture.
- Les offres déjà connues sont signalées. L'import est sélectif.

**Recherches enregistrées.**
- Le worker les relance toutes les 3 à 24 h. Il importe les nouvelles offres des plus récentes aux plus anciennes, dans la limite d'un plafond par passage : chaque offre complète part en analyse (quotas IA).
- Le plafond compte ce qui lance réellement une analyse ou crée une offre : créations et offres « à compléter » complétées. Les offres connues sont reconnues avec exactement la règle de l'import (`knownOfferId`).

**Alertes e-mail.**
- La boîte est lue toutes les 15 minutes, à partir du dernier UID traité (UIDVALIDITY contrôlé). Un relevé dure 6 minutes au plus : la suite reprend au premier e-mail non traité.
- Aucun message n'est marqué lu, déplacé ni supprimé.
- Les e-mails non reconnus sont comptés et affichés.
- Les liens de suivi sont résolus par requêtes HEAD, avec les protections anti-SSRF. Un lien vers un domaine exclu n'est jamais contacté.
- Pour LinkedIn et Indeed, aucun lien n'est suivi, même par un routeur d'e-mails : seuls les liens directs vers l'offre, ou cachés dans un paramètre, sont lus. `lnkd.in` est un domaine exclu.

**Dédoublonnage.**
- `offer_sightings` (jobboard, identifiant externe) : une offre revue sur la même source n'est pas recomptée.
- Entre sources : URL canonique ou URL connexe (`related_urls`, dans les deux sens), empreinte du texte, ou `dedup_key` (intitulé + entreprise + ville sans accents ni arrondissement, sur 90 jours ; « Saint-Denis » et « Saint-Malo » restent distinctes).
- Un texte complet reçu plus tard complète l'offre « à compléter ».

## Conséquences

- LinkedIn et Indeed ne sont couverts que par leurs alertes : intitulé, entreprise, lieu et lien. Le texte complet se colle depuis la fiche de l'offre (statut « Texte à compléter »).
- Les formes des liens et des alertes de chaque jobboard ont été établies d'après les adresses publiques des offres, pas sur de vraies alertes.
  - Elles sont à valider avec les alertes reçues ; l'écran Sources compte les e-mails non reconnus pour les corriger.
- Les détails des API ont été relevés sur des sources secondaires (documentations officielles injoignables depuis l'environnement de développement) et sont à vérifier :
  - France Travail : portée, limite de 1 150 résultats, codes `natureContrat` de l'alternance ;
  - Adzuna : quotas ;
  - ATS : adresses des flux.
  - Aucune de ces API n'a été appelée réellement : tests avec de faux serveurs, et un vrai serveur IMAP (GreenMail).
- `JOBPILOT_SECRETS_KEY` devient nécessaire pour connecter une source. La perdre impose de ressaisir les identifiants ; les offres ne sont pas touchées.
- Les recherches ponctuelles et leurs résultats sont effacés après 30 jours.
