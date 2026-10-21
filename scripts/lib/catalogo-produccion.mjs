/**
 * Lo que producción tiene HOY: tablas, crons y lo que `anon` alcanza.
 *
 * Es la lista contra la que `gate:auditoria` comprueba que nada quede sin área.
 * Hasta el 2026-10-21 se armaba a mano (MCP → JSON → `auditoria:sincronizar`) y
 * nadie la volvía a armar: tenía 57 días, producción había sumado más de 200
 * tablas desde entonces, y el gate seguía en verde porque comparaba contra la
 * foto vieja. Un inventario que se arma a mano se queda viejo solo.
 *
 * Dos canales, el mismo SQL:
 *   - en la máquina, el CLI linkeado (`abrirCanal`), igual que los otros gates;
 *   - en GitHub, la API de gestión con `SUPABASE_ACCESS_TOKEN`, porque ahí no
 *     hay `supabase/.temp` linkeado.
 *
 * Sólo lee. Nunca escribe en la base.
 */
import { existsSync } from 'node:fs';
import { abrirCanal } from './canal-supabase.mjs';

const PROD = 'sacecdkdmsdvgqnrsett';

/* Las definiciones salen de cómo se midió la primera foto (2026-08-23), para
 * que una diferencia sea un cambio de producción y no de la regla:
 *   - tablas: `public`, sin particiones (son la misma tabla) ni las que crea una
 *     extensión;
 *   - anon/funciones: EXECUTE para `anon` en `public`, sin las de extensiones
 *     (pg_trgm/pg_net: revocarlas rompe índices — ver CLAUDE.md regla 4). Las de
 *     TRIGGER sí cuentan: la limpieza del 2026-08-25 las revocó, y si vuelven a
 *     tener el GRANT es que una migración nueva lo dio sin decidirlo;
 *   - anon/tablas: policies que nombran a `anon` explícitamente. */
const SQL = `
SELECT json_build_object(
  'tablas', (SELECT coalesce(json_agg(c.relname ORDER BY c.relname), '[]')
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition
                AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')),
  'crons',  (SELECT coalesce(json_agg(jobname ORDER BY jobname), '[]') FROM cron.job),
  'anon', json_build_object(
    'funciones', (SELECT coalesce(json_agg(DISTINCT p.proname ORDER BY p.proname), '[]')
                    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
                     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')),
    'tablas',    (SELECT coalesce(json_agg(DISTINCT tablename ORDER BY tablename), '[]')
                    FROM pg_policies WHERE schemaname = 'public' AND roles @> '{anon}')),
  -- Los permisos que recibe una función NUEVA. Las diez que aparecieron entre
  -- agosto y octubre no las abrió nadie: nacían abiertas. Desde la migración
  -- 20261021194340 nacen sólo para authenticated/service_role; si alguien
  -- vuelve a abrir el default, esto lo dice el mismo día.
  'defaults_funciones', (SELECT coalesce(json_agg(json_build_object(
        'esquema', CASE WHEN defaclnamespace = 0 THEN '*' ELSE defaclnamespace::regnamespace::text END,
        'acl', defaclacl::text)), '[]')
     FROM pg_default_acl
    WHERE defaclobjtype = 'f' AND defaclrole = 'postgres'::regrole
      AND defaclnamespace IN (0, 'public'::regnamespace))
) AS catalogo`;

async function porApi(token) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: SQL }),
        signal: AbortSignal.timeout(60_000),
    });
    const texto = await r.text();
    if (!r.ok) throw new Error(`API de Supabase → ${r.status}: ${texto.slice(0, 200)}`);
    return JSON.parse(texto);
}

function porCli() {
    const canal = abrirCanal('auditoria');
    try { return canal.consultar(SQL); }
    finally { canal.cerrar(); }
}

/** Devuelve `{ tablas, crons, anon: { funciones, tablas } }`, o lanza. */
export async function leerCatalogoDeProduccion() {
    const linkeado = existsSync('supabase/.temp');
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!linkeado && !token) throw new Error('sin canal: ni proyecto linkeado ni SUPABASE_ACCESS_TOKEN');
    const filas = linkeado ? porCli() : await porApi(token);
    const cat = filas?.[0]?.catalogo;
    if (!cat?.tablas?.length || !Array.isArray(cat.crons)) throw new Error('la respuesta no trajo el catálogo');
    return cat;
}
