// Pruebas de `operar-caja` para el cobro de aplicaciones (2026-10-02).
// SÓLO contra el entorno de pruebas (lee `.env.staging`; se niega con la URL de
// producción). Entra con la cuenta `pruebas` y llama a la función igual que el
// portal. Los movimientos que crea llevan la clave `prueba-auto-…` para poder
// borrarlos después (ver el final de `probar_inyecciones_pagadas.sql`).
//
//   node scripts/entorno-pruebas/probar_operar_caja_aplicacion.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('.env.staging', 'utf8').split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const URL = env.VITE_SUPABASE_URL;
if (!URL || URL.includes('sacecdkdmsdvgqnrsett')) throw new Error('Esto no es el entorno de pruebas.');
const sb = createClient(URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const SALA = 28;
const res = [];
const ok = (prueba, cond, detalle = '') => res.push({ ok: !!cond, prueba, detalle: String(detalle).slice(0, 140) });
const clave = () => `prueba-auto-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function operar(body) {
    const { data, error } = await sb.functions.invoke('operar-caja', { body });
    if (error) {
        let cuerpo = null;
        try { cuerpo = await error.context.json(); } catch { /* sin cuerpo */ }
        return { status: error.context?.status, ...(cuerpo || { error: error.message }) };
    }
    return { status: 200, ...data };
}
async function contarMovimientos() {
    const { count } = await sb.from('caja_movimientos_portal').select('id', { count: 'exact', head: true })
        .eq('branch_id', SALA).eq('tipo_codigo', 'APLICACION');
    return count;
}

const { error: errLogin } = await sb.auth.signInWithPassword({ email: 'pruebas@farmalasa.app', password: 'pruebas2026' });
ok('entrar con la cuenta de pruebas', !errLogin, errLogin?.message);

// Precios y una venta con al menos 2 aplicaciones por pagar.
const { data: precios } = await sb.from('inyeccion_precios').select('origen, precio');
const P = Object.fromEntries((precios || []).map((p) => [p.origen, Number(p.precio)]));
const { data: ventas, error: errV } = await sb.rpc('inyecciones_para_cobrar', { p_branch_id: SALA, p_buscar: null, p_dias: 7 });
const venta = (ventas || []).find((v) => v.renglones.some((r) => r.disponibles >= 2));
const reng = venta?.renglones.find((r) => r.disponibles >= 2);
ok('hay una venta con 2+ aplicaciones por pagar para probar', !!reng, errV?.message || `${venta?.correlativo} · ${reng?.descripcion} · ${reng?.disponibles} por pagar`);

// 1. Estado de la caja simulada.
let r = await operar({ accion: 'estado', sala: SALA });
ok('caja simulada: «estado» contesta abierta', r.status === 200 && r.abierta === true, JSON.stringify({ s: r.status, a: r.abierta }));

// 2. Lo que la caja simulada NO hace.
r = await operar({ accion: 'salida', sala: SALA, monto: 1, concepto: 'x' });
ok('caja simulada: una salida se rechaza (no hay caja real)', r.status === 409 && /simulada/.test(r.error), `${r.status} ${r.error}`);
r = await operar({ accion: 'cerrar', sala: SALA });
ok('caja simulada: cerrar el día se rechaza', r.status === 409, `${r.status} ${r.error}`);

// 3. Aplicación sin decir de qué venta.
r = await operar({ accion: 'ingreso', sala: SALA, monto: 1, concepto: 'Aplicacion de inyeccion', tipo: 'APLICACION', clave_envio: clave() });
ok('aplicación sin venta ni traída → 400', r.status === 400, `${r.status} ${r.error}`);

// 4. El origen viejo «sin venta» ya no existe.
const antes = await contarMovimientos();
r = await operar({ accion: 'ingreso', sala: SALA, monto: P.COMPRADA, concepto: 'Aplicacion de inyeccion', tipo: 'APLICACION',
    clave_envio: clave(), aplicacion: { origen: 'SIN_VENTA', producto: 'NEUROBION', cantidad: 1, aplicar_ahora: 1 } });
ok('origen «SIN_VENTA» → 400', r.status === 400, `${r.status} ${r.error}`);

// 5. La pantalla dice un monto y el precio vigente es otro.
r = await operar({ accion: 'ingreso', sala: SALA, monto: 9.99, concepto: 'Aplicacion de inyeccion', tipo: 'APLICACION', clave_envio: clave(),
    aplicacion: { origen: 'COMPRADA', items: [{ invoice_id: venta.id, linea_num: reng.linea_num, cantidad: 1 }], aplicar_ahora: 1 } });
ok('monto distinto del precio vigente → 409 y se le pide reabrir', r.status === 409 && r.precio_cambio === true, `${r.status} ${r.error}`);

// 6. Pagar más de lo que trae la venta.
r = await operar({ accion: 'ingreso', sala: SALA, monto: P.COMPRADA * (reng.disponibles + 1), concepto: 'Aplicacion de inyeccion', tipo: 'APLICACION',
    clave_envio: clave(), aplicacion: { origen: 'COMPRADA', items: [{ invoice_id: venta.id, linea_num: reng.linea_num, cantidad: reng.disponibles + 1 }], aplicar_ahora: 0, cliente: 'X X X' } });
ok('pagar más aplicaciones de las que quedan → 409', r.status === 409 && /Ya no quedan/.test(r.error), `${r.status} ${r.error}`);
ok('los rechazos no dejaron ningún movimiento escrito', (await contarMovimientos()) === antes, `${antes} → ${await contarMovimientos()}`);

// 7. El cobro bueno: 2, aplicar 1, a nombre de alguien.
const k = clave();
const cuerpo = { accion: 'ingreso', sala: SALA, monto: P.COMPRADA * 2, concepto: 'Aplicacion de inyeccion', tipo: 'APLICACION', clave_envio: k,
    aplicacion: { origen: 'COMPRADA', items: [{ invoice_id: venta.id, linea_num: reng.linea_num, cantidad: 2 }], aplicar_ahora: 1, cliente: 'Cliente De Prueba Automatica' } };
r = await operar(cuerpo);
const movId = r.movimiento_del_portal;
ok('cobro comprada ×2 aplicando 1 → ok, con la factura en el concepto', r.status === 200 && r.ok && /Fac /.test(r.movimiento?.concepto || ''),
    `${r.status} ${r.movimiento?.concepto} ${r.error || ''}`);
ok('el monto guardado es el del precio vigente', Number(r.movimiento?.monto) === P.COMPRADA * 2, r.movimiento?.monto);
const { data: filas } = await sb.from('inyeccion_aplicaciones').select('id, confirmada, aplicada_at, cliente, aplicada_branch_id').eq('cobro_id', movId);
ok('quedaron 2 aplicaciones confirmadas, 1 aplicada, a nombre del cliente', (filas || []).length === 2
    && filas.every((f) => f.confirmada && f.cliente === 'CLIENTE DE PRUEBA AUTOMATICA')
    && filas.filter((f) => f.aplicada_at).length === 1, JSON.stringify(filas?.map((f) => [f.confirmada, !!f.aplicada_at])));

// 8. El mismo envío otra vez (doble toque, reintento de red).
r = await operar(cuerpo);
const { data: filas2 } = await sb.from('inyeccion_aplicaciones').select('id').eq('cobro_id', movId);
ok('el mismo envío repetido contesta «repetido» y no duplica nada', r.ok && r.repetido === true && r.movimiento_del_portal === movId && filas2.length === 2,
    `${r.repetido} ${r.movimiento_del_portal} ${filas2?.length}`);

// 9. La pendiente aparece y se canjea.
const { data: pend } = await sb.rpc('inyecciones_pendientes', { p_buscar: 'Cliente De Prueba Automatica', p_branch_id: null });
ok('la que quedó sin aplicar aparece en pendientes por el nombre', (pend || []).length === 1, (pend || []).length);
const { data: n, error: errA } = await sb.rpc('inyeccion_aplicar', { p_ids: (pend || []).map((p) => p.id), p_branch_id: SALA });
ok('canjearla la marca aplicada', n === 1, errA?.message || n);

// 10. Traída.
r = await operar({ accion: 'ingreso', sala: SALA, monto: P.TRAIDA, concepto: 'Aplicacion de inyeccion', tipo: 'APLICACION', clave_envio: clave(),
    aplicacion: { origen: 'TRAIDA', producto: 'Neurobion 25000', cantidad: 1, aplicar_ahora: 1 } });
ok('traída ×1 aplicada al momento → ok, al precio de traída', r.ok && Number(r.movimiento?.monto) === P.TRAIDA && /Traida/.test(r.movimiento?.concepto || ''),
    `${r.status} ${r.movimiento?.concepto} ${r.error || ''}`);

// 11. Un ingreso que no es aplicación sigue igual que siempre.
r = await operar({ accion: 'ingreso', sala: SALA, monto: 1, concepto: 'Glucosa · prueba automatica', tipo: 'GLUCOSA', clave_envio: clave() });
ok('un ingreso de otro tipo (glucosa) sigue funcionando igual', r.ok && !r.aplicaciones, `${r.status} ${r.error || ''}`);

for (const x of res) console.log(`${x.ok ? 'OK   ' : 'FALLA'}  ${x.prueba}${x.detalle ? `  ·  ${x.detalle}` : ''}`);
console.log(`\n${res.filter((x) => x.ok).length} de ${res.length} OK`);
process.exit(res.every((x) => x.ok) ? 0 : 1);
