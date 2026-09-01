// ─── El puente de una sola vez: los saldos vienen al portal ──────────────────
//
// Lee `Clientes` de la base de puntos y los carga en el libro mayor del portal
// con `puntos_migrar`. Se corre UNA vez, el día del corte — no es un sync.
//
// Existe como edge function y no como script porque esa base **sólo la alcanzan
// las edge functions**: es MySQL en un servidor propio, con los secretos
// `PUNTOS_MYSQL_*` del proyecto. Desde afuera no hay camino.
//
// ── Liga por DUI, y por eso informa en vez de adivinar ──────────────────────
// La base de puntos no tiene el número del ERP: identifica por documento. Y el
// terreno tiene tres accidentes, medidos sobre las 28,111 fichas del portal el
// 2026-09-01:
//
//   · 11,415 fichas NO tienen DUI. A ésas no se les puede migrar nada.
//   · 100 DUI están repetidos en 203 fichas. Ahí NO se elige una: se informa.
//     Elegir mal le pone el saldo de una persona a otra, y eso no se deshace
//     mirando la tabla después.
//   · Los formatos no coinciden — el portal guarda `########-#` y el otro lado
//     mezcla. Se comparan sólo los DÍGITOS, que es lo que ya hace
//     `puntos-consulta` para la pantalla de la ficha.
//
// ── Simula por defecto ──────────────────────────────────────────────────────
// Con `simular` (el default) hace TODO el trabajo de lectura y cruce y no
// escribe una fila: devuelve cuántos entrarían, cuántos quedan afuera y por qué.
// Esa corrida es la que hay que mirar ANTES de la de verdad.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getCorsHeaders, requireInvokeSecret } from '../_shared/security.ts';

// Filas por llamada a `puntos_migrar`. Con ~14,600 cuentas son ocho tandas: un
// payload de 2,000 objetos entra cómodo y un fallo cuesta como mucho una tanda.
const TANDA = 2000;

function conf() {
  const host = Deno.env.get('PUNTOS_MYSQL_HOST');
  const user = Deno.env.get('PUNTOS_MYSQL_USER');
  const password = Deno.env.get('PUNTOS_MYSQL_PASS');
  const database = Deno.env.get('PUNTOS_MYSQL_DB');
  if (!host || !user || !password || !database) return null;
  return { host, port: 3306, user, password, database, connectTimeout: 15_000 };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (!requireInvokeSecret(req)) return json({ ok: false, error: 'no autorizado' }, 401);

  const cfg = conf();
  // `ok: false` a propósito: un 200 diciendo «no configurado» es una corrida que
  // se ve verde sin haber hecho nada.
  if (!cfg) return json({ ok: false, error: 'faltan los secretos PUNTOS_MYSQL_*' }, 500);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let conn: any = null;
  try {
    const body = await req.json().catch(() => ({}));
    const simular = body?.simular !== false;
    const ganadoEl = body?.ganado_el ?? '2026-10-01';

    const mysql = await import('npm:mysql2@3.11.0/promise');
    conn = await mysql.createConnection(cfg);

    // Sólo los que tienen algo que traer. Un saldo en cero no necesita lote, y
    // 0 no es un dato: es la ausencia de uno.
    const [filas] = await conn.query(
      'SELECT idCliente, DUI, Puntos FROM Clientes WHERE Puntos > 0 ORDER BY idCliente',
    ) as any;

    const total = { leidas: 0, migradas: 0, puntos: 0, saldo_cero: 0,
                    dui_corto_o_vacio: 0, sin_ficha_en_el_portal: 0,
                    dui_en_varias_fichas: 0, ya_migradas: 0 };
    const problemas: unknown[] = [];

    for (let i = 0; i < filas.length; i += TANDA) {
      const tanda = filas.slice(i, i + TANDA).map((f: any) => ({
        dui: String(f.DUI ?? ''),
        saldo: Number(f.Puntos ?? 0),
        id_cliente: String(f.idCliente ?? ''),
      }));

      const { data, error } = await supabase.rpc('puntos_migrar', {
        p_filas: tanda, p_ganado_el: ganadoEl, p_simular: simular,
      });
      if (error) throw new Error(`puntos_migrar (tanda ${i / TANDA}): ${error.message}`);

      const d = data as Record<string, number | unknown[]>;
      for (const k of Object.keys(total) as Array<keyof typeof total>) {
        total[k] += Number(d[k] ?? 0);
      }
      // Los primeros 200 problemas alcanzan para decidir; el resto sería ruido
      // en una respuesta que alguien tiene que leer.
      if (Array.isArray(d.problemas) && problemas.length < 200) {
        problemas.push(...d.problemas.slice(0, 200 - problemas.length));
      }
    }

    return json({
      ok: true, simulado: simular, ganado_el: ganadoEl,
      cuentas_con_saldo_en_el_otro_sistema: filas.length,
      ...total,
      // Lo que NO entró, que es lo que hay que mirar antes de la corrida real.
      problemas,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    if (conn) { try { await conn.end(); } catch { /* la corrida ya terminó */ } }
  }
});
