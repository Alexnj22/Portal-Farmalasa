/**
 * ¿La sesión de ahora la abrió un carné en la pestaña Caja? Vive fuera del
 * componente a propósito: al entrar, el portal pinta «Verificando sesión» y
 * DESMONTA el kiosco. Con la marca dentro del componente, ese desmontaje se
 * leía como «cambió de pestaña» y cerraba la sesión un segundo después de
 * abrirla (Salud 4, 2026-11-17). El cambio de pestaña lo mira `TimeClockView`.
 */
export const sesionDeCaja = { abiertaPorCarne: false };
