// distribucion-dte — el emisor de DTE de la S.A.S. de distribución.
//
// Acciones (POST JSON, con la sesión del usuario — verify_jwt ON):
//   { accion: "facturar",   pedido_id }  arma, firma, guarda y transmite
//   { accion: "transmitir", dte_id }     reintenta uno que quedó sin firmar o sin enviar
//   { accion: "descartar",  dte_id }     retira uno que Hacienda NO tiene, para corregir el pedido
//   { accion: "corregir_sellado", dte_id }        abre un pedido nuevo que lo reemplaza e invalida
//   { accion: "anular_venta", dte_id, motivo }    invalida un sellado sin reemplazo (se deshizo la venta)
//   { accion: "enviar_invalidacion", dte_id }     reintenta una invalidación pendiente
//   { accion: "facturar", pedido_id, contingencia: { tipo, emitido_at, codigo_generacion } }
//                                                 una venta hecha SIN SEÑAL: sale en contingencia
//   { accion: "enviar_contingencia" }             el aviso de contingencia a Hacienda, y después
//                                                 transmite los documentos que cubre
//
// ── Contingencia (2026-09-30) ──────────────────────────────────────────────
// Pedido del usuario: «termina el aviso de contingencia para cuando no hay
// señal». Tres entradas y una salida:
//   · venta sin señal: el teléfono guardó la venta con su hora y su código de
//     generación; al volver la señal la manda con `contingencia` y el
//     documento se arma en modelo DIFERIDO con esa hora (tipo 3, sin internet);
//   · Hacienda no responde al facturar: en vez de quedar «por enviar», el
//     documento se re-firma en contingencia (tipo 1, Hacienda no disponible);
//   · un documento sin sello de más de 25 minutos: ya no entra por la vía
//     normal (Hacienda exige ±30 min entre emisión y transmisión), así que al
//     reenviarlo pasa a contingencia (tipo 1 si ya se intentó, 2 si nunca se
//     pudo firmar o enviar).
// La salida es `enviar_contingencia`: arma el evento por tipo (≤1000
// documentos), lo firma, lo reporta y, con el evento RECIBIDO, transmite cada
// documento. Re-firmar un documento que Hacienda no tiene es válido: no existe
// para ella hasta que lo recibe. Antes de re-firmar uno ya intentado se le
// PREGUNTA a Hacienda, porque una respuesta perdida puede esconder uno que sí
// entró.
//
// ── Por qué el DTE lo arma el SERVIDOR ─────────────────────────────────────
// El navegador sólo pide «factura este pedido». Todo lo demás —el tipo de
// documento, los precios (del catálogo, no del pedido del teléfono), el
// correlativo, la firma y el sello— sale de acá, con la llave de servicio. Un
// DTE armado en el navegador sería un documento fiscal que el cliente puede
// editar antes de firmar.
//
// ── Secretos (por proyecto: pruebas y producción tienen los suyos) ─────────
//   DIST_MH_USUARIO     NIT con el que se entra a la API (sin guiones)
//   DIST_MH_CLAVE_API   contraseña de la API
//   DIST_MH_CERT        el `.crt` de Hacienda (XML), tal cual o en base64
//   DIST_MH_CERT_CLAVE  contraseña privada del certificado
// Sin certificado el DTE se guarda «sin_firmar»; sin credenciales, «firmado»
// sin transmitir. Las dos cosas se ven en pantalla y se reintentan: nada se
// da por emitido si Hacienda no lo selló.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";
import {
  armarCreditoFiscal, armarFactura, armarNotaCredito, totalAPagar,
  type DatosVenta, type Emisor, type Receptor, type Renglon,
} from "../_shared/dte/documentos.ts";
import { CONTINGENCIA, MODELO, OPERACION, TIPO_DTE, VERSION, type Ambiente, type TipoDte } from "../_shared/dte/catalogos.ts";
import { claveCoincide, firmarDte, importarLlavePrivada, leerCertificadoMH } from "../_shared/dte/firma.ts";
import { armarContingencia, armarInvalidacion } from "../_shared/dte/eventos.ts";
import { partirPorLote, type Asignacion } from "../_shared/dte/lotes.ts";
import {
  autenticar, consultar, ErrorHacienda, invalidar, reportarContingencia, tokenVigente, transmitirConReintentos,
  type RespuestaRecepcion, type Token,
} from "../_shared/dte/hacienda.ts";

type Admin = ReturnType<typeof createClient>;

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });

class ErrorUsuario extends Error {
  constructor(msg: string, readonly status = 400) { super(msg); }
}

// ── Certificado y credenciales ──────────────────────────────────────────────

let llaveCache: Promise<CryptoKey | null> | null = null;
function llaveDeFirma(): Promise<CryptoKey | null> {
  if (!llaveCache) {
    llaveCache = (async () => {
      const crudo = Deno.env.get("DIST_MH_CERT");
      if (!crudo) return null;
      const xml = crudo.trim().startsWith("<") ? crudo : new TextDecoder().decode(
        Uint8Array.from(atob(crudo.replace(/\s+/g, "")), (c) => c.charCodeAt(0)));
      const cert = leerCertificadoMH(xml);
      const clave = Deno.env.get("DIST_MH_CERT_CLAVE") ?? "";
      if (!(await claveCoincide(cert, clave))) {
        throw new Error("DIST_MH_CERT_CLAVE no corresponde al certificado");
      }
      return importarLlavePrivada(cert.llavePrivadaPkcs8);
    })().catch((e) => { llaveCache = null; throw e; });
  }
  return llaveCache;
}

async function tokenHacienda(admin: Admin, emisorId: number, ambiente: Ambiente): Promise<Token | null> {
  const usuario = Deno.env.get("DIST_MH_USUARIO");
  const clave = Deno.env.get("DIST_MH_CLAVE_API");
  if (!usuario || !clave) return null;
  const { data, error } = await admin.from("dist_mh_token")
    .select("token, obtenido_at").eq("emisor_id", emisorId).eq("ambiente", ambiente).maybeSingle();
  if (error) throw new Error(`leer token: ${error.message}`);
  const guardado = data ? { token: data.token as string, obtenido: new Date(data.obtenido_at as string) } : null;
  if (tokenVigente(guardado)) return guardado;
  const nuevo = await autenticar(ambiente, usuario, clave);
  const { error: e2 } = await admin.from("dist_mh_token").upsert({
    emisor_id: emisorId, ambiente, token: nuevo.token, obtenido_at: nuevo.obtenido.toISOString(),
  });
  if (e2) throw new Error(`guardar token: ${e2.message}`);
  return nuevo;
}

// ── Del modelo de la base al del motor ──────────────────────────────────────

function emisorDe(e: Record<string, any>): Emisor {
  return {
    nit: e.nit, nrc: e.nrc, nombre: e.nombre, codActividad: e.cod_actividad, descActividad: e.desc_actividad,
    nombreComercial: e.nombre_comercial,
    direccion: { departamento: e.departamento, municipio: e.municipio, distrito: e.distrito, complemento: e.complemento },
    telefono: e.telefono, correo: e.correo,
    establecimiento: e.establecimiento, puntoVenta: e.punto_venta,
    codEstable: e.cod_estable_mh, codPuntoVenta: e.cod_punto_venta_mh,
  };
}

function receptorDe(c: Record<string, any>): Receptor {
  const dir = c.departamento && c.municipio && c.distrito && c.complemento
    ? { departamento: c.departamento, municipio: c.municipio, distrito: c.distrito, complemento: c.complemento }
    : null;
  return {
    tipoDocumento: c.tipo_documento, numDocumento: c.num_documento, nrc: c.nrc, nombre: c.nombre,
    codActividad: c.cod_actividad, descActividad: c.desc_actividad, nombreComercial: c.nombre_comercial,
    direccion: dir, telefono: c.telefono, correo: c.correo,
  };
}

// ── Transmitir un DTE ya guardado ───────────────────────────────────────────

async function registrarIntento(admin: Admin, dteId: number, operacion: string, http: number | null, respuesta: unknown, error: string | null) {
  const { error: e } = await admin.from("dist_dte_intentos").insert({ dte_id: dteId, operacion, http, respuesta, error });
  if (e) console.error("distribucion-dte: no se pudo anotar el intento", e.message);
}

/** Minutos desde que se emitió (fec_emi + hor_emi, hora de El Salvador, UTC−6). */
function minutosDesdeEmision(d: { fec_emi: string; hor_emi: string }) {
  const emitido = new Date(`${d.fec_emi}T${String(d.hor_emi).slice(0, 8)}-06:00`).getTime();
  return (Date.now() - emitido) / 60_000;
}

/**
 * Re-arma un documento que Hacienda NO tiene como documento de contingencia
 * (modelo diferido) con la misma hora, número y código, y lo re-firma. Si ya
 * se intentó mandar, antes se le pregunta a Hacienda: si lo tiene, se sella.
 */
async function pasarAContingencia(admin: Admin, dte: any, tipo: number, yaConsultado = false) {
  const ambiente = dte.ambiente as Ambiente;
  if (dte.intentos > 0 && !yaConsultado) {
    const token = await tokenHacienda(admin, dte.emisor_id, ambiente).catch(() => null);
    if (token) {
      try {
        const ya = await consultar(ambiente, token, {
          tipoDte: dte.tipo as TipoDte,
          codigoGeneracion: dte.codigo_generacion, nitEmisor: (dte.json as any).emisor.nit,
        });
        if (ya?.selloRecibido?.length === 40) {
          const { error } = await admin.from("dist_dte").update({ estado: "sellado", sello_recibido: ya.selloRecibido, fh_procesamiento: ya.fhProcesamiento }).eq("id", dte.id);
          if (error) throw new Error(`guardar sello: ${error.message}`);
          return { estado: "sellado", sello: ya.selloRecibido, aviso: "Hacienda sí lo tenía: quedó sellado." };
        }
      } catch (e) {
        if (!(e instanceof ErrorHacienda)) throw e;
        // Sin respuesta tampoco a la consulta: Hacienda sigue caída.
      }
    }
  }
  const json = structuredClone(dte.json) as any;
  // Uno que ya nació en contingencia (venta sin señal) conserva su motivo:
  // sólo le faltaba la firma.
  if (json.identificacion.tipoOperacion !== OPERACION.CONTINGENCIA) {
    json.identificacion.tipoModelo = MODELO.DIFERIDO;
    json.identificacion.tipoOperacion = OPERACION.CONTINGENCIA;
    json.identificacion.tipoContingencia = tipo;
    json.identificacion.motivoContin = null;
  }
  const llave = await llaveDeFirma();
  const firmado = llave ? await firmarDte(json, llave) : null;
  const { error } = await admin.from("dist_dte").update({
    json, firmado, estado: firmado ? "contingencia" : "sin_firmar", contingencia_id: null,
  }).eq("id", dte.id).in("estado", ["sin_firmar", "firmado"]);
  if (error) throw new Error(`pasar a contingencia: ${error.message}`);
  if (!firmado) return { estado: "sin_firmar", aviso: "Falta el certificado de firma: el documento quedó guardado sin firmar." };
  return { estado: "contingencia", aviso: "Hacienda no lo recibió a tiempo: quedó en contingencia y sale con el aviso de contingencia." };
}

/**
 * El aviso de contingencia: un evento por tipo con los documentos que cubre
 * (hasta 1000), firmado y reportado; con el evento RECIBIDO, cada documento se
 * transmite. También reintenta los de un aviso ya recibido que no llegaron.
 */
async function enviarContingencia(admin: Admin, empleadoId: string) {
  const [{ data: e, error: eE }, { data: emp, error: eEmp }] = await Promise.all([
    admin.from("dist_emisores").select("*").eq("activo", true).order("id").limit(1).single(),
    admin.from("employees").select("name, dui").eq("id", empleadoId).single(),
  ]);
  if (eE) throw new Error(`leer el emisor: ${eE.message}`);
  if (eEmp) throw new Error(`leer tu ficha: ${eEmp.message}`);
  if (!emp?.dui) throw new ErrorUsuario("Tu ficha no tiene DUI: Hacienda pide el documento de quien reporta la contingencia.");
  const ambiente = e.ambiente as Ambiente;
  const llave = await llaveDeFirma();
  if (!llave) throw new ErrorUsuario("Falta el certificado de firma: no se puede firmar el aviso de contingencia.");
  const token = await tokenHacienda(admin, e.id, ambiente);
  if (!token) throw new ErrorUsuario("Faltan las credenciales de Hacienda: el aviso de contingencia no se puede enviar.");

  const { data: docs, error: eD } = await admin.from("dist_dte")
    .select("id, tipo, codigo_generacion, fec_emi, hor_emi, json, contingencia_id")
    .eq("emisor_id", e.id).eq("ambiente", ambiente).eq("estado", "contingencia").order("id")
    // Tandas de 999 (bajo el tope silencioso de 1000 de PostgREST): si hay más,
    // la próxima llamada sigue con el resto.
    .limit(999);
  if (eD) throw new Error(`leer documentos: ${eD.message}`);
  const sinAviso = (docs ?? []).filter((d: any) => !d.contingencia_id);
  const porTipo = new Map<number, any[]>();
  for (const d of sinAviso) {
    const t = Number((d.json as any).identificacion.tipoContingencia) || CONTINGENCIA.MH_NO_DISPONIBLE;
    if (!porTipo.has(t)) porTipo.set(t, []);
    porTipo.get(t)!.push(d);
  }
  const responsable = { nombre: emp.name, tipoDocumento: "13", numDocumento: emp.dui };
  const avisos: { tipo: number; documentos: number; estado: string; mensaje?: string | null }[] = [];
  for (const [tipo, lista] of porTipo) {
    for (let i = 0; i < lista.length; i += 1000) {
      const tanda = lista.slice(i, i + 1000);
      const fechas = tanda.map((d: any) => new Date(`${d.fec_emi}T${String(d.hor_emi).slice(0, 8)}-06:00`));
      const desde = new Date(Math.min(...fechas.map((f) => f.getTime())));
      const hasta = new Date();
      let evento;
      try {
        evento = armarContingencia({
          ambiente,
          emisor: {
            nit: e.nit, nombre: e.nombre, telefono: e.telefono, correo: e.correo,
            codEstableMH: e.cod_estable_mh, codPuntoVentaMH: e.cod_punto_venta_mh, tipoEstablecimiento: e.tipo_establecimiento,
          },
          responsable,
          documentos: tanda.map((d: any) => ({ tipoDte: d.tipo as TipoDte, codigoGeneracion: String(d.codigo_generacion).toUpperCase() })),
          desde, hasta, tipo,
        });
      } catch (err) {
        throw new ErrorUsuario((err as Error).message);
      }
      const firmado = await firmarDte(evento, llave);
      const r = await reportarContingencia(ambiente, token, { nit: String(e.nit).replace(/\D/g, ""), firmado });
      const recibido = String(r.estado ?? "").toUpperCase().includes("RECIBIDO");
      const { data: ins, error: eI } = await admin.from("dist_contingencias").insert({
        emisor_id: e.id, ambiente, codigo_generacion: evento.identificacion.codigoGeneracion, tipo,
        desde: desde.toISOString(), hasta: hasta.toISOString(), json: evento, firmado,
        estado: recibido ? "recibido" : "rechazado", sello: r.sello, respuesta: r.cruda,
      }).select("id").single();
      if (eI) throw new Error(`guardar el aviso: ${eI.message}`);
      if (recibido) {
        const { error: eU } = await admin.from("dist_dte").update({ contingencia_id: ins.id }).in("id", tanda.map((d: any) => d.id));
        if (eU) throw new Error(`atar documentos al aviso: ${eU.message}`);
      }
      avisos.push({ tipo, documentos: tanda.length, estado: recibido ? "recibido" : "rechazado",
        mensaje: recibido ? null : [r.mensaje, ...(r.observaciones ?? [])].filter(Boolean).join(" ") });
    }
  }
  // Con el aviso recibido, cada documento se transmite.
  const { data: listos, error: eL } = await admin.from("dist_dte").select("id, dist_contingencias!inner(estado)")
    .eq("emisor_id", e.id).eq("estado", "contingencia").not("contingencia_id", "is", null)
    .eq("dist_contingencias.estado", "recibido").limit(999);
  if (eL) throw new Error(`leer documentos con aviso: ${eL.message}`);
  const resultado = { sellados: 0, rechazados: 0, pendientes: 0 };
  for (const d of listos ?? []) {
    const r = await transmitirDte(admin, (d as any).id);
    if (r.estado === "sellado") resultado.sellados += 1;
    else if (r.estado === "rechazado") resultado.rechazados += 1;
    else resultado.pendientes += 1;
  }
  return { avisos, ...resultado };
}

async function transmitirDte(admin: Admin, dteId: number) {
  const { data: dte, error } = await admin.from("dist_dte")
    .select("id, emisor_id, ambiente, tipo, codigo_generacion, json, firmado, estado, pedido_id, intentos, fec_emi, hor_emi, contingencia_id")
    .eq("id", dteId).single();
  if (error) throw new Error(`leer DTE: ${error.message}`);
  if (dte.estado === "sellado" || dte.estado === "invalidado") return { estado: dte.estado };
  if (dte.estado === "rechazado") throw new ErrorUsuario("este documento fue rechazado: hay que emitir uno nuevo");
  if (dte.estado === "contingencia" && !dte.contingencia_id) {
    return { estado: "contingencia", aviso: "Emitido en contingencia: sale a Hacienda con el aviso de contingencia." };
  }
  // Más de 25 minutos sin sello: la vía normal ya no lo acepta (±30 min).
  const nacioEnContingencia = (dte.json as any)?.identificacion?.tipoOperacion === OPERACION.CONTINGENCIA;
  if (dte.estado !== "contingencia" && (nacioEnContingencia || minutosDesdeEmision(dte) > 25)) {
    return await pasarAContingencia(admin, dte,
      dte.intentos > 0 ? CONTINGENCIA.MH_NO_DISPONIBLE : CONTINGENCIA.EMISOR_NO_DISPONIBLE);
  }

  let firmado = dte.firmado as string | null;
  if (!firmado) {
    const llave = await llaveDeFirma();
    if (!llave) return { estado: "sin_firmar", aviso: "Falta el certificado de firma: el documento quedó guardado sin firmar." };
    firmado = await firmarDte(dte.json, llave);
    const { error: e } = await admin.from("dist_dte").update({ firmado, estado: "firmado" }).eq("id", dteId);
    if (e) throw new Error(`guardar firma: ${e.message}`);
  }

  const ambiente = dte.ambiente as Ambiente;
  const token = await tokenHacienda(admin, dte.emisor_id, ambiente).catch(async (e) => {
    await registrarIntento(admin, dteId, "auth", e instanceof ErrorHacienda ? e.http : null, e?.respuesta ?? null, String(e.message));
    throw e;
  });
  if (!token) return { estado: "firmado", aviso: "Faltan las credenciales de Hacienda: el documento está firmado y pendiente de enviar." };

  const nitEmisor = (dte.json as any).emisor.nit as string;
  let r: RespuestaRecepcion;
  try {
    r = await transmitirConReintentos(ambiente, token, {
      tipoDte: dte.tipo as TipoDte, version: VERSION[dte.tipo as TipoDte],
      codigoGeneracion: dte.codigo_generacion, firmado, nitEmisor,
    });
  } catch (e) {
    // Sólo una falla de Hacienda se traduce a «pendiente de enviar»; un error
    // del propio código tiene que verse como lo que es.
    if (!(e instanceof ErrorHacienda)) throw e;
    await registrarIntento(admin, dteId, "transmitir", e.http, e.respuesta, e.message);
    const { error: eInt } = await admin.from("dist_dte")
      .update({ intentos: dte.intentos + 1, ultimo_intento_at: new Date().toISOString() }).eq("id", dteId);
    if (eInt) throw new Error(`anotar el intento: ${eInt.message}`);
    // Ya en contingencia (con su aviso recibido): se reintenta después.
    if (dte.estado === "contingencia") return { estado: "contingencia", aviso: `Hacienda no respondió (${e.message}). Se reintenta después.` };
    // Hacienda no disponible: el documento pasa a contingencia (la guía:
    // sin respuesta tras consultar y reintentar → contingencia).
    if (e.sinRespuesta || (e.http ?? 0) >= 500) {
      return await pasarAContingencia(admin, { ...dte, intentos: dte.intentos + 1, firmado }, CONTINGENCIA.MH_NO_DISPONIBLE, true);
    }
    return { estado: "firmado", aviso: `Hacienda no respondió (${e.message}). Queda pendiente de enviar.` };
  }
  await registrarIntento(admin, dteId, "transmitir", r.http, r.cruda, null);

  const sellado = r.estado === "PROCESADO" && r.selloRecibido?.length === 40;
  const cambios = {
    estado: sellado ? "sellado" : "rechazado",
    sello_recibido: sellado ? r.selloRecibido : null,
    fh_procesamiento: r.fhProcesamiento,
    codigo_msg: r.codigoMsg,
    descripcion_msg: r.descripcionMsg,
    observaciones_mh: r.observaciones,
    intentos: dte.intentos + 1,
    ultimo_intento_at: new Date().toISOString(),
  };
  const { error: e3 } = await admin.from("dist_dte").update(cambios).eq("id", dteId);
  if (e3) throw new Error(`guardar respuesta de Hacienda: ${e3.message}`);

  if (sellado) {
    const { data: esperan, error: eEsp } = await admin.from("dist_dte")
      .select("id").eq("reemplazo_id", dteId).eq("invalidacion_estado", "pendiente");
    if (eEsp) throw new Error(`buscar invalidaciones pendientes: ${eEsp.message}`);
    for (const o of esperan ?? []) await enviarInvalidacion(admin, o.id);
  }
  if (!sellado && dte.pedido_id) {
    // Rechazado: el pedido vuelve a estar por facturar. El DTE rechazado queda
    // como constancia; el que se emita después lleva otro código y número.
    const { error: e4 } = await admin.from("dist_pedidos")
      .update({ estado: "confirmado", dte_id: null }).eq("id", dte.pedido_id).eq("dte_id", dteId);
    if (e4) throw new Error(`devolver el pedido: ${e4.message}`);
    // La mercadería NO vuelve a los lotes: ya se entregó, y un rechazo se
    // corrige y se vuelve a facturar. Las unidades siguen atadas al pedido y
    // al refacturar se reasignan en la misma transacción; sólo ANULAR el pedido
    // las devuelve (`dist_lotes_al_anular`). Decisión del usuario, 2026-09-29.
  }
  return { estado: cambios.estado, sello: cambios.sello_recibido, mensaje: r.descripcionMsg, observaciones: r.observaciones };
}

// ── Descartar un documento que nunca llegó a Hacienda ───────────────────────
//
// Corregir un pedido ya facturado sólo se puede si el documento NO existe
// para Hacienda. Si alguna vez se intentó transmitir, se le PREGUNTA antes:
// una respuesta perdida puede esconder un documento que sí entró, y descartar
// eso sería perder una venta sellada. Con sello, el camino es invalidarlo.
async function descartar(admin: Admin, dteId: number) {
  const { data: dte, error } = await admin.from("dist_dte")
    .select("id, emisor_id, ambiente, tipo, codigo_generacion, json, estado, pedido_id").eq("id", dteId).single();
  if (error) throw new Error(`leer DTE: ${error.message}`);
  if (dte.estado === "descartado") return { estado: "descartado" };
  if (dte.estado === "sellado" || dte.estado === "invalidado") {
    throw new ErrorUsuario("Este documento ya tiene sello de Hacienda: no se descarta, se invalida.");
  }
  if (dte.estado === "rechazado") {
    return { estado: "rechazado", aviso: "Hacienda lo rechazó: el pedido ya quedó libre para corregirlo y facturarlo de nuevo." };
  }
  const { count, error: eInt } = await admin.from("dist_dte_intentos")
    .select("id", { count: "exact", head: true }).eq("dte_id", dteId).eq("operacion", "transmitir");
  if (eInt) throw new Error(`leer intentos: ${eInt.message}`);
  if ((count ?? 0) > 0) {
    const ambiente = dte.ambiente as Ambiente;
    const token = await tokenHacienda(admin, dte.emisor_id, ambiente);
    if (!token) throw new ErrorUsuario("Se intentó enviar y no se puede confirmar con Hacienda que no lo tenga: faltan las credenciales.");
    const ya = await consultar(ambiente, token, {
      nitEmisor: (dte.json as any).emisor.nit, tipoDte: dte.tipo as TipoDte, codigoGeneracion: dte.codigo_generacion,
    });
    await registrarIntento(admin, dteId, "consultar", ya?.http ?? 404, ya?.cruda ?? null, null);
    if (ya?.selloRecibido) {
      const { error: eS } = await admin.from("dist_dte").update({
        estado: "sellado", sello_recibido: ya.selloRecibido, fh_procesamiento: ya.fhProcesamiento,
      }).eq("id", dteId);
      if (eS) throw new Error(`guardar sello: ${eS.message}`);
      throw new ErrorUsuario("Hacienda SÍ tiene este documento: quedó sellado. Para corregirlo hay que invalidarlo.");
    }
  }
  const { error: eD } = await admin.from("dist_dte").update({ estado: "descartado" }).eq("id", dteId).in("estado", ["sin_firmar", "firmado", "contingencia"]);
  if (eD) throw new Error(`descartar: ${eD.message}`);
  if (dte.pedido_id) {
    const { error: eP } = await admin.from("dist_pedidos")
      .update({ estado: "confirmado", dte_id: null }).eq("id", dte.pedido_id).eq("dte_id", dteId);
    if (eP) throw new Error(`liberar el pedido: ${eP.message}`);
    // Igual que el rechazado: la mercadería sigue fuera hasta refacturar o anular.
  }
  return { estado: "descartado", aviso: "Documento retirado. El pedido volvió a «Por facturar» para corregirlo." };
}

// ── Pagos por forma ─────────────────────────────────────────────────────────
//
// Varias formas en una venta ($2 efectivo, el resto tarjeta) — Manual §XIX.
// La última fila sin monto es «el resto»: se calcula acá, contra el total del
// motor, así los pagos suman el documento al centavo. Con crédito mezclado,
// la condición es 3 («Otro»); todo a crédito, 2; nada a crédito, 1.
const CREDITO = "13";

async function resolverPagos(
  admin: Admin, p: Record<string, any>, c: Record<string, any>, filas: Record<string, any>[], total: string,
  { soloValidar = false } = {},
) {
  const totalC = Math.round(Number(total) * 100);
  let lineas = filas.map((f) => ({ ...f, montoC: f.monto == null ? null : Math.round(Number(f.monto) * 100) }));
  if (!lineas.length) {
    // Pedido sin pagos detallados: la forma y la condición del pedido, por el total.
    lineas = [{ id: null, orden: 1, forma: p.condicion === 2 ? CREDITO : (p.forma_pago ?? "01"), referencia: null, monto: null, montoC: null }];
  }
  const sinMonto = lineas.filter((l) => l.montoC == null);
  if (sinMonto.length > 1) throw new ErrorUsuario("Sólo la última forma de pago puede ser «el resto».");
  const fijos = lineas.reduce((a, l) => a + (l.montoC ?? 0), 0);
  if (sinMonto.length) {
    const resto = totalC - fijos;
    if (resto <= 0) throw new ErrorUsuario(`Las formas de pago ya suman $${(fijos / 100).toFixed(2)} y el total es $${(totalC / 100).toFixed(2)}.`);
    sinMonto[0].montoC = resto;
  } else if (fijos !== totalC) {
    throw new ErrorUsuario(`Las formas de pago suman $${(fijos / 100).toFixed(2)} y el total es $${(totalC / 100).toFixed(2)}.`);
  }
  const conCredito = lineas.some((l) => l.forma === CREDITO);
  if (conCredito) {
    if (!(c.plazo_dias > 0) || !(Number(c.limite_credito) > 0)) throw new ErrorUsuario(`${c.nombre} no tiene crédito aprobado.`);
    if (!(p.plazo_dias > 0)) throw new ErrorUsuario("Una venta a crédito tiene que decir el plazo.");
  }
  const condicion = !conCredito ? 1 : lineas.every((l) => l.forma === CREDITO) ? 2 : 3;
  if (!soloValidar && sinMonto.length && sinMonto[0].id) {
    const { error } = await admin.from("dist_pagos").update({ monto: sinMonto[0].montoC / 100 }).eq("id", sinMonto[0].id);
    if (error) throw new Error(`guardar el resto del pago: ${error.message}`);
  }
  const pagos = lineas.map((l) => ({
    codigo: l.forma,
    monto: (l.montoC! / 100).toFixed(2),
    referencia: l.referencia ?? null,
    plazo: l.forma === CREDITO ? "01" : null,
    periodo: l.forma === CREDITO ? p.plazo_dias : null,
  }));
  return { pagos, condicion };
}

// ── Invalidar un documento sellado ──────────────────────────────────────────
//
// Se arma y se firma el evento (CAT-024: 1 corrección con reemplazo, 2 se
// deshizo la venta, 3 otro) y se deja «pendiente»; `enviarInvalidacion` lo
// manda. Quién responde por ella es quien la pide en el portal (nombre y DUI de
// su ficha); quién la solicita, el cliente si tiene documento, si no la misma
// persona.
async function prepararInvalidacion(
  admin: Admin, dteId: number, tipo: 1 | 2 | 3, motivo: string | null, reemplazoId: number | null, empleadoId: string,
) {
  const [{ data: d, error }, { data: emp, error: eEmp }] = await Promise.all([
    admin.from("dist_dte").select("id, emisor_id, ambiente, tipo, codigo_generacion, numero_control, fec_emi, sello_recibido, json, estado, invalidacion_estado").eq("id", dteId).single(),
    admin.from("employees").select("name, dui").eq("id", empleadoId).single(),
  ]);
  if (error) throw new Error(`leer el documento: ${error.message}`);
  if (eEmp) throw new Error(`leer tu ficha: ${eEmp.message}`);
  if (d.estado !== "sellado") throw new ErrorUsuario("Sólo se invalida un documento sellado por Hacienda.");
  if (d.invalidacion_estado === "pendiente" || d.invalidacion_estado === "procesada") {
    throw new ErrorUsuario("Este documento ya tiene una invalidación en curso.");
  }
  if (!emp?.dui) throw new ErrorUsuario("Tu ficha no tiene DUI: Hacienda pide el documento de quien invalida.");
  const { data: e, error: eE } = await admin.from("dist_emisores").select("*").eq("id", d.emisor_id).single();
  if (eE) throw new Error(`leer el emisor: ${eE.message}`);
  if (!e.cod_estable_mh || !e.cod_punto_venta_mh) {
    throw new ErrorUsuario("Faltan los códigos de establecimiento y punto de venta de Hacienda (pestaña Empresa).");
  }
  let reemplazo: string | null = null;
  if (reemplazoId) {
    const { data: r, error: eR } = await admin.from("dist_dte").select("codigo_generacion").eq("id", reemplazoId).single();
    if (eR) throw new Error(`leer el reemplazo: ${eR.message}`);
    reemplazo = String(r.codigo_generacion).toUpperCase();
  }
  const j = d.json as any;
  const rec = j.receptor ?? null;
  const recDoc = rec ? (rec.nit ? { tipoDocumento: "36", numDocumento: rec.nit } : { tipoDocumento: rec.tipoDocumento ?? null, numDocumento: rec.numDocumento ?? null }) : null;
  const responsable = { nombre: emp.name, tipoDocumento: "13", numDocumento: emp.dui };
  const solicita = recDoc?.numDocumento && recDoc.tipoDocumento
    ? { nombre: rec.nombre, tipoDocumento: recDoc.tipoDocumento, numDocumento: recDoc.numDocumento }
    : responsable;
  let evento;
  try {
    evento = armarInvalidacion({
      ambiente: d.ambiente as Ambiente,
      emisor: {
        nit: e.nit, nombre: e.nombre, telefono: e.telefono, correo: e.correo,
        codEstableMH: e.cod_estable_mh, codPuntoVentaMH: e.cod_punto_venta_mh,
      },
      documento: {
        tipoDte: d.tipo as TipoDte, codigoGeneracion: String(d.codigo_generacion).toUpperCase(),
        selloRecibido: d.sello_recibido, numeroControl: d.numero_control, fecEmi: d.fec_emi,
        receptor: rec ? { ...recDoc, nombre: rec.nombre ?? null, telefono: rec.telefono ?? null, correo: rec.correo ?? null } as any : null,
      },
      tipo, motivo, codigoGeneracionReemplazo: reemplazo, responsable, solicita,
    });
  } catch (err) {
    throw new ErrorUsuario((err as Error).message);
  }
  const llave = await llaveDeFirma();
  if (!llave) throw new ErrorUsuario("Falta el certificado de firma: no se puede preparar la invalidación.");
  const firmado = await firmarDte(evento, llave);
  const { error: eU } = await admin.from("dist_dte").update({
    invalidacion_estado: "pendiente", invalidacion_tipo: tipo, invalidacion_motivo: motivo,
    invalidacion_json: evento, invalidacion_firmado: firmado, invalidado_por: empleadoId, reemplazo_id: reemplazoId,
  }).eq("id", dteId);
  if (eU) throw new Error(`guardar la invalidación: ${eU.message}`);
}

async function enviarInvalidacion(admin: Admin, dteId: number) {
  const { data: d, error } = await admin.from("dist_dte")
    .select("id, emisor_id, ambiente, pedido_id, invalidacion_estado, invalidacion_tipo, invalidacion_firmado, reemplazo_id").eq("id", dteId).single();
  if (error) throw new Error(`leer el documento: ${error.message}`);
  if (d.invalidacion_estado !== "pendiente") return { estado: d.invalidacion_estado ?? "sellado" };
  if (d.reemplazo_id) {
    const { data: r, error: eR } = await admin.from("dist_dte").select("estado").eq("id", d.reemplazo_id).single();
    if (eR) throw new Error(`leer el reemplazo: ${eR.message}`);
    if (r.estado !== "sellado") {
      return { estado: "sellado", aviso: "La invalidación sale cuando el documento que lo reemplaza tenga sello de Hacienda." };
    }
  }
  const ambiente = d.ambiente as Ambiente;
  const token = await tokenHacienda(admin, d.emisor_id, ambiente);
  if (!token) return { estado: "sellado", aviso: "Invalidación firmada y pendiente de enviar: faltan las credenciales de Hacienda." };
  let r;
  try {
    r = await invalidar(ambiente, token, { version: 3, firmado: d.invalidacion_firmado });
  } catch (e) {
    if (!(e instanceof ErrorHacienda)) throw e;
    await registrarIntento(admin, dteId, "invalidar", e.http, e.respuesta, e.message);
    return { estado: "sellado", aviso: `Hacienda no respondió (${e.message}). La invalidación queda pendiente.` };
  }
  await registrarIntento(admin, dteId, "invalidar", r.http, r.cruda, null);
  const ok = r.estado === "PROCESADO";
  const { error: eU } = await admin.from("dist_dte").update(ok
    ? { estado: "invalidado", invalidado_at: new Date().toISOString(), invalidacion_estado: "procesada",
        invalidacion_sello: r.selloRecibido, invalidacion_respuesta: r.cruda }
    : { invalidacion_estado: "rechazada", invalidacion_respuesta: r.cruda }).eq("id", dteId);
  if (eU) throw new Error(`guardar la respuesta: ${eU.message}`);
  if (ok && d.pedido_id) {
    const motivo = d.reemplazo_id ? "Documento invalidado y reemplazado." : "Venta deshecha: documento invalidado ante Hacienda.";
    const { error: eP } = await admin.from("dist_pedidos").update({ estado: "anulado", anulado_motivo: motivo }).eq("id", d.pedido_id);
    if (eP) throw new Error(`anular el pedido: ${eP.message}`);
  }
  return ok
    ? { estado: "invalidado", mensaje: "Hacienda aceptó la invalidación." }
    : { estado: "sellado", aviso: `Hacienda rechazó la invalidación: ${r.descripcionMsg ?? ""} ${r.observaciones.join(" ")}`.trim() };
}

/** Corregir un sellado: un pedido NUEVO con lo mismo, que al facturarse lo reemplaza. */
async function corregirSellado(admin: Admin, dteId: number, empleadoId: string) {
  const { data: d, error } = await admin.from("dist_dte").select("id, estado, pedido_id, invalidacion_estado").eq("id", dteId).single();
  if (error) throw new Error(`leer el documento: ${error.message}`);
  if (d.estado !== "sellado") throw new ErrorUsuario("Esto es para documentos sellados; los demás se corrigen con «Corregir».");
  if (d.invalidacion_estado === "pendiente" || d.invalidacion_estado === "procesada") throw new ErrorUsuario("Este documento ya se está invalidando.");
  const { data: ya, error: eYa } = await admin.from("dist_pedidos").select("id")
    .eq("reemplaza_dte_id", dteId).neq("estado", "anulado").maybeSingle();
  if (eYa) throw new Error(`buscar corrección: ${eYa.message}`);
  if (ya) return { pedido_id: ya.id, aviso: "Ya había una corrección abierta para este documento." };
  const { data: p, error: eP } = await admin.from("dist_pedidos")
    .select("emisor_id, cliente_id, tipo_documento, condicion, forma_pago, plazo_dias, observaciones").eq("id", d.pedido_id).single();
  if (eP) throw new Error(`leer el pedido: ${eP.message}`);
  const { data: nuevo, error: eN } = await admin.from("dist_pedidos").insert({
    ...p, vendedor_id: empleadoId, client_uuid: crypto.randomUUID(), reemplaza_dte_id: dteId,
  }).select("id").single();
  if (eN) throw new ErrorUsuario(`No se pudo abrir la corrección: ${eN.message}`);
  const { data: its, error: eI } = await admin.from("dist_pedido_items")
    .select("product_id, cantidad, descuento, descuento_pct, descripcion, presentacion, lista_id").eq("pedido_id", d.pedido_id);
  if (eI) throw new Error(`leer productos: ${eI.message}`);
  const { error: eIns } = await admin.from("dist_pedido_items").insert(
    (its ?? []).map((i: any) => ({ ...i, pedido_id: nuevo.id, precio_con_iva: 0 })));
  if (eIns) throw new ErrorUsuario(`No se pudieron copiar los productos: ${eIns.message}`);
  return { pedido_id: nuevo.id };
}

// ── Facturar un pedido ──────────────────────────────────────────────────────

interface PedidoContingencia { tipo: number; emitidoAt: Date; codigoGeneracion: string | null }

/** Valida lo que manda el teléfono de una venta hecha sin señal. */
function leerContingencia(c: any): PedidoContingencia | null {
  if (!c) return null;
  const tipo = Number(c.tipo);
  if (![2, 3, 4].includes(tipo)) throw new ErrorUsuario("tipo de contingencia no válido");
  const emitidoAt = new Date(c.emitido_at);
  if (Number.isNaN(emitidoAt.getTime())) throw new ErrorUsuario("falta la hora de la venta sin señal");
  if (emitidoAt.getTime() > Date.now() + 5 * 60_000) throw new ErrorUsuario("la hora de la venta está en el futuro");
  // Hacienda da 72 horas para transmitir lo emitido en contingencia.
  if (Date.now() - emitidoAt.getTime() > 72 * 3600_000) {
    throw new ErrorUsuario("Pasaron más de 72 horas desde la venta sin señal: Hacienda ya no la acepta en contingencia. Factúrala de nuevo.");
  }
  const cod = typeof c.codigo_generacion === "string" ? c.codigo_generacion.toUpperCase() : null;
  if (cod && !/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(cod)) throw new ErrorUsuario("código de generación no válido");
  return { tipo, emitidoAt, codigoGeneracion: cod };
}

async function facturar(admin: Admin, pedidoId: number, empleadoId: string, cont: PedidoContingencia | null = null) {
  const { data: p, error } = await admin.from("dist_pedidos")
    .select("id, emisor_id, cliente_id, estado, tipo_documento, condicion, forma_pago, plazo_dias, observaciones, dte_id, reemplaza_dte_id")
    .eq("id", pedidoId).maybeSingle();
  if (error) throw new Error(`leer el pedido: ${error.message}`);
  if (!p) throw new ErrorUsuario("no existe ese pedido", 404);
  if (p.estado !== "confirmado") {
    if (p.dte_id) return { dte_id: p.dte_id, ...(await transmitirDte(admin, p.dte_id)) };
    throw new ErrorUsuario(`el pedido está ${p.estado}`);
  }

  const [emi, cli, its, pag] = await Promise.all([
    admin.from("dist_emisores").select("*").eq("id", p.emisor_id).single(),
    admin.from("dist_clientes").select("*").eq("id", p.cliente_id).single(),
    admin.from("dist_pedido_items").select("id, product_id, cantidad, precio_con_iva, descuento, descuento_estado, descripcion").eq("pedido_id", pedidoId).order("id"),
    admin.from("dist_pagos").select("id, orden, forma, monto, referencia").eq("pedido_id", pedidoId).order("orden"),
  ]);
  for (const r of [emi, cli, its, pag]) if (r.error) throw new Error(r.error.message);
  const e = emi.data!, c = cli.data!;
  if (!e.activo) throw new ErrorUsuario("el emisor está desactivado");
  if (!its.data!.length) throw new ErrorUsuario("el pedido no tiene productos");
  // Un descuento pedido y todavía sin decidir: la venta es preventa hasta que
  // lo resuelvan en Solicitudes (borrador 0008). Facturarla ahora sería
  // emitir sin el descuento que el cliente espera, o con uno que nadie dio.
  if (its.data!.some((i: any) => i.descuento_estado === "pendiente")) {
    throw new ErrorUsuario("Esta venta tiene un descuento esperando aprobación: se factura cuando lo resuelvan.", 409);
  }

  // El documento lo eligió quien vendió; si no eligió, el de la ficha. Un
  // Crédito Fiscal sin NRC no se emite aunque el pedido lo diga.
  const tipo: TipoDte = (p.tipo_documento as TipoDte | null) ?? (c.contribuyente ? TIPO_DTE.CCF : TIPO_DTE.FACTURA);
  if (tipo === TIPO_DTE.CCF && !c.contribuyente) {
    throw new ErrorUsuario("Este cliente no tiene NRC: sólo se le puede emitir Factura.");
  }
  // De qué lote sale cada renglón (primero vence, primero sale). Si no alcanza
  // la existencia, no se factura: la función lo dice producto por producto y
  // no deja nada reservado a medias. Ver borradores/distribucion/0006.
  const { data: asignadas, error: eLot } = await admin.rpc("dist_asignar_lotes", { p_pedido: pedidoId });
  if (eLot) {
    if (eLot.message?.startsWith("Sin existencia suficiente")) throw new ErrorUsuario(eLot.message, 409);
    throw new Error(`asignar lotes: ${eLot.message}`);
  }
  const renglones: Renglon[] = its.data!.flatMap((i: any) => partirPorLote({
    codigo: String(i.product_id), descripcion: i.descripcion,
    // Precio y descuento se guardan CON IVA en centavos (borrador 0007); el
    // motor los lleva a la base de cada documento.
    cantidad: String(i.cantidad), precio: String(i.precio_con_iva), precioIncluyeIva: true,
    descuento: String(i.descuento),
  }, i.id, (asignadas ?? []) as Asignacion[]));

  const ambiente = e.ambiente as Ambiente;
  const anio = Number(new Date((cont ? cont.emitidoAt.getTime() : Date.now()) - 6 * 3600_000).toISOString().slice(0, 4));
  const opciones = {
    retiene1: c.gran_contribuyente && tipo === TIPO_DTE.CCF,
    percibe1: e.gran_contribuyente && !c.gran_contribuyente && tipo === TIPO_DTE.CCF,
  };
  let total: string;
  try {
    total = totalAPagar(tipo, renglones, opciones);
  } catch (err) {
    throw new ErrorUsuario((err as Error).message);
  }
  // Los pagos se validan ANTES de reservar número: un error acá no deja salto.
  const validados = await resolverPagos(admin, p, c, pag.data ?? [], total, { soloValidar: true });
  // ── El límite de crédito FRENA (borrador 0014) ──
  // Lo que ya debe más lo que se fía ahora no puede pasar del límite aprobado.
  // El atraso no frena (es un hallazgo, igual que en la cartera de las
  // farmacias). Una venta hecha SIN SEÑAL no se frena: la mercadería ya se
  // entregó y el documento tiene que salir; queda a la vista en la cartera.
  const aCredito = validados.pagos.filter((x) => x.codigo === CREDITO).reduce((a, x) => a + Number(x.monto), 0);
  if (aCredito > 0 && !cont) {
    const { data: cr, error: eCr } = await admin.rpc("dist_credito_cliente", { p_cliente: c.id });
    if (eCr) throw new Error(`leer el crédito del cliente: ${eCr.message}`);
    const saldo = Number((cr as any)?.saldo ?? 0);
    const limite = Number(c.limite_credito ?? 0);
    if (Math.round((saldo + aCredito) * 100) > Math.round(limite * 100)) {
      throw new ErrorUsuario(`${c.nombre} ya debe $${saldo.toFixed(2)} y su límite es $${limite.toFixed(2)}: `
        + `puede llevar a crédito hasta $${Math.max(0, limite - saldo).toFixed(2)}. Cobra un abono o cambia la forma de pago.`, 409);
    }
  }
  const { data: correlativo, error: eCor } = await admin.rpc("dist_siguiente_correlativo", {
    p_emisor: e.id, p_ambiente: ambiente, p_tipo: tipo,
    p_establecimiento: e.establecimiento, p_punto_venta: e.punto_venta, p_anio: anio,
  });
  if (eCor) throw new Error(`correlativo: ${eCor.message}`);

  const { pagos, condicion } = await resolverPagos(admin, p, c, pag.data ?? [], total);
  const base: Omit<DatosVenta, "pagos"> = {
    ambiente, emisor: emisorDe(e), correlativo: correlativo as number, receptor: receptorDe(c), renglones,
    condicion, opciones, observaciones: p.observaciones,
  };
  const armar = tipo === TIPO_DTE.CCF ? armarCreditoFiscal : armarFactura;
  let doc;
  try {
    doc = armar({
      ...base, pagos,
      // Sin señal: con la hora de la venta y el código que ya lleva su
      // comprobante provisional, en modelo diferido.
      ...(cont ? { ahora: cont.emitidoAt, codigoGeneracion: cont.codigoGeneracion ?? undefined, contingencia: { tipo: cont.tipo } } : {}),
    });
  } catch (err) {
    throw new ErrorUsuario((err as Error).message);
  }

  const llave = await llaveDeFirma();
  const firmado = llave ? await firmarDte(doc.json, llave) : null;
  const { data: ins, error: eIns } = await admin.from("dist_dte").insert({
    emisor_id: e.id, ambiente, tipo, codigo_generacion: doc.codigoGeneracion, numero_control: doc.numeroControl,
    fec_emi: doc.fecEmi, hor_emi: doc.horEmi, cliente_id: c.id, pedido_id: p.id, total_pagar: doc.totalPagar,
    json: doc.json, firmado, estado: firmado ? (cont ? "contingencia" : "firmado") : "sin_firmar", creado_por: empleadoId,
  }).select("id").single();
  if (eIns) {
    // Dos clics a la vez: el índice único por pedido deja entrar a uno solo.
    if (eIns.code === "23505") throw new ErrorUsuario("este pedido ya se está facturando", 409);
    throw new Error(`guardar DTE: ${eIns.message}`);
  }
  const { error: ePed } = await admin.from("dist_pedidos")
    .update({ estado: "facturado", dte_id: ins.id }).eq("id", p.id).eq("estado", "confirmado");
  if (ePed) throw new Error(`marcar el pedido: ${ePed.message}`);
  // Las unidades quedan atadas a ESTE documento: si se invalida, vuelven.
  const { error: eAsg } = await admin.from("dist_lote_asignaciones")
    .update({ dte_id: ins.id }).eq("pedido_id", p.id).is("devuelta_at", null).is("dte_id", null);
  if (eAsg) throw new Error(`atar los lotes al documento: ${eAsg.message}`);

  if (p.reemplaza_dte_id) {
    // Este documento corrige a uno sellado: el original se invalida citando a
    // éste (CAT-024 tipo 1). Se prepara ya; sale hacia Hacienda cuando éste
    // tenga su sello (Hacienda tiene que conocer al reemplazo primero).
    await prepararInvalidacion(admin, p.reemplaza_dte_id, 1, "Se corrigió la información del documento.", ins.id, empleadoId);
  }
  // En contingencia no se transmite todavía: va con el aviso.
  const envio = cont
    ? { estado: firmado ? "contingencia" : "sin_firmar", aviso: "Emitido en contingencia: sale a Hacienda con el aviso de contingencia." }
    : await transmitirDte(admin, ins.id);
  return { dte_id: ins.id, tipo, numero_control: doc.numeroControl, codigo_generacion: doc.codigoGeneracion, total: doc.totalPagar, ...envio };
}

// ── Nota de Crédito por una devolución (borrador 0017) ─────────────────────
// La base valida y aparta (`dist_preparar_devolucion`, con la sesión de quien
// devuelve: el permiso y la firma son suyos); acá se arma, se firma y se
// guarda la nota; después la base mueve inventario y cuenta
// (`dist_aplicar_devolucion`) y recién entonces se transmite. Si algo falla
// antes de guardar la nota, la devolución queda «preparada» y un reintento con
// el mismo `client_uuid` la rehace: no hay número reservado de balde porque el
// correlativo se pide después de validar.
async function notaCredito(admin: Admin, comoUsuario: Admin, empleadoId: string, cuerpo: any) {
  const dteId = Number(cuerpo.dte_id);
  const uuid = String(cuerpo.client_uuid ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw new ErrorUsuario("Falta el identificador de la devolución.");
  const renglonesPedidos = Array.isArray(cuerpo.renglones) ? cuerpo.renglones : [];
  const { data: prep, error: eP } = await comoUsuario.rpc("dist_preparar_devolucion", {
    p_dte: dteId, p_client_uuid: uuid, p_motivo: String(cuerpo.motivo ?? ""), p_renglones: renglonesPedidos,
  });
  if (eP) {
    if (/DIST_[A-Z_]+:/.test(eP.message)) throw new ErrorUsuario(eP.message, 409);
    throw new Error(`preparar la devolución: ${eP.message}`);
  }
  const pr = prep as any;
  if (pr.ya_emitida) return { devolucion_id: pr.devolucion_id, dte_id: pr.nota_id, ...(await transmitirDte(admin, pr.nota_id)) };

  const o = pr.origen;
  const [emi, cli] = await Promise.all([
    admin.from("dist_emisores").select("*").eq("id", o.emisor_id).single(),
    admin.from("dist_clientes").select("*").eq("id", o.cliente_id).single(),
  ]);
  for (const r of [emi, cli]) if (r.error) throw new Error(r.error.message);
  const e = emi.data!, c = cli.data!;
  const relacionado = String(o.codigo_generacion).toUpperCase();
  // Por unidad y con IVA, como se guardó el precio al vender (borrador 0007).
  const renglones: Renglon[] = (pr.renglones as any[]).map((x) => ({
    codigo: String(x.product_id), descripcion: x.descripcion, uniMedida: 59,
    cantidad: String(x.unidades), precio: String(x.precio_unitario), precioIncluyeIva: true,
    descuento: String(x.descuento), numeroDocumento: relacionado,
  }));
  const ambiente = o.ambiente as Ambiente;
  const anio = Number(new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 4));
  const { data: correlativo, error: eCor } = await admin.rpc("dist_siguiente_correlativo", {
    p_emisor: e.id, p_ambiente: ambiente, p_tipo: TIPO_DTE.NOTA_CREDITO,
    p_establecimiento: e.establecimiento, p_punto_venta: e.punto_venta, p_anio: anio,
  });
  if (eCor) throw new Error(`correlativo: ${eCor.message}`);
  let doc;
  try {
    doc = armarNotaCredito({
      ambiente, emisor: emisorDe(e), correlativo: correlativo as number, receptor: receptorDe(c), renglones,
      condicion: Number(o.condicion) || 1,
      // La misma retención y percepción que el Crédito Fiscal que corrige.
      opciones: { retiene1: !!c.gran_contribuyente, percibe1: !!e.gran_contribuyente && !c.gran_contribuyente },
      observaciones: `Devolución: ${String(cuerpo.motivo ?? "").trim()}`.slice(0, 3000),
      documentoRelacionado: [{ tipoDocumento: TIPO_DTE.CCF, numeroDocumento: relacionado, fechaEmision: o.fec_emi }],
    });
  } catch (err) {
    throw new ErrorUsuario((err as Error).message);
  }
  const llave = await llaveDeFirma();
  const firmado = llave ? await firmarDte(doc.json, llave) : null;
  const { data: ins, error: eIns } = await admin.from("dist_dte").insert({
    emisor_id: e.id, ambiente, tipo: TIPO_DTE.NOTA_CREDITO, codigo_generacion: doc.codigoGeneracion, numero_control: doc.numeroControl,
    fec_emi: doc.fecEmi, hor_emi: doc.horEmi, cliente_id: c.id, pedido_id: null, relacionado_id: o.id, total_pagar: doc.totalPagar,
    json: doc.json, firmado, estado: firmado ? "firmado" : "sin_firmar", creado_por: empleadoId,
  }).select("id").single();
  if (eIns) throw new Error(`guardar la nota: ${eIns.message}`);
  const { data: apl, error: eA } = await admin.rpc("dist_aplicar_devolucion", { p_devolucion: pr.devolucion_id, p_nota: ins.id });
  if (eA) throw new Error(`aplicar la devolución: ${eA.message}`);
  const envio = await transmitirDte(admin, ins.id);
  return {
    devolucion_id: pr.devolucion_id, dte_id: ins.id, tipo: TIPO_DTE.NOTA_CREDITO, numero_control: doc.numeroControl,
    total: doc.totalPagar, ...(apl as Record<string, unknown>), ...envio,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "método no permitido" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const empleado = await requireActiveEmployeeUser(req, admin);
  if (!empleado) return json(req, 401, { error: "Sesión inválida o empleado inactivo" });

  // El permiso lo decide la base, con la sesión de quien llama.
  const comoUsuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization")! } },
  });
  const { data: puede, error: ePerm } = await comoUsuario.rpc("auth_can_edit_any", { p_modules: ["distribucion"] });
  if (ePerm) return json(req, 500, { error: `permiso: ${ePerm.message}` });
  if (!puede) return json(req, 403, { error: "No tienes permiso para facturar en distribución" });

  let cuerpo: any;
  try { cuerpo = await req.json(); } catch { return json(req, 400, { error: "cuerpo inválido" }); }

  try {
    if (cuerpo?.accion === "facturar" && Number.isInteger(cuerpo.pedido_id)) {
      return json(req, 200, await facturar(admin, cuerpo.pedido_id, empleado.id, leerContingencia(cuerpo.contingencia)));
    }
    if (cuerpo?.accion === "descartar" && Number.isInteger(cuerpo.dte_id)) {
      return json(req, 200, { dte_id: cuerpo.dte_id, ...(await descartar(admin, cuerpo.dte_id)) });
    }
    if (cuerpo?.accion === "corregir_sellado" && Number.isInteger(cuerpo.dte_id)) {
      return json(req, 200, await corregirSellado(admin, cuerpo.dte_id, empleado.id));
    }
    if (cuerpo?.accion === "anular_venta" && Number.isInteger(cuerpo.dte_id)) {
      const tipo = cuerpo.tipo === 3 ? 3 : 2;
      const motivo = typeof cuerpo.motivo === "string" ? cuerpo.motivo.trim() : "";
      if (!motivo) throw new ErrorUsuario("Escribe por qué se deshace la venta.");
      await prepararInvalidacion(admin, cuerpo.dte_id, tipo, motivo, null, empleado.id);
      return json(req, 200, { dte_id: cuerpo.dte_id, ...(await enviarInvalidacion(admin, cuerpo.dte_id)) });
    }
    if (cuerpo?.accion === "enviar_invalidacion" && Number.isInteger(cuerpo.dte_id)) {
      return json(req, 200, { dte_id: cuerpo.dte_id, ...(await enviarInvalidacion(admin, cuerpo.dte_id)) });
    }
    if (cuerpo?.accion === "enviar_contingencia") {
      return json(req, 200, await enviarContingencia(admin, empleado.id));
    }
    if (cuerpo?.accion === "nota_credito" && Number.isInteger(cuerpo.dte_id)) {
      return json(req, 200, await notaCredito(admin, comoUsuario, empleado.id, cuerpo));
    }
    if (cuerpo?.accion === "transmitir" && Number.isInteger(cuerpo.dte_id)) {
      return json(req, 200, { dte_id: cuerpo.dte_id, ...(await transmitirDte(admin, cuerpo.dte_id)) });
    }
    return json(req, 400, { error: "acción desconocida" });
  } catch (e) {
    if (e instanceof ErrorUsuario) return json(req, e.status, { error: e.message });
    console.error("distribucion-dte", e);
    return json(req, 500, { error: (e as Error).message });
  }
});
