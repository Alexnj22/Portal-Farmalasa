#!/bin/bash
# Aplica el baseline a la rama de verificacion y compara su huella contra prod.
# Uso: verificar.sh <nombre-rama> [--reset]
#   --reset: borra y recrea `public` antes de aplicar (para reintentar limpio).
#
# El host directo db.<ref>.supabase.co es IPv6 y no tiene ruta desde aca: hay que
# ir por el pooler. La contraseña de la RAMA la da `supabase branches get`.
set -uo pipefail
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

D="$(cd "$(dirname "$0")" && pwd)"
RAMA="${1:?falta el nombre de la rama}"
REPO=/Users/alexnunez/Documents/Portal-Farmalasa
BASE="$D/20260101000000_baseline_schema.sql"

cd "$REPO"
mv .env .env.cli-hold 2>/dev/null
restore(){ mv .env.cli-hold .env 2>/dev/null; }
trap restore EXIT

# `branches get` imprime una tabla separada por '|':
#   HOST | PORT | USER | PASSWORD | JWT SECRET | POSTGRES VERSION | STATUS
# La fila de datos es la que trae el host db.<ref>.supabase.co.
INFO=$(supabase branches get "$RAMA" 2>/dev/null | grep -E 'db\.[a-z]+\.supabase\.co' | tail -1)
HOST=$(awk -F'|' '{gsub(/[[:space:]]/,"",$1); print $1}' <<<"$INFO")
USER=$(awk -F'|' '{gsub(/[[:space:]]/,"",$3); print $3}' <<<"$INFO")
PASS=$(awk -F'|' '{gsub(/[[:space:]]/,"",$4); print $4}' <<<"$INFO")
REF=$(sed 's/^db\.\([a-z]*\)\.supabase\.co$/\1/' <<<"$HOST")

if [ -z "${PASS:-}" ] || [ -z "${REF:-}" ]; then
  echo "no pude leer las credenciales de la rama (host='${HOST:-}')"
  restore; exit 1
fi

URL="postgresql://postgres.${REF}:${PASS}@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
echo "rama=$RAMA  ref=$REF  user=$USER  (contraseña no se imprime)"
echo "conectando por el pooler…"
psql "$URL" -Atc "select 'conectado a '||current_database()||' como '||current_user" || { restore; exit 1; }

if [ "${2:-}" = "--reset" ]; then
  echo "== reset de public =="
  psql "$URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" \
               -c "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;"
fi

echo "== aplicando el baseline =="
psql "$URL" -v ON_ERROR_STOP=0 -f "$BASE" > "$D/apply.out" 2> "$D/apply.err"
echo "  ERRORes: $(grep -c '^psql:.*ERROR' "$D/apply.err")"
echo "  primeros errores:"; grep '^psql:.*ERROR' "$D/apply.err" | head -15 | sed 's/^/    /'

echo "== huella de la rama =="
psql "$URL" -F',' -A -f "$D/fingerprint2.sql" > "$D/fp_rama.csv" 2>"$D/fp_rama.err"
head -20 "$D/fp_rama.csv"

restore; trap - EXIT

echo
echo "== comparacion contra prod (t0) =="
python3 - "$D/fp_prod.csv" "$D/fp_rama.csv" <<'PY'
import csv, sys
def leer(p):
    out = {}
    with open(p) as fh:
        for row in csv.reader(fh):
            if len(row) == 3 and row[0] != "tipo" and not row[0].startswith("("):
                out[row[0]] = (row[1], row[2])
    return out
prod, rama = leer(sys.argv[1]), leer(sys.argv[2])
ok = True
print(f"{'categoria':18s} {'prod':>16s} {'rama':>16s}  veredicto")
for k in sorted(set(prod) | set(rama)):
    p, r = prod.get(k), rama.get(k)
    if p == r:
        v = "= IGUAL"
    else:
        v, ok = "≠ DIFIERE", False
    pn = f"{p[0]}/{p[1][:8]}" if p else "(falta)"
    rn = f"{r[0]}/{r[1][:8]}" if r else "(falta)"
    print(f"{k:18s} {pn:>16s} {rn:>16s}  {v}")
print()
print("RESULTADO:", "las 15 categorias COINCIDEN" if ok else "HAY DIFERENCIAS — no commitear")
PY
