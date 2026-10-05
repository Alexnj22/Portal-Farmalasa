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
const VERSION_AVISO = `${TEXTOS.version} · ${TEXTOS.aviso}`;

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
  if (req.method !== "POST") return json({ error: "solo POST" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "desconocida";
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
      const nacimiento = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.fecha_nacimiento ?? ""))
        ? String(body.fecha_nacimiento) : null;
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
        if (previo.telefono !== tel) return json(NO_ENCONTRADO);
        await anotarAcierto(doc);
        return json({ ok: true, token: await abrirSesion({ preregistro_id: previo.id }) });
      }

      const { data: nuevo, error: eIns } = await admin.from("app_cliente_preregistros").insert({
        nombre: nombre.toUpperCase(), documento: doc, telefono: tel, email, fecha_nacimiento: nacimiento,
        acepta_programa: true, acepta_promociones: aceptaPromos, version_aviso: VERSION_AVISO,
      }).select("id").single();
      if (eIns) throw eIns;
      await anotarAcierto(doc);
      return json({ ok: true, token: await abrirSesion({ preregistro_id: nuevo.id }), pendiente: true });
    }

    if (accion === "textos") {
      return json({ ok: true, textos: { programa: TEXTOS.programa, promociones: TEXTOS.promociones } });
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
    // mismo documento y teléfono. Se intenta en cada consulta mientras espera.
    let customerId: number | null = ses.customer_id;
    if (!customerId && ses.preregistro_id) {
      const { data: pre, error } = await admin.from("app_cliente_preregistros")
        .select("id, documento, telefono, estado, customer_id, acepta_promociones")
        .eq("id", ses.preregistro_id).maybeSingle();
      if (error) throw error;
      if (!pre || pre.estado === "descartado") return json({ ok: false, motivo: "sin_sesion" }, 401);
      if (pre.estado === "vinculado" && pre.customer_id) {
        customerId = pre.customer_id;
      } else {
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
      if (ses.preregistro_id) {
        const { error } = await admin.from("app_cliente_preregistros")
          .delete().eq("id", ses.preregistro_id).eq("estado", "pendiente");
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
    if (accion === "ofertas") {
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
      const nombreSala = new Map((salas ?? []).map((b: any) => [b.id, b.name]));

      const ofertas = await Promise.all((filas ?? []).map(async (o: any) => {
        let imagen: string | null = null;
        if (o.imagen_path) {
          const { data: f, error: eF } = await admin.storage.from("ofertas-clientes")
            .createSignedUrl(o.imagen_path, 3600);
          if (eF) console.error("no se pudo firmar la imagen:", eF.message);
          imagen = f?.signedUrl ?? null;
        }
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
      }));
      return json({ ok: true, ofertas, socio });
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

    if (accion === "resumen") {
      const { data: c, error: eC } = await admin.from("customers")
        .select("name, acepta_programa_puntos, acepta_promociones").eq("id", customerId).maybeSingle();
      if (eC) throw eC;
      if (!c) return json({ ok: false, motivo: "sin_sesion" }, 401);

      const { data: est, error: eEst } = await admin.rpc("puntos_estado_cuenta", { p_customer_id: customerId });
      if (eEst) throw eEst;
      const { data: salas, error: eSalas } = await admin.from("branches").select("codigo_puntos, name");
      if (eSalas) console.error("no se pudieron leer las salas:", eSalas.message);
      const porCodigo = new Map((salas ?? []).map((b: any) => [String(b.codigo_puntos), String(b.name)]));
      const saldo = Number(est?.saldo ?? 0);

      return json({
        ok: true,
        pendiente: false,
        nombre: c.name,
        saldo,
        equivale: Math.round(saldo) / 100,
        acumulados: Number(est?.ganados ?? 0),
        canjeados: Number(est?.usados ?? 0),
        vencimientos: (est?.vencimientos ?? []).map((v: any) => ({ vence: v.vence_el, puntos: Number(v.puntos) })).slice(0, 3),
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
      return json({ ok: true, compras: data ?? [] });
    }

    // Más movimientos, de a 20 desde `desde`.
    if (accion === "movimientos") {
      const desde = Math.max(0, Number(body?.desde) || 0);
      const { data: est, error } = await admin.rpc("puntos_estado_cuenta", { p_customer_id: customerId });
      if (error) throw error;
      const { data: salas, error: eSalas } = await admin.from("branches").select("codigo_puntos, name");
      if (eSalas) console.error("no se pudieron leer las salas:", eSalas.message);
      const porCodigo = new Map((salas ?? []).map((b: any) => [String(b.codigo_puntos), String(b.name)]));
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
      return json({ ok: true, disponibles: (data as any)?.disponibles ?? [] });
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
