/**
 * La sesión que abrió un carné en el kiosco de caja. Vive fuera de los
 * componentes a propósito: al entrar, el portal pinta «Verificando sesión» y
 * DESMONTA el kiosco. Con la marca dentro de un componente, ese desmontaje se
 * leía como «cambió de pestaña» y cerraba la sesión un segundo después de
 * abrirla (Salud 4, 2026-11-17). Por lo mismo, el último uso también vive acá:
 * la cuenta de los 2 minutos no vuelve a empezar al remontar.
 */
export const sesionDeCaja = { abiertaPorCarne: false, ultimoUso: 0 };

/** Tiempo sin tocar nada antes de cerrar la sesión del carné. */
export const INACTIVO_MS = 2 * 60_000;
