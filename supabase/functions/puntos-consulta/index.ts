// ─── Preguntarle a la base de puntos, desde una pantalla ────────────────────
//
// Existe porque el estado de los puntos NO vive en el portal: vive en la base
// del programa de puntos, y el navegador no puede hablar MySQL. Ésta es la única
// puerta.
//
// ── Qué quedó acá, y qué se fue ─────────────────────────────────────────────
// Sólo los MOVIMIENTOS de un cliente: su saldo y su historial de compras y
// canjes. Eso vive únicamente del otro lado y se pide de a un cliente, cuando
// alguien abre el panel — no tiene sentido copiarlo.
//
// El ESTADO de puntos de cada venta sí se copió a Postgres el 2026-08-29,
// porque el usuario pidió poder FILTRAR la lista por él y la lista se pagina en
// el servidor: un filtro que vive en otra base no se puede aplicar. Ese estado
// ya no pasa por acá.
//
// ── Quién puede preguntar ───────────────────────────────────────────────────
// La llama el NAVEGADOR con la sesión de quien mira, así que va con `verify_jwt`
// y además comprueba el permiso del módulo — el JWT dice quién sos, no qué
// podés ver. `clientes`: el mismo permiso que ya hace falta para abrir la ficha,
// sin inventar uno nuevo (decisión del usuario).
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders, requireActiveEmployeeUser, permisoDeModulo,
} from "../_shared/security.ts";

function conf() {
  const host = Deno.env.get("PUNTOS_MYSQL_HOST");
  const user = Deno.env.get("PUNTOS_MYSQL_USER");
  const password = Deno.env.get("PUNTOS_MYSQL_PASS");
  const database = Deno.env.get("PUNTOS_MYSQL_DB");
  if (!host || !user || !password || !database) return null;
  return { host, port: 3306, user, password, database, connectTimeout: 15_000 };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const cfg = conf();
  if (!cfg) return json({ error: "faltan los secretos PUNTOS_MYSQL_*" }, 500);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const empleado = await requireActiveEmployeeUser(req, admin);
  if (!empleado) return json({ error: "Sesión inválida o empleado inactivo." }, 401);

  let conn: any = null;
  try {
    const body = await req.json().catch(() => ({}));
    const accion = body?.accion;

    const mysql = await import("npm:mysql2@3.11.0/promise");

    // ⚠️ Acá vivía una acción `ventas` que le preguntaba el estado a la base de
    // puntos por cada página de la lista. Se quitó el 2026-08-29 al espejar ese
    // estado en Postgres —hizo falta para poder FILTRAR—: ahora viaja en la
    // misma consulta de la lista. Dejarla habría dejado la regla de los cinco
    // estados escrita en DOS lugares, y dos copias de una regla de cinco ramas
    // divergen; la que se rompe es la que nadie mira. La regla vive hoy en la
    // columna generada `puntos_enviados.estado_puntos`, en la base.

    // ── Los movimientos de puntos de un cliente ───────────────────────────
    if (accion === "cliente") {
      const permiso = await permisoDeModulo(admin, empleado.id, "clientes", "can_view");
      if (!permiso.puede) return json({ error: "No tienes permiso para ver clientes." }, 403);

      const customerId = body?.customer_id;
      if (!customerId) return json({ error: "falta customer_id" }, 400);

      const { data: cli, error } = await admin
        .from("customers").select("id, name, dui").eq("id", customerId).maybeSingle();
      if (error) throw new Error(`customers: ${error.message}`);
      // Sin DUI no hay puente posible: el otro sistema identifica por documento,
      // no por nombre. Se devuelve el motivo para que la pantalla lo DIGA en vez
      // de mostrar un vacío que se lee como «no tiene puntos».
      if (!cli?.dui) return json({ ok: true, motivo: "sin_dui", cliente: null, movimientos: [] });

      // Sólo los dígitos: el portal guarda `########-#` y el otro sistema mezcla
      // formatos (largos de 1 a 10 caracteres medidos sobre 14,629 fichas).
      // Comparar el texto crudo perdería la mayoría de las coincidencias.
      const dui = String(cli.dui).replace(/\D/g, "");
      if (dui.length < 8) return json({ ok: true, motivo: "dui_corto", cliente: null, movimientos: [] });

      conn = await mysql.createConnection(cfg);
      const [cuentas] = await conn.query(
        "SELECT idCliente, TRIM(CONCAT(COALESCE(Nombres,''),' ',COALESCE(Apellidos,''))) nombre, Puntos saldo " +
        "FROM Clientes WHERE REPLACE(REPLACE(DUI,'-',''),' ','') = ? LIMIT 2",
        [dui],
      ) as any;

      if (!cuentas?.length) return json({ ok: true, motivo: "sin_cuenta", cliente: null, movimientos: [] });
      // Dos fichas con el mismo documento es un problema de aquel sistema, no
      // algo que esta pantalla pueda resolver — se dice y no se elige una.
      if (cuentas.length > 1) return json({ ok: true, motivo: "duplicado", cliente: null, movimientos: [] });

      const c = cuentas[0];
      const [movs] = await conn.query(
        `SELECT * FROM (
           SELECT 'acumulacion' AS tipo, v.Fecha_ingreso AS fecha, v.PuntosVenta AS puntos,
                  v.TicketFactura AS documento, s.Abreviatura AS sala
             FROM Ventas v LEFT JOIN Sucursales s ON s.idSucursal = v.idSucursal
            WHERE v.idCliente = ?
           UNION ALL
           SELECT 'canje' AS tipo, k.FechaCanje AS fecha, -k.PuntosCanjeados AS puntos,
                  k.TKT AS documento, s.Abreviatura AS sala
             FROM Canjes k LEFT JOIN Sucursales s ON s.idSucursal = k.idSucursal
            WHERE k.idCliente = ?
         ) m ORDER BY m.fecha DESC LIMIT 200`,
        [c.idCliente, c.idCliente],
      ) as any;

      return json({
        ok: true,
        cliente: { id_puntos: c.idCliente, nombre: c.nombre, saldo: Number(c.saldo ?? 0) },
        movimientos: movs ?? [],
      });
    }

    return json({ error: "acción desconocida" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    if (conn) { try { await conn.end(); } catch { /* la consulta ya terminó */ } }
  }
});
