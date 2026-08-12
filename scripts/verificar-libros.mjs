#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// `npm run verificar:libros` — B6 del PLAN-CONTABILIDAD-2026-08-02.
//
// POR QUÉ EXISTE. `verificar-csv-libros` (la edge function) compara contra el
// archivo del ERP, que es una fuente independiente y por eso vale mucho. Pero el
// lado del portal no lo produce el portal: lo produce `generar_csv_libro`, que
// —verificado leyendo las dos, H11— **transcribe las mismas reglas que los RPC**.
// El encabezado de esa función decía que era «una SEGUNDA implementación» y que
// por eso la prueba valía el doble. Era falso: dos copias de la misma regla no
// son dos testigos.
//
// Y hay una franja entera que ninguna de las dos puede ver: **lo que el
// navegador escribe**. El BOM, el CRLF, el escape de comillas de RFC 4180, el
// mapeo de columnas de `LibrosIvaView`, el `exportCsv`. Todo eso está entre el
// RPC y el archivo que la contadora presenta, y nunca se había medido (H15).
//
// Este script cierra esa franja: **baja el archivo apretando el botón real**,
// con Playwright contra un build de producción, y lo compara byte a byte contra
// el archivo del ERP. Es el único camino que ejercita a la vez el RPC, el mapeo
// de columnas y el escritor de CSV. No reimplementa nada.
//
// USO
//   npm run verificar:libros -- --mes 2026-06 --sucursal 30 --libro compras
//   npm run verificar:libros -- --mes 2026-06 --sucursal 30 --libro compras \
//                               --ignorar 22            # el sello, que es C1
//
// REQUIERE
//   E2E_USER / E2E_PASSWORD   la cuenta de QA (ver .env)
//   ADMIN_INVOKE_SECRET       no hace falta: el archivo del ERP se baja por la
//                             edge function `erp-csv-probe`, invocada con la
//                             service key. Si no está, se compara solo el
//                             formato y se dice claramente que faltó el origen.
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

// ── argumentos ──────────────────────────────────────────────────────────────
const arg = (n, def) => {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
               'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const MES      = arg('mes');
const SUCURSAL = Number(arg('sucursal', '30'));
// El nombre que se elige en el desplegable. Se pasa aparte del branch_id para
// no mantener acá una tabla de nombres: `--sucursal 30 --nombre Bodega`.
const NOMBRE_SUC = arg('nombre', null);
const LIBRO    = arg('libro', 'compras');
const IGNORAR  = new Set((arg('ignorar', '') || '').split(',').filter(Boolean).map(Number));

// ── la forma del anexo, y cómo se alinea con el archivo del origen ──────────
// Desde el 2026-08-11 las dos formas ya NO coinciden columna a columna: el
// portal sigue lo que pide Hacienda (23 y 20 columnas en los libros de ventas)
// y el archivo del origen se quedó en el suyo (22 y 19). Comparar por índice
// haría que TODO saliera distinto y este verificador quedaría rojo para
// siempre — o sea, inútil justo cuando más se lo necesita.
//
// El mapa y los motivos viven en un solo lugar, compartidos con la edge
// function: `supabase/functions/_shared/anexo-spec.json`.
const SPEC = JSON.parse(
    readFileSync(new URL('../supabase/functions/_shared/anexo-spec.json', import.meta.url), 'utf8'));
const ESPEC = SPEC.reportes[LIBRO] ?? null;

// Pares (columna nuestra → columna del origen) que sí se comparan: las que
// existen de los dos lados y no divergen a propósito.
const PARES = ESPEC
    ? ESPEC.origen.mapa
        .map((destino, i) => [i, destino])
        .filter(([i, destino]) => destino !== null
            && !ESPEC.origen.valor_diverge.includes(i)
            && !IGNORAR.has(i))
    : [];
const BASE_URL = arg('url', process.env.E2E_BASE_URL || 'http://localhost:4174');
const NO_SERVER = process.argv.includes('--no-server');

if (!MES || !/^\d{4}-\d{2}$/.test(MES)) {
    console.error('Falta --mes YYYY-MM.  Ej: npm run verificar:libros -- --mes 2026-06 --sucursal 30');
    process.exit(2);
}

// El `.env` del repo, leído a mano: este script no usa Vite.
function env(clave) {
    if (process.env[clave]) return process.env[clave];
    try {
        const linea = readFileSync(new URL('../.env', import.meta.url), 'utf8')
            .split('\n').find(l => l.startsWith(`${clave}=`));
        return linea ? linea.slice(clave.length + 1).trim().replace(/^["']|["']$/g, '') : undefined;
    } catch { return undefined; }
}

const E2E_USER     = env('E2E_USER');
const E2E_PASSWORD = env('E2E_PASSWORD');
if (!E2E_USER || !E2E_PASSWORD) {
    console.error('Faltan E2E_USER / E2E_PASSWORD. Son las credenciales de la cuenta de QA.');
    process.exit(2);
}

const rojo  = s => `\x1b[31m${s}\x1b[0m`;
const verde = s => `\x1b[32m${s}\x1b[0m`;
const gris  = s => `\x1b[90m${s}\x1b[0m`;

// ── el archivo del portal, bajado por el botón ──────────────────────────────
async function bajarDelPortal() {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    try {
        await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
        await page.locator('#username').fill(E2E_USER);
        await page.locator('#password').fill(E2E_PASSWORD);
        await page.locator('button[type="submit"]').first().click();
        await page.waitForURL(u => !/\/login$/.test(u.pathname), { timeout: 30_000 });

        await page.goto(`${BASE_URL}/libros-iva?tab=${LIBRO}`, { waitUntil: 'domcontentloaded' });

        // El botón de Exportar es SOLO ÍCONO (DESIGN.md §17): no tiene texto
        // visible, solo `aria-label`. Por eso se busca por rol y nombre
        // accesible — que además es lo que exige la categoría `button-name` del
        // gate de diseño, así que si algún día alguien se lo quita, este script
        // y el gate fallan juntos.
        const exportar = page.getByRole('button', { name: /exportar/i }).first();
        await exportar.waitFor({ state: 'visible', timeout: 30_000 });

        // La sucursal, con el filtro de la vista. `--sucursal` acepta el nombre
        // tal como aparece en el desplegable (`--sucursal Bodega`) además del
        // branch_id, justamente para no mantener acá una tabla de nombres que
        // se desincronice el día que se renombre una.
        if (NOMBRE_SUC) {
            const sel = page.getByRole('button', { name: /sucursal|todas/i }).first();
            if (!await sel.isVisible({ timeout: 5_000 }).catch(() => false)) {
                throw new Error('no encontré el filtro de sucursal — ¿la cuenta tiene scope de una sola?');
            }
            await sel.click();
            await page.getByRole('option', { name: new RegExp(NOMBRE_SUC, 'i') })
                .first().click({ timeout: 5_000 });
            await sleep(800);
            console.log(gris(`  sucursal: ${NOMBRE_SUC}`));
        }

        // El mes, con el stepper de la vista y no por URL: es el mismo camino
        // que hace una persona, y es justamente lo que se quiere probar.
        //
        // Se LEE la etiqueta en cada paso en vez de preguntar "¿ya está el mes
        // que quiero?". La primera versión hacía lo segundo y se dio por
        // satisfecha en el mes equivocado: exportó julio de todas las sucursales
        // creyendo que era junio de Bodega, y lo habría reportado como bueno.
        // Un verificador que no verifica dónde quedó parado no verifica nada.
        const rotuloObjetivo = `${MESES[mesNum - 1]} ${anio}`;
        const etiqueta = () => page.locator('span')
            .filter({ hasText: /^(Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre) \d{4}$/ })
            .first();

        let visto = (await etiqueta().textContent({ timeout: 10_000 })).trim();
        for (let i = 0; i < 36 && visto !== rotuloObjetivo; i++) {
            const [mVisto, aVisto] = visto.split(' ');
            const atras = new Date(Number(aVisto), MESES.indexOf(mVisto))
                        > new Date(anio, mesNum - 1);
            await page.getByRole('button', { name: atras ? /mes anterior/i : /mes siguiente/i })
                .first().click({ timeout: 5_000 });
            await sleep(400);
            const ahora = (await etiqueta().textContent({ timeout: 5_000 })).trim();
            if (ahora === visto) throw new Error(`el stepper no se movió de ${visto}`);
            visto = ahora;
        }
        if (visto !== rotuloObjetivo) {
            throw new Error(`quedé en ${visto}, no en ${rotuloObjetivo}`);
        }
        console.log(gris(`  período en pantalla: ${visto}`));
        await sleep(2_000);   // que termine de cargar el período

        const [descarga] = await Promise.all([
            page.waitForEvent('download', { timeout: 60_000 }),
            exportar.click(),
        ]);
        const ruta = await descarga.path();
        return readFileSync(ruta);          // BYTES CRUDOS: el BOM importa
    } finally {
        await browser.close();
    }
}

// ── el archivo del ERP, por la edge function que ya existe ──────────────────
async function bajarDelErp() {
    const url = env('VITE_SUPABASE_URL');
    const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('ADMIN_INVOKE_SECRET');
    if (!url || !key) return null;

    const [y, m] = MES.split('-').map(Number);
    const fin = new Date(y, m, 0).getDate();
    const ARCHIVO = {
        compras:       'libro_compras_iva_csv.php',
        percepcion:    'libro_percepcion_iva_csv.php',
        consumidor:    'libro_ventas_consumidor_csv.php',
        contribuyente: 'libro_ventas_contribuyente_csv.php',
    }[LIBRO];
    const ERP_SUC = { 2: 5, 4: 1, 25: 2, 27: 3, 28: 4, 29: 7, 30: 6 };

    const res = await fetch(`${url}/functions/v1/erp-csv-probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
            rutas: [ARCHIVO],
            qs: `fechaInicio=${MES}-01&fechaFin=${MES}-${String(fin).padStart(2, '0')}`,
            erpId: ERP_SUC[SUCURSAL],
            credenciales: LIBRO === 'compras' || LIBRO === 'percepcion' ? 'compras' : 'ventas',
            lineas: 500,
        }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.resultados?.[0]?.primeras ?? null;
}

// ── comparación ─────────────────────────────────────────────────────────────
function analizarFormato(bytes) {
    const bom  = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
    const txt  = bytes.toString('utf8').replace(/^﻿/, '');
    return {
        bom,
        crlf: /\r\n/.test(txt),
        saltoFinal: /\n$/.test(txt),
        lineas: txt.split(/\r?\n/).filter(l => l.trim()),
    };
}

const norm = c => {
    const t = c.trim();
    return /^-?\d+(\.\d+)?$/.test(t) && t !== '' ? Number(t).toFixed(4) : t;
};

function comparar(portal, erp) {
    // Las dos claves salen del mapa: la nuestra toma nuestras columnas, la del
    // origen toma las suyas, y las dos quedan en el mismo orden. Sin mapa
    // (reporte desconocido) se cae al modo viejo, por índice.
    const clavePortal = PARES.length
        ? l => { const c = l.split(';'); return PARES.map(([i]) => norm(c[i] ?? '')).join(';'); }
        : l => l.split(';').filter((_, i) => !IGNORAR.has(i)).map(norm).join(';');
    const claveErp = PARES.length
        ? l => { const c = l.split(';'); return PARES.map(([, j]) => norm(c[j] ?? '')).join(';'); }
        : clavePortal;

    const bolsa = new Map();
    for (const l of portal) {
        const k = clavePortal(l);
        (bolsa.get(k) ?? bolsa.set(k, []).get(k)).push(l);
    }
    let iguales = 0;
    const faltan = [];
    for (const l of erp) {
        const arr = bolsa.get(claveErp(l));
        if (arr?.length) { arr.pop(); iguales++; } else faltan.push(l);
    }
    const sobran = [...bolsa.values()].flat();
    // Por columna: dónde se concentran las diferencias. Es la lección de
    // `feedback_verificar_todas_las_columnas_no_los_totales` — cuatro columnas
    // cuadraban y el error vivía en la quinta. El número que se reporta es
    // **la columna nuestra**, que es la que uno va a ir a mirar.
    const porColumna = new Map();
    for (let i = 0; i < Math.min(portal.length, erp.length); i++) {
        const a = erp[i].split(';'), b = portal[i].split(';');
        for (const [nuestra, suya] of PARES) {
            if (norm(a[suya] ?? '') !== norm(b[nuestra] ?? '')) {
                porColumna.set(nuestra, (porColumna.get(nuestra) ?? 0) + 1);
            }
        }
    }
    // La FORMA, que es lo que fallaba y nadie miraba: cuántas líneas nuestras
    // no tienen el número de columnas que el anexo pide.
    const formaMal = ESPEC
        ? portal.filter(l => l.split(';').length !== ESPEC.columnas_hoy).length
        : 0;
    return { iguales, faltan, sobran, porColumna, formaMal,
             columnasEsperadas: ESPEC?.columnas_hoy ?? null };
}

// ── el servidor de preview, si hace falta ───────────────────────────────────
//
// Build propio en `dist-verif` y puerto 4174, no el `dist`/4173 de siempre:
// hay otras sesiones trabajando en el mismo árbol y pisarles el `dist` o
// robarles el puerto del preview es la forma más rápida de romperles el día.
// `--strictPort` ya está en el script de `preview`, así que si el 4174 está
// ocupado falla claro en vez de moverse solo.
const OUT = 'dist-verif';
const PORT = '4174';

function correr(cmd, args, env) {
    return new Promise((res, rej) => {
        const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
        p.on('exit', c => (c === 0 ? res() : rej(new Error(`${cmd} salió con ${c}`))));
    });
}

async function conServidor(fn) {
    if (NO_SERVER) return fn();
    console.log(gris(`  compilando en ${OUT}/ …`));
    await correr('npm', ['run', 'build'], { OUT_DIR: OUT });

    console.log(gris(`  levantando vite preview en ${PORT} …`));
    const proc = spawn('npm', ['run', 'preview'],
        { stdio: 'ignore', detached: true, env: { ...process.env, OUT_DIR: OUT, QA_PORT: PORT } });
    try {
        let vivo = false;
        for (let i = 0; i < 60; i++) {
            try { if ((await fetch(BASE_URL)).ok) { vivo = true; break; } } catch { /* todavía no */ }
            await sleep(500);
        }
        if (!vivo) throw new Error(`el preview no levantó en ${BASE_URL} (¿puerto ${PORT} ocupado?)`);
        return await fn();
    } finally {
        try { process.kill(-proc.pid); } catch { /* ya murió */ }
    }
}

// ── main ────────────────────────────────────────────────────────────────────
const t0 = Date.now();
console.log(`\n  ${LIBRO} · sucursal ${SUCURSAL} · ${MES}\n`);

const bytes = await conServidor(bajarDelPortal);
const fmt = analizarFormato(bytes);

// ── ¿el archivo es el que pedí? ─────────────────────────────────────────────
// Va ANTES de cualquier conclusión, y es la lección más cara de este script: la
// primera versión exportó julio de todas las sucursales creyendo que era junio
// de Bodega, porque confiaba en que el stepper había llegado. Un verificador
// que no comprueba qué archivo tiene en la mano no verifica nada.
//
// La columna de la fecha depende del reporte: en compras y en los libros de
// ventas es la 0; en el anexo de percepción, la 1 (la 0 es el correlativo).
{
    const colFecha = LIBRO === 'percepcion' ? 1 : 0;
    const meses = new Set();
    for (const l of fmt.lineas) {
        const f = (l.split(';')[colFecha] ?? '').trim();
        const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f);
        if (m) meses.add(`${m[3]}-${m[2]}`);
    }
    if (meses.size === 0 && fmt.lineas.length > 0) {
        console.error(rojo(`\n  El archivo no tiene fechas donde se esperaban (columna ${colFecha}).`));
        console.error(gris(`  Primera línea: ${fmt.lineas[0].slice(0, 120)}\n`));
        process.exit(3);
    }
    if (meses.size > 1 || (meses.size === 1 && !meses.has(MES))) {
        console.error(rojo(`\n  El archivo NO es de ${MES}: trae ${[...meses].sort().join(', ')}.`));
        console.error(gris('  El período de la vista no quedó donde se pidió. No se declara nada.\n'));
        process.exit(3);
    }
}

console.log('  Formato del archivo que baja el navegador');
console.log(`    BOM UTF-8 ....... ${fmt.bom ? 'sí' : 'no'}   ${gris('(sí = deliberado: sin él Excel es-SV rompe los acentos)')}`);
console.log(`    Fin de línea .... ${fmt.crlf ? 'CRLF' : 'LF'}  ${gris('(CRLF = convención CSV)')}`);
console.log(`    Salto final ..... ${fmt.saltoFinal ? 'sí' : 'no'}`);
console.log(`    Líneas .......... ${fmt.lineas.length}\n`);

const erp = await bajarDelErp();
if (!erp) {
    console.log(rojo('  No se pudo bajar el archivo del ERP') +
        gris('  (falta SUPABASE_SERVICE_ROLE_KEY o ADMIN_INVOKE_SECRET).'));
    console.log(gris('  Se verificó el FORMATO. El CONTENIDO queda sin verificar — no se declara nada sobre él.\n'));
    process.exit(1);
}

const r = comparar(fmt.lineas, erp);
console.log('  Contra el archivo del ERP');
console.log(`    líneas ERP ...... ${erp.length}`);
console.log(`    líneas portal ... ${fmt.lineas.length}`);
console.log(`    coinciden ....... ${r.iguales}`);
console.log(`    solo en el ERP .. ${r.faltan.length}`);
console.log(`    solo en el portal ${r.sobran.length}\n`);

// La FORMA va primero y aparte: es lo que falló dos veces y lo que la
// comparación contra el origen no puede ver, porque el origen tiene otra.
if (ESPEC) {
    const bien = r.formaMal === 0;
    console.log('  Forma del anexo');
    console.log(`    columnas que pide Hacienda ... ${ESPEC.columnas}`);
    console.log(`    columnas que emitimos ........ ${r.columnasEsperadas}`);
    console.log(`    líneas con la forma mal ...... ${bien ? verde('0') : rojo(String(r.formaMal))}`);
    if (ESPEC.deuda) console.log(gris(`    deuda escrita: ${ESPEC.deuda.slice(0, 150)}…`));
    console.log('');
}

if (r.porColumna.size) {
    console.log('  Diferencias por columna (número de columna NUESTRA)');
    for (const [c, n] of [...r.porColumna].sort((a, b) => b[1] - a[1])) {
        const etq = ESPEC?.etiquetas?.[c] ?? '';
        console.log(`    columna ${String(c).padStart(2)} .... ${String(n).padStart(4)}  ${gris(etq)}`);
    }
    console.log('');
}
if (ESPEC?.origen?.valor_diverge?.length) {
    console.log(gris(`  No se comparan contra el origen, a propósito: ${
        ESPEC.origen.valor_diverge.map(i => `${i} (${ESPEC.etiquetas[i]})`).join(', ')}`));
    console.log(gris(`  Motivo: ${ESPEC.origen.motivo}\n`));
}
for (const l of r.faltan.slice(0, 3)) console.log(gris(`    solo ERP:    ${l.slice(0, 110)}`));
for (const l of r.sobran.slice(0, 3)) console.log(gris(`    solo portal: ${l.slice(0, 110)}`));

const ok = r.faltan.length === 0 && r.sobran.length === 0 && r.formaMal === 0;
console.log(`\n  ${ok ? verde('IDENTICO') : rojo('DIFIERE')}  ${gris(`${((Date.now() - t0) / 1000).toFixed(1)}s`)}\n`);
process.exit(ok ? 0 : 1);
