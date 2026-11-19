#!/usr/bin/env bash
# Respaldo completo de la base de la boda (datos + estructura) con pg_dump.
#
#   SUPABASE_DB_URL='postgresql://postgres.xxxx:CLAVE@aws-0-....pooler.supabase.com:5432/postgres' \
#     bash scripts/respaldo.sh [carpeta]
#
# La URL está en Project Settings → Database → Connection string (modo
# «Session», puerto 5432). Las fotos NO van acá: viven en Storage; para ellas,
# Panel → Álbum → «Descargar todo» (ZIP).
set -euo pipefail
: "${SUPABASE_DB_URL:?Falta SUPABASE_DB_URL}"
destino="${1:-respaldos}"
mkdir -p "$destino"
archivo="$destino/boda-$(date -u +%Y%m%d-%H%M%S).dump"
# Sólo los esquemas propios: auth y storage los administra Supabase.
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges --schema=public --file="$archivo"
echo "Respaldo en $archivo ($(du -h "$archivo" | cut -f1))"
# Restaurar en un proyecto nuevo (después de correr supabase/schema.sql):
#   pg_restore --data-only --no-owner --disable-triggers -d "$OTRA_DB_URL" "$archivo"
