// Pruebas de las reservas de oferta sin tope de unidades (2026-10-19). SÓLO
// contra el entorno de pruebas. Necesita la oferta «PRUEBA reservas sin tope» y
// la sesión de cliente sembradas por la sesión que las corre.
//   node scripts/entorno-pruebas/probar_reservas_sin_tope.mjs <oferta_id> <producto_id>
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.staging', 'utf8').split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
if (!env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL.includes('sacecdkdmsdvgqnrsett')) throw new Error('Esto no es el entorno de pruebas.');
const [ofertaId, productoId] = [process.argv[2], Number(process.argv[3])];
const TOKEN = 'prueba-token-reservas-sin-tope-2026';
const res = [];
const ok = (p, c, d = '') => res.push({ ok: c ? '✓' : '✗', prueba: p, detalle: c ? '' : String(d).slice(0, 140) });
async function pedir(accion, body = {}) {
    const r = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/app-clientes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ accion, token: TOKEN, ...body }),
    });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
const term = await pedir('reserva_terminos');
ok('los términos nuevos son la versión 2026-10-19', term.version === '2026-10-19', term.version);
ok('los términos ya no dicen «5 unidades»', !JSON.stringify(term.puntos).includes('5 unidades'), JSON.stringify(term.puntos));
const ex = await pedir('reserva_existencias', { producto_id: productoId });
ok('reserva_existencias trae la cantidad habitual', Number(ex.habitual) >= 1, JSON.stringify({ s: ex.status, h: ex.habitual, m: ex.mensaje }));
const sala = [...(ex.sucursales ?? [])].sort((a, b) => (b.alcance ?? 0) - (a.alcance ?? 0))[0]?.branch_id ?? 28;
const reservar = (cantidad) => pedir('reservar', { oferta_id: ofertaId, producto_id: productoId, branch_id: sala, cantidad, acepta_terminos: term.version });
let r = await reservar(12);
ok('reservar 12 unidades (antes el tope era 5)', r.ok === true, JSON.stringify(r));
r = await reservar(500);
ok('más de lo disponible en la sala → rechazo', r.ok === false, JSON.stringify(r));
r = await reservar(0);
ok('reservar 0 → rechazo', r.ok === false, JSON.stringify(r));
r = await reservar(2);
ok('segunda reserva sin pagar', r.ok === true, JSON.stringify(r));
r = await reservar(3);
ok('tercera reserva sin pagar', r.ok === true, JSON.stringify(r));
r = await reservar(1);
ok('cuarta sin pagar → rechazo (tope de 3 sin pagar)', r.ok === false && /sin pagar/.test(r.mensaje ?? ''), JSON.stringify(r));
console.log('MARCAR_PAGADA');
console.table(res);
process.exit(res.some((x) => x.ok === '✗') ? 1 : 0);
