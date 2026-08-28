// Sonda de diagnóstico: ¿alcanza el portal la base de puntos, y qué forma tiene?
//
// Existe por una razón concreta: el puerto 3306 de ese servidor NO contesta desde
// una máquina de desarrollo (filtrado por IP), así que no hay forma de mirar el
// esquema desde una sesión local. Lo que hoy escribe ahí es un Apps Script de
// Google, y su IP sí entra — de modo que «se puede» y «se puede desde acá» son
// dos preguntas distintas, y ésta contesta la que importa: desde el portal.
//
// Hace DOS pruebas separadas a propósito:
//   1. TCP crudo (Deno.connect) — dice si el firewall deja pasar. Si esto falla,
//      ningún driver va a andar y la respuesta es «hay que autorizar la IP».
//   2. MySQL con credenciales — dice si además el usuario puede entrar.
// Sin la primera, un fallo de autenticación y uno de firewall se leen igual.
//
// SOLO LEE: SHOW TABLES / SHOW COLUMNS / COUNT. No escribe una fila.
// Detrás de ADMIN_INVOKE_SECRET, como `erp-csv-probe`. Los dos ayudantes de
// `_shared/security.ts` van copiados acá y no importados: se despliega por MCP,
// que sube sólo los archivos de esta carpeta.

const HOST = "farmalasa.com";
const PORT = 3306;
const DB   = "u651865694_puntossalud";
const USER = "u651865694_puntossalud";

function getCorsHeaders(_req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

function requireInvokeSecret(req: Request): boolean {
  const secret = Deno.env.get("ADMIN_INVOKE_SECRET");
  if (!secret) return false;
  return (req.headers.get("Authorization") ?? "") === `Bearer ${secret}`;
}

async function probeTcp(): Promise<{ ok: boolean; ms: number; detalle?: string }> {
  const t0 = Date.now();
  try {
    const conn = await Promise.race([
      Deno.connect({ hostname: HOST, port: PORT }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout 8s")), 8000)),
    ]);
    // El servidor MySQL habla primero: manda el saludo con su versión.
    const buf = new Uint8Array(128);
    const n = await Promise.race([
      conn.read(buf),
      new Promise<null>((res) => setTimeout(() => res(null), 4000)),
    ]);
    let saludo: string | undefined;
    if (typeof n === "number" && n > 0) {
      saludo = new TextDecoder().decode(buf.subarray(0, n)).replace(/[^\x20-\x7e]/g, " ").trim();
    }
    conn.close();
    return { ok: true, ms: Date.now() - t0, detalle: saludo };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detalle: String((e as any)?.message ?? e) };
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!requireInvokeSecret(req)) {
    return new Response(JSON.stringify({ error: "no autorizado" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const password: string | undefined = body?.password;

  const tcp = await probeTcp();
  const out: Record<string, unknown> = { host: `${HOST}:${PORT}`, tcp };

  if (tcp.ok && password) {
    try {
      const mysql = await import("npm:mysql2@3.11.0/promise");
      const conn = await mysql.createConnection({
        host: HOST, port: PORT, user: USER, password, database: DB, connectTimeout: 10000,
      });
      const [tablas] = await conn.query("SHOW TABLES") as any;
      const nombres = tablas.map((r: any) => Object.values(r)[0] as string);
      const detalle: Record<string, unknown> = {};
      for (const t of nombres) {
        const [cols] = await conn.query(`SHOW COLUMNS FROM \`${t}\``) as any;
        const [cnt]  = await conn.query(`SELECT COUNT(*) n FROM \`${t}\``) as any;
        detalle[t] = {
          filas: Number(cnt[0].n),
          columnas: cols.map((c: any) =>
            `${c.Field} ${c.Type}${c.Key ? ' ' + c.Key : ''}${c.Default != null ? ' def=' + c.Default : ''}`),
        };
      }
      await conn.end();
      out.mysql = { ok: true, tablas: detalle };
    } catch (e) {
      out.mysql = { ok: false, error: String((e as any)?.message ?? e) };
    }
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
