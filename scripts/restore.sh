#!/usr/bin/env bash
# Restauration d'une archive produite par backup.sh dans une base VIDE et un dossier de stockage.
# Vérifie les empreintes SHA-256 avant toute écriture.
#
# Usage : DATABASE_URL=… BACKUP_PASSPHRASE=… STORAGE_DIR=… scripts/restore.sh <archive.tar.enc>
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL est requise}" "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE est requise}" "${STORAGE_DIR:?STORAGE_DIR est requis}"
archive="${1:?archive à restaurer}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$archive" | tar -C "$work" -xf -
(cd "$work" && sha256sum --check --quiet SHA256SUMS)

tables=$(psql "$DATABASE_URL" -Atc "select count(*) from pg_tables where schemaname = 'public'")
if [ "$tables" != "0" ]; then
  echo "Refus : la base cible n'est pas vide ($tables tables)." >&2
  exit 1
fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$DATABASE_URL" "$work/base.dump"
mkdir -p "$STORAGE_DIR"
tar -C "$STORAGE_DIR" -xf "$work/fichiers.tar"
echo "Restauration terminée."
