/**
 * La sesión que abrió un carné en el kiosco de caja. Vive fuera de los
 * componentes a propósito: al entrar, el portal pinta «Verificando sesión» y
 * DESMONTA el kiosco. Con la marca dentro de un componente, ese desmontaje se
 * leía como «cambió de pestaña» y cerraba la sesión un segundo después de
 * abrirla (Salud 4, 2026-11-17). Por lo mismo, el último uso también vive acá:
 * la cuenta de los 2 minutos no vuelve a empezar al remontar.
 */
// `previo`: quien tenía la sesión antes de pasar este carné (no se muestra mientras abre).
export const sesionDeCaja = { abiertaPorCarne: false, ultimoUso: 0, vista: null, previo: null, irA: null };

// A dónde ir al abrir la sesión (una sugerencia del inicio: «Abrir la caja»).
// Vive aquí y no en un estado: el kiosco se desmonta mientras entra el carné.
export const guardarDestino = (ir) => { sesionDeCaja.irA = ir; };
export const tomarDestino = () => { const ir = sesionDeCaja.irA; sesionDeCaja.irA = null; return ir; };

/** Tiempo sin tocar nada antes de cerrar la sesión del carné. */
export const INACTIVO_MS = 2 * 60_000;
/** El mismo plazo con un trámite o una ventana abierta. */
export const INACTIVO_CON_VENTANA_MS = 10 * 60_000;
