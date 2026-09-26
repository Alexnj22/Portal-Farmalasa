// distribucion-dte — el emisor de DTE de la S.A.S. de distribución.
//
// Acciones (POST JSON, con la sesión del usuario — verify_jwt ON):
//   { accion: "facturar",   pedido_id }  arma, firma, guarda y transmite
//   { accion: "transmitir", dte_id }     reintenta uno que quedó sin firmar o sin enviar
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
import {
  autenticar, ErrorHacienda, tokenVigente, transmitirConReintentos,
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

  if (!sellado && dte.pedido_id) {
    // Rechazado: el pedido vuelve a estar por facturar. El DTE rechazado queda
    // como constancia; el que se emita después lleva otro código y número.
    const { error: e4 } = await admin.from("dist_pedidos")
      .update({ estado: "confirmado", dte_id: null }).eq("id", dte.pedido_id).eq("dte_id", dteId);
    if (e4) throw new Error(`devolver el pedido: ${e4.message}`);
  }
  return { estado: cambios.estado, sello: cambios.sello_recibido, mensaje: r.descripcionMsg, observaciones: r.observaciones };
}

// ── Facturar un pedido ──────────────────────────────────────────────────────

async function facturar(admin: Admin, pedidoId: number, empleadoId: string) {
  const { data: p, error } = await admin.from("dist_pedidos")
    .select("id, emisor_id, cliente_id, estado, condicion, forma_pago, plazo_dias, observaciones, dte_id")
    .eq("id", pedidoId).maybeSingle();
  if (error) throw new Error(`leer el pedido: ${error.message}`);
  if (!p) throw new ErrorUsuario("no existe ese pedido", 404);
  if (p.estado !== "confirmado") {
    if (p.dte_id) return { dte_id: p.dte_id, ...(await transmitirDte(admin, p.dte_id)) };
    throw new ErrorUsuario(`el pedido está ${p.estado}`);
  }

  const [emi, cli, its] = await Promise.all([
    admin.from("dist_emisores").select("*").eq("id", p.emisor_id).single(),
    admin.from("dist_clientes").select("*").eq("id", p.cliente_id).single(),
    admin.from("dist_pedido_items").select("product_id, cantidad, precio_sin_iva, descuento, descripcion").eq("pedido_id", pedidoId).order("id"),
  ]);
  for (const r of [emi, cli, its]) if (r.error) throw new Error(r.error.message);
  const e = emi.data!, c = cli.data!;
  if (!e.activo) throw new ErrorUsuario("el emisor está desactivado");
  if (!its.data!.length) throw new ErrorUsuario("el pedido no tiene productos");

  const tipo: TipoDte = c.contribuyente ? TIPO_DTE.CCF : TIPO_DTE.FACTURA;
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
  const { data: correlativo, error: eCor } = await admin.rpc("dist_siguiente_correlativo", {
    p_emisor: e.id, p_ambiente: ambiente, p_tipo: tipo,
    p_establecimiento: e.establecimiento, p_punto_venta: e.punto_venta, p_anio: anio,
  });
  if (eCor) throw new Error(`correlativo: ${eCor.message}`);

  const base: Omit<DatosVenta, "pagos"> = {
    ambiente, emisor: emisorDe(e), correlativo: correlativo as number, receptor: receptorDe(c), renglones,
    condicion: p.condicion, opciones, observaciones: p.observaciones,
  };
  const armar = tipo === TIPO_DTE.CCF ? armarCreditoFiscal : armarFactura;
  const pago = p.condicion === 2
    ? { codigo: p.forma_pago === "01" ? "13" : p.forma_pago, monto: total, plazo: "01", periodo: p.plazo_dias }
    : { codigo: p.forma_pago, monto: total };
  let doc;
  try {
    doc = armar({ ...base, pagos: [pago] });
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
