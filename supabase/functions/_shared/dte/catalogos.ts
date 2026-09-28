// Los catálogos de Hacienda que usa la venta en ruta — copiados del «Catálogo
// actualizado del Sistema de Facturación v1.2» (factura.gob.sv, descargado el
// 2026-09-26). Sólo los que el motor necesita decidir: los de ubicación viven
// en la base (`distrito.ts` y las fichas de clientes) y la actividad económica
// sale de la ficha de cada contribuyente.
//
// Van como constantes con nombre y no como números sueltos porque un código
// equivocado NO falla en el esquema — el esquema sólo pide «integer» o «string
// de 2» — sino en Hacienda, con un rechazo, o peor, pasa y dice otra cosa.

/** CAT-002 — tipos de documento que emite la S.A.S. */
export const TIPO_DTE = {
  FACTURA: "01",
  CCF: "03",
  NOTA_REMISION: "04",
  NOTA_CREDITO: "05",
  NOTA_DEBITO: "06",
} as const;
export type TipoDte = typeof TIPO_DTE[keyof typeof TIPO_DTE];

/** Versión del esquema DTE 2.0 vigente para cada tipo (ZIP de julio 2026). */
export const VERSION: Record<TipoDte, number> = {
  "01": 2,
  "03": 4,
  "04": 4,
  "05": 4,
  "06": 4,
};

/** CAT-001 */
export const AMBIENTE = { PRUEBAS: "00", PRODUCCION: "01" } as const;
export type Ambiente = typeof AMBIENTE[keyof typeof AMBIENTE];

/** CAT-003 — 1 previo (se transmite antes de entregar), 2 diferido. */
export const MODELO = { PREVIO: 1, DIFERIDO: 2 } as const;
/** CAT-004 */
export const OPERACION = { NORMAL: 1, CONTINGENCIA: 2 } as const;

/** CAT-005 — el 3 es el de la ruta sin señal. */
export const CONTINGENCIA = {
  MH_NO_DISPONIBLE: 1,
  EMISOR_NO_DISPONIBLE: 2,
  SIN_INTERNET: 3,
  SIN_ENERGIA: 4,
  OTRO: 5,
} as const;

/** CAT-007 */
export const GENERACION = { FISICO: 1, ELECTRONICO: 2 } as const;

/** CAT-011 */
export const TIPO_ITEM = { BIEN: 1, SERVICIO: 2, AMBOS: 3, OTRO_TRIBUTO: 4 } as const;

/** CAT-014 — sólo las que usa una droguería; el resto, por número. */
export const UNIDAD = { UNIDAD: 59, OTRA: 99 } as const;

/** CAT-015 */
export const TRIBUTO_IVA = { codigo: "20", descripcion: "Impuesto al Valor Agregado 13%" } as const;

/** CAT-016 */
export const CONDICION = { CONTADO: 1, CREDITO: 2, OTRO: 3 } as const;

/** CAT-017 */
export const FORMA_PAGO = {
  EFECTIVO: "01",
  TARJETA_DEBITO: "02",
  TARJETA_CREDITO: "03",
  CHEQUE: "04",
  TRANSFERENCIA: "05",
  DINERO_ELECTRONICO: "08",
  CUENTAS_POR_PAGAR: "13",
  OTROS: "99",
} as const;

/** CAT-018 */
export const PLAZO = { DIAS: "01", MESES: "02", ANIOS: "03" } as const;

/** CAT-022 */
export const DOC_IDENTIFICACION = {
  NIT: "36",
  DUI: "13",
  OTRO: "37",
  PASAPORTE: "03",
  CARNET_RESIDENTE: "02",
} as const;

/** CAT-024 — motivo de una invalidación. */
export const MOTIVO_INVALIDACION = { ERROR: 1, RESCINDIR: 2, OTRO: 3 } as const;

/** CAT-025 — a qué título viaja la mercadería en una Nota de Remisión. */
export const TITULO_BIENES = {
  DEPOSITO: "01",
  PROPIEDAD: "02",
  CONSIGNACION: "03",
  TRASLADO: "04",
  OTROS: "05",
} as const;

/**
 * La letra del establecimiento en el número de control (Manual Funcional §XI).
 * No confundir con CAT-009, que codifica lo mismo con números (01/02/04/07).
 */
export const LETRA_ESTABLECIMIENTO = {
  CASA_MATRIZ: "M",
  BODEGA: "B",
  SUCURSAL: "S",
  PREDIO: "P",
} as const;
