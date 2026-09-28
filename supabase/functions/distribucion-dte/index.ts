// distribucion-dte — el emisor de DTE de la S.A.S. de distribución.
//
// Acciones (POST JSON, con la sesión del usuario — verify_jwt ON):
//   { accion: "facturar",   pedido_id }  arma, firma, guarda y transmite
//   { accion: "transmitir", dte_id }     reintenta uno que quedó sin firmar o sin enviar
//   { accion: "descartar",  dte_id }     retira uno que Hacienda NO tiene, para corregir el pedido
//   { accion: "corregir_sellado", dte_id }        abre un pedido nuevo que lo reemplaza e invalida
//   { accion: "anular_venta", dte_id, motivo }    invalida un sellado sin reemplazo (se deshizo la venta)
//   { accion: "enviar_invalidacion", dte_id }     reintenta una invalidación pendiente
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
  armarCreditoFiscal, armarFactura, totalAPagar,
  type DatosVenta, type Emisor, type Receptor, type Renglon,
} from "../_shared/dte/documentos.ts";
import { TIPO_DTE, VERSION, type Ambiente, type TipoDte } from "../_shared/dte/catalogos.ts";
import { claveCoincide, firmarDte, importarLlavePrivada, leerCertificadoMH } from "../_shared/dte/firma.ts";
import { armarInvalidacion } from "../_shared/dte/eventos.ts";
import {
  autenticar, consultar, ErrorHacienda, invalidar, tokenVigente, transmitirConReintentos,
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

async function transmitirDte(admin: Admin, dteId: number) {
  const { data: dte, error } = await admin.from("dist_dte")
    .select("id, emisor_id, ambiente, tipo, codigo_generacion, json, firmado, estado, pedido_id, intentos")
    .eq("id", dteId).single();
  if (error) throw new Error(`leer DTE: ${error.message}`);
  if (dte.estado === "sellado" || dte.estado === "invalidado") return { estado: dte.estado };
  if (dte.estado === "rechazado") throw new ErrorUsuario("este documento fue rechazado: hay que emitir uno nuevo");

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
    .select("product_id, cantidad, descuento, descripcion").eq("pedido_id", d.pedido_id);
  if (eI) throw new Error(`leer productos: ${eI.message}`);
  const { error: eIns } = await admin.from("dist_pedido_items").insert(
    (its ?? []).map((i: any) => ({ ...i, pedido_id: nuevo.id, precio_sin_iva: 0 })));
  if (eIns) throw new ErrorUsuario(`No se pudieron copiar los productos: ${eIns.message}`);
  return { pedido_id: nuevo.id };
}

// ── Facturar un pedido ──────────────────────────────────────────────────────

async function facturar(admin: Admin, pedidoId: number, empleadoId: string) {
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
    admin.from("dist_pedido_items").select("product_id, cantidad, precio_sin_iva, descuento, descripcion").eq("pedido_id", pedidoId).order("id"),
    admin.from("dist_pagos").select("id, orden, forma, monto, referencia").eq("pedido_id", pedidoId).order("orden"),
  ]);
  for (const r of [emi, cli, its, pag]) if (r.error) throw new Error(r.error.message);
  const e = emi.data!, c = cli.data!;
  if (!e.activo) throw new ErrorUsuario("el emisor está desactivado");
  if (!its.data!.length) throw new ErrorUsuario("el pedido no tiene productos");

  // El documento lo eligió quien vendió; si no eligió, el de la ficha. Un
  // Crédito Fiscal sin NRC no se emite aunque el pedido lo diga.
  const tipo: TipoDte = (p.tipo_documento as TipoDte | null) ?? (c.contribuyente ? TIPO_DTE.CCF : TIPO_DTE.FACTURA);
  if (tipo === TIPO_DTE.CCF && !c.contribuyente) {
    throw new ErrorUsuario("Este cliente no tiene NRC: sólo se le puede emitir Factura.");
  }
  const renglones: Renglon[] = its.data!.map((i: any) => ({
    codigo: String(i.product_id), descripcion: i.descripcion,
    cantidad: String(i.cantidad), precio: String(i.precio_sin_iva), precioIncluyeIva: false,
    descuento: String(i.descuento),
  }));

  const ambiente = e.ambiente as Ambiente;
  const anio = Number(new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 4));
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
  await resolverPagos(admin, p, c, pag.data ?? [], total, { soloValidar: true });
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
    doc = armar({ ...base, pagos });
  } catch (err) {
    throw new ErrorUsuario((err as Error).message);
  }

  const llave = await llaveDeFirma();
  const firmado = llave ? await firmarDte(doc.json, llave) : null;
  const { data: ins, error: eIns } = await admin.from("dist_dte").insert({
    emisor_id: e.id, ambiente, tipo, codigo_generacion: doc.codigoGeneracion, numero_control: doc.numeroControl,
    fec_emi: doc.fecEmi, hor_emi: doc.horEmi, cliente_id: c.id, pedido_id: p.id, total_pagar: doc.totalPagar,
    json: doc.json, firmado, estado: firmado ? "firmado" : "sin_firmar", creado_por: empleadoId,
  }).select("id").single();
  if (eIns) {
    // Dos clics a la vez: el índice único por pedido deja entrar a uno solo.
    if (eIns.code === "23505") throw new ErrorUsuario("este pedido ya se está facturando", 409);
    throw new Error(`guardar DTE: ${eIns.message}`);
  }
  const { error: ePed } = await admin.from("dist_pedidos")
    .update({ estado: "facturado", dte_id: ins.id }).eq("id", p.id).eq("estado", "confirmado");
  if (ePed) throw new Error(`marcar el pedido: ${ePed.message}`);

  if (p.reemplaza_dte_id) {
    // Este documento corrige a uno sellado: el original se invalida citando a
    // éste (CAT-024 tipo 1). Se prepara ya; sale hacia Hacienda cuando éste
    // tenga su sello (Hacienda tiene que conocer al reemplazo primero).
    await prepararInvalidacion(admin, p.reemplaza_dte_id, 1, "Se corrigió la información del documento.", ins.id, empleadoId);
  }
  const envio = await transmitirDte(admin, ins.id);
  return { dte_id: ins.id, tipo, numero_control: doc.numeroControl, codigo_generacion: doc.codigoGeneracion, total: doc.totalPagar, ...envio };
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
      return json(req, 200, await facturar(admin, cuerpo.pedido_id, empleado.id));
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
