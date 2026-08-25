// ─── La franja que está por cerrarse ────────────────────────────────────────
//
// ── Por qué existe ─────────────────────────────────────────────────────────
// Medido el 2026-08-25 sobre los primeros nueve días del módulo: **45 de 270
// lecturas (17%) entraron fuera de hora**. Nadie se olvida a propósito de una
// franja de dos horas — se olvida porque en la sala no hay nada que lo
// recuerde: la bitácora es la única tarea del día que no la dispara un cliente
// parado en el mostrador. El ítem 6.1.14 del RTS pide que el registro sea
// CONTEMPORÁNEO, y una lectura anotada a las 21:00 sobre lo que marcaba el
// termómetro a la 13:00 no lo es aunque el número sea cierto.
//
// ── UN aviso por ventana y por día ─────────────────────────────────────────
// El `check_key` lleva la sucursal, la fecha y la HORA DE CIERRE, y no los
// minutos que faltan. Con el cron cada media hora, una misma franja entraría en
// dos corridas y sonaría dos veces por lo mismo; sobre trece registros diarios
// eso es la forma más rápida de enseñarle a la sala a ignorar la campana.
// Distinto del aviso de bultos, donde la clave SÍ lleva los días adentro a
// propósito: allá el número sube y cada día es una noticia nueva.
//
// ── A quién ────────────────────────────────────────────────────────────────
// A la gente de ESA sala que puede anotar —cargo con `bitacoras` en can_edit—,
// que es la única que puede resolverlo. Avisarle a supervisión sería contarle a
// quien no tiene el termómetro en la mano.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cuánto antes se avisa. Con el cron cada 30 minutos, esta ventana garantiza
// que toda franja reciba su aviso al menos una vez, entre 15 y 45 minutos antes
// de cerrarse — tiempo suficiente para caminar la sala sin que el aviso llegue
// tan temprano que se olvide.
const MINUTOS = 45;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  // La llama un cron, así que va desplegada con `--no-verify-jwt` y no hay
  // sesión que presentar: la puerta la pone ella misma. Sin esto, una función
  // sin JWT que manda notificaciones y push es un megáfono abierto.
  const secreto = Deno.env.get('ADMIN_INVOKE_SECRET');
  if (!secreto || (req.headers.get('Authorization') ?? '') !== `Bearer ${secreto}`) {
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: filas, error } = await supabase.rpc('bitacora_pendientes_por_vencer', {
      p_minutos: MINUTOS,
    });
    if (error) throw new Error(`bitacora_pendientes_por_vencer: ${error.message}`);

    const pendientes = Array.isArray(filas) ? filas : [];
    if (pendientes.length === 0) return json({ ok: true, avisados: 0, ventanas: 0 });

    // ── Quién puede anotar ────────────────────────────────────────────────
    // Dos consultas para todas las salas, no dos por sala. Y NUNCA ignorar el
    // error: sin esto el Map queda vacío, no se avisa a nadie y la corrida
    // devuelve 200 — un aviso que no existe y una función que dice que sí.
    const { data: cargos, error: eC } = await supabase
      .from('role_permissions').select('role_id')
      .eq('module_key', 'bitacoras').eq('can_edit', true);
    if (eC) throw new Error(`role_permissions: ${eC.message}`);
    const rolesQuePueden = new Set((cargos ?? []).map((c) => c.role_id));

    const salas = [...new Set(pendientes.map((p) => p.branch_id).filter(Boolean))];
    const { data: gente, error: eG } = await supabase
      // `status` y no `is_active`: esa columna no existe, y el nombre suena a
      // booleano donde la tabla guarda texto ('ACTIVO').
      .from('employees').select('id, branch_id, role_id')
      .in('branch_id', salas).eq('status', 'ACTIVO');
    if (eG) throw new Error(`employees: ${eG.message}`);

    const porSala = new Map<number, string[]>();
    for (const g of gente ?? []) {
      if (!rolesQuePueden.has(g.role_id)) continue;
      const arr = porSala.get(g.branch_id) ?? [];
      arr.push(String(g.id));
      porSala.set(g.branch_id, arr);
    }

    // Los antiduplicados de TODAS las ventanas en una consulta.
    const claves = pendientes.map((p) => `bitacora_por_vencer:${p.branch_id}:${p.fecha}:${p.cierra}`);
    const { data: yaAvisados, error: eN } = await supabase
      .from('notifications').select('metadata').in('metadata->>check_key', claves);
    if (eN) throw new Error(`notifications: ${eN.message}`);
    const yaEstan = new Set((yaAvisados ?? []).map((n) => n?.metadata?.check_key).filter(Boolean));

    let avisados = 0;
    let sinDestinatario = 0;
    const fallidos: string[] = [];

    for (const p of pendientes) {
      const checkKey = `bitacora_por_vencer:${p.branch_id}:${p.fecha}:${p.cierra}`;
      if (yaEstan.has(checkKey)) continue;

      const destinatarios = porSala.get(p.branch_id) ?? [];
      if (destinatarios.length === 0) { sinDestinatario++; continue; }

      // El texto habla del PORTAL y de la sala, nunca de tablas ni de franjas:
      // «registros» es lo que la persona ve en pantalla.
      const cuantos = p.pendientes === 1 ? '1 registro' : `${p.pendientes} registros`;
      const { error: eA } = await supabase.rpc('notify_employees', {
        p_recipients: destinatarios,
        p_type: 'BITACORA_POR_VENCER',
        p_title: `La bitácora cierra a las ${p.cierra}`,
        p_body: `Faltan ${cuantos} en ${p.areas}. Quedan ${p.minutos} minutos para anotarlos a tiempo.`,
        // Abre la VUELTA, no la grilla: el aviso existe para ahorrar el paso
        // de ir a buscar qué falta.
        p_link: '/bitacoras?ronda=1',
        p_metadata: {
          check_key: checkKey,
          branch_id: p.branch_id,
          fecha: p.fecha,
          cierra: p.cierra,
          pendientes: p.pendientes,
        },
        p_push: true,
        p_branch_id: p.branch_id,
      });
      if (eA) { fallidos.push(`${checkKey}: ${eA.message}`); continue; }
      avisados++;
    }

    // `ok: false` cuando algo quedó sin avisar: una corrida que devuelve 200
    // sobre trabajo a medias es la forma en que un fallo vive meses sin que
    // nadie lo mire.
    return json(
      { ok: fallidos.length === 0, avisados, ventanas: pendientes.length, sinDestinatario, fallidos },
      fallidos.length ? 500 : 200,
    );
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
