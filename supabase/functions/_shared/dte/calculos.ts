// Los números de un DTE: renglones del cuerpo y totales del resumen.
//
// ── De dónde salen las reglas ──────────────────────────────────────────────
// Del Manual Funcional v2.0 (mayo 2026) y, donde el manual se contradice, de
// los DTE REALES que ya aceptó Hacienda. Se enfrentaron contra 24 Créditos
// Fiscales de droguerías proveedoras (COFARSAL, Droguería Americana, Imberton,
// Gamma…) y 4 Facturas, sellados entre julio y septiembre de 2026:
//
//   · IVA del CCF = redondear2(subTotal × 0.13)        → 24 de 24, al centavo
//   · Monto total = subTotal + IVA                     → 24 de 24
//   · Total a pagar = monto total + percepción − retención + no gravado
//   · Percepción = 1% del subTotal, sólo si llega a $100 → 9 de 9
//   · IVA de un renglón de Factura = ventaGravada ÷ 1.13 × 0.13  → 35 de 35
//   · IVA de la Factura = redondear2(suma de los IVA por renglón) → 4 de 4
//
// El manual trae un ejemplo de CCF con retención donde el «monto total» ya
// viene con la retención restada ($781.20) y otro de Nota de Crédito donde no
// ($101.70). Se sigue la forma de los documentos reales y de la Nota de
// Crédito; las pruebas de certificación en el ambiente 00 lo confirman o no.
//
// ── Precio con o sin IVA ───────────────────────────────────────────────────
// En la Factura el precio unitario LLEVA el IVA; en CCF, notas y remisión NO.
// Una línea declara cómo viene su precio y el motor lo lleva a la base que
// pide cada documento, a 8 decimales. Así el catálogo de la S.A.S. puede
// guardar un solo precio y nadie tiene que acordarse de dividir entre 1.13.

import {
  aCentavos, CERO, dec, div, esCero, mul, suma,
  type Dec,
} from "./decimal.ts";

export type TipoVenta = "gravada" | "exenta" | "nosujeta";

export interface LineaVenta {
  cantidad: number | string;
  /** Precio unitario, en la base que dice `precioIncluyeIva`. */
  precio: number | string;
  precioIncluyeIva: boolean;
  /** Descuento TOTAL del renglón (no por unidad), en la misma base que `precio`. */
  descuento?: number | string;
  tipoVenta?: TipoVenta;
}

/** Cómo espera el documento el precio unitario. */
export type BasePrecio = "con_iva" | "sin_iva";

export interface RenglonCalculado {
  cantidad: Dec;
  precioUni: Dec;
  montoDescu: Dec;
  ventaNoSuj: Dec;
  ventaExenta: Dec;
  ventaGravada: Dec;
  /** IVA contenido en el renglón (Factura) o 13% encima (notas v4). */
  iva: Dec;
}

const TRECE = dec("0.13");
const UNO_TRECE = dec("1.13");
const UNO_POR_CIENTO = dec("0.01");
const CIEN = dec(100);

/** Umbral de ley para percibir o retener el 1% (Arts. 162 y 163 CT). */
export const UMBRAL_1_POR_CIENTO = CIEN;

function aBase(v: Dec, incluyeIva: boolean, base: BasePrecio): Dec {
  if (base === "con_iva") return incluyeIva ? v : mul(v, UNO_TRECE);
  return incluyeIva ? div(v, UNO_TRECE) : v;
}

export function calcularRenglon(l: LineaVenta, base: BasePrecio): RenglonCalculado {
  const cantidad = dec(l.cantidad);
  if (cantidad <= 0n) throw new Error("la cantidad de un renglón tiene que ser mayor que cero");
  const precioUni = aBase(dec(l.precio), l.precioIncluyeIva, base);
  if (precioUni < 0n) throw new Error("un precio no puede ser negativo");
  const montoDescu = aBase(dec(l.descuento ?? 0), l.precioIncluyeIva, base);
  const bruto = mul(cantidad, precioUni);
  if (montoDescu < 0n || montoDescu > bruto) {
    throw new Error("el descuento de un renglón no puede ser negativo ni mayor que su importe");
  }
  const venta = bruto - montoDescu;
  const tipo = l.tipoVenta ?? "gravada";
  const r: RenglonCalculado = {
    cantidad, precioUni, montoDescu,
    ventaNoSuj: tipo === "nosujeta" ? venta : CERO,
    ventaExenta: tipo === "exenta" ? venta : CERO,
    ventaGravada: tipo === "gravada" ? venta : CERO,
    iva: CERO,
  };
  // Factura: el IVA va ADENTRO del precio → ventaGravada × 13 / 113.
  // Notas v4: el IVA va ENCIMA → ventaGravada × 0.13.
  r.iva = base === "con_iva"
    ? div(mul(r.ventaGravada, TRECE), UNO_TRECE)
    : mul(r.ventaGravada, TRECE);
  return r;
}

export interface OpcionesResumen {
  /** Descuentos globales por tipo de venta (resumen), ya en la base del documento. */
  descuNoSuj?: number | string;
  descuExenta?: number | string;
  descuGravada?: number | string;
  /** El receptor es gran contribuyente y nos RETIENE el 1% (Art. 162). */
  retiene1?: boolean;
  /** Somos gran contribuyente y le PERCIBIMOS el 1% al receptor (Art. 163). */
  percibe1?: boolean;
  /** Cargos/abonos que no afectan la base imponible (puede ser negativo). */
  noGravado?: number | string;
  /**
   * Aplicar el 1% aunque la base no llegue a $100. Es el caso de una nota:
   * corrige un documento que YA lo aplicó, y una devolución de $40 sobre un
   * CCF de $500 con percepción tiene que devolver también su 1%.
   */
  sinUmbral?: boolean;
}

export interface ResumenCalculado {
  totalNoSuj: Dec;
  totalExenta: Dec;
  totalGravada: Dec;
  subTotalVentas: Dec;
  descuNoSuj: Dec;
  descuExenta: Dec;
  descuGravada: Dec;
  totalDescu: Dec;
  subTotal: Dec;
  /** IVA del documento, a centavos. */
  iva: Dec;
  ivaPerci: Dec;
  ivaRete: Dec;
  montoTotalOperacion: Dec;
  totalNoGravado: Dec;
  totalPagar: Dec;
}

export function calcularResumen(
  renglones: RenglonCalculado[],
  base: BasePrecio,
  o: OpcionesResumen = {},
): ResumenCalculado {
  if (renglones.length === 0) throw new Error("un documento sin renglones no se puede emitir");
  const totalNoSuj = aCentavos(suma(...renglones.map((r) => r.ventaNoSuj)));
  const totalExenta = aCentavos(suma(...renglones.map((r) => r.ventaExenta)));
  const totalGravada = aCentavos(suma(...renglones.map((r) => r.ventaGravada)));
  const subTotalVentas = totalNoSuj + totalExenta + totalGravada;

  const descuNoSuj = aCentavos(dec(o.descuNoSuj ?? 0));
  const descuExenta = aCentavos(dec(o.descuExenta ?? 0));
  const descuGravada = aCentavos(dec(o.descuGravada ?? 0));
  if (descuNoSuj > totalNoSuj || descuExenta > totalExenta || descuGravada > totalGravada) {
    throw new Error("un descuento global no puede ser mayor que las ventas a las que se aplica");
  }
  const totalDescu = aCentavos(suma(...renglones.map((r) => r.montoDescu))) +
    descuNoSuj + descuExenta + descuGravada;
  const subTotal = subTotalVentas - descuNoSuj - descuExenta - descuGravada;
  const baseGravada = totalGravada - descuGravada;

  let iva: Dec;
  if (base === "sin_iva") {
    iva = aCentavos(mul(baseGravada, TRECE));
  } else if (esCero(descuGravada)) {
    iva = aCentavos(suma(...renglones.map((r) => r.iva)));
  } else {
    // Con descuento global, la suma por renglón ya no describe la base: se
    // saca el IVA contenido del total gravado neto.
    iva = aCentavos(div(mul(baseGravada, TRECE), UNO_TRECE));
  }

  const llega = o.sinUmbral || baseGravada >= UMBRAL_1_POR_CIENTO;
  const ivaPerci = o.percibe1 && llega && base === "sin_iva"
    ? aCentavos(mul(baseGravada, UNO_POR_CIENTO)) : CERO;
  // En la Factura la base de la retención es el valor SIN IVA.
  const baseRetencion = base === "sin_iva" ? baseGravada : div(baseGravada, UNO_TRECE);
  const ivaRete = o.retiene1 && (o.sinUmbral || baseRetencion >= UMBRAL_1_POR_CIENTO)
    ? aCentavos(mul(baseRetencion, UNO_POR_CIENTO)) : CERO;

  const totalNoGravado = aCentavos(dec(o.noGravado ?? 0));
  const montoTotalOperacion = base === "sin_iva" ? subTotal + iva : subTotal;
  const totalPagar = montoTotalOperacion + ivaPerci - ivaRete + totalNoGravado;
  if (totalPagar < 0n) throw new Error("el total a pagar quedó negativo");

  return {
    totalNoSuj, totalExenta, totalGravada, subTotalVentas,
    descuNoSuj, descuExenta, descuGravada, totalDescu, subTotal,
    iva, ivaPerci, ivaRete, montoTotalOperacion, totalNoGravado, totalPagar,
  };
}
