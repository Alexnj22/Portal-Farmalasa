// Los dos eventos que la ruta necesita desde el primer día:
//
// · INVALIDACIÓN (v3): anular un DTE ya sellado. Plazos del Manual v2.0 §VII:
//   CCF, notas y remisión hasta 10 días hábiles después del sello; Factura
//   hasta 3 meses. No se borra nada: el DTE queda INVALIDADO en Hacienda.
// · CONTINGENCIA (v4): avisar que durante un rango de horas no se pudo
//   transmitir y listar los documentos firmados en ese rango. Se manda dentro
//   de las 24 h siguientes a que vuelva la conexión; después, el lote de esos
//   documentos dentro de las 72 h siguientes al sello del evento.

import { CONTINGENCIA, MOTIVO_INVALIDACION, type Ambiente, type TipoDte } from "./catalogos.ts";
import { codigoGeneracion as nuevoCodigo, fechaHoraSV } from "./identificacion.ts";

const soloDigitos = (s: string) => s.replace(/\D/g, "");

export interface EmisorEvento {
  nit: string;
  nombre: string;
  telefono: string;
  correo: string;
  /** Códigos que asigna Hacienda al establecimiento y al punto de venta (4 caracteres). */
  codEstableMH: string;
  codPuntoVentaMH: string;
  codEstable?: string | null;
  codPuntoVenta?: string | null;
}

export interface Persona {
  nombre: string;
  tipoDocumento: string; // CAT-022
  numDocumento: string;
}

export interface DatosInvalidacion {
  ambiente: Ambiente;
  emisor: EmisorEvento;
  documento: {
    tipoDte: TipoDte;
    codigoGeneracion: string;
    selloRecibido: string;
    numeroControl: string;
    fecEmi: string;
    receptor: { tipoDocumento: string | null; numDocumento: string | null; nombre: string | null; telefono: string | null; correo: string | null } | null;
  };
  /** CAT-024: 1 error (exige documento de reemplazo), 2 rescindir, 3 otro. */
  tipo: number;
  motivo: string | null;
  /** El DTE que reemplaza al invalidado — obligatorio con tipo 1 y 3. */
  codigoGeneracionReemplazo?: string | null;
  responsable: Persona;
  solicita: Persona;
  codigoGeneracion?: string;
  ahora?: Date;
}

export function armarInvalidacion(d: DatosInvalidacion) {
  if (!Object.values(MOTIVO_INVALIDACION).includes(d.tipo as 1 | 2 | 3)) {
    throw new Error(`motivo de invalidación inválido: ${d.tipo}`);
  }
  if (d.tipo !== MOTIVO_INVALIDACION.RESCINDIR && !d.codigoGeneracionReemplazo) {
    throw new Error("invalidar por error u otro motivo exige el documento que lo reemplaza");
  }
  if (d.tipo === MOTIVO_INVALIDACION.OTRO && !d.motivo?.trim()) {
    throw new Error("invalidar por «otro» exige escribir el motivo");
  }
  if (d.documento.selloRecibido?.length !== 40) {
    throw new Error("sólo se invalida un documento con sello de Hacienda");
  }
  const { fecEmi, horEmi } = fechaHoraSV(d.ahora);
  const r = d.documento.receptor;
  const nit = soloDigitos(d.emisor.nit);
  return {
    identificacion: {
      version: 3,
      ambiente: d.ambiente,
      codigoGeneracion: d.codigoGeneracion ?? nuevoCodigo(),
      fecEmi,
      horEmi,
      fusion: null,
    },
    emisor: {
      nit,
      nombre: d.emisor.nombre,
      codEstableMH: d.emisor.codEstableMH,
      codEstable: d.emisor.codEstable ?? null,
      codPuntoVentaMH: d.emisor.codPuntoVentaMH,
      codPuntoVenta: d.emisor.codPuntoVenta ?? null,
      telefono: d.emisor.telefono,
      correo: d.emisor.correo,
    },
    documento: {
      tipoDte: d.documento.tipoDte,
      codigoGeneracion: d.documento.codigoGeneracion,
      selloRecibido: d.documento.selloRecibido,
      numeroControl: d.documento.numeroControl,
      fecEmi: d.documento.fecEmi,
      codigoGeneracionR: d.codigoGeneracionReemplazo ?? null,
      tipoDocumento: r?.tipoDocumento ?? null,
      numDocumento: r?.numDocumento ? (r.tipoDocumento === "36" ? soloDigitos(r.numDocumento) : r.numDocumento) : null,
      nombre: r?.nombre ?? null,
      telefono: r?.telefono ?? null,
      correo: r?.correo ?? null,
    },
    motivo: {
      tipoAnulacion: d.tipo,
      motivoAnulacion: d.motivo?.trim() || null,
      nombreResponsable: d.responsable.nombre,
      tipDocResponsable: d.responsable.tipoDocumento,
      numDocResponsable: d.responsable.numDocumento,
      nombreSolicita: d.solicita.nombre,
      tipDocSolicita: d.solicita.tipoDocumento,
      numDocSolicita: d.solicita.numDocumento,
    },
  };
}

export interface DatosContingencia {
  ambiente: Ambiente;
  emisor: EmisorEvento & { tipoEstablecimiento: string }; // CAT-009: 01 sucursal, 02 matriz, 04 bodega, 07 patio
  responsable: Persona;
  documentos: { tipoDte: TipoDte; codigoGeneracion: string }[];
  desde: Date;
  hasta: Date;
  tipo: number;              // CAT-005
  motivo?: string | null;
  codigoGeneracion?: string;
  ahora?: Date;
}

export function armarContingencia(d: DatosContingencia) {
  if (d.documentos.length === 0) throw new Error("un evento de contingencia sin documentos no se manda");
  if (d.documentos.length > 1000) throw new Error("un evento de contingencia lista como mucho 1000 documentos");
  if (d.hasta < d.desde) throw new Error("la contingencia termina antes de empezar");
  if (d.tipo === CONTINGENCIA.OTRO && !d.motivo?.trim()) {
    throw new Error("una contingencia «otro» exige escribir el motivo");
  }
  const t = fechaHoraSV(d.ahora);
  const i = fechaHoraSV(d.desde);
  const f = fechaHoraSV(d.hasta);
  return {
    identificacion: {
      version: 4,
      ambiente: d.ambiente,
      codigoGeneracion: d.codigoGeneracion ?? nuevoCodigo(),
      fTransmision: t.fecEmi,
      hTransmision: t.horEmi,
    },
    emisor: {
      nit: soloDigitos(d.emisor.nit),
      nombre: d.emisor.nombre,
      nombreResponsable: d.responsable.nombre,
      tipoDocResponsable: d.responsable.tipoDocumento,
      numeroDocResponsable: d.responsable.numDocumento,
      tipoEstablecimiento: d.emisor.tipoEstablecimiento,
      codEstableMH: d.emisor.codEstableMH ?? null,
      codPuntoVentaMH: d.emisor.codPuntoVentaMH ?? null,
      telefono: d.emisor.telefono,
      correo: d.emisor.correo,
    },
    detalleDTE: d.documentos.map((x, n) => ({ noItem: n + 1, tipoDoc: x.tipoDte, codigoGeneracion: x.codigoGeneracion })),
    motivo: {
      fInicio: i.fecEmi,
      fFin: f.fecEmi,
      hInicio: i.horEmi,
      hFin: f.horEmi,
      tipoContingencia: d.tipo,
      motivoContingencia: d.motivo?.trim() || null,
    },
  };
}
