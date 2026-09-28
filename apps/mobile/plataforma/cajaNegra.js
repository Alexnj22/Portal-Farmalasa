// La caja negra — la versión del TELÉFONO: un anillo en memoria de los últimos
// sucesos, con los mismos nombres que la web. Sin sonda de rotación ni pulso.
const ANILLO = 200;
const sucesos = [];

export function anotar(tipo, datos = {}) {
  sucesos.push({ t: new Date().toISOString(), tipo, ...datos });
  if (sucesos.length > ANILLO) sucesos.splice(0, sucesos.length - ANILLO);
}
export function leerCajaNegra() { return [...sucesos]; }
export function limpiarCajaNegra() { sucesos.length = 0; }
export function iniciarPulso() {}
export function recogerPulso() { return null; }
export function contarRenderShell() {}
export function iniciarSondaRotacion() {}
export function leerRotaciones() { return []; }
export function limpiarRotaciones() {}
export function remontarAlGirar() { return false; }
export function fijarRemontarAlGirar() {}
export function entorno() { return { app: true }; }
