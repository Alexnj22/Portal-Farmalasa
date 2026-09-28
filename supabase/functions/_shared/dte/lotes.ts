// Lote y vencimiento en cada renglón de un DTE de Distribución.
//
// «Si se vende de dos lotes se separa» (pedido del usuario, 2026-09-28): un
// renglón del pedido se vuelve UN renglón del documento por lote, y el lote y
// el vencimiento van al final de la descripción, dentro del JSON firmado — así
// los lleva el documento que recibe Hacienda, no sólo el papel. Es la forma en
// que lo hacen las droguerías que nos facturan (Nueva San Carlos: «LOTE: …
// VENCE: dd/mm/aaaa»). El PDF (src/utils/distribucionDocumento.js) separa esa
// cola en sus columnas; los dos lados se prueban juntos en dteLotes.test.js.
//
// El total no cambia al partir: la cantidad y el descuento se reparten de modo
// que sumen EXACTO lo del renglón (el último pedazo lleva el resto), y el motor
// redondea sólo las sumas. Con un centavo de diferencia, los pagos ya
// registrados dejarían de cuadrar con el documento.
import type { Renglon } from "./documentos.ts";

/** Lo que devuelve `dist_asignar_lotes`: de qué lote sale cada renglón. */
export interface Asignacion {
  item_id: number;
  lote: string;
  vence: string | null;       // YYYY-MM-DD
  cantidad: string | number;  // presentaciones que salen de este lote
}

export function colaDeLote(lote: string, vence: string | null): string {
  const v = vence ? ` VENCE: ${vence.slice(8, 10)}/${vence.slice(5, 7)}/${vence.slice(0, 4)}` : "";
  return ` LOTE: ${lote}${v}`;
}

/**
 * Parte un renglón ya armado —con el precio y el descuento como los arme quien
 * factura— en uno por lote. No sabe si el precio lleva IVA ni de qué columna
 * salió: sólo reparte cantidad y descuento y le pega la cola a la descripción.
 */
export function partirPorLote(r: Renglon, itemId: number, asignadas: Asignacion[]): Renglon[] {
  const mias = asignadas.filter((a) => a.item_id === itemId);
  if (!mias.length) return [r];
  // En diezmilésimas (cantidad) y millonésimas (descuento): enteros exactos.
  const cantTotal = Math.round(Number(r.cantidad) * 1e4);
  const descTotal = Math.round(Number(r.descuento ?? 0) * 1e6);
  let cantUsada = 0, descUsado = 0;
  return mias.map((a, k) => {
    const ultimo = k === mias.length - 1;
    const cant = ultimo ? cantTotal - cantUsada : Math.round(Number(a.cantidad) * 1e4);
    const desc = ultimo ? descTotal - descUsado : Math.round((descTotal * cant) / cantTotal);
    cantUsada += cant;
    descUsado += desc;
    return {
      ...r,
      descripcion: `${r.descripcion}${colaDeLote(a.lote, a.vence)}`,
      cantidad: (cant / 1e4).toFixed(4),
      descuento: (desc / 1e6).toFixed(6),
    };
  });
}
