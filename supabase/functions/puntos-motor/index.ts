// ─── El motor del programa de puntos, en el portal ───────────────────────────
//
// Hace las tres cosas de una corrida y en este orden, que importa:
//
//   1. ACUMULAR  — las ventas elegibles del rango dan sus puntos
//   2. CANJES    — los descuentos aplicados en el sistema de ventas se registran
//                  y se descuentan del saldo
//   3. ANULACIONES — las ventas que dejaron de estar finalizadas devuelven lo
//                  que dieron
//
// El orden no es casual: si el canje corriera antes que la acumulación, una
// persona que compra y canjea el mismo día no tendría todavía los puntos de esa
// compra y el canje saldría «sin saldo suficiente» — un aviso falso a la sala
// por un problema de orden, que es la clase de alerta que enseña a ignorarlas.
//
// ── DOS interruptores, y hacen falta LOS DOS ────────────────────────────────
// Esta función no escribe nada a menos que:
//   · exista un cron (o alguien) que la llame, Y
//   · `puntos_config.acumulacion_activa` esté en true.
//
// Si la bandera está apagada, la corrida se hace igual pero SIMULADA: informa
// exactamente lo que haría y no toca una fila. Así el cron se puede crear y
// observar durante días antes de encender nada, y encender es un UPDATE de una
// fila —nunca una migración—, que es la lección del outage del 2026-07-08.
//
// ── Los avisos ──────────────────────────────────────────────────────────────
// `puntos_barrer_canjes` devuelve los avisos ARMADOS pero no los manda: una
// función de Postgres no manda notificaciones. Acá se mandan, con `check_key`
// antiduplicado, a la sala donde pasó y a los supervisores.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getCorsHeaders, requireInvokeSecret } from '../_shared/security.ts';

// Ventana por defecto. Más ancha que la de un minuto a propósito: una factura
// que entra tarde al portal igual se procesa, y como la exclusión es «¿ya tiene
// lote?» y no «¿está en la ventana?», repetir el rango no cuesta ni duplica.
const DIAS_ATRAS = 3;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (!requireInvokeSecret(req)) return json({ ok: false, error: 'no autorizado' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const hoy = new Date();
    const hasta = body?.hasta ?? hoy.toISOString().slice(0, 10);
    const desde = body?.desde ??
      new Date(hoy.getTime() - DIAS_ATRAS * 86_400_000).toISOString().slice(0, 10);

    // La bandera manda. `simular: false` en el cuerpo NO alcanza para escribir:
    // hace falta además que el programa esté encendido en la base. Un parámetro
    // que puede encender solo un trabajo destructivo es un parámetro que alguien
    // pone por error una vez.
    const { data: cfg, error: eCfg } = await supabase
      .from('puntos_config').select('acumulacion_activa, fuente').maybeSingle();
    if (eCfg) throw new Error(`puntos_config: ${eCfg.message}`);

    const encendido = cfg?.acumulacion_activa === true;
    const simular = encendido ? (body?.simular === true) : true;

    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return data as Record<string, unknown>;
    };

    const acumulacion = await rpc('puntos_acumular', {
      p_desde: desde, p_hasta: hasta, p_margen: body?.margen ?? 0.02,
      p_tope: body?.tope ?? 20000, p_simular: simular,
    });

    const canjes = await rpc('puntos_barrer_canjes', {
      p_desde: desde, p_hasta: hasta, p_simular: simular, p_tope: body?.tope_canjes ?? 500,
    });

    const anulaciones = await rpc('puntos_barrer_anulaciones', {
      p_desde: desde, p_hasta: hasta, p_simular: simular, p_tope: body?.tope_anulaciones ?? 500,
    });

    // ── Avisar a la sala y a supervisión ────────────────────────────────────
    const avisos = (canjes?.avisos ?? []) as Array<Record<string, unknown>>;
    let avisados = 0;
    const fallidos: string[] = [];

    if (!simular && avisos.length) {
      // Los antiduplicados de TODOS los avisos en una consulta, no uno por
      // aviso: `notifications` sólo crece y no tiene índice para esta clave.
      const claves = avisos.map((a) => `puntos_sin_saldo:${a.invoice_id}`);
      const { data: yaAvisados, error: e1 } = await supabase
        .from('notifications').select('metadata').in('metadata->>check_key', claves);
      if (e1) throw new Error(`notifications: ${e1.message}`);
      const yaEstan = new Set((yaAvisados ?? []).map((n: any) => n?.metadata?.check_key).filter(Boolean));

      // Quién recibe: la gente de la sala donde pasó, más supervisión. Se
      // resuelve UNA vez para toda la corrida.
      const codigos = [...new Set(avisos.map((a) => a.sucursal).filter(Boolean))];
      const { data: salas, error: e2 } = await supabase
        .from('branches').select('id, codigo_puntos').in('codigo_puntos', codigos as string[]);
      if (e2) throw new Error(`branches: ${e2.message}`);
      const salaPorCodigo = new Map((salas ?? []).map((s: any) => [s.codigo_puntos, s.id]));

      // `status` y NO `is_active`: esa columna no existe, aunque el nombre suene
      // a que sí. Y `tipo_ficha = 'empleado'` porque no toda fila de
      // `employees` es una persona a la que avisarle: hay fichas de servicio
      // externo y de pruebas.
      const { data: gente, error: e3 } = await supabase
        .from('employees').select('id, branch_id, role_id')
        .eq('status', 'ACTIVO').eq('tipo_ficha', 'empleado');
      // NUNCA ignorar el error de un query: sin esto el Map queda vacío y el
      // aviso no sale para nadie, en silencio.
      if (e3) throw new Error(`employees: ${e3.message}`);

      const porSala = new Map<number, string[]>();
      // Supervisión recibe TODOS los avisos, sea cual sea la sala: es quien
      // puede cruzar el patrón entre salas, que es donde se ve si esto es un
      // error de caja o algo peor. Rol 13 = «Supervisor/a de Ventas».
      const supervision: string[] = [];
      for (const g of gente ?? []) {
        if (g.role_id === 13) supervision.push(String(g.id));
        if (!g.branch_id) continue;
        const arr = porSala.get(g.branch_id) ?? [];
        arr.push(String(g.id));
        porSala.set(g.branch_id, arr);
      }

      for (const a of avisos) {
        const checkKey = `puntos_sin_saldo:${a.invoice_id}`;
        if (yaEstan.has(checkKey)) continue;
        const salaId = salaPorCodigo.get(a.sucursal as string);
        const destinatarios = [...new Set([
          ...(porSala.get(salaId as number) ?? []),
          ...supervision,
        ])];
        if (!destinatarios.length) continue;

        // Un fallo en UN aviso no puede tumbar la corrida: se anota y se sigue.
        const { error: e4 } = await supabase.rpc('notify_employees', {
          p_recipients: destinatarios,
          p_type: 'PUNTOS_SIN_SALDO',
          p_title: 'Se canjearon puntos que el cliente no tenía',
          // Se dice cuánto se pidió y cuánto había: es lo único accionable.
          p_body: `Se aplicaron ${a.pedidos} puntos de descuento y el cliente tenía ${a.tenia}. Hay que revisar la venta.`,
          p_link: '/clientes',
          p_metadata: { check_key: checkKey, invoice_id: a.invoice_id, customer_id: a.customer_id },
          p_push: false,
          p_branch_id: salaId ?? null,
        });
        if (e4) { fallidos.push(`${checkKey}: ${e4.message}`); continue; }
        avisados++;
      }
    }

    // `ok: false` cuando algo quedó a medias, y con el detalle. Una corrida que
    // devuelve 200 sobre trabajo incompleto es como un fallo vive meses sin que
    // nadie lo mire.
    return json({
      ok: fallidos.length === 0,
      encendido, simulado: simular, ventana: { desde, hasta },
      acumulacion, canjes, anulaciones,
      avisados, avisos_pendientes: avisos.length, fallidos,
    }, fallidos.length ? 500 : 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
