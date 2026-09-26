// Cliente de la API de transmisión de Hacienda («Sistema de Transmisión»).
//
// ── Rutas ──────────────────────────────────────────────────────────────────
// La guía de integración v8.0 (factura.gob.sv, 2021) documenta las rutas con
// los hosts viejos `apifactura(test).mh.gob.sv`. Los vigentes son
// `apitest.dtes.mh.gob.sv` y `api.dtes.mh.gob.sv`, y la autenticación se mudó
// a `/seguridad/auth` (confirmado por implementaciones de 2025 y por el monitor
// status.facturaelectronica.sv). Las rutas de lote, consulta, contingencia y
// anulación se tomaron de la guía con el host nuevo: **se confirman en el
// ambiente de pruebas con la primera llamada** — por eso viven en una sola
// constante y no repartidas.
//
// ── Lo que dice la guía y cambia el diseño ─────────────────────────────────
// · El token se pide una vez al día (vive 24 h en producción). Se guarda en la
//   base y se reutiliza: pedir uno por documento es la forma de que Hacienda
//   empiece a rechazar por abuso.
// · La hora de transmisión tiene que estar a ±30 minutos de `fecEmi/horEmi`
//   («esta fuera del rango permitido de (+ o -) 30 minutos»). Un documento que
//   se firmó sin señal NO se puede mandar horas después por la vía normal: va
//   por contingencia. Es la razón de ser del modelo diferido.
// · Si la recepción no contesta en ~5 s: CONSULTAR primero y sólo reenviar si
//   Hacienda no lo tiene, máximo 2 reintentos. Reenviar a ciegas un documento
//   que sí entró produce un duplicado rechazado y, peor, confunde el estado.

import type { Ambiente, TipoDte } from "./catalogos.ts";

export const HOSTS: Record<Ambiente, string> = {
  "00": "https://apitest.dtes.mh.gob.sv",
  "01": "https://api.dtes.mh.gob.sv",
};

export const RUTAS = {
  auth: "/seguridad/auth",
  recepcion: "/fesv/recepciondte",
  lote: "/fesv/recepcionlote/",
  consulta: "/fesv/recepcion/consultadte/",
  consultaLote: "/fesv/recepcion/consultadtelote/",
  contingencia: "/fesv/contingencia",
  anulacion: "/fesv/anulardte",
} as const;

/** Tiempo máximo de espera por llamada. La guía pide consultar pasados 5 s. */
export const ESPERA_MS = 8_000;

export type Fetch = typeof fetch;

export class ErrorHacienda extends Error {
  constructor(
    mensaje: string,
    /** `null` = no hubo respuesta (red, tiempo agotado): el estado es DESCONOCIDO. */
    readonly http: number | null,
    readonly respuesta: unknown = null,
  ) {
    super(mensaje);
  }
  /** Sin respuesta no se sabe si Hacienda lo recibió: hay que consultar. */
  get sinRespuesta() {
    return this.http === null;
  }
}

async function llamar(
  f: Fetch,
  url: string,
  init: RequestInit,
): Promise<{ http: number; cuerpo: any }> {
  let res: Response;
  try {
    res = await f(url, { ...init, signal: AbortSignal.timeout(ESPERA_MS) });
  } catch (e) {
    throw new ErrorHacienda(`Hacienda no respondió: ${(e as Error).message}`, null);
  }
  const texto = await res.text();
  let cuerpo: any = texto;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch { /* se deja el texto: un 502 del proxy no es JSON */ }
  return { http: res.status, cuerpo };
}

export interface Token {
  token: string;      // ya trae el prefijo «Bearer »
  obtenido: Date;
}

/** POST /seguridad/auth (form-urlencoded: user = NIT, pwd = contraseña de API). */
export async function autenticar(
  ambiente: Ambiente,
  usuario: string,
  clave: string,
  f: Fetch = fetch,
): Promise<Token> {
  const { http, cuerpo } = await llamar(f, HOSTS[ambiente] + RUTAS.auth, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user: usuario, pwd: clave }).toString(),
  });
  const token = cuerpo?.body?.token;
  if (http !== 200 || cuerpo?.status !== "OK" || typeof token !== "string") {
    throw new ErrorHacienda(
      `Hacienda no aceptó las credenciales: ${cuerpo?.message ?? cuerpo?.error ?? http}`,
      http,
      cuerpo,
    );
  }
  return { token: token.startsWith("Bearer ") ? token : `Bearer ${token}`, obtenido: new Date() };
}

/** Un token se reutiliza hasta 23 h: una hora de margen sobre las 24 de Hacienda. */
export const tokenVigente = (t: Token | null, ahora = new Date()) =>
  !!t && ahora.getTime() - t.obtenido.getTime() < 23 * 3600_000;

export interface RespuestaRecepcion {
  estado: "PROCESADO" | "RECHAZADO" | string;
  codigoGeneracion: string | null;
  selloRecibido: string | null;
  fhProcesamiento: string | null;
  codigoMsg: string | null;
  descripcionMsg: string | null;
  observaciones: string[];
  http: number;
  cruda: unknown;
}

function aRespuesta(http: number, c: any): RespuestaRecepcion {
  return {
    estado: c?.estado ?? (http === 200 ? "PROCESADO" : "RECHAZADO"),
    codigoGeneracion: c?.codigoGeneracion?.trim?.() ?? null,
    // La consulta devuelve `numValidacion`; la recepción, `selloRecibido`.
    selloRecibido: c?.selloRecibido ?? c?.numValidacion ?? null,
    fhProcesamiento: c?.fhProcesamiento ?? null,
    codigoMsg: c?.codigoMsg ?? null,
    descripcionMsg: c?.descripcionMsg ?? null,
    observaciones: (Array.isArray(c?.observaciones) ? c.observaciones : []).filter((o: unknown) => !!o),
    http,
    cruda: c,
  };
}

/**
 * POST /fesv/recepciondte. Hacienda contesta 200 con PROCESADO o 400 con
 * RECHAZADO: los dos son respuestas VÁLIDAS y se devuelven. Sólo se lanza
 * cuando no hubo respuesta (red) o fue un error de servidor/acceso.
 */
export async function transmitir(
  ambiente: Ambiente,
  token: Token,
  d: { tipoDte: TipoDte; version: number; codigoGeneracion: string; firmado: string; idEnvio?: number },
  f: Fetch = fetch,
): Promise<RespuestaRecepcion> {
  const { http, cuerpo } = await llamar(f, HOSTS[ambiente] + RUTAS.recepcion, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token.token },
    body: JSON.stringify({
      ambiente,
      idEnvio: d.idEnvio ?? 1,
      version: d.version,
      tipoDte: d.tipoDte,
      documento: d.firmado,
      codigoGeneracion: d.codigoGeneracion,
    }),
  });
  if (http === 200 || http === 400) return aRespuesta(http, cuerpo);
  throw new ErrorHacienda(`Hacienda devolvió HTTP ${http}`, http, cuerpo);
}

/** POST /fesv/recepcion/consultadte/ — ¿Hacienda tiene este documento? */
export async function consultar(
  ambiente: Ambiente,
  token: Token,
  d: { nitEmisor: string; tipoDte: TipoDte; codigoGeneracion: string },
  f: Fetch = fetch,
): Promise<RespuestaRecepcion | null> {
  const { http, cuerpo } = await llamar(f, HOSTS[ambiente] + RUTAS.consulta, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token.token },
    body: JSON.stringify({ nitEmisor: d.nitEmisor, tdte: d.tipoDte, codigoGeneracion: d.codigoGeneracion }),
  });
  if (http === 200) return aRespuesta(http, cuerpo);
  if (http === 400 || http === 404) return null; // no lo tiene
  throw new ErrorHacienda(`consulta: HTTP ${http}`, http, cuerpo);
}

/** POST /fesv/anulardte — el evento de invalidación, ya firmado. */
export async function invalidar(
  ambiente: Ambiente,
  token: Token,
  d: { version: number; firmado: string; idEnvio?: number },
  f: Fetch = fetch,
): Promise<RespuestaRecepcion> {
  const { http, cuerpo } = await llamar(f, HOSTS[ambiente] + RUTAS.anulacion, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token.token },
    body: JSON.stringify({ ambiente, idEnvio: d.idEnvio ?? 1, version: d.version, documento: d.firmado }),
  });
  if (http === 200 || http === 400) return aRespuesta(http, cuerpo);
  throw new ErrorHacienda(`invalidación: HTTP ${http}`, http, cuerpo);
}

export interface RespuestaContingencia {
  estado: "RECIBIDO" | "RECHAZADO" | string;
  sello: string | null;
  mensaje: string | null;
  observaciones: string[];
  http: number;
  cruda: unknown;
}

/** POST /fesv/contingencia — el evento que abre la puerta al lote diferido. */
export async function reportarContingencia(
  ambiente: Ambiente,
  token: Token,
  d: { nit: string; firmado: string },
  f: Fetch = fetch,
): Promise<RespuestaContingencia> {
  const { http, cuerpo } = await llamar(f, HOSTS[ambiente] + RUTAS.contingencia, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token.token },
    body: JSON.stringify({ nit: d.nit, documento: d.firmado }),
  });
  if (http !== 200 && http !== 400) throw new ErrorHacienda(`contingencia: HTTP ${http}`, http, cuerpo);
  return {
    estado: cuerpo?.estado ?? "RECHAZADO",
    sello: cuerpo?.selloRecibido ?? cuerpo?.numeroValidacion ?? null,
    mensaje: cuerpo?.mensaje ?? null,
    observaciones: (cuerpo?.observaciones ?? []).filter((o: unknown) => !!o),
    http,
    cruda: cuerpo,
  };
}

/**
 * La política de reintentos de la guía, entera: transmitir; si no hubo
 * respuesta, CONSULTAR; si Hacienda no lo tiene, reenviar — hasta 2 veces.
 * Devuelve la respuesta final o lanza `ErrorHacienda` con `sinRespuesta`
 * (→ el documento pasa a contingencia).
 */
export async function transmitirConReintentos(
  ambiente: Ambiente,
  token: Token,
  d: { tipoDte: TipoDte; version: number; codigoGeneracion: string; firmado: string; nitEmisor: string },
  f: Fetch = fetch,
  esperar: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<RespuestaRecepcion> {
  let ultimo: ErrorHacienda | null = null;
  for (let intento = 0; intento < 3; intento++) {
    if (intento > 0) {
      await esperar(5_000);
      try {
        const ya = await consultar(ambiente, token, d, f);
        if (ya && ya.selloRecibido) return ya;
      } catch (e) {
        if (!(e instanceof ErrorHacienda)) throw e;
        ultimo = e;
        continue;
      }
    }
    try {
      return await transmitir(ambiente, token, d, f);
    } catch (e) {
      if (!(e instanceof ErrorHacienda) || !e.sinRespuesta && (e.http ?? 0) < 500) throw e;
      ultimo = e;
    }
  }
  throw ultimo ?? new ErrorHacienda("Hacienda no respondió", null);
}
