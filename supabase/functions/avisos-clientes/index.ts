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

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

interface Aviso { customer_id: number; tipo: string; ref: string; titulo: string; cuerpo: string; url: string }

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
      .select("id, customer_id, push_token")
      .not("customer_id", "is", null).not("push_token", "is", null)
      .is("revocada_at", null).eq("acepta_avisos", true);
    if (eSes) throw eSes;
    const tokens = new Map<number, { id: string; token: string }[]>();
    for (const s of ses ?? []) {
      const l = tokens.get(s.customer_id) ?? [];
      l.push({ id: s.id, token: s.push_token });
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

    const clientes = [...tokens.keys()];
    if (!clientes.length) return json({ ok: true, avisos: 0, motivo: "nadie con avisos encendidos" });

    const modo = body?.modo === "inmediato" || body?.modo === "diario" ? body.modo : "todo";
    const inmediato = modo !== "diario", diario = modo !== "inmediato";
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
          ? ["Tu cupón del mes 🎟️", `Tienes ${pts} puntos ($${(pts / 100).toFixed(2)}) para usar en caja este mes.`]
        : l.origen === "referido"
          ? ["¡Tu invitación funcionó! 🎉", `Ganaste ${pts} puntos por invitar a un amigo.`]
          : [`Ganaste ${pts} puntos`, "Gracias por tu compra. Mira tu saldo en la app."];
      candidatos.push({ customer_id: l.customer_id, tipo: "ganado", ref: `lote:${l.id}`, titulo, cuerpo,
        url: l.origen === "cumpleanos" ? "/puntos?cumple=1" : "/puntos" });
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
        url: "/inyecciones",
      });
    }

    // ── Reserva recibida: la confirmación al reservar (últimas 2 h) ───────
    if (inmediato) {
      const { data: nuevas, error: eNu } = await admin.from("app_reservas")
        .select("id, customer_id, producto_nombre, cantidad")
        .in("customer_id", clientes).eq("estado", "pendiente")
        .gte("created_at", new Date(Date.now() - 2 * 3600_000).toISOString());
      if (eNu) throw eNu;
      for (const r of nuevas ?? []) {
        candidatos.push({
          customer_id: r.customer_id, tipo: "reserva", ref: `reserva-recibida:${r.id}`,
          titulo: `Recibimos tu reserva R-${String(r.id).padStart(6, "0")}`,
          cuerpo: `${r.cantidad} × ${r.producto_nombre}. Te avisamos cuando la sucursal la tenga lista.`,
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
      for (const r of listas ?? []) {
        const hasta = new Date(Date.parse(r.vence_at) - 6 * 3600_000);
        const h = hasta.getUTCHours(), m = String(hasta.getUTCMinutes()).padStart(2, "0");
        candidatos.push({
          customer_id: r.customer_id, tipo: "reserva", ref: `reserva-lista:${r.id}`,
          titulo: "Tu reserva está lista 🛍️",
          cuerpo: `${r.producto_nombre} te espera. Pasa a retirarlo antes de mañana a las ${h % 12 || 12}:${m} ${h < 12 ? "a. m." : "p. m."}`,
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

    if (!candidatos.length) return json({ ok: true, avisos: 0 });

    // Anotar primero: lo que ya estaba anotado NO vuelve (la UNIQUE lo frena).
    const { data: nuevos, error: eA } = await admin.from("app_cliente_avisos")
      .upsert(candidatos, { onConflict: "customer_id,tipo,ref", ignoreDuplicates: true })
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
    return json({ ok: true, candidatos: candidatos.length, nuevos: aEnviar.length, enviados: r.enviados, errores: r.errores });
  } catch (e) {
    console.error("[avisos-clientes]", (e as Error)?.message ?? e);
    return json({ ok: false, error: (e as Error)?.message ?? String(e) }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function enviar(admin: any, tokens: Map<number, { id: string; token: string }[]>, avisos: Aviso[]) {
  const mensajes: { to: string; title: string; body: string; sound: string; data: { url: string }; _c: number; _s: string }[] = [];
  for (const a of avisos) for (const t of tokens.get(a.customer_id) ?? []) {
    mensajes.push({ to: t.token, title: a.titulo, body: a.cuerpo, sound: "default", data: { url: a.url }, _c: a.customer_id, _s: t.id });
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
