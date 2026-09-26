// Arma el JSON de cada DTE que emite la venta en ruta, en DTE 2.0:
// Factura v2 (01), Crédito Fiscal v4 (03), Nota de Remisión v4 (04), Nota de
// Crédito v4 (05) y Nota de Débito v4 (06).
//
// ── Una sola regla de forma: TODAS las claves, siempre ─────────────────────
// Los esquemas oficiales tienen `additionalProperties: false` y declaran
// OBLIGATORIAS incluso las claves que pueden ir en `null`. Una clave de más o
// de menos es un rechazo, así que cada armador escribe el objeto completo, en
// el orden del esquema, y lo que no aplica va explícitamente en `null`.
// `tests/unit/dteDocumentos.test.js` valida cada salida contra el esquema
// oficial descargado de factura.gob.sv — el esquema es el juez, no este
// comentario.
//
// ── Lo que este archivo NO hace ────────────────────────────────────────────
// No asigna el correlativo (eso es de la base, con una secuencia: no puede
// repetirse en el año), no firma y no transmite. Recibe todo resuelto y
// devuelve un objeto puro, para poder probarlo sin red ni base.

import {
  AMBIENTE, CONDICION, DOC_IDENTIFICACION, GENERACION, MODELO, OPERACION,
  TIPO_DTE, TIPO_ITEM, TRIBUTO_IVA, UNIDAD, VERSION,
  type Ambiente, type TipoDte,
} from "./catalogos.ts";
import {
  calcularRenglon, calcularResumen,
  type BasePrecio, type LineaVenta, type OpcionesResumen, type RenglonCalculado, type ResumenCalculado,
} from "./calculos.ts";
import { aCentavos, CERO, dec, mul, num, suma, type Dec } from "./decimal.ts";
import { codigoGeneracion as nuevoCodigo, fechaHoraSV, numeroControl } from "./identificacion.ts";
import { totalEnLetras } from "./letras.ts";

// ── Tipos de entrada ────────────────────────────────────────────────────────

export interface Direccion {
  departamento: string; // CAT-012
  municipio: string;    // CAT-013
  distrito: string;     // CAT-008
  complemento: string;
}

export interface Emisor {
  nit: string;
  nrc: string;
  nombre: string;
  codActividad: string;
  descActividad: string;
  nombreComercial: string | null;
  direccion: Direccion;
  telefono: string;
  correo: string;
  /** Letra + 3 dígitos del número de control: `M001`, `B001`… */
  establecimiento: string;
  /** `P001`… */
  puntoVenta: string;
  /** Códigos que asigna Hacienda al establecimiento, si los hay. */
  codEstable?: string | null;
  codPuntoVenta?: string | null;
}

/** Un cliente, con lo que haga falta según el documento. */
export interface Receptor {
  /** NIT sin guiones (14 dígitos) o DUI con guion, según `tipoDocumento`. */
  numDocumento: string | null;
  tipoDocumento: string | null; // CAT-022
  nrc: string | null;
  nombre: string | null;
  codActividad: string | null;
  descActividad: string | null;
  nombreComercial?: string | null;
  direccion: Direccion | null;
  telefono: string | null;
  correo: string | null;
}

export interface Renglon extends LineaVenta {
  codigo: string | null;
  descripcion: string;
  uniMedida?: number;
  tipoItem?: number;
  /** Nota de crédito/débito: código de generación del documento que corrige. */
  numeroDocumento?: string | null;
}

export interface Pago {
  codigo: string;            // CAT-017
  monto: number | string;
  referencia?: string | null;
  plazo?: string | null;     // CAT-018
  periodo?: number | null;
}

export interface DocumentoRelacionado {
  tipoDocumento: TipoDte;
  /** Código de generación (electrónico) o número del papel (físico). */
  numeroDocumento: string;
  fechaEmision: string;      // AAAA-MM-DD
  tipoGeneracion?: number;   // CAT-007, default electrónico
}

export interface Contingencia {
  tipo: number;              // CAT-005
  motivo?: string | null;    // obligatorio sólo con tipo 5
}

interface Comunes {
  ambiente: Ambiente;
  emisor: Emisor;
  correlativo: number | bigint;
  renglones: Renglon[];
  opciones?: OpcionesResumen;
  observaciones?: string | null;
  /** Si se omiten, se generan (y la hora es la de ahora en El Salvador). */
  codigoGeneracion?: string;
  ahora?: Date;
  /** Con contingencia el documento sale en modelo DIFERIDO (CAT-003 = 2). */
  contingencia?: Contingencia | null;
}

export interface DatosVenta extends Comunes {
  receptor: Receptor | null;
  condicion: number;         // CAT-016
  pagos: Pago[];
}

export interface DteArmado {
  tipo: TipoDte;
  codigoGeneracion: string;
  numeroControl: string;
  fecEmi: string;
  horEmi: string;
  totalPagar: number;
  json: Record<string, unknown>;
}

// ── Piezas comunes ──────────────────────────────────────────────────────────

const soloDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

function identificacion(tipo: TipoDte, d: Comunes, extra: Record<string, unknown> = {}) {
  const codigo = d.codigoGeneracion ?? nuevoCodigo();
  const { fecEmi, horEmi } = fechaHoraSV(d.ahora);
  const cont = d.contingencia ?? null;
  if (cont && cont.tipo === 5 && !cont.motivo?.trim()) {
    throw new Error("una contingencia de tipo «otro» exige escribir el motivo");
  }
  return {
    version: VERSION[tipo],
    ambiente: d.ambiente,
    tipoDte: tipo,
    numeroControl: numeroControl(tipo, d.emisor.establecimiento, d.emisor.puntoVenta, d.correlativo),
    codigoGeneracion: codigo,
    tipoModelo: cont ? MODELO.DIFERIDO : MODELO.PREVIO,
    tipoOperacion: cont ? OPERACION.CONTINGENCIA : OPERACION.NORMAL,
    tipoContingencia: cont ? cont.tipo : null,
    motivoContin: cont ? (cont.motivo?.trim() || null) : null,
    fecEmi,
    horEmi,
    tipoMoneda: "USD",
    ...extra,
  };
}

function emisorCompleto(e: Emisor) {
  return {
    nit: soloDigitos(e.nit),
    nrc: soloDigitos(e.nrc),
    nombre: e.nombre,
    codActividad: e.codActividad,
    descActividad: e.descActividad,
    nombreComercial: e.nombreComercial ?? null,
    direccion: { ...e.direccion },
    telefono: e.telefono,
    correo: e.correo,
    codEstable: e.codEstable ?? null,
    codPuntoVenta: e.codPuntoVenta ?? null,
  };
}

/** Las notas v4 no llevan establecimiento ni punto de venta en el emisor. */
function emisorNota(e: Emisor) {
  const { codEstable: _a, codPuntoVenta: _b, ...resto } = emisorCompleto(e);
  return resto;
}

function pagosDe(pagos: Pago[], condicion: number, totalPagar: Dec) {
  if (!Object.values(CONDICION).includes(condicion as 1 | 2 | 3)) {
    throw new Error(`condición de la operación inválida: ${condicion}`);
  }
  if (pagos.length === 0) throw new Error("una venta tiene que decir cómo se paga");
  const filas = pagos.map((p) => ({
    codigo: p.codigo,
    montoPago: aCentavos(dec(p.monto)),
    referencia: p.referencia ?? null,
    plazo: p.plazo ?? null,
    periodo: p.periodo ?? null,
  }));
  const sumaPagos = suma(...filas.map((f) => f.montoPago));
  if (sumaPagos !== totalPagar) {
    throw new Error(`los pagos suman ${num(sumaPagos)} y el total a pagar es ${num(totalPagar)}`);
  }
  if (condicion === CONDICION.CREDITO && filas.some((f) => !f.plazo || !f.periodo)) {
    throw new Error("una venta a crédito tiene que decir el plazo y el período");
  }
  return filas.map((f) => ({ ...f, montoPago: num(f.montoPago) }));
}

function calcular(renglones: Renglon[], base: BasePrecio, o?: OpcionesResumen) {
  if (renglones.length > 2000) throw new Error("un DTE admite como mucho 2000 renglones");
  const calc = renglones.map((r) => calcularRenglon(r, base));
  return { calc, res: calcularResumen(calc, base, o) };
}

function cuerpoBase(r: Renglon, c: RenglonCalculado, i: number) {
  return {
    numItem: i + 1,
    tipoItem: r.tipoItem ?? TIPO_ITEM.BIEN,
    numeroDocumento: r.numeroDocumento ?? null,
    codigo: r.codigo ?? null,
    codTributo: null,
    descripcion: r.descripcion,
    cantidad: num(c.cantidad),
    uniMedida: r.uniMedida ?? UNIDAD.UNIDAD,
    precioUni: num(c.precioUni),
    montoDescu: num(c.montoDescu),
    ventaNoSuj: num(c.ventaNoSuj),
    ventaExenta: num(c.ventaExenta),
    ventaGravada: num(c.ventaGravada),
  };
}

function porcentajeDescuento(res: ResumenCalculado): number {
  const globales = res.descuNoSuj + res.descuExenta + res.descuGravada;
  if (globales === 0n || res.subTotalVentas === 0n) return 0;
  return num(aCentavos((globales * 100n * 100_000_000n) / res.subTotalVentas));
}

function tributosIva(res: ResumenCalculado) {
  return res.totalGravada > 0n
    ? [{ codigo: TRIBUTO_IVA.codigo, descripcion: TRIBUTO_IVA.descripcion, valor: num(res.iva) }]
    : null;
}

function armado(tipo: TipoDte, json: Record<string, unknown>, totalPagar: Dec): DteArmado {
  const id = json.identificacion as Record<string, string>;
  return {
    tipo,
    codigoGeneracion: id.codigoGeneracion,
    numeroControl: id.numeroControl,
    fecEmi: id.fecEmi,
    horEmi: id.horEmi,
    totalPagar: num(totalPagar),
    json,
  };
}

// ── 01 · Factura (consumidor final, tienda no inscrita en IVA) ─────────────

export function armarFactura(d: DatosVenta): DteArmado {
  const { calc, res } = calcular(d.renglones, "con_iva", d.opciones);
  const r = d.receptor;
  const json = {
    identificacion: identificacion(TIPO_DTE.FACTURA, d),
    documentoRelacionado: null,
    emisor: emisorCompleto(d.emisor),
    receptor: r
      ? {
        tipoDocumento: r.tipoDocumento ?? null,
        numDocumento: r.numDocumento ?? null,
        nrc: r.nrc ? soloDigitos(r.nrc) : null,
        nombre: r.nombre ?? null,
        codActividad: r.codActividad ?? null,
        descActividad: r.descActividad ?? null,
        direccion: r.direccion ? { ...r.direccion } : null,
        telefono: r.telefono ?? null,
        correo: r.correo ?? null,
      }
      : null,
    otrosDocumentos: null,
    ventaTercero: null,
    cuerpoDocumento: d.renglones.map((ren, i) => ({
      ...cuerpoBase(ren, calc[i], i),
      tributos: null, // el IVA de la Factura NO se lista: va dentro del precio
      psv: 0,
      noGravado: 0,
      ivaItem: num(calc[i].iva),
    })),
    resumen: {
      totalNoSuj: num(res.totalNoSuj),
      totalExenta: num(res.totalExenta),
      totalGravada: num(res.totalGravada),
      subTotalVentas: num(res.subTotalVentas),
      descuNoSuj: num(res.descuNoSuj),
      descuExenta: num(res.descuExenta),
      descuGravada: num(res.descuGravada),
      porcentajeDescuento: porcentajeDescuento(res),
      totalDescu: num(res.totalDescu),
      tributos: null,
      subTotal: num(res.subTotal),
      ivaRete: num(res.ivaRete),
      montoTotalOperacion: num(res.montoTotalOperacion),
      totalNoGravado: num(res.totalNoGravado),
      totalPagar: num(res.totalPagar),
      totalLetras: totalEnLetras(res.totalPagar / 1_000_000n),
      totalIva: num(res.iva),
      saldoFavor: 0,
      condicionOperacion: d.condicion,
      pagos: pagosDe(d.pagos, d.condicion, res.totalPagar),
      numPagoElectronico: null,
      observaciones: d.observaciones ?? null,
    },
    apendice: null,
  };
  return armado(TIPO_DTE.FACTURA, json, res.totalPagar);
}

// ── 03 · Comprobante de Crédito Fiscal (contribuyente de IVA) ──────────────

export function armarCreditoFiscal(d: DatosVenta): DteArmado {
  const r = d.receptor;
  if (!r || !r.numDocumento || !r.nrc || !r.nombre || !r.codActividad || !r.descActividad || !r.direccion) {
    throw new Error("un Crédito Fiscal exige NIT, NRC, nombre, actividad y dirección del cliente");
  }
  const { calc, res } = calcular(d.renglones, "sin_iva", d.opciones);
  const json = {
    identificacion: identificacion(TIPO_DTE.CCF, d),
    documentoRelacionado: null,
    emisor: emisorCompleto(d.emisor),
    receptor: {
      nit: soloDigitos(r.numDocumento),
      nrc: soloDigitos(r.nrc),
      nombre: r.nombre,
      codActividad: r.codActividad,
      descActividad: r.descActividad,
      nombreComercial: r.nombreComercial ?? null,
      direccion: { ...r.direccion },
      telefono: r.telefono ?? null,
      correo: r.correo ?? null,
    },
    otrosDocumentos: null,
    ventaTercero: null,
    cuerpoDocumento: d.renglones.map((ren, i) => ({
      ...cuerpoBase(ren, calc[i], i),
      tributos: calc[i].ventaGravada > 0n ? [TRIBUTO_IVA.codigo] : null,
      psv: 0,
      noGravado: 0,
    })),
    resumen: {
      totalNoSuj: num(res.totalNoSuj),
      totalExenta: num(res.totalExenta),
      totalGravada: num(res.totalGravada),
      subTotalVentas: num(res.subTotalVentas),
      descuNoSuj: num(res.descuNoSuj),
      descuExenta: num(res.descuExenta),
      descuGravada: num(res.descuGravada),
      porcentajeDescuento: porcentajeDescuento(res),
      totalDescu: num(res.totalDescu),
      tributos: tributosIva(res),
      subTotal: num(res.subTotal),
      ivaPerci: num(res.ivaPerci),
      ivaRete: num(res.ivaRete),
      montoTotalOperacion: num(res.montoTotalOperacion),
      totalNoGravado: num(res.totalNoGravado),
      totalPagar: num(res.totalPagar),
      totalLetras: totalEnLetras(res.totalPagar / 1_000_000n),
      saldoFavor: 0,
      condicionOperacion: d.condicion,
      pagos: pagosDe(d.pagos, d.condicion, res.totalPagar),
      numPagoElectronico: null,
      observaciones: d.observaciones ?? null,
    },
    apendice: null,
  };
  return armado(TIPO_DTE.CCF, json, res.totalPagar);
}

// ── 04 · Nota de Remisión (la mercadería viaja sin venderse todavía) ───────

export interface DatosRemision extends Comunes {
  /** A quién se remite. Para la carga del camión propio, la misma S.A.S. */
  receptor: Receptor;
  bienTitulo: string; // CAT-025
  documentoRelacionado?: DocumentoRelacionado[] | null;
}

export function armarNotaRemision(d: DatosRemision): DteArmado {
  const r = d.receptor;
  if (!r.numDocumento || !r.tipoDocumento || !r.nombre) {
    throw new Error("una Nota de Remisión exige documento y nombre de quien recibe");
  }
  const { calc, res } = calcular(d.renglones, "sin_iva", d.opciones);
  const json = {
    identificacion: identificacion(TIPO_DTE.NOTA_REMISION, d),
    documentoRelacionado: relacionados(d.documentoRelacionado ?? null),
    emisor: emisorCompleto(d.emisor),
    receptor: {
      tipoDocumento: r.tipoDocumento,
      numDocumento: r.tipoDocumento === DOC_IDENTIFICACION.NIT ? soloDigitos(r.numDocumento) : r.numDocumento,
      nrc: r.nrc ? soloDigitos(r.nrc) : null,
      nombre: r.nombre,
      codActividad: r.codActividad ?? null,
      descActividad: r.descActividad ?? null,
      nombreComercial: r.nombreComercial ?? null,
      direccion: r.direccion ? { ...r.direccion } : null,
      telefono: r.telefono ?? null,
      correo: r.correo ?? null,
      bienTitulo: d.bienTitulo,
    },
    ventaTercero: null,
    cuerpoDocumento: d.renglones.map((ren, i) => ({
      ...cuerpoBase(ren, calc[i], i),
      tributos: calc[i].ventaGravada > 0n ? [TRIBUTO_IVA.codigo] : null,
    })),
    resumen: {
      totalNoSuj: num(res.totalNoSuj),
      totalExenta: num(res.totalExenta),
      totalGravada: num(res.totalGravada),
      subTotalVentas: num(res.subTotalVentas),
      descuNoSuj: num(res.descuNoSuj),
      descuExenta: num(res.descuExenta),
      descuGravada: num(res.descuGravada),
      porcentajeDescuento: porcentajeDescuento(res),
      totalDescu: num(res.totalDescu),
      tributos: tributosIva(res),
      subTotal: num(res.subTotal),
      montoTotalOperacion: num(res.montoTotalOperacion),
      totalLetras: totalEnLetras(res.montoTotalOperacion / 1_000_000n),
      observaciones: d.observaciones ?? null,
    },
    apendice: null,
  };
  return armado(TIPO_DTE.NOTA_REMISION, json, res.montoTotalOperacion);
}

// ── 05 / 06 · Nota de Crédito y Nota de Débito (corrigen un CCF) ───────────

export interface DatosNota extends Comunes {
  receptor: Receptor;
  condicion: number;
  /** El/los CCF que se corrigen. Cada renglón dice a cuál por `numeroDocumento`. */
  documentoRelacionado: DocumentoRelacionado[];
}

function relacionados(docs: DocumentoRelacionado[] | null) {
  if (!docs) return null;
  if (docs.length > 50) throw new Error("un DTE relaciona como mucho 50 documentos");
  return docs.map((x) => ({
    tipoDocumento: x.tipoDocumento,
    tipoGeneracion: x.tipoGeneracion ?? GENERACION.ELECTRONICO,
    numeroDocumento: x.numeroDocumento,
    fechaEmision: x.fechaEmision,
  }));
}

function armarNota(tipo: typeof TIPO_DTE.NOTA_CREDITO | typeof TIPO_DTE.NOTA_DEBITO, d: DatosNota): DteArmado {
  const r = d.receptor;
  if (!r.numDocumento || !r.nrc || !r.nombre || !r.codActividad || !r.descActividad || !r.direccion) {
    throw new Error("una nota exige NIT, NRC, nombre, actividad y dirección del cliente");
  }
  if (!d.documentoRelacionado?.length) throw new Error("una nota tiene que decir qué documento corrige");
  const relacionadosValidos = new Set(d.documentoRelacionado.map((x) => x.numeroDocumento));
  for (const ren of d.renglones) {
    if (!ren.numeroDocumento || !relacionadosValidos.has(ren.numeroDocumento)) {
      throw new Error(`el renglón «${ren.descripcion}» no dice a cuál de los documentos relacionados corrige`);
    }
  }
  const o = d.opciones ?? {};
  if (o.descuNoSuj || o.descuExenta || o.descuGravada) {
    // El manual (§XVIII, nota 2): en una nota los descuentos globales del
    // documento original van DENTRO del descuento por renglón.
    throw new Error("en una nota los descuentos globales se escriben por renglón");
  }
  const { calc, res } = calcular(d.renglones, "sin_iva", { ...o, sinUmbral: true });
  const uno = dec("0.01");
  const perciRenglon = (c: RenglonCalculado): Dec => res.ivaPerci > 0n ? mul(c.ventaGravada, uno) : CERO;
  const reteRenglon = (c: RenglonCalculado): Dec => res.ivaRete > 0n ? mul(c.ventaGravada, uno) : CERO;
  const resumen: Record<string, unknown> = {
    totalNoSuj: num(res.totalNoSuj),
    totalExenta: num(res.totalExenta),
    totalGravada: num(res.totalGravada),
    subTotalVentas: num(res.subTotalVentas),
    totalDescu: num(res.totalDescu),
    tributos: tributosIva(res),
    montoTotalOperacion: num(res.montoTotalOperacion),
    ivaPerci: num(res.ivaPerci),
    totalIva: num(res.iva),
    ivaRete: num(res.ivaRete),
    totalNoGravado: num(res.totalNoGravado),
    totalPagar: num(res.totalPagar),
    totalLetras: totalEnLetras(res.totalPagar / 1_000_000n),
    condicionOperacion: d.condicion,
    ...(tipo === TIPO_DTE.NOTA_DEBITO ? { numPagoElectronico: null } : {}),
    observaciones: d.observaciones ?? null,
    codigoRetencionMH: res.ivaRete > 0n ? "22" : null, // CAT-006: retención IVA 1%
  };
  const json = {
    identificacion: identificacion(tipo, d, { fusion: null }),
    documentoRelacionado: relacionados(d.documentoRelacionado),
    emisor: emisorNota(d.emisor),
    receptor: {
      tipoDocumento: DOC_IDENTIFICACION.NIT,
      numDocumento: soloDigitos(r.numDocumento),
      nrc: soloDigitos(r.nrc),
      nombre: r.nombre,
      codActividad: r.codActividad,
      descActividad: r.descActividad,
      nombreComercial: r.nombreComercial ?? null,
      direccion: { ...r.direccion },
      telefono: r.telefono ?? null,
      correo: r.correo ?? null,
    },
    ventaTercero: null,
    cuerpoDocumento: d.renglones.map((ren, i) => {
      const b = cuerpoBase(ren, calc[i], i);
      return {
        numItem: b.numItem,
        tipoItem: b.tipoItem,
        numeroDocumento: b.numeroDocumento,
        cantidad: b.cantidad,
        codigo: b.codigo,
        codTributo: b.codTributo,
        uniMedida: b.uniMedida,
        descripcion: b.descripcion,
        precioUni: b.precioUni,
        montoDescu: b.montoDescu,
        ventaNoSuj: b.ventaNoSuj,
        ventaExenta: b.ventaExenta,
        ventaGravada: b.ventaGravada,
        tributos: calc[i].ventaGravada > 0n ? [TRIBUTO_IVA.codigo] : null,
        noGravado: 0,
        ivaPerci: num(perciRenglon(calc[i])),
        totalIva: num(calc[i].iva),
        ivaRete: num(reteRenglon(calc[i])),
      };
    }),
    resumen,
    apendice: null,
  };
  return armado(tipo, json, res.totalPagar);
}

export const armarNotaCredito = (d: DatosNota) => armarNota(TIPO_DTE.NOTA_CREDITO, d);
export const armarNotaDebito = (d: DatosNota) => armarNota(TIPO_DTE.NOTA_DEBITO, d);

export { AMBIENTE };
