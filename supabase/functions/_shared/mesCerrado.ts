// ¿Esta venta es de un mes que ya se cerró? (2026-11-25)
//
// Un consumidor final de la noche no se envía al MH (`cof_no_se_envia_mh`),
// pero si el cliente pide su documento, `dte-para-cliente` lo manda en ese
// momento. Si la venta es de un mes anterior, ese mes ya se declaró SIN ella:
// mandarla ahora la deja ante el MH con una fecha de emisión de un periodo que
// ya no la incluye.
//
// Pasó con 0000091241_COF de Salud 1: venta del 24-oct, enviada el 24-nov con
// octubre ya declarado. El MH la recibió («fecEmi difiere de la fecha de
// envío») y hubo que invalidarla. Regla del usuario: una venta de un mes
// anterior sin sello no se manda; se solventa con una venta nueva de hoy.
//
// El mes se mide en hora de El Salvador: a las 7 p. m. del último día, la hora
// UTC ya es del mes siguiente.

const mesSV = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/El_Salvador", year: "numeric", month: "2-digit" })
    .format(d).slice(0, 7);

/** `fecha` es la de la venta (`YYYY-MM-DD`). Sin fecha legible contesta «sí»: ante la duda, no se manda. */
export function esDeMesCerrado(fecha: unknown, ahora: Date = new Date()): boolean {
  const mes = String(fecha ?? "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) return true;
  return mes < mesSV(ahora);
}

export const MENSAJE_MES_CERRADO =
  "Esta venta es de un mes que ya se declaró y no tiene sello del MH. No se puede enviar ahora. " +
  "Hay que solventarla con una venta nueva de hoy. Avisa a un supervisor o administrador.";
