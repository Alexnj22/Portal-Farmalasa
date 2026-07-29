#!/usr/bin/env python3
"""Ensambla el baseline del esquema `public` a partir del volcado del catalogo.

v2 (2026-07-29). Diferencias con v1, que eran fallas reales:
  - v1 movia los 333 archivos de supabase/migrations/ a migrations-legacy/ en el
    acto, ANTES de verificar nada. Esta version por defecto NO toca el repo:
    escribe el baseline donde se le diga y solo archiva con --apply.
  - v1 no emitia ACLs, publicaciones, comentarios ni reloptions (ver gen_ddl2.sql).

Uso:
    python3 build_baseline2.py ddl2.json --out /ruta/baseline.sql
    python3 build_baseline2.py ddl2.json --out supabase/migrations/<v>_baseline_schema.sql --apply
"""
import argparse, collections, json, os, sys

TITULOS = {
    10: "Extensiones",
    20: "Secuencias (las no-IDENTITY; las IDENTITY las recrea el CREATE TABLE)",
    25: "Funciones y procedimientos (antes de las tablas: hay columnas GENERATED "
        "que las llaman. Excluye miembros de extension)",
    30: "Tablas",
    31: "Storage parameters por tabla",
    32: "Secuencias IDENTITY con nombre fosilizado por un rename de tabla",
    50: "Vistas y vistas materializadas (matviews WITH NO DATA)",
    60: "Claves primarias y unicidad",
    70: "Claves foraneas y CHECK",
    80: "Indices (los que no respaldan un constraint)",
    90: "Triggers",
    95: "RLS habilitado",
    96: "Policies",
    97: "Privilegios (REVOKE ALL + los GRANT exactos de produccion)",
    98: "Publicaciones (Realtime)",
    99: "Comentarios",
}

CABECERA = """\
-- ============================================================================
-- BASELINE del esquema `public` — Portal Farmalasa
-- ============================================================================
-- Generado desde el CATALOGO DE PRODUCCION (no desde la historia de
-- migraciones) el {fecha}.
--
-- Motivo (PLAN-SUPABASE-CIERRE.md, C2): la historia registrada no es
-- replayeable. Las 19 migraciones `baseline_*` del 2026-07-11 no ejecutan DDL
-- —solo concatenan texto dentro de supabase_migrations.schema_migrations— y las
-- migraciones de abril esperan columnas que ya no existen (p.ej.
-- employees.is_admin). "Baseline reciente + historia vieja" no es una
-- combinacion valida; la unica arquitectura viable es baseline solo, con la
-- historia archivada en supabase/migrations-legacy/.
--
-- ⚠️  NO APLICAR A PRODUCCION. Prod ya tiene este esquema. Tras commitear este
--     archivo hay que registrarlo como aplicado sin ejecutarlo:
--         supabase migration repair --status applied {version}
--     Sin ese paso, el proximo `db push` intentaria correr el baseline contra la
--     base viva.
--
-- Lo que este archivo SI reproduce, verificado por huella contra prod:
--   tablas, columnas (tipos/NOT NULL/defaults/identity/generated), secuencias
--   con sus parametros, storage parameters, funciones (cuerpo, SECURITY DEFINER,
--   volatilidad y search_path), vistas y matviews, PK/unique/FK/CHECK, indices,
--   triggers, RLS, policies, PRIVILEGIOS y membresia de Realtime.
--
-- Lo que NO reproduce, a proposito:
--   - Datos. Incluye el contenido de las matviews: se crean WITH NO DATA y hay
--     que refrescarlas.
--   - Objetos de extension (las 31 funciones de pg_trgm): los crea
--     CREATE EXTENSION, y su dueño es supabase_admin.
--   - Los jobs de pg_cron y los secretos de Vault: son configuracion, no
--     esquema.
--   - ALTER DEFAULT PRIVILEGES: los trae el bootstrap de Supabase. Por eso cada
--     objeto de la seccion de privilegios lleva REVOKE ALL primero — sin eso,
--     los default privileges de `public` le regalan ALL a anon sobre cada tabla
--     nueva y se reabre la superficie que el proyecto cerro (CLAUDE.md regla #4).
-- ============================================================================

SET check_function_bodies = off;
SET lock_timeout = '5s';
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ddl_json", help="salida de gen_ddl2.sql (supabase db query -o json)")
    ap.add_argument("--out", required=True, help="ruta del .sql a escribir")
    ap.add_argument("--fecha", default="2026-07-29")
    ap.add_argument("--apply", action="store_true",
                    help="ademas, mueve supabase/migrations/*.sql a migrations-legacy/")
    ap.add_argument("--repo", default="/Users/alexnunez/Documents/Portal-Farmalasa")
    args = ap.parse_args()

    d = json.load(open(args.ddl_json))
    rows = d["rows"] if isinstance(d, dict) and "rows" in d else d
    if not rows or not isinstance(rows[0], dict):
        print("ddl_json vacio o con forma inesperada", file=sys.stderr)
        return 1

    faltantes = [r for r in rows if not r.get("ddl")]
    if faltantes:
        print(f"ABORTA: {len(faltantes)} fragmentos sin ddl", file=sys.stderr)
        return 1

    rows.sort(key=lambda r: (int(r["ord"]), r["k"] or ""))
    por = collections.Counter(int(r["ord"]) for r in rows)

    dups = [k for k, n in collections.Counter(
        (int(r["ord"]), r["k"]) for r in rows).items() if n > 1]
    if dups:
        print(f"ABORTA: {len(dups)} claves (ord,k) duplicadas -> orden no "
              f"determinista. Ej: {dups[:3]}", file=sys.stderr)
        return 1

    version = os.path.basename(args.out).split("_")[0]
    partes = [CABECERA.format(fecha=args.fecha, version=version)]

    ord_actual = None
    for r in rows:
        o = int(r["ord"])
        if o != ord_actual:
            ord_actual = o
            titulo = TITULOS.get(o, str(o))
            partes.append(f"\n\n-- ── {titulo} ({por[o]}) " + "─" * max(3, 66 - len(titulo)))
            partes.append("")
        partes.append(r["ddl"])

    body = "\n".join(partes) + "\n"

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as fh:
        fh.write(body)

    print(f"baseline escrito: {args.out}")
    print(f"  fragmentos: {len(rows)}   bytes: {len(body):,}")
    for o in sorted(por):
        print(f"  {o:3d}  {TITULOS.get(o, '?')[:58]:58s} {por[o]:5d}")

    if args.apply:
        mig = os.path.join(args.repo, "supabase/migrations")
        leg = os.path.join(args.repo, "supabase/migrations-legacy")
        os.makedirs(leg, exist_ok=True)
        base = os.path.basename(args.out)
        movidos = 0
        for f in sorted(os.listdir(mig)):
            if f.endswith(".sql") and f != base:
                os.replace(os.path.join(mig, f), os.path.join(leg, f))
                movidos += 1
        print(f"\narchivados en migrations-legacy/: {movidos}")
    else:
        print("\n(dry-run: el repo NO se toco. --apply archiva la historia previa.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
