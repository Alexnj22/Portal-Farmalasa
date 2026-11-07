#!/usr/bin/env node
/**
 * conservar-assets — cada publicación conserva los archivos de las
 * publicaciones de las últimas 48 horas.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 * Medido en `audit_logs` (ERROR_RENDER, 30 días al 2026-09-28): 649 de 704
 * errores de pantalla —el 93%, a 39 personas en una sola semana— eran «no se
 * pudo cargar un pedazo de la pantalla». Cada publicación reemplaza todos los
 * archivos con hash; quien tenía el portal abierto entra a otra vista, pide el
 * archivo de SU versión, y ya no existe. `ErrorBoundary` lo detecta y pide
 * recargar, pero la pantalla ya no abrió: con varias sesiones publicando al
 * día, le pasa a casi todos. La corrección de fondo no es avisar mejor: es que
 * el archivo siga ahí.
 *
 * ── Cómo ─────────────────────────────────────────────────────────────────────
 * Después de `vite build`, SÓLO en la compilación de producción de Vercel:
 *   1. baja `assets-vivos.json` de la versión que está publicada ahora;
 *   2. baja de producción cada archivo que ahí figure, que la versión nueva no
 *      tenga y que haya estado vivo en las últimas 48 horas;
 *   3. escribe el inventario nuevo: lo de esta versión con la hora de ahora, y
 *      lo heredado con la hora en que dejó de estar vivo.
 * Así la ventana se cuenta desde la última vez que alguien pudo tener ese
 * archivo pedido, y lo que pasó las 48 horas se cae solo.
 *
 * ── La caché de compilación (2026-11-07) ─────────────────────────────────────
 * Bajar todo eso en cada compilación costaba 5,000 peticiones al CDN por
 * publicación (el tope), con ~30 publicaciones al día: ~250 mil peticiones
 * diarias, el 84% de todas las del portal y la causa de pasar el plan de 1M al
 * mes. Cada archivo con hash es inmutable, así que basta con bajarlo UNA vez:
 * cada compilación copia lo suyo y lo heredado a `node_modules/.cache/`, que
 * Vercel restaura en la siguiente («Restored build cache…» en el log). Sólo se
 * baja lo que la caché no tenga — si Vercel la descarta, esa compilación baja
 * como antes y la siguiente ya vuelve a cero. La caché se poda al inventario.
 *
 * Nunca rompe una publicación: si producción no responde o un archivo falla,
 * sigue sin él (es el comportamiento de antes). Baja de `portal.farmasalud.lat`
 * y no de la URL del despliegue, que está detrás del inicio de sesión de Vercel.
 *
 *   node scripts/conservar-assets.mjs [dir]           # en Vercel producción
 *   CONSERVAR_ASSETS_ORIGEN=http://localhost:9999 node scripts/conservar-assets.mjs dist   # a mano
 *   node scripts/conservar-assets.mjs dist --solo-inventario   # sólo escribe el inventario
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';

const DIR = process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.OUT_DIR || 'dist';
const soloInventario = process.argv.includes('--solo-inventario');
const ORIGEN = process.env.CONSERVAR_ASSETS_ORIGEN
    || (process.env.VERCEL_ENV === 'production' ? 'https://portal.farmasalud.lat' : null);
const VENTANA_MS = 48 * 60 * 60 * 1000;
const TOPE_ARCHIVOS = 5000;        // freno: un inventario roto no puede bajar el mundo
const EN_PARALELO = 16;
const INVENTARIO = 'assets-vivos.json';
// Dónde se guardan los archivos entre compilaciones. Sólo cuando hay origen
// (o sea, en la compilación de producción): a mano no hace falta.
const CACHE = process.env.CONSERVAR_ASSETS_CACHE || 'node_modules/.cache/conservar-assets';
// Sólo se hereda y se guarda en caché un archivo CON hash en el nombre: su
// contenido no cambia nunca. La entrada se llama siempre `index.js` (nombres
// estables, ver vite.config.js); heredar una vieja o sacarla de la caché
// pisaría la de esta versión con código de otra.
const conHash = (f) => /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(f);

// Por qué falló cada archivo que no se pudo bajar: sin esto, «191 fallidos»
// no dice si fue la red, el servidor o el tiempo.
const motivos = new Map();

// Con `http`/`https` de Node y no con `fetch`: el `fetch` de Node (undici)
// lanza `setTypeOfService EINVAL` desde el socket en algunos sistemas, FUERA de
// cualquier `catch` (medido en macOS con Node 24 y 25). Así la descarga no
// depende de ese detalle del sistema donde se compile.
function bajar(url, ms = 15000) {
    return new Promise((resolver) => {
        const anotarMotivo = (m) => { motivos.set(m, (motivos.get(m) || 0) + 1); resolver(null); };
        let pedido;
        try {
            pedido = (url.startsWith('https:') ? https : http).get(url, { headers: { 'cache-control': 'no-cache' }, timeout: ms }, (r) => {
                if (r.statusCode !== 200) { r.resume(); anotarMotivo(`HTTP ${r.statusCode}`); return; }
                const partes = [];
                r.on('data', (c) => partes.push(c));
                r.on('end', () => resolver(Buffer.concat(partes)));
                r.on('error', (e) => anotarMotivo(e.code || 'error'));
            });
        } catch (e) { anotarMotivo(e.code || 'error'); return; }
        pedido.on('timeout', () => { pedido.destroy(); anotarMotivo('timeout'); });
        pedido.on('error', (e) => anotarMotivo(e.code || 'error'));
    });
}

// Lo que se va armando, a nivel de módulo: si algo revienta a mitad de camino,
// el inventario se escribe igual con lo que ya se bajó. Sin inventario, la
// publicación siguiente no sabría qué heredar y la cadena se cortaría.
let inventario = null;
const escribirInventario = () => {
    if (inventario) writeFileSync(join(DIR, INVENTARIO), JSON.stringify({ generado: new Date().toISOString(), archivos: inventario }));
};

// Deja en la caché todo lo que esta publicación sirve (lo propio y lo heredado)
// y borra lo que ya no figura en el inventario, para que no crezca sin fin.
// Nada de esto puede romper la publicación: la caché es sólo un atajo.
function guardarEnCache(carpeta, enCache) {
    let guardados = 0, podados = 0;
    try {
        for (const f of Object.keys(inventario)) {
            if (enCache.has(f) || !conHash(f)) continue;
            try { copyFileSync(join(carpeta, f), join(CACHE, f)); guardados += 1; } catch { /* sigue */ }
        }
        for (const f of enCache) {
            if (inventario[f] && conHash(f)) continue;
            try { rmSync(join(CACHE, f), { force: true }); podados += 1; } catch { /* sigue */ }
        }
        console.log(`conservar-assets: caché de compilación · ${guardados} guardados · ${podados} podados`);
    } catch (e) {
        console.log(`conservar-assets: no se pudo actualizar la caché (${e.message}); la próxima baja lo que falte.`);
    }
}

async function main() {
    const carpeta = join(DIR, 'assets');
    if (!existsSync(carpeta)) {
        console.log(`conservar-assets: no hay ${carpeta}, nada que hacer.`);
        return;
    }
    const ahora = Date.now();
    const propios = new Set(readdirSync(carpeta));
    inventario = Object.fromEntries([...propios].map((f) => [f, ahora]));

    let heredados = 0, fallidos = 0, vencidos = 0, deCache = 0;
    const usarCache = Boolean(ORIGEN && !soloInventario);
    let enCache = new Set();
    if (usarCache) {
        try { mkdirSync(CACHE, { recursive: true }); enCache = new Set(readdirSync(CACHE)); } catch { enCache = new Set(); }
    }
    if (ORIGEN && !soloInventario) {
        const crudo = await bajar(`${ORIGEN}/${INVENTARIO}`);
        let anterior = null;
        try { anterior = crudo ? JSON.parse(crudo.toString('utf8')) : null; } catch { anterior = null; }
        const archivos = anterior?.archivos && typeof anterior.archivos === 'object' ? anterior.archivos : {};

        const pendientes = Object.entries(archivos)
            .filter(([f]) => /^[\w.-]+$/.test(f) && conHash(f) && !propios.has(f))   // sólo nombres planos y con hash
            .filter(([, desde]) => {
                const vivo = ahora - Number(desde) < VENTANA_MS;
                if (!vivo) vencidos += 1;
                return vivo;
            })
            .slice(0, TOPE_ARCHIVOS);

        for (let i = 0; i < pendientes.length; i += EN_PARALELO) {
            await Promise.all(pendientes.slice(i, i + EN_PARALELO).map(async ([f, desde]) => {
                if (enCache.has(f)) {
                    try {
                        copyFileSync(join(CACHE, f), join(carpeta, f));
                        inventario[f] = Number(desde);
                        heredados += 1; deCache += 1;
                        return;
                    } catch { /* copia fallida: se baja como antes */ }
                }
                // Hasta tres intentos: un corte suelto de la conexión no puede
                // costar el archivo que alguien tiene pedido en una pestaña.
                let cuerpo = null;
                for (let intento = 0; intento < 3 && !cuerpo; intento += 1) cuerpo = await bajar(`${ORIGEN}/assets/${f}`);
                if (!cuerpo) { fallidos += 1; return; }
                writeFileSync(join(carpeta, f), cuerpo);
                inventario[f] = Number(desde);
                heredados += 1;
            }));
        }
        guardarEnCache(carpeta, enCache);
        if (!crudo) console.log(`conservar-assets: ${ORIGEN} no tiene inventario todavía (primera publicación con esto).`);
    }

    escribirInventario();
    console.log(`conservar-assets: ${propios.size} propios · ${heredados} heredados de las últimas 48 h (${deCache} de la caché, ${heredados - deCache} bajados)`
        + ` · ${vencidos} vencidos · ${fallidos} que no se pudieron bajar${ORIGEN ? '' : ' (sin origen: sólo inventario)'}`
        + (motivos.size ? ` [${[...motivos].map(([k, n]) => `${k}: ${n}`).join(', ')}]` : ''));
}

// Un error de red de bajo nivel puede escaparse del `await` (medido: Node 25
// contra localhost lanza `setTypeOfService EINVAL` desde el socket, fuera de
// cualquier `catch`). Sin esta red, eso rompería la publicación.
process.on('uncaughtException', (e) => {
    console.log(`conservar-assets: error de red (${e.code || e.message}); se publica con lo heredado hasta ahí.`);
    try { escribirInventario(); } catch { /* sin inventario: la próxima arranca de cero */ }
    process.exit(0);
});

main().catch((e) => {
    // Nunca romper una publicación por esto: sin conservar, es el portal de antes.
    console.log(`conservar-assets: no se pudo conservar (${e.message}); se publica con lo heredado hasta ahí.`);
    try { escribirInventario(); } catch { /* */ }
});
