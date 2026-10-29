/**
 * gate:seguridad — lo que la vigilancia de seguridad NO puede ver desde la
 * base, y lo que hace falta para que la vigilancia siga viva (2026-10-28).
 *
 * ── De dónde sale ───────────────────────────────────────────────────────────
 *
 * PENDIENTES 13 / SEGURIDAD-Y-ACCESO §3.7. Los dos defectos de seguridad más
 * caros que tuvo el portal no fallaron: funcionaban.
 *   · `attendance` y `audit_logs` aceptaban cualquier fila (`WITH CHECK (true)`):
 *     se podía fabricar una marcación o firmar la bitácora con el nombre de otro.
 *   · `set-employee-password` y `disable-employee-auth` decidían el permiso
 *     leyendo `user_metadata`, que lo escribe EL PROPIO NAVEGADOR: cualquiera
 *     con sesión podía darse permiso a sí mismo.
 * Los dos se cerraron. Este gate es para que no vuelvan sin que nadie lo note.
 *
 * ── Qué pide ────────────────────────────────────────────────────────────────
 *
 * Local (corre también en el pre-commit con `--hook`):
 *   metadata-autoriza  una edge function lee de `user_metadata` una clave que
 *                      sirve para autorizar (cargo, permiso, sala, admin…).
 *                      Esas salen de `employees`/`role_permissions` por el id
 *                      de la sesión. Escribir `user_metadata` (code, username)
 *                      está bien: es leerlo para decidir lo que no.
 *
 * Contra producción (sin `--hook`):
 *   escritura-abierta  una policy de INSERT/UPDATE/DELETE/ALL con `true` que no
 *                      sea sólo de `service_role` (ése salta el RLS igual).
 *   metadata-en-base   una policy o una función de `public` que lea
 *                      `user_metadata` / `raw_user_meta_data`.
 *   vigilancia-muerta  falta el trigger que avisa cuando cambia un control de
 *                      `security_config`, o el cron diario no está activo.
 *                      Un vigilante apagado se ve igual que uno que no
 *                      encontró nada.
 *
 * Si producción no contesta, el gate FALLA: un gate que no pudo medir no
 * puede dar verde.
 *
 * Límite conocido: el detector local mira el ACCESO directo
 * (`x.user_metadata.role`, `user_metadata?.['role']`). Si alguien guarda el
 * objeto en una variable y lee la clave después, no lo ve.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { abrirCanal } from './lib/canal-supabase.mjs';

const RAIZ = process.cwd();
const FUNCIONES = join(RAIZ, 'supabase', 'functions');

// Claves que, leídas de `user_metadata`, sólo pueden servir para autorizar.
const CLAVE_DE_PERMISO = /^(role|roles|rol|role_id|cargo|is_admin|admin|is_su|su|superuser|permisos?|permissions?|can_\w+|modulos?|modules?|scope|branch_id|sucursal|sala)$/i;
const ACCESO = /user_metadata\s*\??\.\s*\??\.?\s*([A-Za-z_]\w*)|user_metadata\s*\??\.?\s*\[\s*['"`]([A-Za-z_]\w*)['"`]\s*\]/g;

function archivosTs(dir) {
  const out = [];
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules' || nombre.startsWith('.')) continue;
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) out.push(...archivosTs(p));
    else if (/\.(ts|js|mjs)$/.test(nombre)) out.push(p);
  }
  return out;
}

function revisarCodigo() {
  const hallazgos = [];
  for (const archivo of archivosTs(FUNCIONES)) {
    const lineas = readFileSync(archivo, 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      if (/^\s*(\/\/|\*)/.test(linea)) return; // comentarios: cuentan la historia, no la hacen
      for (const m of linea.matchAll(ACCESO)) {
        const clave = m[1] ?? m[2];
        if (CLAVE_DE_PERMISO.test(clave)) {
          hallazgos.push({
            cat: 'metadata-autoriza',
            donde: `${relative(RAIZ, archivo)}:${i + 1}`,
            detalle: `lee user_metadata.${clave} — lo escribe el navegador; el permiso sale de employees/role_permissions`,
          });
        }
      }
    });
  }
  return hallazgos;
}

const SQL_PRODUCCION = `
SELECT 'escritura-abierta' AS cat,
       schemaname || '.' || tablename || ' · ' || policyname || ' (' || cmd || ', ' || array_to_string(roles, ',') || ')' AS detalle
  FROM pg_policies
 WHERE schemaname IN ('public', 'storage')
   AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
   AND (coalesce(btrim(qual), '') IN ('true', '(true)') OR coalesce(btrim(with_check), '') IN ('true', '(true)'))
   AND roles <> ARRAY['service_role']::name[]
UNION ALL
SELECT 'metadata-en-base', 'policy ' || schemaname || '.' || tablename || ' · ' || policyname
  FROM pg_policies
 WHERE coalesce(qual, '') || coalesce(with_check, '') ~* '(user_metadata|raw_user_meta_data)'
UNION ALL
SELECT 'metadata-en-base', 'función public.' || p.proname
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.prosrc ~* '(user_metadata|raw_user_meta_data)'
UNION ALL
SELECT 'vigilancia-muerta', 'falta el trigger seguridad_aviso_cambio en security_config (o está apagado)'
 WHERE NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.security_config'::regclass
                      AND tgname = 'seguridad_aviso_cambio' AND tgenabled <> 'D')
UNION ALL
SELECT 'vigilancia-muerta', 'el cron seguridad-vigilancia-diaria no existe o está inactivo'
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'seguridad-vigilancia-diaria' AND active)`;

function revisarProduccion() {
  let canal;
  try {
    canal = abrirCanal('seguridad-gate');
    return canal.consultar(SQL_PRODUCCION).map(f => ({ cat: f.cat, donde: 'producción', detalle: f.detalle }));
  } catch (e) {
    return [{ cat: 'sin-medir', donde: 'producción',
              detalle: `no se pudo consultar (${e.detalleCli || e.message}). Un gate que no pudo medir no puede dar verde.` }];
  } finally {
    canal?.cerrar();
  }
}

function main() {
  const hook = process.argv.includes('--hook');
  const hallazgos = [...revisarCodigo(), ...(hook ? [] : revisarProduccion())];

  console.log('\n── Seguridad ─────────────────────────────────────────────');
  if (hallazgos.length === 0) {
    console.log(hook
      ? '✓ ninguna edge function autoriza con user_metadata. (Producción: `npm run gate:seguridad`.)\n'
      : '✓ sin escrituras abiertas, sin user_metadata decidiendo permisos, y la vigilancia está viva.\n');
    return;
  }
  console.log(`✗ ${hallazgos.length} hallazgo(s):\n`);
  for (const h of hallazgos) console.log(`  • [${h.cat}] ${h.donde} — ${h.detalle}`);
  console.log('');
  process.exitCode = 1;
}

main();
