#!/usr/bin/env node
// Revisa las parejas de Datos de mercado que ya confirmó una persona
// (2026-11-16), con el mismo juez del emparejador. Sólo lee: deja la lista de
// sospechosas en --salida para que una persona decida.
//
//   SRS_CARGA_SECRETO=… node scripts/srs/revisar-confirmadas.mjs [--cache <archivo>] [--salida <archivo>]
//
// Con --cache (el de emparejar-datos-mercado.mjs) además dice si entre lo que
// ya se buscó en la SRS hay otra presentación que el emparejador prefiere.
import fs from 'node:fs';
import path from 'node:path';
import { analizarPortal, busquedasDe, busquedasFinasDe, decidir, juzgar } from './emparejarMercado.mjs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const CACHE = opcion('--cache');
const SALIDA = opcion('--salida') ?? 'revision-confirmadas.json';

const env = {};
try {
    for (const l of fs.readFileSync(path.resolve('.env'), 'utf8').split('\n')) {
        const m = l.match(/^(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)=(.*)$/);
        if (m) env[m[1]] = m[2].trim();
    }
} catch { /* sin .env */ }
const SUPA = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;
const { SRS_CARGA_SECRETO } = process.env;
if (!SUPA || !ANON || !SRS_CARGA_SECRETO) { console.error('Faltan VITE_SUPABASE_URL/ANON_KEY o SRS_CARGA_SECRETO.'); process.exit(1); }

const res = await fetch(`${SUPA}/functions/v1/srs-datos-mercado`, {
    method: 'POST', signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${ANON}`, apikey: ANON, 'x-carga-secreto': SRS_CARGA_SECRETO, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'confirmadas' }),
});
const j = await res.json().catch(() => ({}));
if (!res.ok || !j.ok) { console.error('confirmadas:', res.status, j.error ?? ''); process.exit(1); }

const cache = CACHE && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const sospechosas = [];
for (const r of j.filas) {
    const producto = { product_id: r.product_id, nombre: r.products?.nombre, laboratorio: r.products?.laboratorios?.nombre };
    const portal = analizarPortal(producto);
    const fila = { crp: r.crp, n_registro: r.n_registro, nombre_comercial: r.nombre_srs, presentacion: r.presentacion_srs, laboratorio: r.laboratorio_srs };
    const juicio = juzgar(portal, fila);
    const motivos = [...(juicio.choques ?? []), ...(juicio.avisos ?? [])];
    // Lo que el emparejador elegiría hoy entre lo ya buscado.
    let otra = null;
    const filas = [...busquedasDe(portal), ...busquedasFinasDe(portal)].flatMap(q => cache[q] ?? []);
    if (filas.length) {
        const d = decidir(producto, filas);
        if (d.crp && d.crp !== r.crp && d.confianza === 'alta') otra = { crp: d.crp, nombre: d.nombre_srs, presentacion: d.presentacion_srs };
    }
    if (motivos.length || otra) {
        sospechosas.push({ product_id: r.product_id, portal: producto.nombre, crp: r.crp, srs: r.nombre_srs,
            presentacion: r.presentacion_srs, confianza: r.confianza, motivos: [...new Set(motivos)], otra });
    }
}
fs.writeFileSync(SALIDA, JSON.stringify(sospechosas, null, 1));
const cuenta = {};
for (const s of sospechosas) for (const m of s.motivos.length ? s.motivos : ['otra_mejor']) cuenta[m] = (cuenta[m] ?? 0) + 1;
console.log(`Confirmadas: ${j.filas.length} · sospechosas: ${sospechosas.length}`, cuenta, `· detalle en ${SALIDA}`);
