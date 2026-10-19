#!/usr/bin/env bash
# Prépare .env pour Docker Compose (test local ou VM) : copie .env.example s'il manque, puis génère les secrets
# encore vides (POSTGRES_PASSWORD, BACKUP_PASSPHRASE, JOBPILOT_SECRETS_KEY). Une valeur déjà renseignée n'est jamais remplacée.
# Usage : bash scripts/init-env.sh   (macOS, Linux, ou Git Bash sous Windows ; openssl requis)
set -euo pipefail
cd "$(dirname "$0")/.."

command -v openssl >/dev/null || { echo "openssl introuvable (Git Bash l'inclut sous Windows)." >&2; exit 1; }
if [ ! -f .env ]; then
  cp .env.example .env
  echo "• .env créé depuis .env.example"
fi
chmod 600 .env

set_if_empty() {
  local key="$1" value="$2"
  if grep -Eq "^${key}=.+" .env; then
    echo "• ${key} déjà renseignée : conservée"
  elif grep -Eq "^${key}=" .env; then
    # Remplacement sans sed -i (options différentes sous macOS et Linux).
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k && !done { print k, v; done = 1; next } { print }' .env > .env.tmp && mv .env.tmp .env
    echo "• ${key} générée"
  else
    printf '%s=%s\n' "$key" "$value" >> .env
    echo "• ${key} générée"
  fi
}

set_if_empty POSTGRES_PASSWORD "$(openssl rand -hex 24)"
set_if_empty BACKUP_PASSPHRASE "$(openssl rand -hex 32)"
set_if_empty JOBPILOT_SECRETS_KEY "$(openssl rand -base64 32)"
chmod 600 .env

echo
echo "À conserver hors de cette machine (gestionnaire de mots de passe) : BACKUP_PASSPHRASE et JOBPILOT_SECRETS_KEY."
echo "Sans elles, ni restauration des sauvegardes, ni lecture des identifiants des sources."
