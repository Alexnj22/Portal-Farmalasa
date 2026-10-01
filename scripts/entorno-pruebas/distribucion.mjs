// La distribuidora (Torogoz) en el entorno de pruebas: lo que el branch NO
// trae solo cuando se rehace.
//
// Desde el 2026-10-01 su esquema está en PRODUCCIÓN (33 migraciones
// `distribucion_00NN_*`), así que el branch lo replica al rehacerse, junto con
// las semillas 0002 y 0005 (que sólo siembran donde existe la cuenta
// `pruebas`). Lo que sigue faltando y hace este archivo:
//   · los datos de muestra de las pruebas de pantalla (tablero e historial);
//   · las tres edge functions, con `CORREO_MODO=simulado` (en pruebas no se le
//     manda un correo a nadie).
// Antes este archivo corría los borradores; ya no existen.
//
// Dos usos:
//   · `mantener_al_dia.mjs` llama a `reponerDistribucion(sql, ref)` en cada
//     corrida; si ya hay pedidos de muestra no hace nada.
//   · a mano: `node scripts/entorno-pruebas/distribucion.mjs [--forzar]`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..', '..');
/**
 * Los datos de muestra que usan las pruebas. El
 * historial del tablero va PRIMERO: los cobros y el documento rechazado de
 * `distribucion_pruebas.sql` se siembran sobre él.
 */
const SEMILLAS = ['distribucion_tablero_pruebas.sql', 'distribucion_pruebas.sql'];
export const FUNCIONES = ['distribucion-dte', 'distribucion-comprobante', 'distribucion-correo'];

/** Los archivos a correr, en orden: las semillas de las pruebas. */
export function archivosDeDistribucion() {
    return SEMILLAS.map(f => path.join(aqui, f));
}

/** ¿Está el esquema (lo trae el branch) y tiene datos de muestra? */
export const CONSULTA_EXISTE = "select to_regclass('public.dist_emisores') is not null as existe";
const CONSULTA_DATOS = 'select exists (select 1 from public.dist_pedidos) as hay';

/**
 * Siembra los datos de muestra y despliega las funciones con el
 * `sql(ref, query, { escribe })` de quien llama. Devuelve cuántos archivos
 * corrió (0 si ya estaba).
 */
export async function reponerDistribucion(sql, ref, { forzar = false, log = console.log } = {}) {
    const [fila] = await sql(ref, CONSULTA_EXISTE);
    if (!fila?.existe) {
        // El esquema viene de las migraciones de producción: si falta, el
        // branch está viejo y lo que corresponde es rehacerlo, no parcharlo.
        throw new Error('El branch no tiene el esquema de la distribuidora: está atrasado respecto de producción (rehacerlo).');
    }
    const [datos] = await sql(ref, CONSULTA_DATOS);
    if (datos?.hay && !forzar) {
        log('✓ Distribuidora: ya tiene sus datos de muestra.');
        return 0;
    }
    const archivos = archivosDeDistribucion();
    for (const f of archivos) {
        await sql(ref, fs.readFileSync(f, 'utf8'), { escribe: true });
        log(`  · ${path.basename(f)}`);
    }
    desplegarFunciones(ref, { log });
    log(`✓ Distribuidora sembrada: ${archivos.length} archivos.`);
    return archivos.length;
}

/** Las dos edge functions, con el CLI. Sin CLI lo dice y sigue: el esquema ya sirve para mirar. */
export function desplegarFunciones(ref, { log = console.log } = {}) {
    const hay = spawnSync('supabase', ['--version'], { encoding: 'utf8' });
    if (hay.status !== 0) {
        log('⚠ Sin CLI de Supabase: las funciones de la distribuidora quedan sin desplegar (facturar no va a andar).');
        return false;
    }
    // El CLI se traga el `.env` del repo (apunta a producción): se aparta mientras tanto.
    const env = path.join(raiz, '.env');
    const apartado = path.join(raiz, '.env.distribucion-apartado');
    const mover = fs.existsSync(env);
    if (mover) fs.renameSync(env, apartado);
    try {
        for (const fn of FUNCIONES) {
            // `distribucion-dte` la llama el navegador con sesión: JWT encendido (no lleva --no-verify-jwt).
            const r = spawnSync('supabase', ['functions', 'deploy', fn, '--project-ref', ref, '--use-api'], { cwd: raiz, encoding: 'utf8' });
            if (r.status !== 0) throw new Error(`No se pudo desplegar ${fn}: ${(r.stderr || r.stdout).slice(-400)}`);
            log(`  · función ${fn}`);
        }
        // El correo al cliente, simulado: en pruebas no se le manda nada a nadie (0019).
        const sec = spawnSync('supabase', ['secrets', 'set', 'CORREO_MODO=simulado', '--project-ref', ref], { cwd: raiz, encoding: 'utf8' });
        if (sec.status !== 0) log(`⚠ No se pudo poner CORREO_MODO=simulado: ${(sec.stderr || sec.stdout).slice(-200)}`);
    } finally {
        if (mover) fs.renameSync(apartado, env);
    }
    return true;
}

// ── A mano: con el CLI y el branch de `.env.staging` ───────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const url = fs.readFileSync(path.join(raiz, '.env.staging'), 'utf8').match(/VITE_SUPABASE_URL=https:\/\/([a-z]+)\.supabase\.co/)?.[1];
    if (!url) { console.error('No encontré el branch en .env.staging (npm run pruebas:env).'); process.exit(1); }
    if (url === 'sacecdkdmsdvgqnrsett') { console.error('Negado: .env.staging apunta a producción.'); process.exit(1); }
    // El CLI corre SQL sobre el proyecto «enlazado»: se enlaza en una carpeta aparte para no tocar la del repo.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'distribucion-'));
    fs.mkdirSync(path.join(tmp, 'supabase'));
    const enlace = spawnSync('supabase', ['link', '--project-ref', url], { cwd: tmp, encoding: 'utf8' });
    if (enlace.status !== 0) { console.error(enlace.stderr || enlace.stdout); process.exit(1); }
    const sqlCli = async (_ref, query) => {
        const f = path.join(tmp, 'q.sql');
        fs.writeFileSync(f, query);
        const r = spawnSync('supabase', ['db', 'query', '--linked', '-f', f, '-o', 'json'], { cwd: tmp, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        if (r.status !== 0) throw new Error((r.stderr || r.stdout).slice(-600));
        const j = r.stdout.slice(r.stdout.indexOf('{'));
        try { return JSON.parse(j).rows ?? []; } catch { return []; }
    };
    console.log(`→ branch ${url}`);
    reponerDistribucion(sqlCli, url, { forzar: process.argv.includes('--forzar') })
        .catch(e => { console.error(e.message); process.exitCode = 1; });
}
