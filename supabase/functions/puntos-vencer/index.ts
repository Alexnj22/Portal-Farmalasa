// ─── El vencimiento de los puntos ───────────────────────────────────────────
//
// Corre una vez al mes. Reconstruye los grupos de puntos de cada cliente —el
// más viejo se gasta primero— y quita los que pasaron su año.
//
// ── Por qué nace MIRANDO y no quitando ─────────────────────────────────────
// Es la única pieza del circuito que le saca algo al cliente, y el primer
// vencimiento posible es un año después de que arranque el programa: hasta ese
// día no hay un solo punto que quitar. Encenderla ahora en modo real no haría
// nada y no probaría nada. Corriendo en modo mirar, en cambio, la bitácora
// junta doce mediciones antes de que le pase a nadie — y la decisión de
// aplicarla se toma contra esas doce filas.
//
// Por eso `aplicar` es false por defecto y hay que pedirlo. Un trabajo
// destructivo cuyo modo seguro es el que se escribe solo no se enciende por
// accidente ni por un cuerpo vacío.
//
// ── La resta se hace como un canje, no borrando ────────────────────────────
// Igual que la reversión de una anulación. El saldo de esa base es
// «registrados − redimidos», `PuntosCanjeados` es unsigned —un negativo ni
// cabría— y la compra original queda intacta con la baja visible en el estado
// de cuenta. Borrar dejaría al cliente con menos puntos y ninguna línea que lo
// explique.
//
// ── Lo que mide y no aplica ────────────────────────────────────────────────
// `sin_gracia` es cuánto vencería si cada punto contara desde su propia compra,
// sin la regla de que lo viejo arranca el día del programa. NUNCA se aplica:
// se mide porque es exactamente el tamaño del escalón que llega el primer
// aniversario, y conviene saberlo con un año de anticipación.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  INICIO_PROGRAMA, MESES_DE_VIDA, SQL_LOTES_VIVOS,
  sumarMeses, venceEl, lotesConVencimiento,
} from "../_shared/puntosLotes.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tope de cuentas que una corrida puede tocar. No es una cuota de rendimiento:
// es el freno para que un error de fecha —un corte mal calculado— no se lleve el
// programa entero en una noche. Si el tope se alcanza, la corrida lo dice y la
// siguiente sigue; que tarde tres meses en ponerse al día es preferible a
// descubrir el error después.
const TOPE_CUENTAS = 500;

function conf() {
  const host = Deno.env.get("PUNTOS_MYSQL_HOST");
  const user = Deno.env.get("PUNTOS_MYSQL_USER");
  const password = Deno.env.get("PUNTOS_MYSQL_PASS");
  const database = Deno.env.get("PUNTOS_MYSQL_DB");
  if (!host || !user || !password || !database) return null;
  return { host, port: 3306, user, password, database, connectTimeout: 15_000 };
}

/**
 * Los grupos que YA cumplieron doce meses desde su propia compra.
 *
 * Se filtra en la base y no acá porque sin el filtro esto baja todo el
 * historial vivo. La condición es NECESARIA para vencer con o sin gracia, así
 * que las dos cuentas salen de la misma consulta: la de gracia es este conjunto
 * pasado por `venceEl`.
 */
const SQL_CANDIDATOS = `
  WITH canj AS (
    SELECT idCliente, COALESCE(SUM(PuntosCanjeados), 0) AS gastado
      FROM Canjes GROUP BY idCliente
  ),
  acum AS (
    SELECT v.idCliente,
           DATE_FORMAT(v.Fecha_ingreso, '%Y-%m-%d') AS fecha,
           v.PuntosVenta AS puntos,
           SUM(v.PuntosVenta) OVER (PARTITION BY v.idCliente
                                    ORDER BY v.Fecha_ingreso, v.idVenta
                                    ROWS UNBOUNDED PRECEDING) AS acumulado
      FROM Ventas v
  )
  SELECT a.idCliente, a.fecha,
         LEAST(a.puntos, a.acumulado - COALESCE(c.gastado, 0)) AS quedan
    FROM acum a
    LEFT JOIN canj c   ON c.idCliente  = a.idCliente
    JOIN Clientes cl   ON cl.idCliente = a.idCliente
   WHERE a.acumulado - COALESCE(c.gastado, 0) > 0
     AND cl.Puntos > 0
     AND a.fecha <= ?
   ORDER BY a.idCliente, a.fecha
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const secreto = Deno.env.get("ADMIN_INVOKE_SECRET");
  if (!secreto || (req.headers.get("Authorization") ?? "") !== `Bearer ${secreto}`) {
    return json({ error: "no autorizado" }, 401);
  }

  const cfg = conf();
  if (!cfg) return json({ error: "faltan credenciales" }, 503);

  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const aplicar = body?.aplicar === true;
  const tope = Math.min(Number(body?.tope) || TOPE_CUENTAS, TOPE_CUENTAS);
  // Se puede pasar una fecha para medir un escenario. No cambia lo que se
  // aplica salvo que además se pida aplicar, y eso es deliberado: medir «qué
  // pasaría en marzo» tiene que ser barato y no tener consecuencias.
  const hoy = String(body?.al ?? new Date().toISOString().slice(0, 10)).slice(0, 10);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let conn: any = null;
  try {
    const mysql = await import("npm:mysql2@3.11.0/promise");
    conn = await mysql.createConnection(cfg);

    // Doce meses hacia atrás: nada más nuevo que esto puede haber vencido.
    const corte = sumarMeses(hoy, -MESES_DE_VIDA);
    const [filas] = await conn.query(SQL_CANDIDATOS, [corte]) as any;

    // Por cliente, dos sumas: la que de verdad vence (con la gracia) y la que
    // vencería sin ella.
    const conGracia = new Map<number, number>();
    const sinGracia = new Map<number, number>();
    for (const f of filas ?? []) {
      const id = Number(f.idCliente);
      const pts = Number(f.quedan);
      if (!(pts > 0)) continue;
      sinGracia.set(id, (sinGracia.get(id) ?? 0) + pts);
      if (venceEl(String(f.fecha)) <= hoy) conGracia.set(id, (conGracia.get(id) ?? 0) + pts);
    }

    const resumen = {
      evaluado_al: hoy,
      arranca: INICIO_PROGRAMA,
      primer_vencimiento_posible: sumarMeses(INICIO_PROGRAMA, MESES_DE_VIDA),
      clientes: conGracia.size,
      puntos: [...conGracia.values()].reduce((a, b) => a + b, 0),
      clientes_sin_gracia: sinGracia.size,
      puntos_sin_gracia: [...sinGracia.values()].reduce((a, b) => a + b, 0),
      descuadrados: 0,
      aplicados: 0,
      puntos_quitados: 0,
      tope_alcanzado: false,
      no_cuadraron: [] as number[],
    };

    if (aplicar && conGracia.size > 0) {
      let tocadas = 0;
      for (const [idCliente, aQuitar] of conGracia) {
        if (tocadas >= tope) { resumen.tope_alcanzado = true; break; }

        await conn.beginTransaction();
        try {
          // El saldo se bloquea ANTES de recalcular: entre leer y escribir, una
          // caja puede haber cobrado un canje y el número que se restaría sería
          // de un saldo que ya no existe.
          const [[fila]] = await conn.query(
            "SELECT Puntos FROM Clientes WHERE idCliente = ? FOR UPDATE", [idCliente]);
          const saldo = Number(fila?.Puntos ?? 0);

          // Se vuelve a armar el reparto con el saldo bloqueado y se compara con
          // él. Si el historial no suma su propio saldo, las fechas que salen de
          // ahí son inventadas y NO se le quita nada a esa cuenta: se anota.
          const [vivos] = await conn.query(SQL_LOTES_VIVOS, [idCliente, idCliente]) as any;
          const lotes = lotesConVencimiento(vivos ?? []);
          const suma = lotes.reduce((s, l) => s + l.puntos, 0);
          if (Math.abs(suma - saldo) >= 1) {
            resumen.descuadrados++;
            resumen.no_cuadraron.push(idCliente);
            await conn.rollback();
            continue;
          }

          const vencido = lotes.filter((l) => l.vence <= hoy)
            .reduce((s, l) => s + l.puntos, 0);
          // Nunca más de lo que hay, nunca negativo: el mismo freno que la
          // reversión de una anulación.
          const resta = Math.max(0, Math.min(vencido, saldo));
          if (resta === 0) { await conn.rollback(); continue; }

          await conn.query(
            "INSERT INTO Canjes (idCliente, idVendedor, idSucursal, PuntosCanjeados, TKT, Tipo) " +
            "VALUES (?, 0, 0, ?, ?, 'C')",
            [idCliente, resta, `Vence ${hoy.slice(0, 7)}`.slice(0, 20)],
          );
          await conn.query(
            "UPDATE Clientes SET Puntos = Puntos - ? WHERE idCliente = ?", [resta, idCliente]);
          await conn.commit();

          resumen.aplicados++;
          resumen.puntos_quitados += resta;
          tocadas++;
        } catch (e) {
          await conn.rollback();
          console.error("no se pudo vencer la cuenta", idCliente, e instanceof Error ? e.message : e);
        }
      }
    }

    const ms = Date.now() - t0;
    const { error: eLog } = await admin.from("puntos_vencimiento_log").insert({
      simulado: !aplicar,
      evaluado_al: hoy,
      clientes: resumen.clientes,
      puntos: resumen.puntos,
      clientes_sin_gracia: resumen.clientes_sin_gracia,
      puntos_sin_gracia: resumen.puntos_sin_gracia,
      descuadrados: resumen.descuadrados,
      detalle: resumen,
      ms,
    });
    // La bitácora que no se pudo escribir se dice, no se traga: una corrida que
    // quitó puntos y no dejó fila es exactamente lo que esta tabla existe para
    // que no pase.
    if (eLog) console.error("no se pudo anotar la corrida:", eLog.message);

    return json({ ok: true, aplicado: aplicar, ms, ...resumen });
  } catch (e) {
    console.error("puntos-vencer:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    if (conn) { try { await conn.end(); } catch { /* ya terminó */ } }
  }
});
