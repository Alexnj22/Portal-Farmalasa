// Pruebas de la forma de pago en los ingresos de caja (2026-10-17).
// SÓLO contra el entorno de pruebas (lee `.env.staging`; se niega con la URL de
// producción). Entra con DOS cuentas —`pruebas` anota, `qa.test` decide— porque
// nadie puede autorizar ni corregir lo propio, y eso también se prueba.
//
// Antes: una venta con tarjeta de $13.37 en la sala 28 ese día (la crea la
// sesión que lo corre; ver `docs/planes-cerrados/PLAN-INGRESOS-Y-RESERVAS-2026-10-17.md`).
// Los movimientos llevan la clave `prueba-ingresos-…` para borrarlos después.
//
//   node scripts/entorno-pruebas/probar_ingresos_forma_de_pago.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('.env.staging', 'utf8').split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const URL = env.VITE_SUPABASE_URL;
if (!URL || URL.includes('sacecdkdmsdvgqnrsett')) throw new Error('Esto no es el entorno de pruebas.');
const nuevo = () => createClient(URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const sala = nuevo();   // anota
const jefe = nuevo();   // decide

const SALA = 28;
const FOTO = 'https://example.invalid/payment-proofs/prueba-voucher.jpg';
const res = [];
const ok = (prueba, cond, detalle = '') => res.push({ ok: !!cond, prueba, detalle: String(detalle ?? '').slice(0, 160) });
const clave = () => `prueba-ingresos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const voucher = String(Date.now()).slice(-9);

async function operar(sb, body) {
    const { data, error } = await sb.functions.invoke('operar-caja', { body });
    if (error) {
        let cuerpo = null;
        try { cuerpo = await error.context.json(); } catch { /* sin cuerpo */ }
        return { status: error.context?.status, ...(cuerpo || { error: error.message }) };
    }
    return { status: 200, ...data };
}
const ingreso = (extra) => operar(sala, { accion: 'ingreso', sala: SALA, concepto: 'Otro · prueba forma de pago', tipo: 'OTRO_ENTRADA', clave_envio: clave(), ...extra });
const fila = async (id) => (await sala.from('caja_movimientos_portal').select('*').eq('id', id).single()).data;
// Por «estado», igual que la pantalla: `caja_efectivo_piezas` sólo la llama el
// servidor. Y sin piezas se FALLA: comparar vacío con vacío daría verde.
const piezas = async () => {
    const r = await operar(sala, { accion: 'estado', sala: SALA });
    if (!r.efectivo_piezas) throw new Error(`«estado» no trajo las piezas del cajón: ${r.status} ${r.error ?? ''}`);
    return r.efectivo_piezas;
};
const solicitudDe = async (sb, tipo, movId) => (await sb.from('approval_requests').select('*')
    .eq('type', tipo).eq('metadata->>movimiento_portal', String(movId)).order('created_at', { ascending: false }).limit(1)).data?.[0];
const pedirCorreccion = (extra) => operar(sala, { accion: 'corregir', sala: SALA, motivo: 'prueba automática', ...extra });
const aplicar = (sb, solicitud) => operar(sb, { accion: 'aplicar_correccion', sala: SALA, solicitud, approver_note: 'prueba' });

// ── Entrar ─────────────────────────────────────────────────────────────────
let e = await sala.auth.signInWithPassword({ email: 'pruebas@farmalasa.app', password: 'pruebas2026' });
ok('entra la cuenta que anota (pruebas)', !e.error, e.error?.message);
e = await jefe.auth.signInWithPassword({ email: 'qa.test@farmalasa.app', password: 'pruebas2026' });
ok('entra la cuenta que decide (qa.test)', !e.error, e.error?.message);

// ── 1. Efectivo: como siempre ──────────────────────────────────────────────
let r = await ingreso({ monto: 2 });
ok('1. ingreso sin forma de pago → efectivo', r.status === 200 && r.movimiento?.forma_pago === 'EFECTIVO' && !r.no_va_a_caja, `${r.status} ${r.error ?? r.movimiento?.forma_pago}`);
const dia = r.movimiento?.fecha;
const efectivo1 = r.movimiento;
const p0 = await piezas(dia);

// ── 2. Tarjeta con foto: no va a la caja ───────────────────────────────────
r = await ingreso({ monto: 1, forma_pago: 'TARJETA', foto_url: FOTO, comprobante_total: 16.37, boleta: voucher });
ok('2. tarjeta con foto → anotado, no va a la caja', r.status === 200 && r.no_va_a_caja === true && r.movimiento?.erp_movimiento_id == null, `${r.status} ${r.error ?? ''}`);
ok('2. tarjeta con foto → no pide autorización', r.movimiento?.autorizacion == null, r.movimiento?.autorizacion);
const tarjeta1 = r.movimiento;
let p1 = await piezas(dia);
ok('2. el efectivo del cajón NO sube', Number(p1?.entradas) === Number(p0?.entradas), `${p0?.entradas} → ${p1?.entradas}`);
ok('2. aparece en «no están en el cajón»', Math.abs(Number(p1?.entradas_no_efectivo) - Number(p0?.entradas_no_efectivo) - 1) < 0.001, `${p0?.entradas_no_efectivo} → ${p1?.entradas_no_efectivo}`);

// ── 3. El mismo voucher se reparte, sin pasarse ────────────────────────────
r = await ingreso({ monto: 2, forma_pago: 'TARJETA', foto_url: FOTO, comprobante_total: 16.37, boleta: voucher });
ok('3. segundo ingreso sobre el mismo voucher (1+2 ≤ 16.37)', r.status === 200, `${r.status} ${r.error ?? ''}`);
const tarjeta2 = r.movimiento;
r = await ingreso({ monto: 14, forma_pago: 'TARJETA', foto_url: FOTO, comprobante_total: 16.37, boleta: voucher });
ok('3. tercero que se pasa del voucher (3+14 > 16.37) → 409', r.status === 409 && /comprobante/.test(r.error), `${r.status} ${r.error}`);
r = await ingreso({ monto: 20, forma_pago: 'TARJETA', foto_url: FOTO, comprobante_total: 16.37 });
ok('3. cobro mayor que su voucher → 400', r.status === 400, `${r.status} ${r.error}`);

// ── 4. El cuadre del voucher: los 13.37 que sobran son una venta con tarjeta
let { data: vouchers, error: errV } = await sala.rpc('caja_vouchers_del_dia', { p_branch_id: SALA, p_dia: dia });
const v = (vouchers || []).find((x) => x.voucher === voucher);
ok('4. el voucher suma sus dos ingresos ($3)', Number(v?.ingresos) === 3, errV?.message || JSON.stringify(v));
ok('4. el resto ($13.37) cuadra con la venta con tarjeta', v?.estado === 'CUADRA' && v?.venta?.correlativo === 'PRUEBA-ING-1', JSON.stringify(v?.venta ?? v?.estado));

// ── 5. Transferencia sin foto: a autorización ──────────────────────────────
r = await ingreso({ monto: 5, forma_pago: 'TRANSFERENCIA' });
ok('5. sin foto y sin decir por qué → 400', r.status === 400 && /explica/i.test(r.error), `${r.status} ${r.error}`);
r = await ingreso({ monto: 5, forma_pago: 'TRANSFERENCIA', motivo_sin_comprobante: 'el cliente no mandó la captura' });
ok('5. sin foto con motivo → anotado y PENDIENTE', r.status === 200 && r.movimiento?.autorizacion === 'PENDIENTE', `${r.status} ${r.error ?? r.movimiento?.autorizacion}`);
const transf = r.movimiento;
let sol = await solicitudDe(jefe, 'CAJA_INGRESO_AUTORIZACION', transf?.id);
ok('5. quien decide VE la solicitud', sol?.status === 'PENDING', sol ? `${sol.status} · aprobadores ${sol.metadata?.aprobadores_n}` : 'no la ve');

// ── 6. Nadie se autoriza a sí mismo; rechazar pide motivo ──────────────────
r = await sala.rpc('caja_ingreso_resolver', { p_solicitud: sol?.id, p_aprobar: true, p_nota: null });
ok('6. quien lo anotó NO lo puede autorizar', !!r.error, r.error?.message);
r = await jefe.rpc('caja_ingreso_resolver', { p_solicitud: sol?.id, p_aprobar: false, p_nota: null });
ok('6. rechazar sin motivo → error', !!r.error && /rechazarlo/i.test(r.error.message), r.error?.message);
r = await jefe.rpc('caja_ingreso_resolver', { p_solicitud: sol?.id, p_aprobar: false, p_nota: 'falta la captura del banco' });
ok('6. rechazar con motivo', !r.error, r.error?.message);
let m = await fila(transf.id);
ok('6. rechazado NO es anulado: sigue vivo y RECHAZADA', m.autorizacion === 'RECHAZADA' && !m.anulado_at, `${m.autorizacion} anulado=${m.anulado_at}`);
const { data: avisos } = await sala.from('notifications').select('title, body')
    .eq('metadata->>movimiento_portal', String(transf.id)).order('created_at', { ascending: false }).limit(1);
ok('6. a quien lo anotó le llega el aviso con el motivo', /falta la captura/.test(avisos?.[0]?.body ?? ''), avisos?.[0]?.body);

// ── 7. Reenviar con más pruebas ────────────────────────────────────────────
r = await sala.rpc('caja_ingreso_reenviar', { p_movimiento: transf.id, p_nota: '', p_foto_url: null });
ok('7. reenviar sin nada nuevo → error', !!r.error, r.error?.message);
r = await sala.rpc('caja_ingreso_reenviar', { p_movimiento: transf.id, p_nota: 'ya mandó la captura', p_foto_url: FOTO });
ok('7. reenviar con foto y nota', !r.error, r.error?.message);
m = await fila(transf.id);
ok('7. vuelve a PENDIENTE con la foto nueva', m.autorizacion === 'PENDIENTE' && m.foto_url === FOTO, `${m.autorizacion} ${m.foto_url}`);
sol = await solicitudDe(jefe, 'CAJA_INGRESO_AUTORIZACION', transf.id);
ok('7. la solicitud nueva dice que es un reenvío y por qué se rechazó', sol?.metadata?.reenvio === true && /captura del banco/.test(sol?.metadata?.rechazo_anterior ?? ''), JSON.stringify({ r: sol?.metadata?.reenvio, a: sol?.metadata?.rechazo_anterior }));
r = await jefe.rpc('caja_ingreso_resolver', { p_solicitud: sol?.id, p_aprobar: true, p_nota: null });
ok('7. autorizar', !r.error, r.error?.message);
m = await fila(transf.id);
ok('7. queda APROBADA y firmada', m.autorizacion === 'APROBADA' && !!m.autorizacion_por, `${m.autorizacion}`);
r = await jefe.rpc('caja_ingreso_resolver', { p_solicitud: sol?.id, p_aprobar: true, p_nota: null });
ok('7. autorizar dos veces → error', !!r.error, r.error?.message);

// ── 8. Anular un cobro con tarjeta ─────────────────────────────────────────
p1 = await piezas(dia);
r = await pedirCorreccion({ movimiento: tarjeta2.id, que: 'ANULAR' });
ok('8. pedir anular un cobro con tarjeta', r.status === 200 && !!r.solicitud, `${r.status} ${r.error ?? ''}`);
const solAnular = r.solicitud;
r = await aplicar(sala, solAnular);
ok('8. quien lo pidió NO lo puede aplicar', r.status === 403, `${r.status} ${r.error}`);
r = await aplicar(jefe, solAnular);
ok('8. aplicar la anulación', r.status === 200 && r.ok, `${r.status} ${r.error ?? ''}`);
m = await fila(tarjeta2.id);
ok('8. queda anulado', !!m.anulado_at, m.anulado_at);
let p2 = await piezas(dia);
ok('8. el efectivo del cajón no se movió', Number(p2.entradas) === Number(p1.entradas), `${p1.entradas} → ${p2.entradas}`);
ok('8. «no están en el cajón» bajó $2', Math.abs(Number(p1.entradas_no_efectivo) - Number(p2.entradas_no_efectivo) - 2) < 0.001, `${p1.entradas_no_efectivo} → ${p2.entradas_no_efectivo}`);
({ data: vouchers } = await sala.rpc('caja_vouchers_del_dia', { p_branch_id: SALA, p_dia: dia }));
ok('8. el voucher ahora tiene $1 y ya no cuadra con la venta de $13.37', vouchers.find((x) => x.voucher === voucher)?.estado === 'SIN_VENTA', vouchers.find((x) => x.voucher === voucher)?.estado);

// ── 9. Anular uno que esperaba autorización: se cancela la autorización ────
r = await ingreso({ monto: 4, forma_pago: 'TARJETA', motivo_sin_comprobante: 'el POS no imprimió' });
const pendiente = r.movimiento;
const solAut = (await solicitudDe(jefe, 'CAJA_INGRESO_AUTORIZACION', pendiente.id))?.id;
r = await pedirCorreccion({ movimiento: pendiente.id, que: 'ANULAR' });
r = await aplicar(jefe, r.solicitud);
ok('9. anular un ingreso pendiente de autorización', r.status === 200, `${r.status} ${r.error ?? ''}`);
m = await fila(pendiente.id);
const autCancelada = (await jefe.from('approval_requests').select('status').eq('id', solAut).single()).data;
ok('9. su autorización queda CANCELADA', autCancelada?.status === 'CANCELLED' && m.autorizacion == null, `${autCancelada?.status} · ${m.autorizacion}`);
r = await jefe.rpc('caja_ingreso_resolver', { p_solicitud: solAut, p_aprobar: true, p_nota: null });
ok('9. ya no se puede autorizar', !!r.error, r.error?.message);

// ── 10. Cambiar la forma de pago ───────────────────────────────────────────
p1 = await piezas(dia);
r = await pedirCorreccion({ movimiento: efectivo1.id, que: 'FORMA', forma_nueva: 'TARJETA' });
ok('10. efectivo → tarjeta sin foto → 400', r.status === 400 && /foto/.test(r.error), `${r.status} ${r.error}`);
r = await pedirCorreccion({ movimiento: efectivo1.id, que: 'FORMA', forma_nueva: 'EFECTIVO' });
ok('10. a la misma forma → 409', r.status === 409, `${r.status} ${r.error}`);
r = await pedirCorreccion({ movimiento: efectivo1.id, que: 'FORMA', forma_nueva: 'TARJETA', foto_url: FOTO, comprobante_total: 2 });
ok('10. pedir efectivo → tarjeta con foto', r.status === 200, `${r.status} ${r.error ?? ''}`);
r = await aplicar(jefe, r.solicitud);
ok('10. aplicar efectivo → tarjeta', r.status === 200 && r.aplicado?.forma === 'TARJETA', `${r.status} ${r.error ?? JSON.stringify(r.aplicado)}`);
m = await fila(efectivo1.id);
ok('10. queda con tarjeta, foto y fuera de la caja', m.forma_pago === 'TARJETA' && m.foto_url === FOTO && m.erp_movimiento_id == null, `${m.forma_pago} ${m.foto_url}`);
p2 = await piezas(dia);
ok('10. el efectivo del cajón bajó $2', Math.abs(Number(p1.entradas) - Number(p2.entradas) - 2) < 0.001, `${p1.entradas} → ${p2.entradas}`);

r = await pedirCorreccion({ movimiento: efectivo1.id, que: 'FORMA', forma_nueva: 'TRANSFERENCIA', foto_url: FOTO });
r = await aplicar(jefe, r.solicitud);
m = await fila(efectivo1.id);
ok('10. tarjeta → transferencia (sólo el portal)', r.status === 200 && m.forma_pago === 'TRANSFERENCIA', `${r.status} ${r.error ?? m.forma_pago}`);

r = await pedirCorreccion({ movimiento: efectivo1.id, que: 'FORMA', forma_nueva: 'EFECTIVO' });
ok('10. pedir transferencia → efectivo (no pide foto)', r.status === 200, `${r.status} ${r.error ?? ''}`);
r = await aplicar(jefe, r.solicitud);
m = await fila(efectivo1.id);
p2 = await piezas(dia);
ok('10. vuelve a efectivo y vuelve al cajón', r.status === 200 && m.forma_pago === 'EFECTIVO' && m.comprobante_total == null, `${r.status} ${r.error ?? m.forma_pago}`);
ok('10. el efectivo del cajón vuelve a subir $2', Math.abs(Number(p2.entradas) - Number(p1.entradas)) < 0.001, `${p1.entradas} → ${p2.entradas}`);

r = await pedirCorreccion({ movimiento: transf.id, que: 'FORMA', forma_nueva: 'EFECTIVO' });
const solDoble = r.solicitud;
r = await pedirCorreccion({ movimiento: transf.id, que: 'ANULAR' });
ok('10. una sola corrección viva por movimiento', r.status === 409, `${r.status} ${r.error}`);
r = await aplicar(jefe, solDoble);
m = await fila(transf.id);
ok('10. un ingreso AUTORIZADO pasado a efectivo queda sin autorización pendiente', m.forma_pago === 'EFECTIVO' && m.autorizacion !== 'PENDIENTE', `${m.forma_pago} ${m.autorizacion}`);

// ── 11. Corregir el monto de un cobro con tarjeta ──────────────────────────
r = await pedirCorreccion({ movimiento: tarjeta1.id, que: 'MONTO', monto_nuevo: 20 });
ok('11. monto nuevo mayor que el voucher → 400 al pedir', r.status === 400, `${r.status} ${r.error}`);
r = await pedirCorreccion({ movimiento: tarjeta1.id, que: 'MONTO', monto_nuevo: 0 });
ok('11. monto nuevo en cero → 400 al pedir', r.status === 400, `${r.status} ${r.error}`);
r = await pedirCorreccion({ movimiento: tarjeta1.id, que: 'MONTO', monto_nuevo: 3 });
r = await aplicar(jefe, r.solicitud);
m = await fila(tarjeta1.id);
ok('11. corregir el monto de un cobro con tarjeta (sólo el portal)', r.status === 200 && Number(m.monto) === 3, `${r.status} ${r.error ?? m.monto}`);

// ── 12. Lo que muestra el historial de correcciones ────────────────────────
const { data: corr } = await sala.rpc('get_correcciones_de_caja', { p_movimientos: [efectivo1.id] });
ok('12. el historial dice de qué forma a qué forma', (corr || []).some((c) => c.que === 'FORMA' && c.forma_antes === 'EFECTIVO' && c.forma_despues === 'TARJETA'), JSON.stringify((corr || []).map((c) => [c.que, c.forma_antes, c.forma_despues, c.estado])));

// ── 13. Una salida no cambia de forma ──────────────────────────────────────
r = await pedirCorreccion({ movimiento: tarjeta1.id, que: 'OTRA' });
ok('13. una corrección desconocida → 400', r.status === 400, `${r.status} ${r.error}`);

// ── 14. La inyección pagada con tarjeta (el ejemplo del usuario) ───────────
const { data: precios } = await sala.from('inyeccion_precios').select('origen, precio');
const P = Object.fromEntries((precios || []).map((p) => [p.origen, Number(p.precio)]));
p1 = await piezas(dia);
r = await operar(sala, { accion: 'ingreso', sala: SALA, monto: P.TRAIDA, concepto: 'Aplicacion de inyeccion', tipo: 'APLICACION',
    clave_envio: clave(), forma_pago: 'TARJETA', foto_url: FOTO, comprobante_total: P.TRAIDA, boleta: `${voucher}9`,
    aplicacion: { origen: 'TRAIDA', producto: 'Neurobion 25000', cantidad: 1, aplicar_ahora: 1 } });
ok('14. inyección traída pagada con tarjeta → cobrada, no va a la caja', r.status === 200 && r.no_va_a_caja === true
    && Number(r.movimiento?.monto) === P.TRAIDA, `${r.status} ${r.error ?? ''}`);
const { data: apl } = await sala.from('inyeccion_aplicaciones').select('confirmada, aplicada_at').eq('cobro_id', r.movimiento_del_portal);
ok('14. su aplicación queda confirmada y aplicada', (apl || []).length === 1 && apl[0].confirmada && !!apl[0].aplicada_at, JSON.stringify(apl));
p2 = await piezas(dia);
ok('14. el efectivo del cajón no sube por la inyección con tarjeta', Number(p2.entradas) === Number(p1.entradas), `${p1.entradas} → ${p2.entradas}`);
r = await operar(sala, { accion: 'ingreso', sala: SALA, monto: P.TRAIDA, concepto: 'Aplicacion de inyeccion', tipo: 'APLICACION',
    clave_envio: clave(), forma_pago: 'TRANSFERENCIA', motivo_sin_comprobante: 'el cliente transfiere en la tarde',
    aplicacion: { origen: 'TRAIDA', producto: 'Neurobion 25000', cantidad: 1, aplicar_ahora: 1 } });
ok('14. inyección por transferencia sin comprobante → cobrada y PENDIENTE', r.status === 200 && r.movimiento?.autorizacion === 'PENDIENTE', `${r.status} ${r.error ?? r.movimiento?.autorizacion}`);

console.table(res.map((x) => ({ ok: x.ok ? '✓' : '✗', prueba: x.prueba, detalle: x.ok ? '' : x.detalle })));
const fallas = res.filter((x) => !x.ok).length;
console.log(fallas ? `\n✗ ${fallas} de ${res.length} fallaron` : `\n✓ ${res.length} de ${res.length} pasaron`);
process.exit(fallas ? 1 : 0);
