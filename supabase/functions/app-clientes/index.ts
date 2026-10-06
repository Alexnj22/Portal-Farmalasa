// ─── La app de clientes ─────────────────────────────────────────────────────
//
// La puerta del teléfono del CLIENTE. Hermana de `mis-puntos`, con una
// diferencia que lo cambia todo: aquélla pide documento + teléfono en cada
// consulta; ésta los pide UNA vez y devuelve una sesión.
//
// ── La sesión ───────────────────────────────────────────────────────────────
// Un token opaco de 32 bytes que vive en el llavero del teléfono. En la base
// sólo queda su HUELLA (`app_cliente_sesiones.token_hash`): una copia de la
// tabla no sirve para entrar. Caduca a los 180 días sin uso, la revoca «Cerrar
// sesión» o «Borrar mi cuenta», y la sala puede revocarla al descartar un
// pre-registro. El `customer_id` sale SIEMPRE de la sesión, nunca del cuerpo:
// nadie consulta otra ficha cambiando un número.
//
// ── Las mismas tres reglas que `mis-puntos` ─────────────────────────────────
//   1. Freno por IP (`puntos_consulta_registrar`): el mismo contador, así que
//      probar en la web y en la app suma contra el mismo tope.
//   2. «No encontrado» es una sola respuesta para todo lo que no coincidió.
//   3. El documento no se archiva en el registro de intentos, sólo su huella.
//
// ── El pre-registro ─────────────────────────────────────────────────────────
// Quien no tiene ficha puede dejar sus datos. NO se crea la ficha: nace en el
// sistema de la caja cuando la sala lo registra, y la siguiente consulta de la
// app la encuentra sola con el MISMO documento y teléfono (`vincularSiSePuede`).
// Mientras tanto la app muestra «tu registro está pendiente».
//
// ── Lo que NO hace, a propósito ─────────────────────────────────────────────
// No canjea puntos, no edita la ficha, no devuelve el documento ni el teléfono.
// Todo lo que escribe es reversible o es del propio cliente: sus permisos, su
// aviso al teléfono, su sesión.
import { createClient } from "npm:@supabase/supabase-js@2";
import { TEXTOS_CONSENTIMIENTO as TEXTOS } from "../_shared/consentimientoPuntos.ts";
import { clienteDelEnlace, enlaceDePase, paseDeCliente } from "../_shared/pase.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOPE_FALLOS = 8;
const TOPE_FALLOS_CODIGO = 5;
const ES_CODIGO = /^[ACDEFGHJKMNPQRTUVWXY34679]{7}$/;
const DIAS_SESION = 180;
const POR_PAGINA_INICIAL = 10;
const POR_PAGINA = 20;

// Las condiciones de la reserva, tal como las lee el cliente. Cambiar el texto
// exige cambiar la `version`: la app vuelve a pedir que las acepte y cada
// reserva guarda la versión que aceptó.
const TERMINOS_RESERVA = {
  version: "2026-10-06",
  titulo: "Así funciona tu reserva",
  puntos: [
    "Por ahora puedes reservar productos que estén en oferta.",
    "Te avisamos cuando la sucursal la tenga lista. Desde ese aviso tienes 24 horas para retirarla.",
    "El precio de oferta vale si la retiras dentro de las fechas de la oferta.",
    "Puedes tener hasta 3 reservas activas y hasta 5 unidades por producto.",
    "Si no la retiras a tiempo, el producto vuelve a la venta. Con 3 reservas sin retirar en 30 días, no podrás reservar por 30 días.",
    "Los productos bajo receta no se reservan.",
    "Pagas al retirar, en la sucursal.",
  ],
};

// Cómo se llama cada sucursal PARA EL CLIENTE (decisión del usuario,
// 2026-10-06): el barrio, no el número interno. Lo demás pasa tal cual.
const NOMBRE_SUCURSAL: Record<string, string> = {
  "Salud 1": "Salud - San Antonio",
  "Salud 2": "Salud - El Calvario",
  "Salud 3": "Salud - Totolco",
  "Salud 4": "Salud - El Paraíso",
  "Salud 5": "Salud - Nueva Concepción",
};
const sucursal = (n: unknown) => (n == null ? n : NOMBRE_SUCURSAL[String(n)] ?? String(n));
// deno-lint-ignore no-explicit-any
const conSucursal = (x: any): any =>
  Array.isArray(x) ? x.map(conSucursal)
  : x && typeof x === "object"
    ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === "sala" ? sucursal(v) : conSucursal(v)]))
    : x;

// Las MUESTRAS de una ficha (`app_cliente_muestras`, 2026-10-06): ofertas,
// inyecciones y vencimientos de muestra que sólo ve esa persona, para revisar
// el diseño con datos que producción no tiene. Nunca tumban la respuesta: si
// no se pueden leer, la app se ve con lo real y nada más.
// deno-lint-ignore no-explicit-any
async function muestrasDe(admin: any, customerId: number | null, tipo: string): Promise<any[]> {
  if (!customerId) return [];
  const { data, error } = await admin.from("app_cliente_muestras")
    .select("id, datos").eq("customer_id", customerId).eq("tipo", tipo).order("id");
  if (error) { console.error("no se pudieron leer las muestras:", error.message); return []; }
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((m: any) => ({ id: m.id, ...m.datos }));
}
const VERSION_AVISO = `${TEXTOS.version} · ${TEXTOS.aviso}`;

// Para el alta que no se puede hacer desde la app (el documento ya tiene un
// registro pendiente con otro teléfono). No dice por qué: confirmar que ese
// documento está registrado sería regalar el dato.
const NO_SE_PUDO_REGISTRAR = {
  ok: false,
  motivo: "no_se_pudo",
  mensaje: "No pudimos registrarte desde la app. Pasa a cualquiera de nuestras salas y te ayudamos.",
};

/** 'AAAA-MM-DD' de una fecha REAL entre 1900 y hoy; null si viene vacía; false si es inválida. */
function fechaDeNacimiento(v: unknown): string | null | false {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const real = d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  if (!real || +m[1] < 1900 || d.getTime() > Date.now()) return false;
  return t;
}

const NO_ENCONTRADO = {
  ok: false,
  motivo: "no_encontrado",
  mensaje: "No encontramos ese registro. Revisa los datos.",
};

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Misma huella que `mis-puntos`, para que el freno cuente igual en las dos.
const huellaDoc = async (doc: string) => (await sha256(`puntos:${doc}`)).slice(0, 32);

function tokenNuevo(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Hoy en El Salvador (UTC-6, sin horario de verano).
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

const limpiarDoc = (v: unknown) => String(v ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const limpiarTel = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const plataformaValida = (p: unknown) => (["ios", "android", "web"].includes(String(p)) ? String(p) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  // La tarjeta de Wallet: Safari abre este enlace (lo da la acción
  // `wallet_enlace`, firmado y válido 10 min) y ofrece «Agregar a Wallet».
  const enlaceWallet = req.method === "GET" ? new URL(req.url).searchParams.get("wallet") : null;
  if (req.method !== "POST" && !enlaceWallet) return json({ error: "solo POST" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // La tarjeta de Wallet de una ficha, firmada (ver `_shared/pase.ts`).
  const paseDe = async (id: number) => (await paseDeCliente(admin, id)).pase;


  if (enlaceWallet) {
    try {
      const id = await clienteDelEnlace(enlaceWallet);
      if (!id) return new Response("Este enlace ya venció. Vuelve a tocar «Agregar a Wallet» en la app.", { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      const pkpass = await paseDe(id);
      return new Response(pkpass, { headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": "attachment; filename=PuntosSalud.pkpass",
        "Cache-Control": "no-store",
      } });
    } catch (e) {
      console.error("[wallet]", (e as Error)?.message ?? e);
      return new Response("No se pudo crear la tarjeta.", { status: 500 });
    }
  }
  // La IP para el freno: la que pone Cloudflare (`cf-connecting-ip`), que el
  // cliente no puede falsear. Si no viene, el primer valor de
  // `x-forwarded-for`, igual que `mis-puntos`. El último no: puede ser un proxy
  // interno, y entonces TODOS los clientes compartirían un mismo tope.
  const ip = (req.headers.get("cf-connecting-ip")
    ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0]
    ?? "").trim() || "desconocida";
  const body = await req.json().catch(() => ({} as any));
  const accion = String(body?.accion ?? "");

  // ── El freno, compartido con `mis-puntos` ────────────────────────────────
  // Devuelve una Response si hay que cortar; si no, null.
  async function frenar(doc: string, esCodigo: boolean): Promise<Response | null> {
    const { data: fallos, error } = await admin.rpc("puntos_consulta_registrar", {
      p_ip: ip, p_huella_dui: await huellaDoc(doc), p_acerto: false,
    });
    if (error) {
      console.error("app-clientes: el freno no respondió:", error.message);
      return json({ ok: false, mensaje: "Servicio no disponible. Intenta en un rato." }, 503);
    }
    if (Number(fallos ?? 0) >= (esCodigo ? TOPE_FALLOS_CODIGO : TOPE_FALLOS)) {
      return json({ ok: false, motivo: "muchos_intentos", mensaje: "Demasiados intentos. Espera unos minutos." }, 429);
    }
    return null;
  }
  async function anotarAcierto(doc: string) {
    const { error } = await admin.rpc("puntos_consulta_registrar", {
      p_ip: ip, p_huella_dui: await huellaDoc(doc), p_acerto: true,
    });
    if (error) console.error("no se pudo anotar el acierto:", error.message);
  }

  async function buscarCliente(doc: string, tel: string) {
    const { data, error } = await admin.rpc("puntos_cliente_por_documento", {
      p_documento: doc, p_telefono: tel || null,
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] ?? null : null;
  }

  async function abrirSesion(fila: { customer_id?: number | null; preregistro_id?: string | null }) {
    const token = tokenNuevo();
    const { error } = await admin.from("app_cliente_sesiones").insert({
      customer_id: fila.customer_id ?? null,
      preregistro_id: fila.preregistro_id ?? null,
      token_hash: await sha256(token),
      plataforma: plataformaValida(body?.plataforma),
      dispositivo: body?.dispositivo ? String(body.dispositivo).slice(0, 80) : null,
    });
    if (error) throw error;
    return token;
  }

  async function guardarPermisos(customerId: number, programa: boolean | null, promociones: boolean | null) {
    const { data, error } = await admin.rpc("puntos_guardar_consentimiento", {
      p_customer_id: customerId,
      p_programa: programa,
      p_promociones: promociones,
      p_texto_programa: TEXTOS.programa,
      p_texto_promos: TEXTOS.promociones,
      p_version_aviso: VERSION_AVISO,
      p_identificado_por: "dui_telefono",
      p_origen: "app-clientes",
    });
    if (error) throw error;
    return data as any;
  }

  try {
    // ════════════════════════════════════════════════════════════════════
    // Sin sesión: entrar y registrarse.
    // ════════════════════════════════════════════════════════════════════
    if (accion === "entrar") {
      const doc = limpiarDoc(body?.documento);
      const tel = limpiarTel(body?.telefono);
      const esCodigo = ES_CODIGO.test(doc);
      if (doc.length < 7 || (!esCodigo && tel.length < 8)) return json(NO_ENCONTRADO);

      const corte = await frenar(doc, esCodigo);
      if (corte) return corte;

      const cli = await buscarCliente(doc, tel);
      if (cli) {
        await anotarAcierto(doc);
        return json({ ok: true, token: await abrirSesion({ customer_id: cli.id }) });
      }
      // ¿Se pre-registró con ESOS dos datos? Entonces vuelve a su pre-registro.
      if (!esCodigo) {
        const { data: pre, error } = await admin.from("app_cliente_preregistros")
          .select("id").eq("documento", doc).eq("telefono", tel).eq("estado", "pendiente").maybeSingle();
        if (error) throw error;
        if (pre) {
          await anotarAcierto(doc);
          return json({ ok: true, token: await abrirSesion({ preregistro_id: pre.id }) });
        }
      }
      return json(NO_ENCONTRADO);
    }

    if (accion === "registrar") {
      const doc = limpiarDoc(body?.documento);
      const tel = limpiarTel(body?.telefono);
      const nombre = String(body?.nombre ?? "").replace(/\s+/g, " ").trim();
      const email = String(body?.email ?? "").trim().toLowerCase() || null;
      const nacimiento = fechaDeNacimiento(body?.fecha_nacimiento);
      if (nacimiento === false) {
        return json({ ok: false, motivo: "datos", mensaje: "Revisa tu fecha de nacimiento." });
      }
      const aceptaPromos = body?.acepta_promociones === true;

      if (body?.acepta_programa !== true) {
        return json({ ok: false, motivo: "consentimiento", mensaje: "Para unirte hay que aceptar el programa." });
      }
      if (nombre.length < 3 || nombre.length > 120) {
        return json({ ok: false, motivo: "datos", mensaje: "Escribe tu nombre completo." });
      }
      if (doc.length < 7 || doc.length > 20 || ES_CODIGO.test(doc)) {
        return json({ ok: false, motivo: "datos", mensaje: "Revisa tu número de documento." });
      }
      if (tel.length < 8 || tel.length > 15) {
        return json({ ok: false, motivo: "datos", mensaje: "Revisa tu teléfono: son 8 dígitos." });
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ ok: false, motivo: "datos", mensaje: "Revisa tu correo." });
      }

      // El alta también pasa por el freno: sin él, la puerta se vuelve una
      // forma de llenar la tabla de basura o de probar documentos.
      const corte = await frenar(doc, false);
      if (corte) return corte;

      // ¿Ya es cliente? Entonces no hay nada que pre-registrar: entra.
      const cli = await buscarCliente(doc, tel);
      if (cli) {
        await anotarAcierto(doc);
        await guardarPermisos(cli.id, true, aceptaPromos);
        return json({ ok: true, token: await abrirSesion({ customer_id: cli.id }), ya_era_cliente: true });
      }

      // ¿Ya hay un pre-registro pendiente con ese documento?
      const { data: previo, error: ePrev } = await admin.from("app_cliente_preregistros")
        .select("id, telefono").eq("documento", doc).eq("estado", "pendiente").maybeSingle();
      if (ePrev) throw ePrev;
      if (previo) {
        // Mismo teléfono: es la misma persona volviendo, entra a su registro.
        // Otro teléfono: no se dice nada más — confirmar que ese documento
        // está registrado sería regalar el dato.
        if (previo.telefono !== tel) return json(NO_SE_PUDO_REGISTRAR);
        await anotarAcierto(doc);
        return json({ ok: true, token: await abrirSesion({ preregistro_id: previo.id }) });
      }

      const { data: nuevo, error: eIns } = await admin.from("app_cliente_preregistros").insert({
        nombre: nombre.toUpperCase(), documento: doc, telefono: tel, email, fecha_nacimiento: nacimiento,
        acepta_programa: true, acepta_promociones: aceptaPromos, version_aviso: VERSION_AVISO,
      }).select("id").single();
      if (eIns) throw eIns;
      // Llegó invitado: se anota quién lo invitó. El premio lo decide la base
      // (`puntos_premiar_referidos`) cuando haga su primera compra de $10.
      // Un código que no existe no frena el alta: se ignora.
      const ref = String(body?.referido ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (ref.length === 6) {
        const { data: quien, error: eR } = await admin.from("app_cliente_referido_codigo")
          .select("customer_id").eq("codigo", ref).maybeSingle();
        if (eR) console.error("no se pudo leer el código de invitación:", eR.message);
        if (quien) {
          const { error: eRef } = await admin.from("app_cliente_referidos")
            .insert({ referidor_id: quien.customer_id, preregistro_id: nuevo.id, codigo: ref });
          if (eRef) console.error("no se pudo anotar la invitación:", eRef.message);
        }
      }
      // A propósito NO se anota como acierto: cada alta nueva cuenta contra el
      // tope de la IP (8 en 15 min). Sin esto, desde un solo teléfono se podían
      // crear pre-registros sin límite con documentos ajenos.
      return json({ ok: true, token: await abrirSesion({ preregistro_id: nuevo.id }), pendiente: true });
    }

    if (accion === "textos") {
      return json({ ok: true, textos: { programa: TEXTOS.programa, promociones: TEXTOS.promociones } });
    }

    // Las ofertas vigentes. Con `customerId` null es la vitrina PÚBLICA (sin
    // cuenta, desde la bienvenida): lo exclusivo se anuncia sin detalle y no
    // hay muestras. Es el gancho para unirse (2026-10-06).
    // deno-lint-ignore no-explicit-any
    const ofertasPara = async (customerId: number | null): Promise<any> => {
      const hoy = hoySV();
      const { data: filas, error } = await admin.from("ofertas_clientes")
        .select("id, titulo, descripcion, etiqueta, condiciones, imagen_path, inicio, fin, exclusiva, branch_ids, descuento_tipo, descuento_monto, productos, acento")
        .eq("publicada", true).lte("inicio", hoy).gte("fin", hoy)
        .order("orden", { ascending: true }).order("fin", { ascending: true })
        .limit(50);
      if (error) throw error;

      let socio = false;
      if (customerId) {
        const { data: c, error: eC } = await admin.from("customers")
          .select("acepta_programa_puntos, acumula_puntos").eq("id", customerId).maybeSingle();
        if (eC) throw eC;
        socio = c?.acepta_programa_puntos !== false && c?.acumula_puntos !== false;
      }
      const { data: salas, error: eB } = await admin.from("branches").select("id, name");
      if (eB) console.error("no se pudieron leer las salas:", eB.message);
      const nombreSala = new Map((salas ?? []).map((b: any) => [b.id, sucursal(b.name)]));

      // Firmadas en UNA llamada y por 12 horas: firmar una por una costaba una
      // petición a Storage por oferta en cada apertura, y una URL nueva cada vez
      // hacía que el teléfono volviera a bajar la misma foto.
      const muestras = await muestrasDe(admin, customerId, "oferta");
      const rutas = [...(filas ?? []), ...muestras].map((o: any) => o.imagen_path).filter(Boolean);
      const firmadas = new Map<string, string>();
      if (rutas.length) {
        const { data: fs, error: eF } = await admin.storage.from("ofertas-clientes").createSignedUrls(rutas, 12 * 3600);
        if (eF) console.error("no se pudieron firmar las imágenes:", eF.message);
        for (const f of fs ?? []) if (f.path && f.signedUrl) firmadas.set(f.path, f.signedUrl);
      }
      const ofertas = (filas ?? []).map((o: any) => {
        const imagen = o.imagen_path ? firmadas.get(o.imagen_path) ?? null : null;
        const disponible = !o.exclusiva || socio;
        return {
          id: o.id, titulo: o.titulo, etiqueta: o.etiqueta, imagen, inicio: o.inicio, fin: o.fin, acento: o.acento ?? "magenta",
          exclusiva: o.exclusiva, disponible,
          // Lo exclusivo se ANUNCIA a quien no es socio —es la invitación a
          // serlo— pero el detalle sólo lo ve quien puede usarlo.
          descripcion: disponible ? o.descripcion : null,
          condiciones: disponible ? o.condiciones : null,
          // La oferta de un descuento de la caja: qué rebaja y en qué productos,
          // con el precio antes y después. Lo exclusivo no lo muestra a quien no
          // es socio, igual que el texto.
          descuento: o.descuento_tipo ? { tipo: o.descuento_tipo, monto: Number(o.descuento_monto) } : null,
          productos: disponible && Array.isArray(o.productos) ? o.productos : [],
          salas: Array.isArray(o.branch_ids) && o.branch_ids.length
            ? o.branch_ids.map((id: number) => nombreSala.get(id)).filter(Boolean) : null,
        };
      });
      for (const m of muestras) {
        const disponible = !m.exclusiva || socio;
        ofertas.push({
          id: `muestra-${m.id}`, titulo: m.titulo, etiqueta: m.etiqueta ?? null,
          imagen: m.imagen_path ? firmadas.get(m.imagen_path) ?? null : null,
          inicio: m.inicio, fin: m.fin, acento: m.acento ?? "magenta", exclusiva: !!m.exclusiva, disponible,
          descripcion: disponible ? m.descripcion ?? null : null,
          condiciones: disponible ? m.condiciones ?? null : null,
          descuento: m.descuento ?? null,
          productos: disponible && Array.isArray(m.productos) ? m.productos : [],
          salas: Array.isArray(m.salas) && m.salas.length ? m.salas.map(sucursal) : null,
        });
      }
      return { ok: true, ofertas, socio };
    };

    if (accion === "ofertas_publicas") return json(await ofertasPara(null));

    // Las HISTORIAS (carrusel tipo estados): vigentes y publicadas, con la foto
    // firmada. Con ficha, se suman sus muestras.
    // deno-lint-ignore no-explicit-any
    const historiasPara = async (customerId: number | null): Promise<any> => {
      const hoy = hoySV();
      const { data: filas, error } = await admin.from("app_historias")
        .select("id, titulo, texto, imagen_path, enlace, boton, inicio, fin")
        .eq("publicada", true).lte("inicio", hoy).gte("fin", hoy)
        .order("orden", { ascending: true }).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      const muestras = await muestrasDe(admin, customerId, "historia");
      const todas = [...(filas ?? []), ...muestras.map((m) => ({ ...m, id: `muestra-${m.id}` }))];
      const rutas = todas.map((h) => h.imagen_path).filter(Boolean);
      const firmadas = new Map<string, string>();
      if (rutas.length) {
        const { data: fs, error: eF } = await admin.storage.from("ofertas-clientes").createSignedUrls(rutas, 12 * 3600);
        if (eF) console.error("no se pudieron firmar las historias:", eF.message);
        for (const f of fs ?? []) if (f.path && f.signedUrl) firmadas.set(f.path, f.signedUrl);
      }
      return {
        ok: true,
        historias: todas.filter((h) => firmadas.has(h.imagen_path)).map((h) => ({
          id: h.id, titulo: h.titulo, texto: h.texto ?? null, imagen: firmadas.get(h.imagen_path),
          enlace: h.enlace ?? null, boton: h.boton ?? null, fin: h.fin,
        })),
      };
    };
    if (accion === "historias_publicas") return json(await historiasPara(null));

    // Las salas: dirección, teléfonos y horario, y si está abierta AHORA (hora
    // de El Salvador). Pública: se ve también sin cuenta.
    if (accion === "salas") {
      const { data, error } = await admin.from("branches")
        .select("id, name, address, phone, cell, weekly_hours").eq("type", "FARMACIA").order("name");
      if (error) throw error;
      const sv = new Date(Date.now() - 6 * 3600_000);
      const dia = sv.getUTCDay();
      const ahora = sv.getUTCHours() * 60 + sv.getUTCMinutes();
      const minutos = (h: string) => { const m = String(h ?? "").match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
      // deno-lint-ignore no-explicit-any
      const salas = (data ?? []).map((b: any) => {
        const horas = b.weekly_hours ?? {};
        // deno-lint-ignore no-explicit-any
        const horario = [0, 1, 2, 3, 4, 5, 6].map((d) => { const h: any = horas[d] ?? horas[String(d)] ?? {}; return {
          dia: d, abre: h.isOpen ? String(h.start ?? "").slice(0, 5) : null, cierra: h.isOpen ? String(h.end ?? "").slice(0, 5) : null,
        }; });
        const hoy = horario[dia];
        const a = minutos(hoy.abre ?? ""), c = minutos(hoy.cierra ?? "");
        return {
          id: b.id, nombre: sucursal(b.name), direccion: b.address, telefono: b.phone, celular: b.cell, horario,
          abierta: a != null && c != null && ahora >= a && ahora < c,
          cierra_hoy: hoy.cierra, abre_hoy: hoy.abre,
        };
      });
      return json({ ok: true, salas });
    }

    // ════════════════════════════════════════════════════════════════════
    // Con sesión.
    // ════════════════════════════════════════════════════════════════════
    const token = String(body?.token ?? "");
    if (token.length < 30) return json({ ok: false, motivo: "sin_sesion" }, 401);
    const hash = await sha256(token);
    const { data: ses, error: eSes } = await admin.from("app_cliente_sesiones")
      .select("id, customer_id, preregistro_id, ultimo_uso_at, revocada_at, acepta_avisos")
      .eq("token_hash", hash).maybeSingle();
    if (eSes) throw eSes;
    const vencida = ses && Date.now() - new Date(ses.ultimo_uso_at).getTime() > DIAS_SESION * 86400_000;
    if (!ses || ses.revocada_at || vencida) return json({ ok: false, motivo: "sin_sesion" }, 401);

    // El uso se anota a lo sumo una vez por hora: anotar cada consulta sería
    // una escritura por pantalla abierta, que es justo el churn que no se quiere.
    if (Date.now() - new Date(ses.ultimo_uso_at).getTime() > 3600_000) {
      const { error } = await admin.from("app_cliente_sesiones")
        .update({ ultimo_uso_at: new Date().toISOString() }).eq("id", ses.id);
      if (error) console.error("no se pudo anotar el uso:", error.message);
    }

    // Un pre-registro se vincula solo el día que la sala crea la ficha con el
    // mismo documento y teléfono. La búsqueda de la ficha recorre `customers`,
    // así que se intenta sólo al pedir el RESUMEN (al abrir la app), no en cada
    // pantalla.
    let customerId: number | null = ses.customer_id;
    if (!customerId && ses.preregistro_id) {
      const { data: pre, error } = await admin.from("app_cliente_preregistros")
        .select("id, documento, telefono, estado, customer_id, acepta_promociones")
        .eq("id", ses.preregistro_id).maybeSingle();
      if (error) throw error;
      if (!pre || pre.estado === "descartado") return json({ ok: false, motivo: "sin_sesion" }, 401);
      if (pre.estado === "vinculado" && pre.customer_id) {
        customerId = pre.customer_id;
      } else if (accion === "resumen") {
        const cli = await buscarCliente(pre.documento, pre.telefono);
        if (cli) {
          customerId = cli.id;
          const { error: eV } = await admin.from("app_cliente_preregistros")
            .update({ estado: "vinculado", customer_id: cli.id, resuelto_at: new Date().toISOString() })
            .eq("id", pre.id).eq("estado", "pendiente");
          if (eV) throw eV;
          await guardarPermisos(cli.id, true, pre.acepta_promociones);
        }
      }
      if (customerId) {
        const { error: eS } = await admin.from("app_cliente_sesiones")
          .update({ customer_id: customerId }).eq("preregistro_id", ses.preregistro_id).is("customer_id", null);
        if (eS) throw eS;
      }
    }

    // ── Cerrar sesión / borrar cuenta: valen también sin ficha ─────────────
    if (accion === "salir") {
      const { error } = await admin.from("app_cliente_sesiones")
        .update({ revocada_at: new Date().toISOString(), push_token: null }).eq("id", ses.id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (accion === "borrar_cuenta") {
      // La cuenta de la app es la sesión, los avisos y el pre-registro. La
      // FICHA no se borra: es un registro fiscal que la ley obliga a guardar, y
      // la sala la usa para facturar. Lo que el cliente sí decide sobre ella
      // —sus permisos— se puede retirar en el mismo gesto (`retirar_permisos`).
      const ahora = new Date().toISOString();
      if (customerId) {
        const { error } = await admin.from("app_cliente_sesiones")
          .update({ revocada_at: ahora, push_token: null, acepta_avisos: false })
          .eq("customer_id", customerId).is("revocada_at", null);
        if (error) throw error;
        if (body?.retirar_permisos === true) await guardarPermisos(customerId, false, false);
      }
      // El pre-registro se borra aunque ya esté VINCULADO: sus datos (nombre,
      // documento, teléfono, correo, nacimiento) ya viven en la ficha, y
      // guardarlos aparte después de «borrar mi cuenta» no tiene motivo.
      if (ses.preregistro_id) {
        const { error } = await admin.from("app_cliente_preregistros").delete().eq("id", ses.preregistro_id);
        if (error) throw error;
      }
      if (customerId) {
        const { error } = await admin.from("app_cliente_preregistros").delete().eq("customer_id", customerId);
        if (error) throw error;
      }
      const { error: eYo } = await admin.from("app_cliente_sesiones")
        .update({ revocada_at: ahora, push_token: null }).eq("id", ses.id);
      if (eYo) throw eYo;
      return json({ ok: true });
    }

    if (accion === "avisos") {
      const acepta = body?.acepta === true;
      const pushToken = acepta && body?.push_token ? String(body.push_token).slice(0, 200) : null;
      const { error } = await admin.from("app_cliente_sesiones")
        .update({ acepta_avisos: acepta, push_token: pushToken }).eq("id", ses.id);
      if (error) throw error;
      return json({ ok: true, acepta });
    }

    // ── Ofertas: las ve también quien está pendiente ──────────────────────
    if (accion === "ofertas") return json(await ofertasPara(customerId));
    if (accion === "historias") return json(await historiasPara(customerId));

    // ── Reservas de productos en oferta (2026-10-06) ──────────────────────
    // Reglas en TERMINOS_RESERVA (se muestran antes de la primera reserva y se
    // guardan con su versión). La sucursal las maneja desde el portal.
    if (accion === "reserva_terminos") return json({ ok: true, ...TERMINOS_RESERVA });

    if (accion === "reserva_existencias") {
      const productoId = Number(body?.producto_id);
      if (!productoId) return json({ ok: false, mensaje: "Producto inválido." }, 400);
      const { data, error } = await admin.rpc("app_cliente_existencias", { p_producto_id: productoId });
      if (error) throw error;
      return json({ ok: true, sucursales: conSucursal(data ?? []) });
    }

    if (accion === "mis_reservas" || accion === "reservar" || accion === "cancelar_reserva") {
      if (!customerId) return json({ ok: false, mensaje: "Completa tu registro en una sucursal para reservar." });
    }

    if (accion === "mis_reservas") {
      const { data, error } = await admin.from("app_reservas")
        .select("id, estado, producto_nombre, cantidad, precio_unitario, precio_normal, oferta_titulo, oferta_fin, branch_id, lista_at, vence_at, created_at, cerrada_at")
        .eq("customer_id", customerId).gte("created_at", new Date(Date.now() - 45 * 86400_000).toISOString())
        .order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      const { data: salas, error: eS } = await admin.from("branches").select("id, name");
      if (eS) throw eS;
      const nombre = new Map((salas ?? []).map((b: any) => [Number(b.id), sucursal(b.name)]));
      return json({ ok: true, reservas: (data ?? []).map((r: any) => ({ ...r, codigo: `R-${String(r.id).padStart(6, "0")}`, sala: nombre.get(Number(r.branch_id)) ?? null })) });
    }

    if (accion === "reservar") {
      const ofertaId = String(body?.oferta_id ?? "");
      const productoId = Number(body?.producto_id);
      const branchId = Number(body?.branch_id);
      const cantidad = Math.trunc(Number(body?.cantidad));
      if (body?.acepta_terminos !== TERMINOS_RESERVA.version) {
        return json({ ok: false, motivo: "terminos", mensaje: "Acepta las condiciones de la reserva para continuar." });
      }
      if (!productoId || !branchId || !(cantidad >= 1 && cantidad <= 5)) {
        return json({ ok: false, mensaje: "Revisa la sucursal y la cantidad (de 1 a 5)." });
      }
      // La oferta: publicada, vigente, con ese producto. Una MUESTRA (sólo la
      // ficha de prueba) se reserva igual, para poder ver el circuito completo.
      const hoy = hoySV();
      let o: any = null;
      if (ofertaId.startsWith("muestra-")) {
        const m = (await muestrasDe(admin, customerId, "oferta")).find((x) => `muestra-${x.id}` === ofertaId);
        if (m && m.fin >= hoy) o = { id: null, titulo: m.titulo, fin: m.fin, productos: m.productos ?? [], branch_ids: null };
      } else {
        const { data, error: eO } = await admin.from("ofertas_clientes")
          .select("id, titulo, fin, exclusiva, productos, branch_ids")
          .eq("id", ofertaId).eq("publicada", true).lte("inicio", hoy).gte("fin", hoy).maybeSingle();
        if (eO) throw eO;
        o = data;
      }
      if (!o) return json({ ok: false, mensaje: "Esta oferta ya no está vigente." });
      const p = (Array.isArray(o.productos) ? o.productos : []).find((x: any) => Number(x.id) === productoId);
      if (!p) return json({ ok: false, mensaje: "Ese producto no está en la oferta." });
      if (Array.isArray(o.branch_ids) && o.branch_ids.length && !o.branch_ids.map(Number).includes(branchId)) {
        return json({ ok: false, mensaje: "La oferta no aplica en esa sucursal." });
      }
      const { data: prod, error: eP } = await admin.from("products").select("es_antibiotico, requiere_receta").eq("id", productoId).maybeSingle();
      if (eP) throw eP;
      if (prod?.es_antibiotico || prod?.requiere_receta) return json({ ok: false, mensaje: "Los productos bajo receta no se reservan." });
      // Tope de activas y bloqueo por vencidas.
      const { data: suyas, error: eR } = await admin.from("app_reservas").select("estado, cerrada_at")
        .eq("customer_id", customerId).or(`estado.in.(pendiente,lista),and(estado.eq.vencida,cerrada_at.gte.${new Date(Date.now() - 30 * 86400_000).toISOString()})`);
      if (eR) throw eR;
      const activas = (suyas ?? []).filter((r: any) => r.estado === "pendiente" || r.estado === "lista").length;
      const vencidas = (suyas ?? []).filter((r: any) => r.estado === "vencida").length;
      if (vencidas >= 3) return json({ ok: false, mensaje: "Tienes 3 reservas que no se retiraron este mes. Podrás reservar de nuevo en 30 días." });
      if (activas >= 3) return json({ ok: false, mensaje: "Ya tienes 3 reservas activas. Retira o cancela una para reservar otra." });
      const { data: nueva, error: eI } = await admin.from("app_reservas").insert({
        customer_id: customerId, branch_id: branchId, oferta_id: o.id, oferta_titulo: o.titulo, oferta_fin: o.fin,
        producto_id: productoId, producto_nombre: String(p.nombre), cantidad,
        precio_unitario: p.precio_descuento ?? null, precio_normal: p.precio ?? null, terminos_version: TERMINOS_RESERVA.version,
      }).select("id").single();
      if (eI) throw eI;
      return json({ ok: true, id: nueva.id, codigo: `R-${String(nueva.id).padStart(6, "0")}` });
    }

    if (accion === "cancelar_reserva") {
      const { data, error } = await admin.from("app_reservas")
        .update({ estado: "cancelada", cerrada_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", Number(body?.id)).eq("customer_id", customerId).in("estado", ["pendiente", "lista"]).select("id");
      if (error) throw error;
      return json(data?.length ? { ok: true } : { ok: false, mensaje: "Esa reserva ya no se puede cancelar." });
    }

    // La BANDEJA: los avisos que ya se le mandaron, para verlos en la app.
    if (accion === "bandeja" && !customerId) return json({ ok: true, avisos: [], sin_leer: 0 });
    if (accion === "bandeja_leida" && !customerId) return json({ ok: true });
    if (accion === "bandeja") {
      const { data, error } = await admin.from("app_cliente_avisos")
        .select("id, tipo, titulo, cuerpo, url, created_at, leido_at")
        .eq("customer_id", customerId).eq("enviado", true)
        .order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return json({ ok: true, avisos: data ?? [], sin_leer: (data ?? []).filter((a) => !a.leido_at).length });
    }
    if (accion === "bandeja_leida") {
      const { error } = await admin.from("app_cliente_avisos").update({ leido_at: new Date().toISOString() })
        .eq("customer_id", customerId).is("leido_at", null);
      if (error) throw error;
      return json({ ok: true });
    }

    // ── Lo demás necesita ficha ────────────────────────────────────────────
    if (!customerId) {
      const { data: pre, error: ePre } = await admin.from("app_cliente_preregistros")
        .select("nombre, created_at").eq("id", ses.preregistro_id).maybeSingle();
      if (ePre) throw ePre;
      return json({
        ok: true, pendiente: true, nombre: pre?.nombre ?? null, registrado_el: pre?.created_at ?? null,
        acepta_avisos: ses.acepta_avisos,
      });
    }

    // ── El código del cliente para su tarjeta ─────────────────────────────
    // El mismo código de 7 letras que emite la sala (`puntos_codigo_emitir`),
    // con el mismo alfabeto sin parecidos. Si la ficha todavía no tiene, se le
    // emite UNO la primera vez que abre la app (decisión del usuario,
    // 2026-10-05) y queda en la bitácora como lo emitido en sala. Nunca se
    // REEMPLAZA uno existente: reemitir cambia la credencial con que la
    // persona entra, y eso sólo lo decide la sala.
    async function codigoDelCliente(id: number, nombre: string): Promise<string | null> {
      const { data: hay, error } = await admin.from("puntos_codigo_acceso").select("codigo").eq("customer_id", id).maybeSingle();
      if (error) throw error;
      if (hay?.codigo) return hay.codigo;
      const ALFABETO = "ACDEFGHJKMNPQRTUVWXY34679";
      for (let intento = 0; intento < 20; intento++) {
        const azar = crypto.getRandomValues(new Uint8Array(7));
        const codigo = [...azar].map((b) => ALFABETO[b % ALFABETO.length]).join("");
        const { error: eIns } = await admin.from("puntos_codigo_acceso").insert({ customer_id: id, codigo });
        if (!eIns) {
          const { error: eLog } = await admin.from("audit_logs").insert({
            action: "PUNTOS_CODIGO_EMITIDO", target_id: String(id), source: "SYSTEM", severity: "WARNING",
            details: { cliente: nombre, veces: 1, origen: "app-clientes" },
          });
          if (eLog) console.error("no se pudo anotar el código emitido:", eLog.message);
          return codigo;
        }
        if (eIns.code !== "23505") throw eIns;
        // Choque: o el código ya lo tiene otro (se vuelve a tirar) o esta ficha
        // recibió uno entretanto (otra pestaña, la sala): se usa ése.
        const { data: otro, error: eOtro } = await admin.from("puntos_codigo_acceso").select("codigo").eq("customer_id", id).maybeSingle();
        if (eOtro) throw eOtro;
        if (otro?.codigo) return otro.codigo;
      }
      return null;
    }

    if (accion === "resumen") {
      const { data: c, error: eC } = await admin.from("customers")
        .select("name, acepta_programa_puntos, acepta_promociones").eq("id", customerId).maybeSingle();
      if (eC) throw eC;
      if (!c) return json({ ok: false, motivo: "sin_sesion" }, 401);

      const { data: est, error: eEst } = await admin.rpc("puntos_estado_cuenta", { p_customer_id: customerId });
      if (eEst) throw eEst;
      const { data: salas, error: eSalas } = await admin.from("branches").select("codigo_puntos, name");
      if (eSalas) console.error("no se pudieron leer las salas:", eSalas.message);
      const porCodigo = new Map((salas ?? []).map((b: any) => [String(b.codigo_puntos), sucursal(b.name)]));
      const saldo = Number(est?.saldo ?? 0);

      // «Socio desde»: la primera vez que ganó puntos (la ficha puede ser más
      // nueva que su historia: se sincroniza desde la caja).
      const { data: primero, error: ePri } = await admin.from("puntos_lote")
        .select("ganado_el").eq("customer_id", customerId).order("ganado_el", { ascending: true }).limit(1).maybeSingle();
      if (ePri) console.error("no se pudo leer el primer lote:", ePri.message);
      let codigo: string | null = null;
      try { codigo = await codigoDelCliente(customerId, c.name); }
      catch (e) { console.error("no se pudo obtener el código:", (e as Error)?.message); }

      // ¿Es su cumpleaños hoy (hora de El Salvador)? La app lo celebra. La
      // muestra `cumpleanos` lo fuerza, para ver la tarjeta sin esperar al día.
      const hoyMD = new Date(Date.now() - 6 * 3600_000).toISOString().slice(5, 10);
      const { data: nac, error: eNac } = await admin.from("customers").select("fecha_nacimiento").eq("id", customerId).maybeSingle();
      if (eNac) console.error("no se pudo leer el cumpleaños:", eNac.message);
      const { data: cfgP, error: eCfg } = await admin.from("puntos_config").select("puntos_cumpleanos").limit(1).maybeSingle();
      if (eCfg) console.error("no se pudo leer la configuración:", eCfg.message);
      const cumpleanos = String(nac?.fecha_nacimiento ?? "").slice(5, 10) === hoyMD
        || (await muestrasDe(admin, customerId, "cumpleanos")).length > 0;

      const { data: resAb, error: eRA } = await admin.from("app_reservas").select("estado")
        .eq("customer_id", customerId).in("estado", ["pendiente", "lista"]);
      if (eRA) console.error("no se pudieron leer las reservas:", eRA.message);

      return json({
        ok: true,
        pendiente: false,
        nombre: c.name,
        cumpleanos,
        reservas_abiertas: (resAb ?? []).length,
        reservas_listas: (resAb ?? []).filter((r: any) => r.estado === "lista").length,
        wallet_serial: `socio-${customerId}`,
        regalo_cumpleanos: Number(cfgP?.puntos_cumpleanos ?? 0),
        codigo,
        socio_desde: primero?.ganado_el ?? null,
        saldo,
        equivale: Math.round(saldo) / 100,
        acumulados: Number(est?.ganados ?? 0),
        canjeados: Number(est?.usados ?? 0),
        // Todos (con tope), ordenados: la app arma la gráfica de los próximos
        // meses y el aviso de lo que vence en 90 días. Antes iban sólo 3.
        vencimientos: [
          ...(est?.vencimientos ?? []).map((v: any) => ({ vence: v.vence_el, puntos: Number(v.puntos) })),
          ...(await muestrasDe(admin, customerId, "vencimiento")).map((v: any) => ({ vence: v.vence, puntos: Number(v.puntos) })),
        ].sort((a, b) => String(a.vence).localeCompare(String(b.vence))).slice(0, 36),
        // Paginados: los primeros 10 acá y el resto con `movimientos` de a 20.
        // Un cliente de años tiene cientos y la app no debe bajar ni pintar
        // una lista infinita.
        movimientos: (est?.movimientos ?? []).slice(0, POR_PAGINA_INICIAL).map((m: any) => ({
          tipo: m.tipo, fecha: m.fecha, puntos: Number(m.puntos),
          sala: porCodigo.get(String(m.sucursal ?? "")) ?? null,
        })),
        movimientos_total: (est?.movimientos ?? []).length,
        consentimiento: {
          programa: c.acepta_programa_puntos ?? null,
          promociones: c.acepta_promociones ?? null,
          textos: { programa: TEXTOS.programa, promociones: TEXTOS.promociones },
        },
        acepta_avisos: ses.acepta_avisos,
      });
    }

    // Las compras del cliente con sus productos, los puntos que dio cada una y
    // lo canjeado en ella. La regla «¿cuenta como venta?» vive en la base
    // (`venta_valida`, dentro de `app_cliente_compras`), no acá.
    if (accion === "compras") {
      const { data, error } = await admin.rpc("app_cliente_compras", { p_customer_id: customerId });
      if (error) throw error;
      return json({ ok: true, compras: conSucursal(data ?? []) });
    }

    // Más movimientos, de a 20 desde `desde`.
    if (accion === "movimientos") {
      const desde = Math.max(0, Number(body?.desde) || 0);
      const { data: est, error } = await admin.rpc("puntos_estado_cuenta", { p_customer_id: customerId });
      if (error) throw error;
      const { data: salas, error: eSalas } = await admin.from("branches").select("codigo_puntos, name");
      if (eSalas) console.error("no se pudieron leer las salas:", eSalas.message);
      const porCodigo = new Map((salas ?? []).map((b: any) => [String(b.codigo_puntos), sucursal(b.name)]));
      const todos = est?.movimientos ?? [];
      return json({
        ok: true,
        total: todos.length,
        movimientos: todos.slice(desde, desde + POR_PAGINA).map((m: any) => ({
          tipo: m.tipo, fecha: m.fecha, puntos: Number(m.puntos),
          sala: porCodigo.get(String(m.sucursal ?? "")) ?? null,
        })),
      });
    }

    // Sólo las PENDIENTES: lo que el cliente necesita saber es qué le falta
    // aplicarse y dónde puede ir. Las aplicadas son historia de la sala.
    if (accion === "inyecciones") {
      const { data, error } = await admin.rpc("app_cliente_inyecciones", { p_customer_id: customerId });
      if (error) throw error;
      const muestras = (await muestrasDe(admin, customerId, "inyeccion")).map((m: any) => ({ ...m, id: `muestra-${m.id}` }));
      return json({ ok: true, disponibles: conSucursal([...((data as any)?.disponibles ?? []), ...muestras]) });
    }

    // El enlace para agregar la tarjeta a Apple Wallet (ver el GET de arriba).
    // La tarjeta en base64, para la hoja nativa de Apple dentro de la app
    // (modules/wallet): sin enlaces ni Safari de por medio.
    if (accion === "wallet_pase") {
      const bytes = await paseDe(customerId);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return json({ ok: true, pase: btoa(bin), serial: `socio-${customerId}` });
    }

    if (accion === "wallet_enlace") {
      const base = Deno.env.get("SUPABASE_URL")!;
      return json({ ok: true, url: `${base}/functions/v1/app-clientes?wallet=${await enlaceDePase(customerId)}` });
    }

    // Invitar a un amigo: el código propio (se crea la primera vez) y cómo va.
    if (accion === "referido") {
      let { data: cod, error: eC } = await admin.from("app_cliente_referido_codigo")
        .select("codigo").eq("customer_id", customerId).maybeSingle();
      if (eC) throw eC;
      if (!cod) {
        // Sin letras que se confunden al dictarlas (O/0, I/1, L).
        const ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        for (let i = 0; i < 6 && !cod; i++) {
          const azar = crypto.getRandomValues(new Uint8Array(6));
          const codigo = Array.from(azar, (n) => ABC[n % ABC.length]).join("");
          const { data, error } = await admin.from("app_cliente_referido_codigo")
            .insert({ customer_id: customerId, codigo }).select("codigo").maybeSingle();
          if (!error) cod = data;
          else if (error.code !== "23505") throw error;
          else {
            // Choque: o el código ya era de otro, o esta persona lo creó en paralelo.
            const { data: ya, error: eYa } = await admin.from("app_cliente_referido_codigo").select("codigo").eq("customer_id", customerId).maybeSingle();
            if (eYa) throw eYa;
            if (ya) cod = ya;
          }
        }
      }
      const { data: refs, error: eRefs } = await admin.from("app_cliente_referidos")
        .select("estado, motivo").eq("referidor_id", customerId);
      if (eRefs) throw eRefs;
      // deno-lint-ignore no-explicit-any
      const premiados = (refs ?? []).filter((r: any) => r.estado === "premiado" && !r.motivo).length;
      return json({
        ok: true, codigo: cod?.codigo ?? null, puntos: 50, minimo: 10,
        // deno-lint-ignore no-explicit-any
        invitados: (refs ?? []).length, pendientes: (refs ?? []).filter((r: any) => r.estado === "pendiente").length,
        premiados, ganados: premiados * 50,
      });
    }

    if (accion === "permisos") {
      const programa = typeof body?.programa === "boolean" ? body.programa : null;
      const promociones = typeof body?.promociones === "boolean" ? body.promociones : null;
      if (programa === null && promociones === null) return json({ ok: false, mensaje: "Sin cambios." });
      const g = await guardarPermisos(customerId, programa, promociones);
      return json({ ok: true, programa: g?.acepta_programa_puntos ?? null, promociones: g?.acepta_promociones ?? null });
    }

    return json({ ok: false, mensaje: "Acción desconocida." }, 400);
  } catch (e) {
    console.error("app-clientes:", accion, (e as any)?.message ?? e);
    return json({ ok: false, mensaje: "No se pudo completar. Intenta en un rato." }, 503);
  }
});
