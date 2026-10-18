#!/usr/bin/env bash
# Vérification de bout en bout : sauvegarde de SOURCE_URL, restauration dans une base neuve, puis comparaison
# du nombre de lignes de chaque table et des empreintes des fichiers.
#
# Usage : SOURCE_URL=… ADMIN_URL=… (connexion pour créer la base de contrôle) [STORAGE_DIR=…] scripts/backup-check.sh
set -euo pipefail
: "${SOURCE_URL:?SOURCE_URL est requise}" "${ADMIN_URL:?ADMIN_URL est requise}"
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"; psql "$ADMIN_URL" -qc "drop database if exists jobpilot_restore_check" >/dev/null' EXIT
export BACKUP_PASSPHRASE="contrôle-$(date +%s)-$RANDOM"
src_storage="${STORAGE_DIR:-$tmp/source-storage}"
mkdir -p "$src_storage"

archive=$(DATABASE_URL="$SOURCE_URL" BACKUP_DIR="$tmp/backups" STORAGE_DIR="$src_storage" "$here/backup.sh")
psql "$ADMIN_URL" -qc "drop database if exists jobpilot_restore_check" -c "create database jobpilot_restore_check" >/dev/null
target_url="${ADMIN_URL%/*}/jobpilot_restore_check"
DATABASE_URL="$target_url" STORAGE_DIR="$tmp/restored-storage" "$here/restore.sh" "$archive" >/dev/null

counts() {
  psql "$1" -At <<'SQL'
select string_agg(format('%s=%s', table_name, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text), ' ' order by table_name)
from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';
SQL
}
before=$(counts "$SOURCE_URL")
after=$(counts "$target_url")
files_before=$( (cd "$src_storage" && find . -type f -exec sha256sum {} + | sort) || true)
files_after=$( (cd "$tmp/restored-storage" && find . -type f -exec sha256sum {} + | sort) || true)
echo "archive : $(du -h "$archive" | cut -f1) ; tables : $(echo "$before" | wc -w) ; fichiers : $(echo -n "$files_before" | grep -c . || true)"
if [ "$before" = "$after" ] && [ "$files_before" = "$files_after" ]; then
  echo "OK : lignes et fichiers identiques après restauration."
else
  echo "ÉCHEC : différences après restauration." >&2
  diff <(echo "$before" | tr ' ' '\n') <(echo "$after" | tr ' ' '\n') >&2 || true
  exit 1
fi
