// El saldo a favor que se acaba de usar desde Preventa (2026-11-21): la
// pantalla del saldo lo deja aquí y Preventa lo recoge al volver para sumarlo
// a los puntos de la venta (en el portal es un diálogo y lo recibe directo).
let pendiente = null;
export const dejarSaldoUsado = (monto) => { pendiente = Number(monto) || 0; };
export const tomarSaldoUsado = () => { const m = pendiente; pendiente = null; return m; };
