// ─── La bolsa que lleva días encima de alguien ──────────────────────────────
//
// Un recorrido NO se puede cerrar con bultos sin entregar —decisión del usuario,
// «si lo sobró se debe entregar»— y esa regla, sola, no cierra nada: deja el
// recorrido abierto para siempre y a nadie enterado. Este aviso es la otra mitad.
//
// ── A quién se le avisa, y por qué a los dos ───────────────────────────────
// Al RETIRADOR, porque es el único que puede resolverlo: la bolsa está encima
// suyo. Y a la SALA DE DESTINO, porque es la que la está esperando y la única
// que va a reclamar si no llega. Avisarle sólo al primero es contarle a quien ya
// lo sabe — es [[feedback_una_alarma_que_espera_a_que_alguien_mire_no_cierra_el_circuito]].
//
// ── El antiduplicado lleva los días adentro ────────────────────────────────
// `check_key` incluye el número de días, así que el aviso se repite UNA vez por
// día que pasa y no una sola vez para siempre. Una alarma que suena una vez y se
// calla se pierde entre lo del día; una que suena cada corrida es ruido que se
// aprende a ignorar. Un aviso por día es lo que hace que el número suba a la
// vista de todos.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cuántos días de custodia dejan de ser normales. Decisión del usuario
// (2026-08-24). El mismo número vive en `DIAS_PARA_ALARMA` del portal, que sólo
// lo usa para pintar el renglón: el que decide el aviso es éste.
const DIAS = 3;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: viejos, error } = await supabase.rpc('retiro_bultos_viejos', { p_dias: DIAS });
    if (error) throw new Error(`retiro_bultos_viejos: ${error.message}`);

    const filas = Array.isArray(viejos) ? viejos : [];
    if (filas.length === 0) return json({ ok: true, avisados: 0, revisados: 0 });

    // La gente de las salas de destino, en UNA consulta y no una por bulto: son
    // pocas filas y varias bolsas suelen ir a la misma sala.
    const destinos = [...new Set(filas.map((f) => f.branch_id_destino).filter(Boolean))];
    const porSala = new Map<number, string[]>();
    if (destinos.length) {
      const { data: gente, error: e2 } = await supabase
        // `status` y NO `is_active`: esa columna no existe. El nombre suena a
        // booleano y la tabla guarda texto ('ACTIVO') — es la regla de CLAUDE.md
        // «el tipo de la columna manda, no el nombre», y un `.eq('is_active',
        // true)` acá no habría fallado: habría devuelto CERO filas en silencio,
        // y el aviso saldría sólo para el retirador durante semanas.
        .from('employees').select('id, branch_id').in('branch_id', destinos).eq('status', 'ACTIVO');
      // NUNCA ignorar el error de un query: sin esto el Map queda vacío y el
      // aviso sale sólo para el retirador, en silencio y por semanas.
      if (e2) throw new Error(`employees: ${e2.message}`);
      for (const g of gente ?? []) {
        const arr = porSala.get(g.branch_id) ?? [];
        arr.push(String(g.id));
        porSala.set(g.branch_id, arr);
      }
    }

    // Los antiduplicados de TODAS las bolsas en una consulta, no una por bolsa.
    // Eran N barridos de `notifications` —tabla sin índice para esa clave y que
    // sólo crece— encadenados uno tras otro dentro de una llamada con plazo.
    const claves = filas.map((f) => `bulto_viejo:${f.request_id}:${f.dias}`);
    const { data: yaAvisados, error: e5 } = await supabase
      .from('notifications').select('metadata').in('metadata->>check_key', claves);
    if (e5) throw new Error(`notifications: ${e5.message}`);
    const yaEstan = new Set((yaAvisados ?? []).map((n) => n?.metadata?.check_key).filter(Boolean));

    let avisados = 0;
    const fallidos: string[] = [];
    for (const f of filas) {
      const checkKey = `bulto_viejo:${f.request_id}:${f.dias}`;
      if (yaEstan.has(checkKey)) continue;

      const destinatarios = [...new Set([
        String(f.retirador_id),
        ...(porSala.get(f.branch_id_destino) ?? []),
      ])].filter(Boolean);
      if (destinatarios.length === 0) continue;

      // Un fallo en UNA bolsa no puede tumbar la corrida. El `check_key` lleva
      // los días adentro, así que las que quedaran sin avisar hoy NO se
      // reintentan mañana —mañana la clave es otra—: el aviso de este día se
      // perdería en silencio. Se anota y se sigue.
      const { error: e4 } = await supabase.rpc('notify_employees', {
        p_recipients: destinatarios,
        p_type: 'TRASLADO_SIN_ENTREGAR',
        p_title: `Lleva ${f.dias} días sin entregarse`,
        // Se nombra a la persona y el recorrido, no el número del traslado: quien
        // lo lee tiene que saber a quién preguntarle, que es lo único accionable.
        p_body: `${f.origen ?? 'Una sala'} → ${f.destino ?? 'otra sala'}, con ${f.retirador ?? 'alguien'}.`,
        p_link: '/traslados',
        p_metadata: { check_key: checkKey, request_id: f.request_id, dias: f.dias },
      });
      if (e4) { fallidos.push(`${checkKey}: ${e4.message}`); continue; }
      avisados++;
    }

    // `ok: false` cuando algo quedó sin avisar, y con el detalle: una corrida
    // que dice 200 sobre trabajo a medias es la forma en que un fallo vive
    // meses sin que nadie lo mire.
    return json({ ok: fallidos.length === 0, avisados, revisados: filas.length, fallidos },
                fallidos.length ? 500 : 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
