// Las piezas de `identificacion` que no son datos de la venta: número de
// control, código de generación, fecha y hora.

import type { TipoDte } from "./catalogos.ts";

const RE_ESTABLECIMIENTO = /^[MBSP]\d{3}$/;
const RE_PUNTO_VENTA = /^P\d{3}$/;

/**
 * `DTE-03-M001P001-000000000000042` — 31 caracteres (Manual Funcional §XI).
 *
 * El correlativo NO puede repetirse en el año calendario para ese tipo,
 * establecimiento y punto de venta: lo asigna la base con una secuencia, nunca
 * el navegador. Aquí sólo se le da forma.
 */
export function numeroControl(
  tipo: TipoDte,
  establecimiento: string,
  puntoVenta: string,
  correlativo: number | bigint,
): string {
  if (!RE_ESTABLECIMIENTO.test(establecimiento)) {
    throw new Error(`establecimiento inválido «${establecimiento}»: M/B/S/P + 3 dígitos`);
  }
  if (!RE_PUNTO_VENTA.test(puntoVenta)) {
    throw new Error(`punto de venta inválido «${puntoVenta}»: P + 3 dígitos`);
  }
  const n = BigInt(correlativo);
  if (n < 1n || n > 999_999_999_999_999n) {
    throw new Error(`correlativo fuera de rango: ${correlativo}`);
  }
  return `DTE-${tipo}-${establecimiento}${puntoVenta}-${n.toString().padStart(15, "0")}`;
}

/** UUID v4 en MAYÚSCULAS — el esquema rechaza minúsculas (`^[A-F0-9]…`). */
export const codigoGeneracion = (): string => crypto.randomUUID().toUpperCase();

/**
 * Fecha y hora de emisión en El Salvador (UTC−6, sin horario de verano).
 *
 * Se calcula con un desfase fijo y no con `toLocaleString`: el runtime de las
 * Edge Functions no garantiza los datos de zonas horarias, y El Salvador no
 * cambia de hora desde 1987. Una fecha en UTC a las 7 p. m. SV ya es «mañana»:
 * ése es el defecto que esta función existe para no tener.
 */
export function fechaHoraSV(ahora: Date = new Date()): { fecEmi: string; horEmi: string } {
  const sv = new Date(ahora.getTime() - 6 * 3600_000);
  const iso = sv.toISOString(); // AAAA-MM-DDTHH:MM:SS.mmmZ, leído como hora SV
  return { fecEmi: iso.slice(0, 10), horEmi: iso.slice(11, 19) };
}
