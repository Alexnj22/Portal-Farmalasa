// Avisos al teléfono de los clientes de Puntos Salud (2026-10-06).
//
// Dos crons, de 8:00 a 20:00 de El Salvador (de noche no se escribe a nadie):
//   · `modo: "inmediato"`, CADA MINUTO: lo que acaba de pasar — puntos ganados
//     y oferta nueva. La venta tarda ~1 min en llegar de la caja, así que el
//     aviso llega 1–2 min después de pagar (decisión del usuario, 2026-10-06).
//   · `modo: "diario"`, a las 9:00: los recordatorios — puntos por vencer e
//     inyección pendiente. Una vez al día y a una hora fija, no a cualquier rato.
// Cada vuelta busca lo que pasó y le avisa a quien tiene los avisos encendidos:
//
//   · ganado      — cada lote nuevo: una compra, el regalo de cumpleaños, un
//                   referido que se premió.
//   · vence       — puntos que vencen en 15 días (una vez por fecha).
//   · inyeccion   — una inyección pagada hace 3 días y todavía sin aplicar.
//   · oferta      — una oferta publicada en los últimos 2 días; SÓLO a quien
//                   aceptó recibir promociones (es publicidad).
//   · mayoreo     — (2026-10-09) aprobado como cliente de mayoreo o pasado a
//                   Mayoreo Plus (inmediato), y subir de rango (diario).
//   · receta/chat — (2026-10-12) los escribe la base (`reserva_receta_decidir`,
//                   `chat_responder`) con `enviado = false`; acá sólo se mandan.
//   · credito     — (2026-10-15, diario) un crédito pasó el plazo: una vez por
//                   crédito, y un recordatorio cada 7 días como máximo mientras
//                   siga vencido. Sin montos (se lee en la pantalla bloqueada).
//
// ── Por qué no manda dos veces ─────────────────────────────────────────────
// Antes de enviar, cada aviso se INSERTA en `app_cliente_avisos`, cuya UNIQUE
// (customer_id, tipo, ref) hace que el segundo intento no inserte nada. Sólo
// se envía lo que se insertó en esta vuelta. Las ventanas de búsqueda son más
// anchas que la cadencia a propósito: si una vuelta falla, la siguiente
// recoge lo que quedó, y la tabla impide repetir.
//
// ── El envío ───────────────────────────────────────────────────────────────
// Por el servicio de avisos de Expo (gratis), el mismo que usa la app del
// personal. Para que llegue a un iPhone, Expo tiene que tener la llave de
// avisos de Apple de ESTA app (`eas credentials`, una vez): sin ella Expo
// contesta `InvalidCredentials` y se anota en el registro.
//
// Prueba: `{ "prueba": "cumpleanos", "customer_id": N }` le manda a esa ficha
// el aviso de cumpleaños (sin anotarlo), para ver cómo llega.
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronSecret } from "../_shared/security.ts";
import { mensajePush } from "../_shared/avisoPrivado.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

// `cuerpoPublico` (2026-10-15): el cuerpo SIN el producto, para la pantalla
// bloqueada de Android (ver _shared/avisoPrivado.ts). No se guarda en la tabla.
interface Aviso { customer_id: number; tipo: string; ref: string; titulo: string; cuerpo: string; url: string; cuerpoPublico?: string }
type Token = { id: string; token: string; plataforma: string | null };

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaCorta = (f: string) => { const [, m, d] = f.split("-"); return `${Number(d)} ${MESES[Number(m) - 1]}`; };
const primerNombre = (n: string) => {
  const p = String(n ?? "").trim().split(/\s+/)[0] ?? "";
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : "";
};

Deno.serve(async (req) => {
  if (!checkCronSecret(req)) return json({ error: "no autorizado" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));

  try {
    // Quién puede recibir: sesiones vivas con token y avisos encendidos.
    const { data: ses, error: eSes } = await admin.from("app_cliente_sesiones")
      .select("id, customer_id, push_token, plataforma")
      .not("customer_id", "is", null).not("push_token", "is", null)
      .is("revocada_at", null).eq("acepta_avisos", true);
    if (eSes) throw eSes;
    const tokens = new Map<number, Token[]>();
    for (const s of ses ?? []) {
      const l = tokens.get(s.customer_id) ?? [];
      l.push({ id: s.id, token: s.push_token, plataforma: s.plataforma ?? null });
      tokens.set(s.customer_id, l);
    }

    // ── Prueba: un aviso de muestra a una ficha ───────────────────────────
    if (body?.prueba === "cumpleanos" && Number(body?.customer_id)) {
      const id = Number(body.customer_id);
      const { data: c, error } = await admin.from("customers").select("name").eq("id", id).maybeSingle();
      if (error) throw error;
      const { data: cfg, error: eCfg } = await admin.from("puntos_config").select("puntos_cumpleanos").limit(1).maybeSingle();
      if (eCfg) throw eCfg;
      const r = await enviar(admin, tokens, [{
        customer_id: id, tipo: "cumpleanos", ref: "prueba",
        titulo: `¡Feliz cumpleaños, ${primerNombre(c?.name ?? "")}! 🎂`,
        cuerpo: `Te regalamos ${cfg?.puntos_cumpleanos ?? 50} puntos para celebrar. Ábrela y míralos.`,
        url: "/puntos?cumple=1",
      }]);
      return json({ ok: true, prueba: true, ...r });
    }

    // `pendientes` (2026-10-12): sólo manda los avisos que escribió la base
    // (respuesta del chat, receta revisada). Lo dispara la propia base al
    // instante (`chat_responder`, `reserva_receta_decidir`) para que el cliente
    // no espere al cron del minuto.
    const modo = ["inmediato", "diario", "pendientes"].includes(body?.modo) ? body.modo : "todo";
    const inmediato = modo !== "diario", diario = modo !== "inmediato" && modo !== "pendientes";

    // ── Avisos que escribe la BASE (2026-10-12): la receta revisada
    // (`reserva_receta_decidir`, tipo `receta`) y la respuesta del chat
    // (`chat_responder`, tipo `chat`) entran a `app_cliente_avisos` con
    // `enviado = false`; esta vuelta los manda. Últimas 24 h: lo que llega de
    // noche sale a la mañana con la primera corrida. Se marca enviado lo que
    // Expo aceptó y lo de quien no tiene avisos encendidos (no hay a quién
    // mandarlo, y así la receta aparece igual en su bandeja); lo que falló
    // con token se reintenta en la próxima vuelta.
    let pendientesBase = { enviados: 0, errores: [] as string[] };
    if (inmediato) {
      const { data: pend, error: ePd } = await admin.from("app_cliente_avisos")
        .select("id, customer_id, tipo, ref, titulo, cuerpo, url").limit(500)
        .in("tipo", ["receta", "chat"]).eq("enviado", false)
        .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
        .order("id", { ascending: true });
      if (ePd) console.error("no se pudieron leer los avisos pendientes:", ePd.message);
      if (pend?.length) {
        const conToken = pend.filter((a: any) => tokens.has(Number(a.customer_id)));
        const r = await enviar(admin, tokens, conToken.map((a: any) => ({
          customer_id: Number(a.customer_id), tipo: a.tipo, ref: a.ref, titulo: a.titulo, cuerpo: a.cuerpo ?? "", url: a.url ?? "/",
        })));
        const listos = pend.filter((a: any) => !tokens.has(Number(a.customer_id)) || r.ok_por.has(Number(a.customer_id))).map((a: any) => a.id);
        if (listos.length) {
          const { error } = await admin.from("app_cliente_avisos").update({ enviado: true }).in("id", listos);
          if (error) console.error("no se pudieron marcar los avisos pendientes:", error.message);
        }
        pendientesBase = { enviados: r.enviados, errores: r.errores };
      }
    }

    if (modo === "pendientes") return json({ ok: true, pendientes: pendientesBase });
    const clientes = [...tokens.keys()];
    if (!clientes.length) return json({ ok: true, avisos: 0, motivo: "nadie con avisos encendidos", pendientes: pendientesBase });
    const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
    const masDias = (n: number) => new Date(Date.parse(`${hoy}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
    const candidatos: Aviso[] = [];

    // ── Ganado: lotes de las últimas 2 horas (la bitácora impide repetir) ──
    const { data: lotes, error: eL } = !inmediato ? { data: [], error: null } : await admin.from("puntos_lote")
      .select("id, customer_id, origen, puntos, sucursal")
      .in("customer_id", clientes).in("origen", ["venta", "cumpleanos", "referido", "cupon"])
      .gte("created_at", new Date(Date.now() - 2 * 3600_000).toISOString());
    if (eL) throw eL;
    for (const l of lotes ?? []) {
      const pts = Number(l.puntos);
      const [titulo, cuerpo] = l.origen === "cumpleanos"
        ? ["¡Feliz cumpleaños! 🎂", `Te regalamos ${pts} puntos para celebrar.`]
        : l.origen === "cupon"
          // Sin decir el premio: se descubre raspándolo en la app.
          ? ["Tu cupón del mes 🎟️", "Ya llegó: ráspalo en la app para descubrir cuánto ganaste."]
        : l.origen === "referido"
          ? ["¡Tu invitación funcionó! 🎉", `Ganaste ${pts} puntos por invitar a un amigo.`]
          : [`Ganaste ${pts} puntos`, "Gracias por tu compra. Mira tu saldo en la app."];
      candidatos.push({ customer_id: l.customer_id, tipo: "ganado", ref: `lote:${l.id}`, titulo, cuerpo,
        url: l.origen === "cumpleanos" ? "/puntos?cumple=1" : "/puntos" });
    }

    // ── Se restaron puntos (2026-10-08): canje, anulación, ajuste, vencimiento
    // o una compra pasada a otra ficha. Con el saldo que queda.
    const { data: salidas, error: eSal } = !inmediato ? { data: [], error: null } : await admin.from("puntos_salida")
      .select("id, customer_id, tipo, puntos, monto, sucursal, motivo")
      .in("customer_id", clientes).is("revertida_at", null)
      .gte("created_at", new Date(Date.now() - 2 * 3600_000).toISOString());
    if (eSal) console.error("no se pudieron leer las salidas:", eSal.message);
    if (salidas?.length) {
      const { data: cuentas, error: eCu } = await admin.from("puntos_cuenta").select("customer_id, saldo")
        .in("customer_id", [...new Set(salidas.map((x: any) => x.customer_id))]);
      if (eCu) console.error("no se pudieron leer los saldos:", eCu.message);
      const saldo = new Map((cuentas ?? []).map((c: any) => [Number(c.customer_id), Number(c.saldo)]));
      for (const x of salidas as any[]) {
        const pts = Number(x.puntos);
        const queda = saldo.has(Number(x.customer_id)) ? ` Te quedan ${saldo.get(Number(x.customer_id))!.toLocaleString("en-US")} puntos.` : "";
        const [titulo, cuerpo] =
          x.tipo === "canje" ? [`Usaste ${pts} puntos 💳`, `${x.monto ? `Ahorraste $${Number(x.monto).toFixed(2)}` : "Canjeaste tus puntos"}${x.sucursal ? ` en ${x.sucursal}` : ""}.${queda}`]
          : x.tipo === "anulacion" ? [`Se restaron ${pts} puntos`, `Se anuló una compra y se quitaron los puntos que te había dado.${queda}`]
          : x.tipo === "vencimiento" ? [`Vencieron ${pts} puntos`, `Pasó un año sin usarlos.${queda}`]
          : x.tipo === "cambio_cliente" ? [`Se movieron ${pts} puntos`, `Una compra se registró a nombre de otra persona.${queda}`]
          : [`Ajuste de ${pts} puntos`, `${x.motivo ? `${x.motivo}.` : "Se corrigió tu saldo."}${queda}`];
        candidatos.push({ customer_id: x.customer_id, tipo: "restado", ref: `salida:${x.id}`, titulo, cuerpo, url: "/puntos" });
      }
    }

    // ── Subiste de nivel (2026-10-07): sólo quien acaba de comprar puede
    // haber subido. Un aviso por nivel y por cliente (la llave es el nivel).
    const compraron = [...new Set((lotes ?? []).filter((l) => l.origen === "venta").map((l) => Number(l.customer_id)))];
    if (compraron.length) {
      const { data: niv, error: eN } = await admin.rpc("app_niveles_de", { p_clientes: compraron });
      if (eN) console.error("no se pudieron leer los niveles:", eN.message);
      for (const n of (niv ?? []) as { customer_id: number; clave: string; nombre: string }[]) {
        if (n.clave === "vip") continue;
        candidatos.push({ customer_id: n.customer_id, tipo: "nivel", ref: `nivel:${n.clave}`,
          titulo: `¡Subiste a ${n.nombre}! 👑`, cuerpo: "Desde ahora ganas más puntos con cada compra. Mira tus beneficios.",
          url: "/puntos?nivel=1" });
      }
    }

    // ── Mayoreo: aprobado, o pasado de Mayoreo a Mayoreo Plus (2026-10-09) ──
    // Sale del historial que escribe `mayorista_resolver` (acciones «aprobado»
    // y «precio_cambiado»), de las últimas 48 h: una aprobación de noche se
    // avisa a la mañana. La llave es la fila del historial. Sólo si sigue
    // aprobado y con ese precio (si lo deshicieron, no se avisa).
    if (inmediato) {
      const { data: hist, error: eH } = await admin.from("clientes_mayoristas_historial")
        .select("id, customer_id, accion, precio")
        .in("customer_id", clientes).in("accion", ["aprobado", "precio_cambiado"])
        .gte("created_at", new Date(Date.now() - 48 * 3600_000).toISOString());
      if (eH) console.error("no se pudo leer el historial de mayoreo:", eH.message);
      if (hist?.length) {
        const ids = [...new Set(hist.map((h: any) => Number(h.customer_id)))];
        const [{ data: vig, error: eVg }, { data: previos, error: ePv }] = await Promise.all([
          admin.from("clientes_mayoristas").select("customer_id, estado, precio").in("customer_id", ids),
          // El precio que tenía antes de cada cambio: la fila anterior con precio.
          admin.from("clientes_mayoristas_historial").select("id, customer_id, precio")
            .in("customer_id", ids).not("precio", "is", null).order("id", { ascending: true }),
        ]);
        if (eVg) console.error("no se pudo leer el estado de mayoreo:", eVg.message);
        if (ePv) console.error("no se pudo leer el precio anterior:", ePv.message);
        const vigente = new Map((vig ?? []).map((v: any) => [Number(v.customer_id), v]));
        const NOMBRE_PRECIO: Record<string, string> = { mayoreo: "Mayoreo", mayoreo_plus: "Mayoreo Plus" };
        for (const h of hist as any[]) {
          const v = vigente.get(Number(h.customer_id));
          if (!v || v.estado !== "aprobado") continue;
          if (h.accion === "aprobado") {
            candidatos.push({ customer_id: h.customer_id, tipo: "mayoreo", ref: `mayoreo:${h.id}`,
              titulo: "¡Bienvenido a precio de mayoreo! 💎",
              cuerpo: `Te aprobamos como cliente de mayoreo con precio ${NOMBRE_PRECIO[v.precio] ?? "Mayoreo"}. Mira tu rango y tus beneficios.`,
              url: "/puntos?mayoreo=1" });
            continue;
          }
          // precio_cambiado: sólo la subida de Mayoreo a Mayoreo Plus se celebra.
          if (h.precio !== "mayoreo_plus" || v.precio !== "mayoreo_plus") continue;
          const antes = (previos ?? []).filter((p: any) => Number(p.customer_id) === Number(h.customer_id) && Number(p.id) < Number(h.id)).at(-1);
          if (ePv || antes?.precio !== "mayoreo") continue;
          candidatos.push({ customer_id: h.customer_id, tipo: "mayoreo", ref: `mayoreo:${h.id}`,
            titulo: "Ahora tienes precio Mayoreo Plus 🏷️",
            cuerpo: "Desde hoy pagas a precio Mayoreo Plus en todas las sucursales. Muestra tu tarjeta en caja.",
            url: "/puntos?precio=1" });
        }
      }
    }

    // ── Mayoreo: subiste de rango (2026-10-09) ──────────────────────────────
    // El rango (Jade < Zafiro < Rubí < Diamante) se recalcula el día 1 con el
    // promedio de 3 meses: basta la corrida diaria. Sólo subidas: la bitácora
    // guarda cada rango ya avisado (ref `rango:<clave>`); se avisa si el de hoy
    // es más alto que todos los anotados. La PRIMERA vez que se ve a un cliente
    // aprobado su rango se anota en silencio (enviado = false, no sale en la
    // campana): no se sabe de dónde venía, y al aprobarlo ya recibió la bienvenida.
    if (diario) {
      const ORDEN_RANGO: Record<string, number> = { jade: 0, zafiro: 1, rubi: 2, diamante: 3 };
      const NOMBRE_RANGO: Record<string, string> = { jade: "Jade", zafiro: "Zafiro", rubi: "Rubí", diamante: "Diamante" };
      const { data: aprob, error: eAp } = await admin.from("clientes_mayoristas").select("customer_id")
        .in("customer_id", clientes).eq("estado", "aprobado");
      if (eAp) console.error("no se pudieron leer los clientes de mayoreo:", eAp.message);
      const ids = (aprob ?? []).map((a: any) => Number(a.customer_id));
      if (ids.length) {
        const { data: vistos, error: eVi } = await admin.from("app_cliente_avisos").select("customer_id, ref")
          .in("customer_id", ids).eq("tipo", "mayoreo").like("ref", "rango:%");
        if (eVi) console.error("no se pudieron leer los rangos avisados:", eVi.message);
        const tope = new Map<number, number>();
        for (const v of vistos ?? []) {
          const o = ORDEN_RANGO[String(v.ref).slice(6)] ?? -1;
          tope.set(Number(v.customer_id), Math.max(tope.get(Number(v.customer_id)) ?? -1, o));
        }
        const rangos = await Promise.all(ids.map(async (id) => {
          const { data, error } = await admin.rpc("mayorista_rango", { p_customer: id });
          if (error) { console.error("no se pudo leer el rango:", error.message); return null; }
          return { id, clave: String(data ?? "") };
        }));
        const silenciosos: Aviso[] = [];
        // Sin la bitácora no se sabe qué ya se avisó: mejor no avisar nada.
        for (const r of eVi ? [] : rangos) {
          if (!r || !(r.clave in ORDEN_RANGO)) continue;
          const aviso: Aviso = { customer_id: r.id, tipo: "mayoreo", ref: `rango:${r.clave}`,
            titulo: `¡Subiste a ${NOMBRE_RANGO[r.clave]}! 💎`,
            cuerpo: "Tu compra promedio de los últimos 3 meses subió tu rango de mayoreo. Mira tus beneficios.",
            url: "/puntos?rango=1" };
          if (!tope.has(r.id)) silenciosos.push(aviso);
          else if (ORDEN_RANGO[r.clave] > tope.get(r.id)!) candidatos.push(aviso);
        }
        if (silenciosos.length) {
          const { error: eSi } = await admin.from("app_cliente_avisos")
            .upsert(silenciosos, { onConflict: "customer_id,tipo,ref", ignoreDuplicates: true });
          if (eSi) console.error("no se pudo anotar el rango de partida:", eSi.message);
        }
      }
    }

    // ── Encargos: la sucursal respondió o ya llegó (2026-10-07) ──
    const { data: encs, error: eE } = !inmediato ? { data: [], error: null } : await admin.from("app_encargos")
      .select("id, customer_id, estado, producto_nombre, anticipo, fecha_estimada, nota_sucursal")
      .in("customer_id", clientes).in("estado", ["confirmado", "rechazado", "listo"])
      .gte("updated_at", new Date(Date.now() - 2 * 3600_000).toISOString());
    if (eE) throw eE;
    for (const e of encs ?? []) {
      const cod = `E-${String(e.id).padStart(6, "0")}`;
      const llega = `llega aprox. el ${String(e.fecha_estimada).split("-").reverse().join("/")}. Confírmalo pagando el anticipo de $${Number(e.anticipo).toFixed(2)}.`;
      // El título nunca nombra el producto; el cuerpo público, tampoco (la
      // nota de la sucursal puede nombrarlo).
      const [titulo, cuerpo, cuerpoPublico] = e.estado === "confirmado"
        ? [`Tu encargo ${cod} se puede conseguir`, `${e.producto_nombre}: ${llega}`, `Lo que encargaste ${llega}`]
        : e.estado === "rechazado"
          ? [`Tu encargo ${cod} no se pudo conseguir`, e.nota_sucursal ?? "Por ahora no lo podemos conseguir.", "Toca para ver el detalle."]
          : [`¡Tu encargo ${cod} ya llegó!`, `${e.producto_nombre} te espera en la sucursal.`, "Te espera en la sucursal. Toca para ver el detalle."];
      candidatos.push({ customer_id: e.customer_id, tipo: "encargo", ref: `encargo:${e.id}:${e.estado}`, titulo, cuerpo, cuerpoPublico, url: "/reservas" });
    }

    // ── Vence: lo que vence dentro de 15 días (ventana de 2 por si una vuelta falla)
    const { data: vence, error: eV } = !diario ? { data: [], error: null } : await admin.from("puntos_lote")
      .select("customer_id, vence_el, restantes")
      .in("customer_id", clientes).gt("restantes", 0)
      .gte("vence_el", masDias(14)).lte("vence_el", masDias(15));
    if (eV) throw eV;
    const porFecha = new Map<string, { customer_id: number; vence: string; pts: number }>();
    for (const v of vence ?? []) {
      const k = `${v.customer_id}|${v.vence_el}`;
      const x = porFecha.get(k) ?? { customer_id: v.customer_id, vence: v.vence_el, pts: 0 };
      x.pts += Number(v.restantes);
      porFecha.set(k, x);
    }
    for (const v of porFecha.values()) {
      candidatos.push({
        customer_id: v.customer_id, tipo: "vence", ref: `vence:${v.vence}`,
        titulo: `${v.pts} puntos vencen pronto`,
        cuerpo: `Vencen el ${fechaCorta(v.vence)}: son $${(v.pts / 100).toFixed(2)} de descuento. Úsalos en tu próxima compra.`,
        url: "/puntos",
      });
    }

    // ── Inyección pendiente: pagada hace 3 días ───────────────────────────
    const { data: iny, error: eI } = !diario ? { data: [], error: null } : await admin.rpc("app_cliente_inyecciones_por_recordar", { p_clientes: clientes });
    if (eI) console.error("no se pudieron leer las inyecciones:", eI.message);
    for (const a of (iny ?? []) as { id: number; customer_id: number; producto: string; sala: string }[]) {
      candidatos.push({
        customer_id: a.customer_id, tipo: "inyeccion", ref: `iny:${a.id}`,
        titulo: "Tu inyección te espera 💉",
        cuerpo: `${a.producto} ya está pagada${a.sala ? ` en ${a.sala}` : ""}. Pasa cuando quieras a aplicártela.`,
        cuerpoPublico: `Ya está pagada${a.sala ? ` en ${a.sala}` : ""}. Pasa cuando quieras a aplicártela.`,
        url: "/inyecciones",
      });
    }

    // ── Tratamiento: se le está por acabar algo que compra con regularidad ──
    // (2026-10-07). Primero se recalculan los tratamientos de quien tiene la
    // app; la llave lleva la fecha de la última compra: un aviso por ciclo.
    if (diario) {
      const { error: eD } = await admin.rpc("app_tratamientos_detectar", { p_clientes: clientes });
      if (eD) console.error("no se pudieron detectar los tratamientos:", eD.message);
      const { data: trat, error: eT } = await admin.rpc("app_tratamientos_por_recordar", { p_clientes: clientes });
      if (eT) console.error("no se pudieron leer los tratamientos:", eT.message);
      // UN aviso por cliente con todos sus medicamentos por acabarse (2026-10-13,
      // pedido del usuario: «me llegó 2 veces… mejor recibir 1 con los 3»).
      // Cada medicamento se recuerda una sola vez por compra: la `ref` del aviso
      // junta las llaves `trat:<id>:<última compra>` separadas por «|», y lo que
      // ya salió (suelto, como antes, o en un grupo) no se vuelve a incluir.
      const filas = (trat ?? []) as { id: number; customer_id: number; nombre: string; ultima_compra: string }[];
      if (filas.length) {
        const { data: previos, error: ePv } = await admin.from("app_cliente_avisos").select("ref").limit(5000)
          .eq("tipo", "tratamiento").in("customer_id", [...new Set(filas.map((a) => a.customer_id))])
          .gte("created_at", new Date(Date.now() - 120 * 86400_000).toISOString());
        if (ePv) console.error("no se pudieron leer los avisos de tratamiento previos:", ePv.message);
        const yaAvisados = new Set((previos ?? []).flatMap((p: { ref: string }) => String(p.ref).split("|")));
        // «LOSARTAN 50 MG X 30 TAB MK» → «Losartan 50 mg»: lo que va antes de la presentación.
        const corto = (n: string) => {
          const base = String(n).split(/\s+X\s+/i)[0].trim().replace(/[.,]+$/, "").toLowerCase();
          return base.replace(/(^|\s)([a-záéíóúñ])/g, (_m, sp, c) => sp + c.toUpperCase())
            .replace(/\b(Mg|Ml|Mcg|Ui|G)\b/g, (u) => u.toLowerCase());
        };
        const porCliente = new Map<number, typeof filas>();
        for (const a of filas) {
          if (yaAvisados.has(`trat:${a.id}:${a.ultima_compra}`)) continue;
          porCliente.set(a.customer_id, [...(porCliente.get(a.customer_id) ?? []), a]);
        }
        for (const [cliente, lista] of porCliente) {
          const nombres = lista.map((a) => corto(a.nombre));
          const enumerar = nombres.length === 1 ? nombres[0]
            : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
          candidatos.push({
            customer_id: cliente, tipo: "tratamiento",
            ref: lista.map((a) => `trat:${a.id}:${a.ultima_compra}`).sort().join("|"),
            titulo: lista.length === 1 ? "¿Ya te toca otra vez? 💊" : `Se te están por acabar ${lista.length} medicamentos 💊`,
            cuerpo: lista.length === 1
              ? `Se te está por acabar ${enumerar}. Resérvalo y lo tenemos listo.`
              : `${enumerar}. Resérvalos de una vez y te los tenemos listos.`,
            cuerpoPublico: lista.length === 1 ? "Resérvalo y lo tenemos listo. Toca para ver cuál."
              : "Resérvalos de una vez y te los tenemos listos. Toca para ver cuáles.",
            url: "/tratamientos",
          });
        }
      }
    }

    // ── Crédito vencido (2026-10-15): el cliente ve sus créditos en la app ──
    // «Vencido» lo decide `creditos_pasados_del_plazo(30)`, la MISMA lista que
    // avisa al personal: el criterio vive en un solo sitio. UN aviso por
    // cliente aunque tenga varios: la `ref` junta las llaves `cred:<id>` de
    // los créditos que vencieron desde el último aviso (como `tratamiento`), así
    // cada crédito se avisa una sola vez. Si no venció ninguno nuevo y el último
    // aviso de crédito tiene 7 días o más, sale UN recordatorio (`recordatorio:
    // <día>`). Nunca con montos: el texto se lee en la pantalla bloqueada.
    if (diario) {
      const { data: venc, error: eCr } = await admin.rpc("creditos_pasados_del_plazo", { p_dias: 30 });
      if (eCr) console.error("no se pudieron leer los créditos vencidos:", eCr.message);
      const porCliente = new Map<number, number[]>();
      for (const f of (venc ?? []) as { id: number; customer_id: number | null }[]) {
        const c = Number(f.customer_id);
        if (!c || !tokens.has(c)) continue;
        porCliente.set(c, [...(porCliente.get(c) ?? []), Number(f.id)]);
      }
      if (porCliente.size) {
        const { data: previos, error: ePc } = await admin.from("app_cliente_avisos").select("customer_id, ref, created_at")
          .eq("tipo", "credito").in("customer_id", [...porCliente.keys()]).limit(5000);
        if (ePc) console.error("no se pudieron leer los avisos de crédito previos:", ePc.message);
        const avisados = new Set<string>();
        const ultimo = new Map<number, number>();
        for (const p of (previos ?? []) as { customer_id: number; ref: string; created_at: string }[]) {
          for (const k of String(p.ref).split("|")) avisados.add(`${p.customer_id}|${k}`);
          ultimo.set(Number(p.customer_id), Math.max(ultimo.get(Number(p.customer_id)) ?? 0, Date.parse(p.created_at)));
        }
        // Sin la bitácora no se sabe qué ya se avisó: mejor no avisar nada.
        for (const [cliente, ids] of ePc ? [] : porCliente) {
          const nuevos = ids.map((id) => `cred:${id}`).filter((k) => !avisados.has(`${cliente}|${k}`)).sort();
          const varios = ids.length > 1;
          if (nuevos.length) {
            candidatos.push({ customer_id: cliente, tipo: "credito", ref: nuevos.join("|"),
              titulo: varios ? `Tienes ${ids.length} créditos vencidos` : "Tienes un crédito vencido",
              cuerpo: "Toca para ver el detalle. ¿Dudas? Escríbenos por el chat de la app.",
              url: "/creditos" });
          } else if (Date.now() - (ultimo.get(cliente) ?? 0) >= 7 * 86400_000 - 3600_000) {
            // La hora de margen: la corrida diaria no sale cada día al mismo segundo.
            candidatos.push({ customer_id: cliente, tipo: "credito", ref: `recordatorio:${hoy}`,
              titulo: varios ? "Recordatorio: tienes créditos vencidos" : "Recordatorio: tienes un crédito vencido",
              cuerpo: "Toca para ver el detalle. Si ya pagaste, no te preocupes: se actualiza en unas horas.",
              url: "/creditos" });
          }
        }
      }
    }

    // ── Reserva recibida: la confirmación al reservar (últimas 2 h) ───────
    if (inmediato) {
      const { data: nuevas, error: eNu } = await admin.from("app_reservas")
        .select("id, customer_id, producto_nombre, cantidad")
        .in("customer_id", clientes).eq("estado", "pendiente")
        // Una reserva con receta ya recibe su aviso al aprobarse (tipo `receta`).
        .is("receta_estado", null)
        .gte("created_at", new Date(Date.now() - 2 * 3600_000).toISOString());
      if (eNu) throw eNu;
      for (const r of nuevas ?? []) {
        candidatos.push({
          customer_id: r.customer_id, tipo: "reserva", ref: `reserva-recibida:${r.id}`,
          titulo: `Recibimos tu reserva R-${String(r.id).padStart(6, "0")}`,
          cuerpo: `${r.cantidad} × ${r.producto_nombre}. Te avisamos cuando la sucursal la tenga lista.`,
          cuerpoPublico: "Te avisamos cuando la sucursal la tenga lista.",
          url: "/reservas",
        });
      }
    }

    // ── Reserva lista: la sucursal la apartó (últimas 2 h) ────────────────
    if (inmediato) {
      const { data: listas, error: eRes } = await admin.from("app_reservas")
        .select("id, customer_id, producto_nombre, vence_at, branch_id")
        .in("customer_id", clientes).eq("estado", "lista")
        .gte("lista_at", new Date(Date.now() - 2 * 3600_000).toISOString());
      if (eRes) throw eRes;
      // La sucursal va en el TÍTULO (2026-10-15): es lo que se lee con el
      // teléfono bloqueado, donde el producto no sale. Sin el nombre, sin ella.
      const salas = [...new Set((listas ?? []).map((r: any) => r.branch_id).filter((b: unknown) => b != null))];
      const { data: brs, error: eBr } = salas.length
        ? await admin.from("branches").select("id, name").in("id", salas) : { data: [], error: null };
      if (eBr) console.error("no se pudieron leer las sucursales:", eBr.message);
      const sala = new Map((brs ?? []).map((b: any) => [b.id, String(b.name ?? "").trim()]));
      for (const r of listas ?? []) {
        const hasta = new Date(Date.parse(r.vence_at) - 6 * 3600_000);
        const h = hasta.getUTCHours(), m = String(hasta.getUTCMinutes()).padStart(2, "0");
        const antesDe = `antes de mañana a las ${h % 12 || 12}:${m} ${h < 12 ? "a. m." : "p. m."}`;
        const en = sala.get(r.branch_id) ? ` en ${sala.get(r.branch_id)}` : "";
        candidatos.push({
          customer_id: r.customer_id, tipo: "reserva", ref: `reserva-lista:${r.id}`,
          titulo: `Tu reserva está lista${en} 🛍️`,
          cuerpo: `${r.producto_nombre} te espera. Pasa a retirarlo ${antesDe}`,
          cuerpoPublico: `Pasa a retirarla ${antesDe}`,
          url: "/reservas",
        });
      }
    }

    // ── Oferta nueva: sólo a quien aceptó promociones ─────────────────────
    const { data: ofertas, error: eO } = !inmediato ? { data: [], error: null } : await admin.from("ofertas_clientes")
      .select("id, titulo, etiqueta, exclusiva")
      .eq("publicada", true).lte("inicio", hoy).gte("fin", hoy)
      .gte("updated_at", new Date(Date.now() - 2 * 86400_000).toISOString());
    if (eO) throw eO;
    if (ofertas?.length) {
      const { data: promo, error: eP } = await admin.from("customers")
        .select("id").in("id", clientes).eq("acepta_promociones", true);
      if (eP) throw eP;
      for (const o of ofertas) for (const c of promo ?? []) {
        candidatos.push({
          customer_id: c.id, tipo: "oferta", ref: `oferta:${o.id}`,
          titulo: o.etiqueta ? `${o.etiqueta} · ${o.titulo}` : o.titulo,
          cuerpo: o.exclusiva ? "Oferta exclusiva para socios. Mírala en la app." : "Nueva oferta en Farmacia Salud. Mírala en la app.",
          url: `/oferta/${o.id}`,
        });
      }
    }

    // ── Platino: la oferta antes que nadie (2026-10-07) ───────────────────
    // Las que empiezan en los próximos 2 días, sólo a Platino con promociones.
    const { data: pronto, error: ePr } = !diario ? { data: [], error: null } : await admin.from("ofertas_clientes")
      .select("id, titulo, inicio").eq("publicada", true).gt("inicio", hoy)
      .lte("inicio", new Date(Date.parse(`${hoy}T12:00:00Z`) + 2 * 86400_000).toISOString().slice(0, 10));
    if (ePr) console.error("no se pudieron leer las próximas ofertas:", ePr.message);
    if (pronto?.length) {
      const { data: promo, error: eP } = await admin.from("customers").select("id").in("id", clientes).eq("acepta_promociones", true);
      if (eP) throw eP;
      const { data: niv, error: eN } = promo?.length
        ? await admin.rpc("app_niveles_de", { p_clientes: promo.map((c: any) => c.id) }) : { data: [], error: null };
      if (eN) console.error("no se pudieron leer los niveles:", eN.message);
      for (const c of ((niv ?? []) as { customer_id: number; clave: string }[]).filter((n) => n.clave === "platino")) {
        for (const o of pronto) candidatos.push({
          customer_id: c.customer_id, tipo: "oferta", ref: `oferta-pronto:${o.id}`,
          titulo: `Antes que nadie 👑 · ${o.titulo}`,
          cuerpo: "Por ser Platino la ves desde hoy. Empieza para todos en unos días.",
          url: `/oferta/${o.id}`,
        });
      }
    }

    if (!candidatos.length) return json({ ok: true, avisos: 0, pendientes: pendientesBase });

    // Anotar primero: lo que ya estaba anotado NO vuelve (la UNIQUE lo frena).
    const { data: nuevos, error: eA } = await admin.from("app_cliente_avisos")
      .upsert(candidatos.map(({ cuerpoPublico: _p, ...a }) => a), { onConflict: "customer_id,tipo,ref", ignoreDuplicates: true })
      .select("id, customer_id, tipo, ref");
    if (eA) throw eA;
    const llave = (a: { customer_id: number; tipo: string; ref: string }) => `${a.customer_id}|${a.tipo}|${a.ref}`;
    const nuevosSet = new Map((nuevos ?? []).map((n) => [llave(n), n.id]));
    const aEnviar = candidatos.filter((c) => nuevosSet.has(llave(c)));
    const r = await enviar(admin, tokens, aEnviar);
    const enviados = aEnviar.filter((a) => r.ok_por.has(a.customer_id)).map((a) => nuevosSet.get(llave(a)));
    if (enviados.length) {
      const { error } = await admin.from("app_cliente_avisos").update({ enviado: true }).in("id", enviados);
      if (error) console.error("no se pudo marcar lo enviado:", error.message);
    }
    return json({ ok: true, candidatos: candidatos.length, nuevos: aEnviar.length, enviados: r.enviados, errores: r.errores, pendientes: pendientesBase });
  } catch (e) {
    console.error("[avisos-clientes]", (e as Error)?.message ?? e);
    return json({ ok: false, error: (e as Error)?.message ?? String(e) }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function enviar(admin: any, tokens: Map<number, Token[]>, avisos: Aviso[]) {
  // Un mensaje por teléfono: lo que nombra un producto se arma distinto en
  // iPhone y en Android (_shared/avisoPrivado.ts).
  const mensajes: (ReturnType<typeof mensajePush> & { _c: number; _s: string })[] = [];
  for (const a of avisos) for (const t of tokens.get(a.customer_id) ?? []) {
    mensajes.push({ ...mensajePush(a, t.token, t.plataforma), _c: a.customer_id, _s: t.id });
  }
  let enviados = 0;
  const errores: string[] = [];
  const ok_por = new Set<number>();
  const muertas: string[] = [];
  for (let i = 0; i < mensajes.length; i += 100) {
    const tanda = mensajes.slice(i, i + 100);
    const r = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(tanda.map(({ _c, _s, ...m }) => m)),
      // Con plazo: un Expo colgado no se lleva la corrida entera.
      signal: AbortSignal.timeout(20_000),
    }).catch((e) => ({ ok: false, status: 0, json: async () => null, _e: e }) as unknown as Response);
    const res = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(res?.data)) { errores.push(`expo ${r.status}`); continue; }
    res.data.forEach((t: { status: string; message?: string; details?: { error?: string } }, j: number) => {
      if (t.status === "ok") { enviados++; ok_por.add(tanda[j]._c); return; }
      errores.push(t.details?.error ?? t.message ?? "error");
      // El teléfono ya no tiene la app: se olvida el token.
      if (t.details?.error === "DeviceNotRegistered") muertas.push(tanda[j]._s);
    });
  }
  if (muertas.length) {
    const { error } = await admin.from("app_cliente_sesiones").update({ push_token: null }).in("id", muertas);
    if (error) console.error("no se pudieron limpiar los tokens:", error.message);
  }
  if (errores.length) console.error("[avisos-clientes] errores de envío:", [...new Set(errores)].join(", "));
  return { enviados, errores: [...new Set(errores)], ok_por };
}
