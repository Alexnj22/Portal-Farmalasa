// ─── Los puntos de un cliente, sin sesión ───────────────────────────────────
//
// La primera puerta del portal que se puede tocar desde internet sin
// credenciales. Eso cambia el modelo de amenaza por completo: no hay un usuario
// a quien atribuirle un intento fallido, así que el único límite posible es
// cuántos intentos se toleran.
//
// ── Por qué DUI *y* teléfono ────────────────────────────────────────────────
// Con sólo el teléfono, cualquiera que vea un ticket —o que pruebe números—
// vería el nombre y el saldo de esa persona. Un teléfono no es una contraseña:
// lo sabe la familia, sale en papeles y se puede recorrer entero. Exigir que los
// DOS coincidan en la misma ficha convierte «probar números» en «adivinar un
// par», que es otro problema.
//
// No es autenticación fuerte y no se pretende que lo sea. Por eso esta puerta
// muestra el saldo y los movimientos, y NADA de lo que no se puede deshacer:
// no permite canjear, no permite cambiar la ficha, y no devuelve el documento
// que se usó para entrar.
//
// ── Las tres reglas que la hacen publicable ─────────────────────────────────
//   1. FRENO por IP: 8 fallos en 15 minutos y deja de contestar.
//   2. La respuesta es IGUAL cuando el par no existe y cuando el DUI existe pero
//      el teléfono no coincide. Distinguirlas convertiría esto en un detector de
//      «este DUI es cliente», que es justo lo que no se quiere regalar.
//   3. El DUI no se guarda en el registro de intentos, sólo su huella. Un
//      registro que archiva documentos de identidad es una filtración esperando.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fallos tolerados por IP en 15 minutos. Bajo a propósito: quien escribe SUS
// datos no se equivoca ocho veces, y quien prueba los de otros necesita miles.
const TOPE_FALLOS = 8;

function conf() {
  const host = Deno.env.get("PUNTOS_MYSQL_HOST");
  const user = Deno.env.get("PUNTOS_MYSQL_USER");
  const password = Deno.env.get("PUNTOS_MYSQL_PASS");
  const database = Deno.env.get("PUNTOS_MYSQL_DB");
  if (!host || !user || !password || !database) return null;
  return { host, port: 3306, user, password, database, connectTimeout: 15_000 };
}

async function huella(dui: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`puntos:${dui}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "solo POST" }, 405);

  const cfg = conf();
  if (!cfg) return json({ error: "no disponible" }, 503);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // La IP real viene del proxy. Sin ella el freno no puede agrupar, así que se
  // usa una constante — que hace el freno GLOBAL en vez de por IP. Es más
  // estricto de lo debido y ése es el lado correcto para equivocarse.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "desconocida";

  let conn: any = null;
  try {
    const body = await req.json().catch(() => ({}));
    const dui = String(body?.dui ?? "").replace(/\D/g, "");
    const tel = String(body?.telefono ?? "").replace(/\D/g, "");

    // Un mismo texto para todo lo que no encontró: el par no existe, el DUI está
    // mal escrito, el teléfono no coincide. Quien pregunta no puede distinguir
    // cuál de las tres cosas pasó.
    const noEncontrado = {
      ok: false,
      motivo: "no_encontrado",
      mensaje: "No encontramos una ficha con ese documento y ese teléfono. Revisa los datos, o pregunta en cualquiera de nuestras salas.",
    };

    if (dui.length !== 9 || tel.length < 8) return json(noEncontrado);

    const h = await huella(dui);
    const { data: fallos, error: eReg } = await admin.rpc("puntos_consulta_registrar", {
      p_ip: ip, p_huella_dui: h, p_acerto: false,
    });
    // Si el freno no se pudo consultar, NO se contesta. Un freno que falla
    // abierto es lo mismo que no tenerlo, y acá lo que se protege son datos de
    // personas que no eligieron estar expuestas.
    if (eReg) return json({ error: "no disponible" }, 503);
    if (Number(fallos ?? 0) >= TOPE_FALLOS) {
      return json({
        ok: false, motivo: "muchos_intentos",
        mensaje: "Demasiados intentos. Espera unos minutos y vuelve a probar.",
      }, 429);
    }

    const { data: filas, error: eCli } = await admin.rpc("puntos_cliente_por_dui_y_telefono", {
      p_dui: dui, p_telefono: tel,
    });
    if (eCli) return json({ error: "no disponible" }, 503);
    const cli = Array.isArray(filas) ? filas[0] : null;
    if (!cli) return json(noEncontrado);

    // Acertó: se anota para que los fallos previos no lo sigan penalizando.
    await admin.rpc("puntos_consulta_registrar", { p_ip: ip, p_huella_dui: h, p_acerto: true });

    const mysql = await import("npm:mysql2@3.11.0/promise");
    conn = await mysql.createConnection(cfg);

    const [cuentas] = await conn.query(
      "SELECT idCliente, Puntos saldo FROM Clientes " +
      "WHERE REPLACE(REPLACE(DUI,'-',''),' ','') = ? LIMIT 2",
      [dui],
    ) as any;

    // Tiene ficha en el portal pero todavía no cuenta de puntos. Se dice, en vez
    // de mostrar un cero que se lee como «gasté y no me dieron nada».
    if (!cuentas?.length || cuentas.length > 1) {
      return json({
        ok: true, nombre: cli.name, saldo: 0, equivale: 0,
        acumulados: 0, canjeados: 0, movimientos: [],
        aviso: "Todavía no tienes cuenta de puntos. Se te crea en la sala la primera vez que acumulás.",
      });
    }

    const c = cuentas[0];
    const [[tot]] = await conn.query(
      "SELECT (SELECT COALESCE(SUM(PuntosVenta),0)     FROM Ventas WHERE idCliente = ?) acumulados, " +
      "       (SELECT COALESCE(SUM(PuntosCanjeados),0) FROM Canjes WHERE idCliente = ?) canjeados",
      [c.idCliente, c.idCliente],
    ) as any;

    const [movs] = await conn.query(
      `SELECT * FROM (
         SELECT 'compra' tipo, v.Fecha_ingreso fecha, v.PuntosVenta puntos, s.Abreviatura sala
           FROM Ventas v LEFT JOIN Sucursales s ON s.idSucursal = v.idSucursal
          WHERE v.idCliente = ?
         UNION ALL
         SELECT 'canje', k.FechaCanje, -k.PuntosCanjeados, s.Abreviatura
           FROM Canjes k LEFT JOIN Sucursales s ON s.idSucursal = k.idSucursal
          WHERE k.idCliente = ?
       ) m ORDER BY m.fecha DESC LIMIT 40`,
      [c.idCliente, c.idCliente],
    ) as any;

    const saldo = Number(c.saldo ?? 0);
    return json({
      ok: true,
      nombre: cli.name,
      saldo,
      // Cien puntos son un dólar. Se manda ya convertido: «$4.20 de descuento»
      // le dice algo a cualquiera, «420 puntos» no le dice nada a nadie.
      equivale: Math.round(saldo) / 100,
      acumulados: Number(tot?.acumulados ?? 0),
      canjeados: Number(tot?.canjeados ?? 0),
      // NUNCA se devuelve el documento ni el teléfono: el que pregunta ya los
      // tenía, y repetirlos sólo agrega una copia más de un dato sensible
      // viajando por la red.
      movimientos: (movs ?? []).map((m: any) => ({
        tipo: m.tipo, fecha: m.fecha, puntos: Number(m.puntos), sala: m.sala,
      })),
    });
  } catch (_e) {
    // Sin detalle hacia afuera: un mensaje de error de base de datos en una
    // puerta pública describe el esquema a quien esté mirando.
    return json({ error: "no disponible" }, 503);
  } finally {
    if (conn) { try { await conn.end(); } catch { /* ya terminó */ } }
  }
});
