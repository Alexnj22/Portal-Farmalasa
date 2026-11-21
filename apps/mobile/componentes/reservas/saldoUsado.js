// El saldo a favor que se acaba de apartar desde Preventa (2026-11-21): la
// pantalla del saldo lo deja aquí y Preventa lo recoge al volver para pagar
// con él parte de la venta (en el portal es un diálogo y lo recibe directo).
// `{ uso_id, reserva_id, monto, codigo, efectivo }`.
let pendiente = null;
export const dejarSaldoUsado = (saldo) => { pendiente = saldo ?? null; };
export const tomarSaldoUsado = () => { const m = pendiente; pendiente = null; return m; };
