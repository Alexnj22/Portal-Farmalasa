#!/usr/bin/env node
// Carga de Datos de Mercado de la SRS por la opción 1 (2026-11-18).
//
// Dos pasos, y el segundo sólo con el plan que una persona ya vio:
//
//   1. Armar el plan (no escribe nada en ningún lado):
//        node scripts/srs/cargar-datos-mercado.mjs --establecimiento E10F2098 --salida plan.json
//      Lee del portal las parejas confirmadas, los precios y la existencia de
//      la sucursal (función `srs-datos-mercado`, acción «datos_carga»), lee de
//      la SRS lo que ya tiene precargado esa farmacia, y convierte cada
//      producto a la presentación de la SRS (scripts/srs/cargaMercado.mjs).
//      Deja plan.json y plan.csv, y escribe el resumen.
//
//   2. Mandarlo:
//        node scripts/srs/cargar-datos-mercado.mjs --enviar plan.json
//      Borra lo precargado que no vendemos, agrega lo que falta y guarda
//      existencia y precios. Anota cada paso en plan.json.hecho.jsonl: si se
//      corta, se vuelve a correr igual y sigue donde quedó.
//
// Credenciales: SRS_DM_USUARIO, SRS_DM_CLAVE, SRS_CARGA_SECRETO (bóveda) y
// VITE_SUPABASE_URL/ANON_KEY del .env. Correr desde la raíz del repo.
import fs from 'node:fs';
import path from 'node:path';
import { armarPlan } from './cargaMercado.mjs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

// Código de la SRS → sucursal del portal (erp_sucursal_map).
// `srs` es el nombre con que la SRS tiene registrada cada farmacia (paso 3).
const FARMACIAS = {
    E10F2098: { erp: 1, nombre: 'Farmacia La Salud (Salud 1)', srs: 'FARMACIA LA SALUD' },
    E10F3086: { erp: 2, nombre: 'Salud 2', srs: 'FARMACIA LA SALUD 2' },
    E10F3144: { erp: 3, nombre: 'Salud 3', srs: 'FARMACIA LA SALUD 3' },
    E10F3445: { erp: 4, nombre: 'Salud 4', srs: 'FARMACIA LA SALUD 4' },
    E10F81148: { erp: 7, nombre: 'Salud 5', srs: 'FARMACIA LA SALUD 5' },
    E10F1627: { erp: 5, nombre: 'La Popular', srs: 'LA POPULAR' },
};
const PLAN_VENCE_H = 24;
// Despacio a propósito (2026-11-18): el firewall de la SRS bloqueó la red de
// la oficina después de un día de consultas seguidas. Entre producto y
// producto, --pausa ms (3 s por omisión); cada TANDA, un descanso largo.
const PAUSA_MS = Number(opcion('--pausa') ?? 3000);
const TANDA = 100;
const DESCANSO_MS = 60_000;

/** El firewall de la SRS (Cloudflare) cortó: se para todo, no se reintenta. */
class Bloqueado extends Error {}
const esBloqueo = (res, texto) => res.status === 403 || res.status === 429
    || /you have been blocked|cloudflare ray id|attention required/i.test(texto);

function leerEnv() {
    const out = {};
    try {
        for (const l of fs.readFileSync(path.resolve('.env'), 'utf8').split('\n')) {
            const m = l.match(/^(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)=(.*)$/);
            if (m) out[m[1]] = m[2].trim();
        }
    } catch { /* sin .env */ }
    return { url: process.env.VITE_SUPABASE_URL ?? out.VITE_SUPABASE_URL, anon: process.env.VITE_SUPABASE_ANON_KEY ?? out.VITE_SUPABASE_ANON_KEY };
}
const { url: SUPA, anon: ANON } = leerEnv();
const { SRS_DM_USUARIO, SRS_DM_CLAVE, SRS_CARGA_SECRETO } = process.env;
if (!SUPA || !ANON || !SRS_DM_USUARIO || !SRS_DM_CLAVE || !SRS_CARGA_SECRETO) {
    console.error('Faltan VITE_SUPABASE_URL/ANON_KEY (.env) o SRS_DM_USUARIO, SRS_DM_CLAVE, SRS_CARGA_SECRETO.');
    process.exit(1);
}
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

async function funcion(cuerpo) {
    const res = await fetch(`${SUPA}/functions/v1/srs-datos-mercado`, {
        method: 'POST', signal: AbortSignal.timeout(140_000),
        headers: { Authorization: `Bearer ${ANON}`, apikey: ANON, 'x-carga-secreto': SRS_CARGA_SECRETO, 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(`srs-datos-mercado ${cuerpo.accion}: ${res.status} ${j.error ?? ''}`);
    return j;
}

// ── La SRS ────────────────────────────────────────────────────────────────
const BASE = 'https://datosmercado.srs.gob.sv/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
let galletas = {};
let establecimiento = null;
const cab = () => Object.entries(galletas).map(([k, v]) => `${k}=${v}`).join('; ');
async function pedir(ruta, init = {}) {
    const res = await fetch(BASE + ruta, { ...init, redirect: 'manual', signal: AbortSignal.timeout(60_000),
        headers: { 'User-Agent': UA, Cookie: cab(), ...(init.headers ?? {}) } });
    for (const c of res.headers.getSetCookie()) { const [par] = c.split(';'); const i = par.indexOf('='); if (i > 0) galletas[par.slice(0, i).trim()] = par.slice(i + 1).trim(); }
    const texto = await res.text();
    if (esBloqueo(res, texto)) throw new Bloqueado(`La SRS bloqueó la conexión (${res.status} en ${ruta}). Se detiene sin reintentar.`);
    // Se devuelve el cuerpo ya leído con la misma forma de Response.
    return { status: res.status, headers: res.headers, text: async () => texto };
}
async function entrar() {
    galletas = {};
    await (await pedir('login.php')).text();
    const res = await pedir('login.php', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: BASE + 'login.php' },
        body: new URLSearchParams({ username: SRS_DM_USUARIO, password: SRS_DM_CLAVE, 'login-ingresar': 'Login' }) });
    await res.text();
    if (!(res.status >= 300 && res.status < 400 && (res.headers.get('location') ?? '').includes('index.php'))) throw new Error('La SRS no aceptó la cuenta.');
    await (await pedir(`action_setestablecimiento.php?establecimiento=${encodeURIComponent(establecimiento)}`)).text();
    // Nunca escribir sin saber en qué farmacia se está: el paso 3 de la SRS
    // trae el nombre de la farmacia activa en su formulario.
    const paso3 = await (await pedir('contenido_infoest.php')).text();
    const activa = paso3.match(/name="datos_est_nombre"[\s\S]{0,300}?value="([^"]*)"/)?.[1]?.trim().toUpperCase();
    if (activa !== FARMACIAS[establecimiento].srs) throw new Error(`La SRS quedó en «${activa ?? '¿?'}» y no en ${FARMACIAS[establecimiento].srs} (${establecimiento}).`);
}
/** POST a una acción; vuelve a entrar una vez si la sesión venció. */
async function accion(ruta, datos) {
    for (let intento = 0; intento < 2; intento++) {
        const res = await pedir(ruta, { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Referer: BASE + 'index.php' },
            body: new URLSearchParams(datos) });
        const t = (await res.text()).trim();
        if (res.status >= 300 || t.startsWith('<')) { await entrar(); continue; }
        return t;
    }
    throw new Error(`${ruta}: la sesión de la SRS no se pudo recuperar.`);
}
async function precargados() {
    const html = await (await pedir('contenido_inventario.php')).text();
    const i = html.indexOf('var rawData = [');
    if (i < 0) throw new Error('No se encontró la lista de la SRS (¿opción 1 elegida en esta farmacia?).');
    const fin = html.indexOf('];', i);
    const crudo = html.slice(i + 'var rawData = '.length, fin + 1);
    let filas;
    try { filas = JSON.parse(crudo); } catch { throw new Error('La lista de la SRS no se pudo leer.'); }
    return filas.map(f => ({ crp: f.b, nombre: f.c, presentacion: f.e, laboratorio: f.a, existencias: f.d, precio: f.i, conDescuento: f.j }));
}

// ── 1. Armar el plan ──────────────────────────────────────────────────────
async function planear() {
    establecimiento = opcion('--establecimiento');
    const farmacia = FARMACIAS[establecimiento];
    if (!farmacia) { console.error(`--establecimiento debe ser uno de ${Object.keys(FARMACIAS).join(', ')}`); process.exit(1); }
    const salida = opcion('--salida') ?? `carga-${establecimiento}.json`;

    const datos = await funcion({ accion: 'datos_carga', erp_sucursal_id: farmacia.erp });
    await entrar();
    const yaEstan = await precargados();

    const agrupar = (filas, clave) => { const m = new Map(); for (const f of filas) { const k = f[clave]; if (!m.has(k)) m.set(k, []); m.get(k).push(f); } return m; };
    const pares = datos.pares.map(p => ({ ...p, producto: { nombre: p.products?.nombre, principio_activo: p.products?.principio_activo, laboratorio: p.products?.laboratorios?.nombre } }));
    const plan = armarPlan({ pares, precios: agrupar(datos.precios, 'product_id'), inventario: agrupar(datos.inventario, 'erp_product_id'), precargados: yaEstan, pendientes: datos.pendientes ?? [] });

    const doc = { establecimiento, farmacia: farmacia.nombre, creado: new Date().toISOString(), precargados: yaEstan.length, confirmadas: pares.length, ...plan };
    fs.writeFileSync(salida, JSON.stringify(doc, null, 1));
    const csv = [['accion', 'crp', 'producto_srs', 'productos_portal', 'existencia', 'precio', 'con_descuento', 'conversion', 'avisos', 'antes_existencia', 'antes_precio'].join(',')];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    for (const [nombre, filas] of [['guardar', plan.guardar], ['agregar', plan.agregar]]) {
        for (const f of filas) csv.push([nombre, f.crp, q(f.srs), q(f.productos.map(p => p.nombre).join(' + ')), f.existencia, f.precio, f.conDescuento,
            q(f.productos.map(p => `${p.conversion.base} u × ${p.conversion.porUnidad} ÷ ${p.conversion.srs}; precio de ${p.conversion.precioDe}${p.conversion.escala !== 1 ? ' × ' + p.conversion.escala : ''}`).join(' | ')),
            q(f.avisos.join(' ')), f.antes?.existencias ?? '', f.antes?.precio ?? ''].join(','));
    }
    for (const f of plan.eliminar) csv.push(['eliminar', f.crp, q(f.srs), '', '', '', '', '', '', '', ''].join(','));
    for (const f of plan.revisar) csv.push(['revisar', f.crp, q(f.srs), q(f.nombre), '', '', '', q(f.detalle ?? ''), q(f.motivo), '', ''].join(','));
    fs.writeFileSync(salida.replace(/\.json$/, '') + '.csv', csv.join('\n'));

    const cuenta = (filas, campo) => { const m = {}; for (const f of filas) for (const a of [].concat(f[campo] ?? [])) m[a] = (m[a] ?? 0) + 1; return m; };
    console.log(`${farmacia.nombre} (${establecimiento})`);
    console.log(`  la SRS tiene precargados: ${yaEstan.length} · parejas confirmadas: ${pares.length}`);
    console.log(`  guardar (ya estaban): ${plan.guardar.length} — con existencia: ${plan.guardar.filter(f => f.existencia > 0).length}`);
    console.log(`  agregar: ${plan.agregar.length}`);
    console.log(`  eliminar (no los vendemos): ${plan.eliminar.length}`);
    console.log(`  revisar (no se tocan): ${plan.revisar.length}`, cuenta(plan.revisar, 'motivo'));
    console.log('  avisos:', cuenta([...plan.guardar, ...plan.agregar], 'avisos'));
    console.log(`  plan: ${salida}`);
}

// ── 2. Mandarlo ───────────────────────────────────────────────────────────
async function enviar(archivo) {
    const plan = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    establecimiento = plan.establecimiento;
    if (!FARMACIAS[establecimiento]) throw new Error('El plan no dice la farmacia.');
    const horas = (Date.now() - Date.parse(plan.creado)) / 3_600_000;
    if (horas > PLAN_VENCE_H) throw new Error(`El plan tiene ${Math.round(horas)} h: la existencia ya cambió. Ármalo de nuevo.`);

    const bitacora = archivo + '.hecho.jsonl';
    const hecho = new Set();
    if (fs.existsSync(bitacora)) for (const l of fs.readFileSync(bitacora, 'utf8').split('\n')) {
        if (!l) continue; const j = JSON.parse(l); if (j.ok) hecho.add(`${j.paso}:${j.crp}`);
    }
    const anotar = (j) => fs.appendFileSync(bitacora, JSON.stringify({ ...j, at: new Date().toISOString() }) + '\n');

    await entrar();
    const yaEstan = new Set((await precargados()).map(p => p.crp));
    const guardarDatos = (f) => ({
        crp: f.crp, existencias: String(f.existencia),
        precioDro: '0', precioBot: '0', precioFar: '0', precioCon: f.precio.toFixed(2), precioConDes: f.conDescuento.toFixed(2),
        precioInd: '0', precioLic: '0', precioEst: '0', precioPri: '0', precioExp: '0',
    });

    let fallas = 0; let n = 0; let hechosAhora = 0;
    const total = plan.eliminar.length + plan.agregar.length * 2 + plan.guardar.length;
    const paso = async (nombre, crp, hacer, bueno) => {
        n++;
        if (hecho.has(`${nombre}:${crp}`)) return true;
        let resp; let ok = false;
        try { resp = await hacer(); ok = bueno(resp); } catch (e) { if (e instanceof Bloqueado) throw e; resp = e.message; }
        anotar({ paso: nombre, crp, ok, resp: String(resp).slice(0, 200) });
        if (!ok) { fallas++; console.log(`  ✗ ${nombre} ${crp}: ${String(resp).slice(0, 120)}`); }
        hechosAhora++;
        if (hechosAhora % 50 === 0) console.log(`  ${n}/${total} · fallas ${fallas} · ${new Date().toLocaleTimeString('es-SV')}`);
        // Diez fallas en una corrida no son mala suerte: se para y se mira.
        if (fallas >= 10) throw new Error(`Diez fallas: se detiene. Bitácora: ${bitacora}`);
        await dormir(hechosAhora % TANDA === 0 ? DESCANSO_MS : PAUSA_MS);
        return ok;
    };
    const guardo = (t) => t === '1';

    for (const f of plan.eliminar) {
        if (!yaEstan.has(f.crp)) { n++; continue; }
        await paso('eliminar', f.crp, () => accion('accion_inventarioeliminar.php', { crp: f.crp }), (t) => t === '1');
    }
    for (const f of plan.agregar) {
        const entro = yaEstan.has(f.crp) || await paso('agregar', f.crp, () => accion('accion_inventarioagregar.php', { crp: f.crp }),
            (t) => { try { return !!JSON.parse(t); } catch { return false; } });
        if (entro) await paso('guardar', f.crp, () => accion('accion_inventarioguardar.php', guardarDatos(f)), guardo);
        else n++;
    }
    for (const f of plan.guardar) await paso('guardar', f.crp, () => accion('accion_inventarioguardar.php', guardarDatos(f)), guardo);

    // Releer una muestra de lo guardado.
    const muestra = [...plan.agregar, ...plan.guardar].filter(f => f.existencia > 0).sort(() => Math.random() - 0.5).slice(0, 10);
    let iguales = 0;
    for (const f of muestra) {
        const t = await accion('accion_inventariogetdata.php', { crp: f.crp });
        try { const d = JSON.parse(t); if (Number(d.existencias) === f.existencia && Number(d.precioCon) === f.precio) iguales++; else console.log(`  ≠ ${f.crp}: SRS dice ${t.slice(0, 120)}`); } catch { console.log(`  ? ${f.crp}: ${t.slice(0, 80)}`); }
    }
    console.log(`Listo: ${total} pasos, ${fallas} fallas. Releídos ${iguales}/${muestra.length} iguales. Bitácora: ${bitacora}`);
    if (fallas) process.exitCode = 1;
}

const plan = opcion('--enviar');
(plan ? enviar(plan) : planear()).catch((e) => { console.error(e.message); process.exit(1); });
