// Sonda de diagnóstico: ¿alcanza el portal la base de puntos, y qué forma tiene?
//
// Existe por una razón concreta: el puerto 3306 de ese servidor NO contesta desde
// una máquina de desarrollo (filtrado por IP), así que no hay forma de mirar el
// esquema desde una sesión local. Lo que hoy escribe ahí es un Apps Script de
// Google, y su IP sí entra — de modo que «se puede» y «se puede desde acá» son
// dos preguntas distintas, y ésta contesta la que importa: desde el portal.
//
// ── Por qué prueba VARIOS puertos y no sólo el 3306 ─────────────────────────
// Un `timeout` en el 3306 tiene DOS causas posibles que se leen igual: que el
// firewall del hosting no deje entrar a esta IP, o que este runtime no permita
// abrir sockets TCP a puertos que no sean de HTTP. Probar sólo el 3306 no las
// distingue, y la respuesta cambia todo: en el primer caso hace falta un puente
// dentro de aquel servidor, y en el segundo no hace falta ninguno — bastaría
// autorizar la IP. Por eso se prueba TAMBIÉN el 443 del mismo host: si el 443
// abre y el 3306 no, el bloqueo es del otro lado.
//
// Después, con credenciales, MySQL: dice si además el usuario puede entrar.
//
// SOLO LEE: SHOW TABLES / SHOW COLUMNS / COUNT. No escribe una fila.
// Detrás de ADMIN_INVOKE_SECRET, como `erp-csv-probe`. Los dos ayudantes de
// `_shared/security.ts` van copiados acá y no importados: la primera versión se
// desplegó por MCP, que sube sólo los archivos de esta carpeta.

const HOST = "farmalasa.com";
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

async function probeTcp(hostname: string, port: number, esperaSaludo: boolean) {
  const t0 = Date.now();
  try {
    const conn = await Promise.race([
      Deno.connect({ hostname, port }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout 8s")), 8000)),
    ]);
    let saludo: string | undefined;
    if (esperaSaludo) {
      // El servidor MySQL habla primero: manda el saludo con su versión.
      const buf = new Uint8Array(128);
      const n = await Promise.race([
        conn.read(buf),
        new Promise<null>((res) => setTimeout(() => res(null), 4000)),
      ]);
      if (typeof n === "number" && n > 0) {
        saludo = new TextDecoder().decode(buf.subarray(0, n)).replace(/[^\x20-\x7e]/g, " ").trim();
      }
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
  const host: string = body?.host ?? HOST;

  const out: Record<string, unknown> = {
    host,
    // El 443 es el control: si TAMBIÉN falla, el problema es de este lado y el
    // 3306 no prueba nada sobre el firewall del hosting.
    "tcp:443":  await probeTcp(host, 443, false),
    "tcp:3306": await probeTcp(host, 3306, true),
  };

  if ((out["tcp:3306"] as any)?.ok && password) {
    try {
      const mysql = await import("npm:mysql2@3.11.0/promise");
      const conn = await mysql.createConnection({
        host, port: 3306, user: body?.user ?? USER, password,
        database: body?.database ?? DB, connectTimeout: 10000,
      });

      // Modo consulta: para entender cómo el otro sistema representa las cosas
      // antes de escribirle. SOLO LECTURA y con la puerta cerrada de dos formas
      // — una sola sentencia (sin `;`) y sólo verbos que leen. No es paranoia:
      // esta función tiene credenciales de escritura sobre la base de puntos de
      // 14,631 personas, y un `sql` que llegue desde afuera no puede poder más
      // que mirar.
      if (body?.sql) {
        const sql = String(body.sql).trim();
        if (sql.includes(";") || !/^(select|show|describe|desc|explain)\s/i.test(sql)) {
          await conn.end();
          return new Response(JSON.stringify({ error: "sólo una sentencia de lectura" }), {
            status: 400, headers: { ...cors, "Content-Type": "application/json" },
          });
        }
        const [filas] = await conn.query(sql) as any;
        await conn.end();
        return new Response(JSON.stringify({ ok: true, filas }, null, 2), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const [tablas] = await conn.query("SHOW TABLES") as any;
      const nombres = tablas.map((r: any) => Object.values(r)[0] as string);
      const detalle: Record<string, unknown> = {};
      for (const t of nombres) {
        const [cols] = await conn.query(`SHOW COLUMNS FROM \`${t}\``) as any;
        const [cnt]  = await conn.query(`SELECT COUNT(*) n FROM \`${t}\``) as any;
        detalle[t] = {
          filas: Number(cnt[0].n),
          columnas: cols.map((c: any) =>
            `${c.Field} ${c.Type}${c.Key ? ' ' + c.Key : ''}${c.Null === 'NO' ? ' NOT NULL' : ''}${c.Default != null ? ' def=' + c.Default : ''}${c.Extra ? ' ' + c.Extra : ''}`),
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
