#!/usr/bin/env bash
# Sauvegarde chiffrée de JobPilot : base (pg_dump, format custom) et fichiers stockés, dans une seule archive
# chiffrée AES-256 (clé dérivée de BACKUP_PASSPHRASE, PBKDF2). Les archives de plus de BACKUP_RETENTION_DAYS
# jours (30 par défaut) sont supprimées. À planifier une fois par jour (cron, tâche planifiée de l'hébergeur).
#
# Usage : DATABASE_URL=… BACKUP_DIR=… BACKUP_PASSPHRASE=… [STORAGE_DIR=.data/storage] scripts/backup.sh
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL est requise}" "${BACKUP_DIR:?BACKUP_DIR est requis}" "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE est requise}"
STORAGE_DIR="${STORAGE_DIR:-.data/storage}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$BACKUP_DIR"

pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$work/base.dump"
if [ -d "$STORAGE_DIR" ]; then
  tar -C "$STORAGE_DIR" -cf "$work/fichiers.tar" .
else
  tar -cf "$work/fichiers.tar" --files-from /dev/null
fi
(cd "$work" && sha256sum base.dump fichiers.tar > SHA256SUMS)

archive="$BACKUP_DIR/jobpilot-$stamp.tar.enc"
tar -C "$work" -cf - base.dump fichiers.tar SHA256SUMS |
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$archive"
find "$BACKUP_DIR" -maxdepth 1 -name 'jobpilot-*.tar.enc' -mtime +"$RETENTION_DAYS" -delete
echo "$archive"
