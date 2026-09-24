import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireInvokeSecret } from "../_shared/security.ts";
import { BASE, login, pedir } from "../_shared/erp-dte.ts";
import {
  direccionesPorSucursal,
  hoySV,
  renglonesDeTraslado,
  sesionEn,
  TRASLADO,
  VER,
} from "../_shared/erp-traslado.ts";

// Anota en el portal cada traslado que se hace en el sistema de la caja:
// fecha, sala de destino y producto (`traslados_erp_linea`).
//
// ── Por qué existe ─────────────────────────────────────────────────────────
// El aviso de productos sin venta (`productos_parados_de_sala`) cuenta los seis
// meses desde la última vez que el producto ENTRÓ a la sala. El portal sabe lo
// que él mismo movió, pero no lo que alguien trasladó a mano en el sistema: sin
// esto, un producto que llegó hace dos semanas por un traslado manual se lee
// como «medio año parado» y el aviso pide devolverlo recién llegado.
//
// ── Cómo recorre ───────────────────────────────────────────────────────────
// Los números de traslado son correlativos y globales, así que se sigue desde
// el último anotado: se abre `ver_traslado.php` del siguiente, y del
// siguiente, hasta encontrar `VACIOS_SEGUIDOS` números sin renglones — que es
// como contesta el sistema a un número que todavía no existe. El listado no
// sirve para esto: no filtra por fecha y devuelve los ~9,000 de cada sala en
// ~35 s (medido el 2026-09-24).
//
// ── El destino, por dirección EXACTA ───────────────────────────────────────
// La página del traslado da la dirección, no el número de sala. La tabla
// dirección → sala sale del propio sistema (`direccionesPorSucursal`), pero
// comparar por «contiene» es un error: la dirección de Salud 3 está CONTENIDA
// en la de Bodega (las dos en Crío. Totolco). Sin coincidencia exacta el
// renglón se guarda con destino NULL y se cuenta en la respuesta.
//
// La fecha es la del día en que se leyó. Con el cron cada hora el atraso es de
// minutos, y para un reloj de seis meses eso no cambia nada.
//
// No escribe una línea en el sistema: sólo lee.

const PRESUPUESTO_MS = 100_000;
const VACIOS_SEGUIDOS = 25;
const TOPE_POR_CORRIDA = 600;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (!requireInvokeSecret(req)) return json({ ok: false, error: "No autorizado." }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const arranque = Date.now();

  try {
    const cuerpo = await req.json().catch(() => ({}));

    // Desde dónde seguir. `desde` sólo hace falta la primera vez (o para
    // releer un tramo); después manda lo ya anotado.
    const { data: ult, error: ultErr } = await admin
      .from("traslados_erp_linea")
      .select("id_traslado")
      .eq("fuente", "recorrido")
      .order("id_traslado", { ascending: false })
      .limit(1);
    if (ultErr) throw ultErr;
    const desdeCuerpo = Number(cuerpo.desde);
    const ultimo = Number.isFinite(desdeCuerpo) && desdeCuerpo > 0
      ? desdeCuerpo
      : Number(ult?.[0]?.id_traslado ?? 0);
    if (!ultimo) {
      return json({ ok: false, codigo: "SIN_PUNTO_DE_PARTIDA", error: "Falta `desde` en la primera corrida." }, 400);
    }

    // Una sola sesión. Cada sala omite su propia dirección de la lista de
    // destinos, así que se leen dos (Bodega y Salud 1) para tenerlas todas.
    let sesion: Promise<string> | null = null;
    const unSoloLogin = () => (sesion ??= login());
    const direcciones = new Map<string, number>();
    let cookie = "";
    for (const sala of [6, 1]) {
      cookie = await sesionEn(sala, unSoloLogin);
      const html = await pedir(cookie, TRASLADO, undefined, { extra: { Referer: `${BASE}/dashboard.php` } });
      for (const [id, dir] of direccionesPorSucursal(html)) direcciones.set(dir, Number(id));
    }
    if (direcciones.size < 7) {
      // Sin la tabla completa, un destino que falte se anotaría NULL para
      // siempre (el renglón no se vuelve a leer). Mejor no avanzar.
      return json({ ok: false, codigo: "DIRECCIONES_INCOMPLETAS", encontradas: direcciones.size }, 502);
    }

    const fecha = hoySV();
    const lineas: Record<string, unknown>[] = [];
    let id = ultimo, vacios = 0, leidos = 0, sinDestino = 0, corte = false;

    while (vacios < VACIOS_SEGUIDOS) {
      if (Date.now() - arranque > PRESUPUESTO_MS || leidos >= TOPE_POR_CORRIDA) { corte = true; break; }
      id++;
      const html = await pedir(cookie, `${VER}?id_traslado=${id}`, undefined, {
        extra: { Referer: `${BASE}/admin_traslados.php` },
      });
      leidos++;
      const { renglones, destino } = renglonesDeTraslado(html);
      if (renglones.length === 0) { vacios++; continue; }
      vacios = 0;
      const sala = destino ? direcciones.get(destino) ?? null : null;
      if (sala === null) sinDestino++;
      renglones.forEach((r, i) => lineas.push({
        id_traslado: id, posicion: i + 1, fecha, destino: sala ?? "",
        descripcion: r.descripcion, presentacion: r.presentacion,
        unidad: r.unidad, cantidad: r.cantidad, fuente: "recorrido",
      }));
    }

    let insertados = 0;
    for (let k = 0; k < lineas.length; k += 400) {
      const { data, error } = await admin.rpc("registrar_traslados_erp", { p_lineas: lineas.slice(k, k + 400) });
      if (error) throw error;
      insertados += Number(data ?? 0);
    }

    return json({
      ok: true,
      desde: ultimo,
      hasta: id - vacios,
      leidos,
      renglones: lineas.length,
      insertados,
      sin_destino: sinDestino,
      corte,
      ms: Date.now() - arranque,
    });
  } catch (e) {
    console.error("leer-traslados-erp:", (e as Error).message);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
