// ROLLBACK: devuelve a Bodega lo que un pedido de prueba trasladó a la sucursal.
//
// Se escribe ANTES de despachar a propósito: si la ida se corta a la mitad, el
// camino de vuelta ya existe y no hay que improvisarlo con producto repartido
// entre dos salas.
//
// Lee las líneas REALES de `pedido_traslado_linea` —con la presentación, el
// lote y la cantidad que de verdad se movieron— y arma el traslado inverso.
// No inventa nada: revierte exactamente lo que salió.
//
//   node rollback.mjs <pedido_id> <erp_sucursal_id> [--ejecutar]
//
// Sin `--ejecutar` sólo muestra lo que haría.
import { readFileSync } from 'fs';
import { createClient } from '/Users/alexnunez/Documents/Portal-Farmalasa/node_modules/@supabase/supabase-js/dist/index.mjs';

const env = Object.fromEntries(
  readFileSync('/Users/alexnunez/Documents/Portal-Farmalasa/.env', 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const BASE = 'https://clientesdte3.oss.com.sv/farma_salud';
const [PEDIDO, SUC] = process.argv.slice(2);
const EJECUTAR = process.argv.includes('--ejecutar');
const UBIC = { 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 1, 7: 8 };   // erp_sucursal → ubicación
const UBIC_BODEGA = 1, SUC_BODEGA = 6;

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
await sb.auth.signInWithPassword({ email: `${env.E2E_USER}@farmalasa.app`, password: env.E2E_PASSWORD });

const login = async () => {
  const r = await fetch(`${BASE}/login.php`, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: env.ERP_USUARIO, password: env.ERP_PASSWORD, m: '1' }).toString(),
    redirect: 'manual' });
  return r.headers.get('set-cookie').split(';')[0];
};
const pedir = async (cookie, u, d, ref, ms = 45000) => (await fetch(u, {
  method: d ? 'POST' : 'GET',
  headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest',
             Referer: ref ?? `${BASE}/dashboard.php`,
             ...(d ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
  body: d?.toString(), signal: AbortSignal.timeout(ms) })).text();
const leerResp = t => { try { const j = JSON.parse(t); return { ok: /success/i.test(j.typeinfo ?? ''), msg: j.msg ?? '' }; } catch { return { ok: false, msg: t.slice(0, 120) }; } };
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const hoySV = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);

// Las líneas que de verdad salieron
const { data: lineas, error } = await sb.from('pedido_traslado_linea')
  .select('id, pedido_item_id, erp_product_id, cantidad, clave, estado, detalle')
  .eq('pedido_id', PEDIDO).eq('erp_sucursal_id', Number(SUC))
  .in('estado', ['enviada', 'recibida']);
if (error) { console.log('no pude leer las líneas:', error.message); process.exit(1); }
if (!lineas?.length) { console.log('no hay nada que devolver'); process.exit(0); }

console.log(`a devolver: ${lineas.length} producto(s) de la sucursal ${SUC} hacia Bodega`);
for (const l of lineas) {
  const d = l.detalle ?? {};
  console.log(`  ${l.clave} · ${d.producto ?? l.erp_product_id} · ${l.cantidad} · ${d.presentacion ?? '?'} · estado=${l.estado}`);
}
if (!EJECUTAR) { console.log('\n(simulación — agregá --ejecutar para hacerlo de verdad)'); process.exit(0); }

// ── La vuelta: sesión en la SUCURSAL, destino Bodega ──────────────────────────
const cookie = await login();
const s = await pedir(cookie, `${BASE}/cambio_sesion.php`,
  new URLSearchParams({ process: 'set_sucursal', id_sucursal: String(SUC) }), `${BASE}/dashboard.php`);
if (!JSON.parse(s)?.success) { console.log('no se pudo abrir la sucursal'); process.exit(1); }

const ubicOrigen = UBIC[Number(SUC)];
const partes = []; const detalle = []; let total = 0;

for (const l of lineas) {
  const filaHtml = await pedir(cookie, `${BASE}/traslado_producto.php`, new URLSearchParams({
    process: 'traerdatos', page: '1', producto_buscar: String(l.erp_product_id),
    origen: String(ubicOrigen), sortBy: 'asc', records: '50' }), `${BASE}/traslado_producto.php`);

  const presSel = filaHtml.match(/<select[^>]*class=["'][^"']*\bsel\b[^"']*["'][^>]*>([\s\S]*?)<\/select>/)?.[1] ?? '';
  const pres = [...presSel.matchAll(/<option[^>]*value=["'](\d+)["'][^>]*>([^<]*)</g)].map(m => ({ id: m[1], tipo: norm(m[2]) }));
  const loteSel = filaHtml.match(/<select[^>]*class=['"][^'"]*lote-select[^'"]*['"][^>]*>([\s\S]*?)<\/select>/)?.[0] ?? '';
  const regulado = /data-regulado=['"]1['"]/.test(loteSel);
  const lotes = [...loteSel.matchAll(/<option([^>]*)>([^<]*)</g)].map(m => ({
    id: m[1].match(/value=['"](\d+)['"]/)?.[1] ?? '',
    numero: m[2].trim().split(' - ')[0].trim(),
    stock: Number(m[1].match(/data-stock=['"]([^'"]*)['"]/)?.[1] ?? 0) })).filter(x => x.id);
  const vence = filaHtml.match(/class=['"][^'"]*\bvence\b[^'"]*['"][^>]*value=['"]([^'"]*)['"]/)?.[1] ?? '';

  // La presentación tiene que traer el MISMO factor con el que se fue
  const d = l.detalle ?? {};
  const tipoBuscado = norm(String(d.presentacion ?? '').replace(/\s*\(.*\)$/, ''));
  const factorIda = Number(String(d.presentacion ?? '').match(/\((\d+)\)/)?.[1] ?? 0);
  let elegida = null;
  for (const c of pres.filter(p => !tipoBuscado || p.tipo === tipoBuscado)) {
    const jp = JSON.parse(await pedir(cookie, `${BASE}/traslado_producto.php`,
      new URLSearchParams({ process: 'getpresentacion', id_presentacion: c.id }), `${BASE}/traslado_producto.php`));
    if (!factorIda || Number(jp?.unidad) === factorIda) { elegida = { ...c, ...jp }; break; }
  }
  if (!elegida) { console.log(`  ✗ ${l.clave}: no encontré la presentación con la que se fue`); continue; }

  // El mismo lote que viajó
  let idLote = '0';
  if (regulado) {
    const renglones = Array.isArray(d.renglones) ? d.renglones : [];
    const numero = renglones[0]?.lote;
    const lote = numero ? lotes.find(x => norm(x.numero) === norm(numero)) : lotes.sort((a, b) => b.stock - a.stock)[0];
    if (!lote) { console.log(`  ✗ ${l.clave}: el lote ${numero} no está en la sucursal`); continue; }
    idLote = lote.id;
  }

  partes.push([l.erp_product_id, elegida.costo, elegida.precio, l.cantidad, elegida.unidad, vence, elegida.id, idLote].join('|'));
  total += Number(elegida.costo || 0) * Number(l.cantidad);
  detalle.push({ clave: l.clave, producto: d.producto, cantidad: l.cantidad, lote: idLote });
}

if (!partes.length) { console.log('no se pudo armar ni una línea de vuelta'); process.exit(1); }

const html = await pedir(cookie, `${BASE}/traslado_producto.php`, undefined, `${BASE}/dashboard.php`);
const vale = html.match(/numero_vale["'][^>]*value=["']([^"']+)["']/)?.[1];
if (!vale) { console.log('el sistema no dio vale para la vuelta'); process.exit(1); }

const resp = leerResp(await pedir(cookie, `${BASE}/traslado_producto.php`, new URLSearchParams({
  process: 'insert', datos: partes.join('#') + '#', id_traslado_guardado: '0',
  cuantos: String(partes.length), total: total.toFixed(4), fecha: hoySV(),
  concepto: `ROLLBACK prueba portal - devuelve a Bodega`,
  origen: String(ubicOrigen), id_suc_destino: String(SUC_BODEGA),
  id_ubicacion_destino: '0', numero_vale: vale }), `${BASE}/traslado_producto.php`));

if (!resp.ok) { console.log(`\n✗ el sistema no aceptó la vuelta: ${resp.msg}`); process.exit(1); }
console.log(`\n✓ traslado de vuelta creado (${partes.length} líneas)`);

// ── Y se RECIBE en Bodega ────────────────────────────────────────────────────
// Sin esto el producto queda en tránsito: fuera de la sucursal y todavía no en
// Bodega, que es peor que en cualquiera de los dos lados. El rollback no está
// completo hasta acá.
const pendientes = async (ck, ubic) => {
  try {
    const j = JSON.parse(await pedir(ck, `${BASE}/admin_traslados_dt.php`, new URLSearchParams({
      draw: '0', start: '0', length: '200', origen: String(ubic), pro: 'env', estado: 'pe' }),
      `${BASE}/admin_traslados.php`));
    if (!Array.isArray(j?.data) || j.recordsFiltered === j.recordsTotal) return new Set();
    return new Set(j.data.map(f => String(f?.[0] ?? '')).filter(Boolean));
  } catch { return new Set(); }
};
const despues = await pendientes(cookie, ubicOrigen);
const idVuelta = [...despues][despues.size - 1];
if (!idVuelta) { console.log('✗ no pude identificar el traslado de vuelta — recibirlo a mano en Bodega'); process.exit(1); }
console.log(`  id del traslado de vuelta: ${idVuelta}`);

const ckBodega = await login();
const sb2 = await pedir(ckBodega, `${BASE}/cambio_sesion.php`,
  new URLSearchParams({ process: 'set_sucursal', id_sucursal: String(SUC_BODEGA) }), `${BASE}/dashboard.php`);
if (!JSON.parse(sb2)?.success) { console.log('✗ no se pudo abrir Bodega para recibir'); process.exit(1); }

const pag = await pedir(ckBodega, `${BASE}/recibir_traslado.php?id_movimiento=${idVuelta}`,
  undefined, `${BASE}/admin_traslados.php`);
const trs = [...pag.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map(m => m[0]).filter(t => /class="id_p"/.test(t));
const pr = []; let tot = 0;
for (const tr of trs) {
  const idProd = tr.match(/class="id_p">\s*([\d]+)/)?.[1] ?? '';
  const idPres = tr.match(/<select[^>]*class=['"]sel['"][^>]*>\s*<option[^>]*value=['"](\d+)['"]/)?.[1] ?? '';
  const compra = tr.match(/class=['"][^'"]*precio_compra[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? '0';
  const venta  = tr.match(/class=['"][^'"]*precio_venta[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? '0';
  const unidad = tr.match(/class=['"]unidad['"][^>]*value=['"](\d+)/)?.[1] ?? '1';
  const esp    = tr.match(/class=['"][^'"]*\besp\b[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? '0';
  const ven    = tr.match(/class=['"][^'"]*\bvence\b[^'"]*['"][^>]*value=['"]([^'"]*)['"]/)?.[1] ?? '';
  if (!idProd || !idPres) continue;
  pr.push([idProd, compra, venta, esp, unidad, ven, idPres, esp].join('|'));
  tot += Number(compra) * Number(esp);
}
if (!pr.length) { console.log('✗ el traslado de vuelta no muestra líneas para recibir'); process.exit(1); }

const rec = leerResp(await pedir(ckBodega, `${BASE}/recibir_traslado.php`, new URLSearchParams({
  process: 'insert', datos: pr.join('#') + '#', cuantos: String(pr.length),
  total: tot.toFixed(4), fecha: hoySV(), concepto: 'ROLLBACK prueba portal - recibido en Bodega',
  destino: String(UBIC_BODEGA), id_traslado: idVuelta }), `${BASE}/recibir_traslado.php`));

console.log(rec.ok ? '✓ recibido en Bodega — rollback COMPLETO' : `✗ no se pudo recibir en Bodega: ${rec.msg}`);
console.log(JSON.stringify(detalle, null, 1));
