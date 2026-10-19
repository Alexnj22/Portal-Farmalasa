// Pruebas del pago del asegurado de Mapfre (2026-10-19). SÓLO contra el
// entorno de pruebas. Necesita la ficha de Mapfre (erp_id 19713) y las facturas
// PRUEBA-MAP-1..4 sembradas por la sesión (sala 28, y la 4 en la sala 25).
//
//   node scripts/entorno-pruebas/probar_mapfre.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('.env.staging', 'utf8').split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
if (!env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL.includes('sacecdkdmsdvgqnrsett')) throw new Error('Esto no es el entorno de pruebas.');
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const SALA = 28;
const res = [];
const ok = (prueba, cond, detalle = '') => res.push({ ok: cond ? '✓' : '✗', prueba, detalle: cond ? '' : String(detalle ?? '').slice(0, 140) });
const clave = () => `prueba-mapfre-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
async function operar(body) {
    const { data, error } = await sb.functions.invoke('operar-caja', { body });
    if (error) { let c = null; try { c = await error.context.json(); } catch { /* */ } return { status: error.context?.status, ...(c || { error: error.message }) }; }
    return { status: 200, ...data };
}
const cobrar = (extra) => operar({ accion: 'ingreso', sala: SALA, concepto: 'Pago de asegurado Mapfre', tipo: 'MAPFRE', clave_envio: clave(), ...extra });

await sb.auth.signInWithPassword({ email: 'pruebas@farmalasa.app', password: 'pruebas2026' });
const { data: clientes } = await sb.from('customers').select('id, name').neq('erp_id', '19713').limit(1);
const asegurado = clientes?.[0];
ok('hay un cliente para usar de asegurado', !!asegurado);

let { data: lista, error } = await sb.rpc('mapfre_facturas', { p_branch_id: SALA, p_buscar: null, p_dias: 60 });
const f1 = (lista || []).find((f) => f.correlativo === 'PRUEBA-MAP-1');
const f2 = (lista || []).find((f) => f.correlativo === 'PRUEBA-MAP-2');
const f3 = (lista || []).find((f) => f.correlativo === 'PRUEBA-MAP-3');
ok('la lista trae las facturas de Mapfre de la sala con lo que paga el asegurado', Number(f1?.asegurado) === 7.89 && Number(f2?.asegurado) === 0.47, error?.message || JSON.stringify(lista?.map((f) => [f.correlativo, f.asegurado])));
ok('no trae la de otra sala', !(lista || []).some((f) => f.correlativo === 'PRUEBA-MAP-4'));
ok('no trae las de antes del 19-oct (el cobro empezó ese día)', !(lista || []).some((f) => f.correlativo === 'PRUEBA-MAP-VIEJA'));
ok('las tres están POR_COBRAR', [f1, f2, f3].every((f) => f?.estado === 'POR_COBRAR'), JSON.stringify([f1?.estado, f2?.estado, f3?.estado]));
({ data: lista } = await sb.rpc('mapfre_facturas', { p_branch_id: SALA, p_buscar: 'menaderm', p_dias: 60 }));
ok('buscar por producto la encuentra', lista?.length === 1 && lista[0].correlativo === 'PRUEBA-MAP-1', JSON.stringify(lista?.map((f) => f.correlativo)));

let r = await cobrar({ monto: 7.89 });
ok('sin factura → 400', r.status === 400 && /factura/.test(r.error), `${r.status} ${r.error}`);
r = await cobrar({ monto: 7.89, mapfre: { invoice_id: f1.id } });
ok('sin asegurado → 400', r.status === 400 && /asegurado/.test(r.error), `${r.status} ${r.error}`);
r = await cobrar({ monto: 5, mapfre: { invoice_id: f1.id, customer_id: asegurado.id } });
ok('monto distinto del de la factura → 409', r.status === 409 && /7\.89/.test(r.error), `${r.status} ${r.error}`);
r = await cobrar({ monto: 2.67, mapfre: { invoice_id: (await sb.from('sales_invoices').select('id').eq('correlativo', 'PRUEBA-MAP-4').single()).data?.id, customer_id: asegurado.id } });
ok('factura de otra sala → 409', r.status === 409 && /otra sala/.test(r.error), `${r.status} ${r.error}`);
r = await cobrar({ monto: 1, mapfre: { invoice_id: 990000101, customer_id: asegurado.id } });
ok('factura que no es de Mapfre → 409', r.status === 409, `${r.status} ${r.error}`);

r = await cobrar({ monto: 7.89, mapfre: { invoice_id: f1.id, customer_id: asegurado.id } });
ok('cobro en efectivo → anotado con factura y asegurado', r.status === 200 && r.movimiento?.invoice_id === f1.id && r.movimiento?.customer_id === asegurado.id && Number(r.movimiento?.monto) === 7.89, `${r.status} ${r.error ?? ''}`);
ok('el concepto lleva la factura y el asegurado', /Fac PRUEBA-MAP-1/.test(r.movimiento?.detalle ?? '') && (r.movimiento?.detalle ?? '').includes(asegurado.name), r.movimiento?.detalle);
const mov1 = r.movimiento;
r = await cobrar({ monto: 7.89, mapfre: { invoice_id: f1.id, customer_id: asegurado.id } });
ok('la misma factura otra vez → 409', r.status === 409 && /ya tiene su pago/.test(r.error), `${r.status} ${r.error}`);

r = await cobrar({ monto: 0.47, mapfre: { invoice_id: f2.id, customer_id: asegurado.id }, forma_pago: 'TARJETA', foto_url: 'https://example.invalid/v.jpg', comprobante_total: 0.47 });
ok('cobro con tarjeta → no va a la caja', r.status === 200 && r.no_va_a_caja === true && r.movimiento?.invoice_id === f2.id, `${r.status} ${r.error ?? ''}`);

// «Otro» anotado antes del tipo: ese dinero ya entró.
r = await operar({ accion: 'ingreso', sala: SALA, monto: 2.67, concepto: 'Otro · pago cliente mapfre', tipo: 'OTRO_ENTRADA', clave_envio: clave() });
({ data: lista } = await sb.rpc('mapfre_facturas', { p_branch_id: SALA, p_buscar: null, p_dias: 60 }));
const est = Object.fromEntries((lista || []).map((f) => [f.correlativo, f.estado]));
ok('la cobrada queda COBRADA', est['PRUEBA-MAP-1'] === 'COBRADA' && est['PRUEBA-MAP-2'] === 'COBRADA', JSON.stringify(est));
ok('la anotada como «Otro» ese día queda ANOTADA_COMO_OTRO', est['PRUEBA-MAP-3'] === 'ANOTADA_COMO_OTRO', JSON.stringify(est));

// Anular el cobro libera la factura.
r = await operar({ accion: 'corregir', sala: SALA, movimiento: mov1.id, que: 'ANULAR', motivo: 'prueba de anular mapfre' });
const qa = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
await qa.auth.signInWithPassword({ email: 'qa.test@farmalasa.app', password: 'pruebas2026' });
const { data: ap, error: errAp } = await qa.functions.invoke('operar-caja', { body: { accion: 'aplicar_correccion', sala: SALA, solicitud: r.solicitud } });
ok('anular el cobro de Mapfre', !errAp && ap?.ok, errAp?.message);
({ data: lista } = await sb.rpc('mapfre_facturas', { p_branch_id: SALA, p_buscar: null, p_dias: 60 }));
ok('anulado, la factura vuelve a POR_COBRAR', lista.find((f) => f.correlativo === 'PRUEBA-MAP-1')?.estado === 'POR_COBRAR', lista.find((f) => f.correlativo === 'PRUEBA-MAP-1')?.estado);
r = await cobrar({ monto: 7.89, mapfre: { invoice_id: f1.id, customer_id: asegurado.id } });
ok('y se puede volver a cobrar', r.status === 200, `${r.status} ${r.error ?? ''}`);

console.table(res);
const fallas = res.filter((x) => x.ok === '✗').length;
console.log(fallas ? `✗ ${fallas} de ${res.length} fallaron` : `✓ ${res.length} de ${res.length} pasaron`);
process.exit(fallas ? 1 : 0);
