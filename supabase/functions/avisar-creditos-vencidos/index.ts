import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── La venta al crédito que ya se pasó del mes ─────────────────────────────
//
// Pedido del usuario (2-sep): «podemos avisar cuando una venta ya pasó el
// plazo». Hasta hoy el plazo existía sólo en la cabeza de quien fió: nadie lo
// miraba, y el crédito más viejo con saldo llevaba **462 días**.
//
// ── A quién se le avisa, y por qué a los dos ───────────────────────────────
// A QUIEN VENDIÓ, porque es quien sabe a quién llamar — el cliente le fió a esa
// persona, no a la empresa. Y a la JEFATURA DE LA SALA, porque quien vendió
// puede estar de vacaciones, haberse ido, o simplemente no hacerlo: un aviso
// que llega sólo a quien ya lo sabe no cierra ningún circuito.
//
// ── Uno por SALA, no uno por crédito ───────────────────────────────────────
// Son 34 créditos vencidos hoy repartidos en cinco salas. Treinta y cuatro
// avisos es ruido que se aprende a ignorar en una semana; cinco que dicen
// «7 créditos, $X» son cinco que se leen. El detalle está a un toque, en la
// pantalla que ya existe.
//
// ── El antiduplicado lleva el DÍA adentro ──────────────────────────────────
// `check_key` incluye la fecha, así que el aviso se repite una vez por día
// mientras haya algo vencido, y no una sola vez para siempre. Una alarma que
// suena una vez y se calla se pierde entre lo del día.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** El plazo de la política: un mes. El mismo número vive en `DIAS_DE_PLAZO`
 *  del portal, que sólo lo usa para pintar; el que decide el aviso es éste. */
const DIAS = 30;

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data, error } = await supabase.rpc('creditos_pasados_del_plazo', { p_dias: DIAS });
    if (error) throw new Error(`creditos_pasados_del_plazo: ${error.message}`);
    const filas = Array.isArray(data) ? data : [];
    if (!filas.length) return json({ ok: true, avisados: 0, vencidos: 0 });

    // La jefatura de cada sala, en UNA consulta. `status` y NO `is_active`: esa
    // columna no existe y la tabla guarda texto — un `.eq('is_active', true)`
    // devolvería CERO filas sin dar error, y el aviso saldría sólo para quien
    // vendió, en silencio y por meses.
    const salas = [...new Set(filas.map((f) => f.branch_id).filter(Boolean))];
    const { data: jefes, error: e2 } = await supabase
      .from('employees').select('id, branch_id, role_id')
      .in('branch_id', salas).eq('status', 'ACTIVO');
    if (e2) throw new Error(`employees: ${e2.message}`);

    const JEFE_DE_SALA = 19;
    const porSala = new Map<number, string[]>();
    for (const j of jefes ?? []) {
      if (j.role_id !== JEFE_DE_SALA) continue;
      const arr = porSala.get(j.branch_id) ?? [];
      arr.push(String(j.id));
      porSala.set(j.branch_id, arr);
    }

    // Agrupado por sala: cuántos, cuánto, y el más viejo — que es el que
    // convierte el aviso en algo que se puede ir a hacer.
    const grupos = new Map<number, { sala: string; n: number; total: number; dias: number; vendedores: Set<string> }>();
    for (const f of filas) {
      const g = grupos.get(f.branch_id) ?? { sala: f.sala ?? 'Una sala', n: 0, total: 0, dias: 0, vendedores: new Set<string>() };
      g.n++;
      g.total += Number(f.saldo) || 0;
      g.dias = Math.max(g.dias, Number(f.dias) || 0);
      if (f.vendedor_id) g.vendedores.add(String(f.vendedor_id));
      grupos.set(f.branch_id, g);
    }

    const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
    const claves = [...grupos.keys()].map((b) => `credito_vencido:${b}:${hoy}`);
    const { data: yaAvisados, error: e3 } = await supabase
      .from('notifications').select('metadata').in('metadata->>check_key', claves);
    if (e3) throw new Error(`notifications: ${e3.message}`);
    const yaEstan = new Set((yaAvisados ?? []).map((n) => n?.metadata?.check_key).filter(Boolean));

    let avisados = 0;
    const fallidos: string[] = [];
    for (const [branchId, g] of grupos) {
      const checkKey = `credito_vencido:${branchId}:${hoy}`;
      if (yaEstan.has(checkKey)) continue;

      const destinatarios = [...new Set([
        ...g.vendedores,
        ...(porSala.get(branchId) ?? []),
      ])].filter(Boolean);
      if (!destinatarios.length) continue;

      // Un fallo en UNA sala no puede tumbar la corrida. Y como la clave lleva
      // el día adentro, lo que quede sin avisar hoy NO se reintenta mañana: se
      // anota y se sigue.
      const { error: e4 } = await supabase.rpc('notify_employees', {
        p_recipients: destinatarios,
        p_type: 'CREDITO_VENCIDO',
        p_title: g.n === 1 ? 'Un crédito se pasó del mes' : `${g.n} créditos se pasaron del mes`,
        p_body: `${g.sala}: ${money(g.total)} sin cobrar. El más viejo lleva ${g.dias} días.`,
        p_link: `/cuentas-por-cobrar?sala=${branchId}&ver=VENCIDOS`,
        p_metadata: { check_key: checkKey, branch_id: branchId, creditos: g.n, total: g.total, dias: g.dias },
      });
      if (e4) { fallidos.push(`${checkKey}: ${e4.message}`); continue; }
      avisados++;
    }

    // `ok: false` cuando algo quedó sin avisar, y con el detalle: una corrida
    // que dice 200 sobre trabajo a medias es cómo un fallo vive meses sin que
    // nadie lo mire.
    return json({ ok: fallidos.length === 0, avisados, vencidos: filas.length, salas: grupos.size, fallidos },
                fallidos.length ? 500 : 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
