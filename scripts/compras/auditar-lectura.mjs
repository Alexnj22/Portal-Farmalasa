#!/usr/bin/env node
/**
 * ¿La carga de compras sigue leyendo bien? — `npm run auditar:compras`
 *
 * Nació el 2026-11-05 de hacer esto mismo a mano sobre octubre: se leyeron
 * los 495 DTE del mes con la propuesta de «Cargar compra» y se cruzaron con el
 * lote, el vencimiento y el producto con que el sistema REGISTRÓ las compras
 * que ya estaban cargadas. Salieron cinco formatos de proveedor que no se
 * leían, un lector que le ponía a un producto el lote del renglón de abajo, y
 * productos «seguros» que eran otra concentración. Ninguno daba error.
 *
 * La verdad de referencia es `purchase_receipts` (por el sello de Hacienda):
 * lo que quedó cargado, sea desde el portal o a mano. Una diferencia puede ser
 * del portal o de quien tipeó; por eso el gate mide TASAS y proveedores
 * enteros, no renglones sueltos.
 *
 * Falla (exit 1) si:
 *   - más del 8 % de los lotes o de los vencimientos leídos es DISTINTO al
 *     registrado (un dato falso; en octubre era 4.4 % y 3.5 %, casi todo
 *     tipeo al cargar a mano);
 *   - más del 4 % de los productos que la carga da por SEGUROS no es el
 *     producto que se cargó;
 *   - un proveedor con 3+ renglones con lote (o vencimiento) en el sistema no
 *     tiene NINGUNO leído: es un formato nuevo. Lo que no se lee NO entra en
 *     la tasa: hay proveedores que no lo mandan nunca (Zablah, Steiner…) y
 *     ahí lo escribe Bodega.
 *
 * Uso: node scripts/compras/auditar-lectura.mjs [--dias=14] [--json=salida.json]
 * Corre solo los lunes (.github/workflows/auditar-compras.yml).
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const DIAS = Number(arg('dias', 30));
const TOPE_LOTE = 0.08, TOPE_VENCE = 0.08, TOPE_SEGURO = 0.04;

const env = { ...process.env };
if (existsSync('.env') && !env.VITE_SUPABASE_URL) {
  for (const l of readFileSync('.env', 'utf8').split('\n')) {
    const i = l.indexOf('='); if (i < 0 || l.trim().startsWith('#')) continue;
    env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}
for (const k of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'E2E_USER', 'E2E_PASSWORD']) {
  if (!env[k]) { console.error(`Falta ${k}`); process.exit(2); }
}
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { error: eA } = await sb.auth.signInWithPassword({ email: `${env.E2E_USER}@farmalasa.app`, password: env.E2E_PASSWORD });
if (eA) { console.error('No pude entrar:', eA.message); process.exit(2); }

const desde = new Date(Date.now() - DIAS * 864e5).toISOString().slice(0, 10);
const { data: docs, error: eD } = await sb.from('purchase_dte_documents')
  .select('id, emisor_nombre, sello_recibido').gte('fecha_emision', desde).in('tipo_dte', ['01', '03', '14'])
  .not('sello_recibido', 'is', null).range(0, 999);
if (eD) throw eD;

// La verdad: lo que quedó registrado con ese sello.
const verdad = new Map();
for (let i = 0; i < docs.length; i += 100) {
  const ch = docs.slice(i, i + 100);
  const { data: rec, error } = await sb.from('purchase_receipts').select('id, sello_recibido').in('sello_recibido', ch.map((d) => d.sello_recibido));
  if (error) throw error;
  for (let j = 0; j < rec.length; j += 100) {
    const ids = rec.slice(j, j + 100).map((r) => r.id);
    const { data: it, error: e2 } = await sb.from('purchase_receipt_items')
      .select('receipt_id, erp_product_id, descripcion, lote, fecha_vencimiento').in('receipt_id', ids).range(0, 999);
    if (e2) throw e2;
    for (const r of rec.slice(j, j + 100)) {
      const doc = ch.find((d) => d.sello_recibido === r.sello_recibido);
      const l = verdad.get(doc.id) ?? []; l.push(...it.filter((x) => x.receipt_id === r.id)); verdad.set(doc.id, l);
    }
  }
}
const conVerdad = docs.filter((d) => verdad.get(d.id)?.length);

// La propuesta de «Cargar compra», tal cual la ve Bodega.
const props = new Map(); const cola = [...conVerdad];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cola.length) {
    const d = cola.shift();
    for (let t = 0; t < 2; t++) {
      const { data, error } = await sb.functions.invoke('leer-dte-json', { body: { document_ids: [d.id], modo: 'propuesta', max_items: 300 } });
      if (!error && data?.documentos?.[0]?.renglones) { props.set(d.id, data.documentos[0]); break; }
    }
  }
}));

const limpio = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const bigramas = (s) => { const t = limpio(s); const o = new Map(); for (let i = 0; i < t.length - 1; i++) o.set(t.slice(i, i + 2), (o.get(t.slice(i, i + 2)) ?? 0) + 1); return o; };
const parecido = (a, b) => {
  const A = bigramas(a), B = bigramas(b); let c = 0, n = 0;
  for (const [k, v] of A) { c += Math.min(v, B.get(k) ?? 0); n += v; }
  for (const v of B.values()) n += v;
  return n ? (2 * c) / n : 0;
};

const m = { lote_ok: 0, lote_mal: 0, lote_sin: 0, vence_ok: 0, vence_mal: 0, vence_sin: 0, seguro_ok: 0, seguro_mal: 0 };
const porProv = new Map(); const ejemplos = [];
for (const d of conVerdad) {
  const p = props.get(d.id); if (!p) continue;
  const items = [...verdad.get(d.id)];
  const prov = p.encabezado?.proveedor ?? d.emisor_nombre;
  const pp = porProv.get(prov) ?? { con_lote: 0, leidos: 0, con_vence: 0, vence_leidos: 0 }; porProv.set(prov, pp);
  for (const r of p.renglones) {
    if (r.servicio_sugerido) continue;
    let i = r.producto_id ? items.findIndex((x) => x.erp_product_id === r.producto_id) : -1;
    const seguroMal = r.seguro && r.producto_id && i < 0;
    if (r.seguro && r.producto_id) { if (i >= 0) m.seguro_ok++; else m.seguro_mal++; }
    if (i < 0) {
      let mejor = -1, s = 0.55;
      items.forEach((x, k) => { const v = parecido(String(r.descripcion).slice(0, 40), x.descripcion); if (v > s) { s = v; mejor = k; } });
      i = mejor;
    }
    if (seguroMal) {
      ejemplos.push(`${prov} · «${String(r.descripcion).replace(/\s+/g, ' ').slice(0, 50)}» · la carga proponía **${r.producto}** (${r.match_origen}) · se cargó **${i >= 0 ? items[i].descripcion : '¿?'}**`);
    }
    if (i < 0) continue;
    const real = items.splice(i, 1)[0];
    const lr = limpio(real.lote), lp = limpio(r.lote);
    if (lr && lr !== 'GENERICO' && lr !== 'NULL') {
      pp.con_lote++;
      if (lp) pp.leidos++;
      if (!lp) m.lote_sin++;
      else if (lp === lr || lp.includes(lr) || lr.includes(lp)) m.lote_ok++;
      else m.lote_mal++;
    }
    const vr = String(real.fecha_vencimiento ?? '').slice(0, 7), vp = String(r.vence ?? '').slice(0, 7);
    if (vr && !vr.startsWith('2099') && !vr.startsWith('1900')) {
      pp.con_vence++; if (vp) pp.vence_leidos++;
      if (!vp) m.vence_sin++; else if (vp === vr) m.vence_ok++; else m.vence_mal++;
    }
  }
}

const tasa = (mal, ok) => (mal + ok ? mal / (mal + ok) : 0);
const tLote = tasa(m.lote_mal, m.lote_ok);
const tVence = tasa(m.vence_mal, m.vence_ok);
const tSeguro = tasa(m.seguro_mal, m.seguro_ok);
// Sólo cuenta como «formato nuevo» si el proveedor SÍ manda el dato en algún
// documento leído antes — se aproxima con «lo lee en algún renglón de otro
// proveedor no»: acá basta con avisar y que alguien abra el PDF.
const nuevos = [
  ...[...porProv].filter(([, v]) => v.con_lote >= 3 && v.leidos === 0).map(([k, v]) => `${k}: ${v.con_lote} renglones con lote en el sistema y ninguno leído`),
  ...[...porProv].filter(([, v]) => v.con_vence >= 3 && v.vence_leidos === 0).map(([k, v]) => `${k}: ${v.con_vence} renglones con vencimiento en el sistema y ninguno leído`),
];
// Los que se sabe que no lo traen ni en el DTE ni en el PDF (cruce de octubre).
const SIN_DATO = /LABORATORIOS SUIZOS|ZABLAH|CONGELADOS DEL SABOR|STEINER|UNISERFA|BAZZINI|EUROPEAS|SAN NICOLAS|LANCASCO|RANIER|MUNDO MEDICO|MEDICAL PHARMA/i;
const nuevosDeVerdad = nuevos.filter((n) => !SIN_DATO.test(n));
const sinDato = [...new Set(nuevos.filter((n) => SIN_DATO.test(n)).map((n) => n.split(':')[0]))];

const fallas = [];
if (tLote > TOPE_LOTE) fallas.push(`lotes que no coinciden: ${(tLote * 100).toFixed(1)} % (tope ${TOPE_LOTE * 100} %)`);
if (tVence > TOPE_VENCE) fallas.push(`vencimientos que no coinciden: ${(tVence * 100).toFixed(1)} % (tope ${TOPE_VENCE * 100} %)`);
if (tSeguro > TOPE_SEGURO) fallas.push(`productos «seguros» que eran otro: ${(tSeguro * 100).toFixed(1)} % (tope ${TOPE_SEGURO * 100} %)`);
for (const n of nuevosDeVerdad) fallas.push(`formato que no se lee: ${n}`);

const informe = [
  `## Lectura de compras — últimos ${DIAS} días`,
  ``,
  `${conVerdad.length} documentos ya cargados en el sistema, de ${docs.length} recibidos; ${props.size} leídos.`,
  ``,
  `| | coincide | distinto | sin leer | % malo |`,
  `|---|---:|---:|---:|---:|`,
  `| lote | ${m.lote_ok} | ${m.lote_mal} | ${m.lote_sin} | ${(tLote * 100).toFixed(1)} % distinto |`,
  `| vencimiento | ${m.vence_ok} | ${m.vence_mal} | ${m.vence_sin} | ${(tVence * 100).toFixed(1)} % distinto |`,
  `| producto «seguro» | ${m.seguro_ok} | ${m.seguro_mal} | — | ${(tSeguro * 100).toFixed(1)} % |`,
  ``,
  sinDato.length ? `Sin el dato en el documento (lo escribe Bodega): ${sinDato.join(', ')}.\n` : '',
  fallas.length ? `### ❌ Revisar\n${fallas.map((f) => `- ${f}`).join('\n')}` : `### ✅ Sin hallazgos`,
  ejemplos.length ? `\n### Productos «seguros» que se cargaron como otro (o la carga o el sistema está mal)\n${ejemplos.slice(0, 20).map((e) => `- ${e}`).join('\n')}` : '',
].join('\n');

console.log(informe);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, informe + '\n');
const salida = arg('json', null);
if (salida) writeFileSync(salida, JSON.stringify({ m, tLote, tVence, tSeguro, nuevos, ejemplos }, null, 1));
process.exit(fallas.length ? 1 : 0);
