# Héberger JobPilot gratuitement : test local, accès depuis le téléphone, en ligne 24 h/24

Relevé le 19/10/2026. Les offres gratuites changent sans préavis : vérifier les conditions citées avant de s'y fier.

## Pourquoi pas GitHub Pages

GitHub Pages ne sert que des fichiers statiques (HTML, CSS, JavaScript) : il n'exécute aucun code serveur ([documentation GitHub](https://docs.github.com/en/enterprise-server@3.6/pages/getting-started-with-github-pages/about-github-pages)). Or JobPilot a besoin en permanence :
- d'un serveur Next.js (connexion, Server Actions, export PDF/DOCX) ;
- d'une base PostgreSQL ;
- d'un worker (analyses, matching, relevé de la boîte d'alertes toutes les 15 min, recherches enregistrées, sauvegardes).

S'y ajoutent deux raisons de principe :
- **site public.** Un site Pages est public, sauf avec un abonnement payant. Or JobPilot contient ton CV et tes candidatures.
- **usage déconseillé par GitHub.** GitHub déconseille Pages pour tout envoi de mot de passe, et il y en a un à la connexion.

GitHub Pages peut seulement servir une page de présentation ou la documentation du projet. L'application elle-même tourne sur ta machine, ou sur une VM gratuite.

| Besoin | Solution gratuite | Section |
|---|---|---|
| Tester sur ton ordinateur | Docker Compose | 1 |
| IA sans frais et sans envoyer ton CV ailleurs | Ollama (modèle local) | 2 |
| Ouvrir JobPilot depuis ton téléphone, sans l'exposer sur Internet | Tailscale Serve | 3 |
| Fonctionner 24 h/24, ordinateur éteint | VM Oracle Cloud « Always Free » + Tailscale | 4 |

## 1. Tester en local (Windows, macOS, Linux)

**Prérequis.**
- **Docker** : Docker Desktop, gratuit pour un usage personnel (sous Windows, il installe WSL 2), ou Docker Engine sous Linux.
- **Git.**
- **Bash et openssl** : sous Windows, *Git Bash*, installé avec Git, fournit les deux.

```sh
git clone -b claude/keen-wozniak-bguqkr https://github.com/plyts/job_board_agregate.git jobpilot && cd jobpilot
bash scripts/init-env.sh          # crée .env et génère les secrets (mot de passe de la base, clés)
docker compose up -d --build      # construit l'image (quelques minutes la première fois) puis démarre tout
docker compose ps                 # db healthy · migrate exited (0) · web healthy · worker running
```

La branche `claude/keen-wozniak-bguqkr` est pour l'instant la seule du dépôt : le code n'a pas encore été fusionné dans une branche principale. `scripts/init-env.sh` ne remplace jamais une valeur déjà renseignée. Note à part, dans un gestionnaire de mots de passe, `BACKUP_PASSPHRASE` et `JOBPILOT_SECRETS_KEY`. Sans elles, aucune restauration de sauvegarde ni lecture des identifiants des sources n'est possible.

Créer ton compte, puis ouvrir [http://localhost:3000](http://localhost:3000) :

```sh
docker compose exec -e JOBPILOT_PASSWORD='un mot de passe long' worker npm run user:create -- --email moi@exemple.fr --name "Mon nom"
```

L'application n'écoute que sur ta machine (`127.0.0.1:3000`) : personne d'autre ne peut l'ouvrir.

| Action | Commande |
|---|---|
| Arrêter (les données restent) | `docker compose stop` |
| Redémarrer | `docker compose start` |
| Mettre à jour après un `git pull` | `docker compose up -d --build` (les migrations passent avant le redémarrage) |
| Voir les journaux | `docker compose logs -f web worker` |
| Tout effacer, données comprises | `docker compose down -v` |

**Si la connexion revient sans cesse à la page de connexion** (Safari, ou navigateur qui ne traite pas `localhost` comme sûr) : ajouter `COOKIE_INSECURE=1` dans `.env`, puis `docker compose up -d`. **Uniquement pour un test sur ta machine**, jamais avec un accès à distance.

**Sauvegardes en local.** Le worker sauvegarde chaque nuit à 03:15 si la machine est allumée ; une échéance manquée est rattrapée au démarrage. Les archives chiffrées sont dans le volume `backups`. Pour en garder une copie ailleurs (clé USB, disque externe) :

```sh
docker compose cp worker:/backups ./sauvegardes
```

## 2. IA gratuite

| Option | CV et candidatures | Offres | Remarque |
|---|---|---|---|
| **Ollama** (modèle sur ta machine) | Oui, sans consentement : rien ne sort de ta machine | Oui | Gratuit ; lent sans carte graphique (une analyse peut prendre une minute ou plus) |
| Groq, OpenRouter (modèles `:free`), Cerebras | Refusé par défaut | Oui | Clé gratuite, quotas journaliers ; voir `.env.example` |
| Gemini, Mistral gratuits | Déconseillé : contenus réutilisés pour l'entraînement | Oui | |

Ollama installé normalement sur ta machine, hors Docker, utilise la carte graphique (Metal sur Mac, CUDA sur PC) :

```sh
ollama pull qwen2.5:7b            # exemple : un modèle 7-8B qui sait produire du JSON ; à comparer avec npm run eval:offers
```

Dans `.env` :

```sh
LOCAL_BASE_URL=http://host.docker.internal:11434/v1
LOCAL_MODEL=qwen2.5:7b
```

Puis `docker compose up -d` et `docker compose exec worker npm run llm:check`. La ligne « Modèle local » doit passer à ✓ ; « Fournisseur injoignable » signifie qu'Ollama n'est pas lancé. Sans aucun fournisseur, l'application fonctionne quand même :
- saisie manuelle du profil ;
- matching par règles seules ;
- édition du CV à la main.

## 3. Ouvrir JobPilot depuis ton téléphone : Tailscale Serve (gratuit, privé)

[Tailscale](https://tailscale.com/docs/features/tailscale-serve) relie tes appareils dans un réseau privé chiffré. Son offre personnelle est gratuite (100 appareils et 3 utilisateurs selon un guide communautaire, à vérifier). **Serve** publie JobPilot en HTTPS, avec un vrai certificat, à une adresse joignable seulement par tes appareils. Le cookie de session exige HTTPS, Serve le fournit.

1. Créer un compte Tailscale, installer Tailscale sur l'ordinateur qui fait tourner JobPilot et sur ton téléphone, se connecter au même compte.
2. Sur l'ordinateur :

   ```sh
   tailscale serve --bg 3000
   tailscale serve status        # affiche l'adresse : https://<machine>.<ton-réseau>.ts.net
   ```

   La première fois, Tailscale propose d'activer les certificats HTTPS du réseau : accepter.
3. Ouvrir cette adresse sur le téléphone, avec Tailscale actif.

**Ne pas utiliser `tailscale funnel`** : Funnel publie le service sur Internet, pour n'importe qui.

L'ordinateur doit rester allumé, et l'accès ne passe que par HTTPS (`COOKIE_INSECURE` absent de `.env`).

## 4. En ligne 24 h/24 : VM Oracle Cloud « Always Free »

Oracle Cloud propose des ressources « Always Free », sans limite de durée, notamment des VM ARM (Ampere A1).
- **Ressources.** L'allocation aurait été réduite le 15/06/2026 à 2 cœurs et 12 Go de mémoire, au lieu de 4 cœurs et 24 Go ([InfoQ](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/), [documentation Oracle](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm)). C'est suffisant pour JobPilot : au repos, PostgreSQL, le web et le worker occupent ensemble environ 300 Mo (mesuré le 19/10/2026), le reste sert aux pointes (import de PDF, exports).
- **Carte bancaire.** Elle est demandée à l'inscription. Rester sur un compte « Always Free », sans passer au paiement à l'usage. Créer une alerte de budget à 1 € pour être prévenu de toute facturation.
- **Région UE.** Choisir Paris, Marseille ou Francfort à l'inscription : c'est la région d'attache du compte, et le CV reste dans l'UE (docs/RGPD.md).

Mise en place :
1. Créer une VM *Ampere A1* sous Ubuntu, 2 cœurs et 12 Go au plus, avec une clé SSH. Laisser fermés tous les ports entrants, sauf SSH.
2. Installer Docker Engine et Tailscale sur la VM, puis `tailscale up`.
3. Suivre les sections 1 et 3 de ce guide sur la VM. Les images utilisées existent en ARM, mais la construction sur ARM n'a pas été testée.
4. Facultatif : fermer aussi SSH sur Internet et passer par Tailscale (`tailscale up --ssh`).

Pas besoin de nom de domaine ni de Caddy : Tailscale Serve fournit l'adresse et le certificat. Pour la copie hors site des sauvegardes, `BACKUP_COPY_COMMAND` peut envoyer chaque archive vers ton ordinateur par SFTP, au travers de Tailscale (rclone, voir docs/DEPLOIEMENT.md).

## À éviter, même gratuit

- **Vercel, Netlify (offres gratuites).** Fonctions sans serveur permanent : le worker ne peut pas y tourner (file pg-boss, relevé IMAP toutes les 15 min, sauvegardes).
- **Render gratuit.** Service mis en veille après inactivité et base gratuite à durée limitée : le worker s'arrête.
- **Port 3000 ouvert sur Internet, ou `tailscale funnel`.** Ton CV deviendrait joignable par n'importe qui ; la connexion seule ne suffit pas comme protection.
- **Cloudflare Tunnel** (accès public protégé par Cloudflare Access, gratuit jusqu'à 50 utilisateurs, voir [Cloudflare](https://www.cloudflare.com/en-au/products/cloudflare-access)). Possible, mais un tunnel nommé demande un nom de domaine géré par Cloudflare, donc payant. Tailscale suffit pour un usage personnel.

## Ce qui a été vérifié

Le 19/10/2026, sur Linux avec Docker Engine, depuis une copie propre du dépôt :
- `scripts/init-env.sh` crée `.env` (droits 600), et un second passage conserve les valeurs ;
- `docker compose up -d` démarre la base, les migrations, le web (sain) et le worker ;
- création du compte ;
- connexion dans Chromium sur `http://localhost:3000` et `http://127.0.0.1:3000`, sans `COOKIE_INSECURE` ;
- `host.docker.internal` est joignable depuis le worker, et `llm:check` signale Ollama absent ;
- `docker compose cp worker:/backups ./sauvegardes` copie le dossier des sauvegardes ;
- mémoire au repos : worker 154 Mo, base 85 Mo, web 63 Mo.

**Non testés ici** :
- Docker Desktop sous Windows et macOS ;
- Safari ;
- Tailscale ;
- Oracle Cloud et la construction ARM ;
- une analyse réelle avec Ollama.
