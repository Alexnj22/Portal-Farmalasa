// La distribuidora (Torogoz) en el entorno de pruebas: reponerla cuando el
// branch se rehace.
//
// Su esquema vive en `supabase/borradores/distribucion/`, NO en migraciones:
// todavía no existe en producción, y el branch se construye replicando las
// migraciones de producción. Así que cada vez que `mantener_al_dia.mjs` rehace
// el branch, la distribuidora desaparece entera —tablas, funciones, semillas y
// sus dos edge functions— y nada lo dice: la pantalla contesta «no se pudieron
// cargar los datos de la empresa». Pasó el 2026-09-30, con quince borradores
// encima y a media sesión de trabajo.
//
// Dos usos:
//   · `mantener_al_dia.mjs` llama a `reponerDistribucion(sql, ref)` en cada
//     corrida; si `dist_emisores` ya existe no hace nada.
//   · a mano: `node scripts/entorno-pruebas/distribucion.mjs [--forzar]` repone
//     en el branch de `.env.staging` con el CLI de Supabase (el del llavero).
//
// Las edge functions se despliegan con el CLI si está instalado (en GitHub lo
// instala el workflow). Al migrar la distribuidora a producción, este archivo
// se borra: sus borradores pasan a ser migraciones y el branch los trae solo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..', '..');
const BORRADORES = path.join(raiz, 'supabase', 'borradores', 'distribucion');
/**
 * Después de los borradores: los datos de muestra que usan las pruebas. El
 * historial del tablero va PRIMERO: los cobros y el documento rechazado de
 * `distribucion_pruebas.sql` se siembran sobre él.
 */
const SEMILLAS = ['distribucion_tablero_pruebas.sql', 'distribucion_pruebas.sql'];
export const FUNCIONES = ['distribucion-dte', 'distribucion-comprobante'];

/** Los archivos a correr, en orden: `0001_…` a `NNNN_…` y después las semillas. */
export function archivosDeDistribucion() {
    const borradores = fs.readdirSync(BORRADORES).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort()
        .map(f => path.join(BORRADORES, f));
    return [...borradores, ...SEMILLAS.map(f => path.join(aqui, f))];
}

/** ¿Hay que reponer? — sin `dist_emisores` el branch no tiene la distribuidora. */
export const CONSULTA_EXISTE = "select to_regclass('public.dist_emisores') is not null as existe";

/**
 * Corre los borradores con el `sql(ref, query, { escribe })` de quien llama.
 * Devuelve cuántos archivos corrió (0 si ya estaba).
 */
export async function reponerDistribucion(sql, ref, { forzar = false, log = console.log } = {}) {
    const [fila] = await sql(ref, CONSULTA_EXISTE);
    if (fila?.existe && !forzar) {
        log('✓ Distribuidora: ya está en el branch.');
        return 0;
    }
    const archivos = archivosDeDistribucion();
    for (const f of archivos) {
        await sql(ref, fs.readFileSync(f, 'utf8'), { escribe: true });
        log(`  · ${path.basename(f)}`);
    }
    desplegarFunciones(ref, { log });
    log(`✓ Distribuidora repuesta: ${archivos.length} archivos.`);
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
