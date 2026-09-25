// ─────────────────────────────────────────────────────────────────────────────
// Las teclas de toda la pantalla — la versión del NAVEGADOR.
// ─────────────────────────────────────────────────────────────────────────────
//
// El lector de carné es un teclado: en la pantalla de espera del kiosco no hay
// un campo con foco, así que sus teclas se escuchan en `window`. En la app
// nativa un lector por Bluetooth o USB llega por otro camino, con esta misma
// interfaz en `teclado.native.js`. Ver `almacen.js`.

export const escucharTeclas = (fn, captura = false) => window.addEventListener('keydown', fn, captura);
export const soltarTeclas   = (fn, captura = false) => window.removeEventListener('keydown', fn, captura);
