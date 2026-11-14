#!/usr/bin/env node
// Emparejador de Datos de Mercado de la SRS (2026-11-14) — la corrida.
//
// Trae de la base lo que falta emparejar (función `srs-datos-mercado`, acción
// «lista»), busca cada producto en el catálogo de la SRS con la cuenta de la
// empresa, decide la pareja (scripts/srs/emparejarMercado.mjs) y, con
// --cargar, la deja en la base (acción «cargar» → `srs_mercado_cargar_propuestas`,
// que nunca pisa lo que una persona ya confirmó o marcó «no aplica»).
//
// Uso:
//   SRS_DM_USUARIO=… SRS_DM_CLAVE=… SRS_CARGA_SECRETO=… \
//     node scripts/srs/emparejar-datos-mercado.mjs [--cargar] [--cache <archivo>] [--salida <archivo>]
//
// La cuenta y el secreto están en la bóveda (srs_dm_usuario, srs_dm_clave,
// srs_carga_secreto). Sin --cargar no escribe nada: deja el resultado en
// --salida para revisarlo. --cache guarda las respuestas del catálogo para no
// volver a preguntarle a la SRS lo mismo (se puede correr de nuevo gratis
// después de ajustar el emparejador).
import fs from 'node:fs';
import path from 'node:path';
import { analizarPortal, busquedasDe, busquedasFinasDe, decidir, TOPE_CATALOGO } from './emparejarMercado.mjs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const CARGAR = args.includes('--cargar');
const CACHE = opcion('--cache');
const SALIDA = opcion('--salida') ?? 'emparejado-datos-mercado.json';
const CONCURRENCIA = 3;

function leerEnv() {
    const out = {};
    try {
        for (const l of fs.readFileSync(path.resolve('.env'), 'utf8').split('\n')) {
            const m = l.match(/^(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)=(.*)$/);
            if (m) out[m[1]] = m[2].trim();
        }
    } catch { /* sin .env: se exige por variable */ }
    return { url: process.env.VITE_SUPABASE_URL ?? out.VITE_SUPABASE_URL, anon: process.env.VITE_SUPABASE_ANON_KEY ?? out.VITE_SUPABASE_ANON_KEY };
}
const { url: SUPA, anon: ANON } = leerEnv();
const { SRS_DM_USUARIO, SRS_DM_CLAVE, SRS_CARGA_SECRETO } = process.env;
if (!SUPA || !ANON || !SRS_DM_USUARIO || !SRS_DM_CLAVE || !SRS_CARGA_SECRETO) {
    console.error('Faltan VITE_SUPABASE_URL/ANON_KEY (.env) o SRS_DM_USUARIO, SRS_DM_CLAVE, SRS_CARGA_SECRETO.');
    process.exit(1);
}

async function funcion(cuerpo) {
    const res = await fetch(`${SUPA}/functions/v1/srs-datos-mercado`, {
        method: 'POST',
        signal: AbortSignal.timeout(120_000),
        headers: { Authorization: `Bearer ${ANON}`, apikey: ANON, 'x-carga-secreto': SRS_CARGA_SECRETO, 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(`srs-datos-mercado ${cuerpo.accion}: ${res.status} ${j.error ?? ''}`);
    return j;
}

// ── El catálogo de la SRS (mismo inicio de sesión que la función) ─────────
const BASE = 'https://datosmercado.srs.gob.sv/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
let galletas = {};
const cab = () => Object.entries(galletas).map(([k, v]) => `${k}=${v}`).join('; ');
async function pedir(ruta, init = {}) {
    const res = await fetch(BASE + ruta, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000),
        headers: { 'User-Agent': UA, Cookie: cab(), ...(init.headers ?? {}) } });
    for (const c of res.headers.getSetCookie()) { const [par] = c.split(';'); const i = par.indexOf('='); if (i > 0) galletas[par.slice(0, i).trim()] = par.slice(i + 1).trim(); }
    return res;
}
let entrando = null;
async function entrar() {
    if (!entrando) entrando = (async () => {
        galletas = {};
        await (await pedir('login.php')).text();
        const res = await pedir('login.php', { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: BASE + 'login.php' },
            body: new URLSearchParams({ username: SRS_DM_USUARIO, password: SRS_DM_CLAVE, 'login-ingresar': 'Login' }) });
        await res.text();
        if (!(res.status >= 300 && res.status < 400 && (res.headers.get('location') ?? '').includes('index.php'))) throw new Error('La SRS no aceptó la cuenta.');
    })().finally(() => { entrando = null; });
    return entrando;
}

const cache = CACHE && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
let preguntas = 0;
async function buscar(q) {
    if (cache[q]) return cache[q];
    for (let intento = 0; intento < 3; intento++) {
        if (!Object.keys(galletas).length) await entrar();
        try {
            const res = await pedir('data_listaproductosfiltro.php?query=' + encodeURIComponent(q), { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            const cuerpo = await res.text();
            if (res.status >= 300 || cuerpo.trimStart().startsWith('<')) { galletas = {}; continue; }
            const filas = cuerpo.trim() ? JSON.parse(cuerpo) : [];
            preguntas++;
            cache[q] = filas;
            return filas;
        } catch (e) {
            if (intento === 2) throw e;
            await new Promise(r => setTimeout(r, 1500));
        }
    }
    throw new Error(`No se pudo buscar «${q}».`);
}

async function catalogoPara(producto) {
    const portal = analizarPortal(producto);
    const [amplia] = busquedasDe(portal);
    if (!amplia) return [];
    let filas = await buscar(amplia);
    if (filas.length >= TOPE_CATALOGO) {
        // Llegó al tope: afinar con concentración, forma y unidades.
        for (const q of busquedasFinasDe(portal)) filas = filas.concat(await buscar(q));
    } else if (!filas.length && portal.marca.length > 1) {
        filas = await buscar(portal.marca[0]);
    }
    return filas;
}

// ── La corrida ─────────────────────────────────────────────────────────────
const { productos } = await funcion({ accion: 'lista' });
console.log(`Productos por emparejar: ${productos.length}`);
const resultado = new Array(productos.length);
let hechos = 0;
let siguiente = 0;
async function trabajador() {
    while (siguiente < productos.length) {
        const i = siguiente++;
        const p = productos[i];
        const filas = await catalogoPara(p);
        resultado[i] = { ...decidir(p, filas), _portal: p.nombre };
        if (++hechos % 100 === 0) {
            console.log(`  ${hechos}/${productos.length} (preguntas a la SRS: ${preguntas})`);
            if (CACHE) fs.writeFileSync(CACHE, JSON.stringify(cache));
        }
    }
}
await Promise.all(Array.from({ length: CONCURRENCIA }, trabajador));
if (CACHE) fs.writeFileSync(CACHE, JSON.stringify(cache));
fs.writeFileSync(SALIDA, JSON.stringify(resultado, null, 1));

const cuenta = {};
for (const r of resultado) cuenta[r.confianza] = (cuenta[r.confianza] ?? 0) + 1;
console.log('Confianza:', cuenta, `· preguntas a la SRS: ${preguntas} · resultado en ${SALIDA}`);

if (CARGAR) {
    const filas = resultado.map(({ _portal, ...r }) => r);
    let escritas = 0;
    for (let i = 0; i < filas.length; i += 1000) {
        const r = await funcion({ accion: 'cargar', filas: filas.slice(i, i + 1000) });
        escritas += r.escritas;
    }
    console.log(`Cargadas: ${escritas} filas cambiaron (las confirmadas por una persona no se tocan).`);
}
