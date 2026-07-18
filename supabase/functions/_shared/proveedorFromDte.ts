// Extrae los datos de proveedor desde un DTE ya parseado — compartido entre
// backfill-proveedores-dte (Fase 2) y sync-purchase-emails (Fase 3).
// Ver PLAN-PROVEEDORES-2026-07.md §2 para el mapeo de campos y §2 tabla
// "Por tipo de DTE, quién es el proveedor".

export interface ProveedorDteData {
  nit: string | null;
  dui: string | null;
  nrc: string | null;
  nombre: string;
  nombre_comercial: string | null;
  cod_actividad: string | null;
  desc_actividad: string | null;
  tipo_establecimiento: string | null;
  departamento: string | null;
  municipio: string | null;
  direccion: string | null;
  telefono: string | null;
  correo: string | null;
  percibe_1: boolean;
  retiene_renta: boolean;
  fecha_emision: string | null;
}

// 01 Factura, 03 CCF, 05 NC, 06 ND — comparten el mismo bloque `emisor`
// (quien nos vendió). CORRECCIÓN 2026-07-18: se probó incluir 09 acá creyendo
// que era "Nota de Remisión" (typo del plan original) — es en realidad
// "Documento Contable de Liquidación" (src/utils/dteTypes.js, catálogo CAT-002
// oficial), misma familia que 08 (comprobante de liquidación), que el plan ya
// excluye explícitamente porque el emisor suele ser un intermediario/cliente
// reportando, no un proveedor real (confirmado con datos: Redserfinsa/
// tarjetas de crédito). Revertido — ver corrección de datos en
// 20260718110000_proveedores_maestro_fix_tipo09.sql.
const TIPOS_EMISOR_PROVEEDOR = new Set(['01', '03', '05', '06']);
const TIPO_FSE = '14';

// Para filtrar la query del backfill (Fase 2): tipos que SÍ pueden generar
// proveedor. Evita reescanear para siempre los 07/08/09/11/15 que nunca van a
// tener proveedor_id (no hay marcador de "no aplica" — el filtro de tipo lo
// reemplaza).
export const TIPOS_DTE_CON_PROVEEDOR = [...TIPOS_EMISOR_PROVEEDOR, TIPO_FSE];
// 07/08 (retención/liquidación): el `emisor` suele ser un CLIENTE que nos
// retiene, no un proveedor — nunca auto-crear. 11/15: casos raros, fuera de
// alcance v1. Cualquier tipo no listado cae en el mismo "no auto-crear".

function truthyAmount(v: unknown): boolean {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0;
}

export function extractProveedorFromDte(json: any): ProveedorDteData | null {
  const tipoDte = String(json?.identificacion?.tipoDte ?? '');
  const fechaEmision: string | null = json?.identificacion?.fecEmi ?? null;
  const percibe1 = truthyAmount(json?.resumen?.ivaPerci1);
  const reteRenta = truthyAmount(json?.resumen?.reteRenta);

  if (TIPOS_EMISOR_PROVEEDOR.has(tipoDte)) {
    const e = json?.emisor;
    if (!e?.nit || !e?.nombre) return null;
    return {
      nit: e.nit, dui: null, nrc: e.nrc ?? null,
      nombre: e.nombre, nombre_comercial: e.nombreComercial ?? null,
      cod_actividad: e.codActividad ?? null, desc_actividad: e.descActividad ?? null,
      tipo_establecimiento: e.tipoEstablecimiento ?? null,
      departamento: e.direccion?.departamento ?? null,
      municipio: e.direccion?.municipio ?? null,
      direccion: e.direccion?.complemento ?? null,
      telefono: e.telefono ?? null, correo: e.correo ?? null,
      percibe_1: percibe1, retiene_renta: reteRenta,
      fecha_emision: fechaEmision,
    };
  }

  if (tipoDte === TIPO_FSE) {
    const s = json?.sujetoExcluido;
    if (!s?.numDocumento || !s?.nombre) return null;
    const digits = String(s.numDocumento).replace(/[^0-9]/g, '');
    const tipoDoc = String(s.tipoDocumento ?? '');
    // CAT-022: 36=NIT, 13=DUI. Sin ese campo (JSON viejo), heurística por
    // longitud: NIT = 14 dígitos, DUI = 9.
    const esNit = tipoDoc === '36' || (tipoDoc !== '13' && digits.length === 14);
    return {
      nit: esNit ? s.numDocumento : null,
      dui: esNit ? null : s.numDocumento,
      nrc: null,
      nombre: s.nombre, nombre_comercial: null,
      cod_actividad: s.codActividad ?? null, desc_actividad: s.descActividad ?? null,
      tipo_establecimiento: null,
      departamento: s.direccion?.departamento ?? null,
      municipio: s.direccion?.municipio ?? null,
      direccion: s.direccion?.complemento ?? null,
      telefono: s.telefono ?? null, correo: s.correo ?? null,
      percibe_1: percibe1, retiene_renta: reteRenta,
      fecha_emision: fechaEmision,
    };
  }

  return null;
}
