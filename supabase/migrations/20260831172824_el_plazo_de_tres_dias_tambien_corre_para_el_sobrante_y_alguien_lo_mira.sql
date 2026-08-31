SET lock_timeout = '5s';

-- ── 1. El plazo también corre para el sobrante ──────────────────────────────
--
-- `decidir_diferencia_pedido` ponía el vencimiento SÓLO cuando la opción cierra
-- con `llegada_sala` — el faltante «en físico», donde bodega manda el producto.
-- El sobrante «en físico» cierra con `llegada_bodega` —la sala devuelve la
-- unidad— y esa rama no ponía fecha: el renglón quedaba esperando para siempre
-- una devolución que nadie tenía plazo para hacer.
--
-- Es la misma asimetría que ya se pagó una vez: el brazo del sobrante se
-- construyó en agosto como espejo del faltante y **el plazo se quedó atrás**.
-- Las dos opciones son la misma promesa —«esto se arregla moviendo el producto,
-- no papeles»— y una promesa sin fecha no se puede reclamar.
--
-- Se reescribe con `replace()` guardado sobre la definición viva: la función
-- tiene 9.3 kB de los que esto toca una línea, y transcribirla entera es la
-- forma más probable de romper algo que hoy anda.
DO $$
DECLARE d text; viejo text; nuevo text;
BEGIN
    SELECT pg_get_functiondef(oid) INTO d
      FROM pg_proc WHERE proname = 'decidir_diferencia_pedido' AND pronamespace = 'public'::regnamespace;

    viejo := 'IF v_nuevo = ''acordada'' AND v_op.cierra_con = ''llegada_sala'' THEN';
    nuevo := 'IF v_nuevo = ''acordada'' AND v_op.cierra_con IN (''llegada_sala'', ''llegada_bodega'') THEN';

    IF position(nuevo in d) > 0 THEN
        RAISE NOTICE 'el plazo ya cubría las dos llegadas';
        RETURN;
    END IF;
    IF position(viejo in d) = 0 THEN
        RAISE EXCEPTION 'decidir_diferencia_pedido cambió de forma: no encontré la rama del vencimiento';
    END IF;

    EXECUTE replace(d, viejo, nuevo);
END $$;

-- ── 2. Alguien mira ese plazo ───────────────────────────────────────────────
--
-- Hasta hoy el vencimiento se escribía y **nadie lo leía**: la pantalla lo
-- muestra a quien abre el pedido, y esa es justo la persona que ya sabe. Un
-- plazo que sólo se ve entrando a mirar es un plazo que vence solo.
--
-- ── A quién se le avisa, y por qué a ése ────────────────────────────────────
-- Al lado que DEBE el movimiento, no a los dos por igual: en un faltante «en
-- físico» el producto lo manda bodega, y en un sobrante lo devuelve la sala.
-- Avisarle a quien espera no cambia nada — ya está esperando.
-- Supervisión va siempre, porque es quien puede destrabarlo.
--
-- ── Una vez al día, no una por corrida ──────────────────────────────────────
-- Se comprueba contra `notifications` en vez de agregarle una columna a
-- `pedido_items`, que es de las grandes: un ALTER ahí pide ACCESS EXCLUSIVE y
-- esto no lo amerita. El conjunto es chico —los avisos de las últimas 20 horas—
-- así que la consulta sin índice no pesa.
CREATE OR REPLACE FUNCTION public.avisar_diferencias_vencidas()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_bodega  integer;
    v_avisos  integer := 0;
    v_items   integer := 0;
    r         record;
    v_dest    uuid[];
    v_titulo  text;
    v_cuerpo  text;
    v_dias    integer;
BEGIN
    SELECT m.branch_id INTO v_bodega FROM public.erp_sucursal_map m WHERE m.es_bodega;

    FOR r IN
        SELECT pi.id, pi.pedido_id, pi.erp_sucursal_id, pi.resolucion_vence_at,
               pi.error_tipo, pi.resolucion_tipo,
               o.cierra_con, o.rotulo,
               p.numero      AS pedido_numero,
               pr.nombre     AS producto,
               m.nombre      AS sala,
               m.branch_id   AS sala_branch
          FROM public.pedido_items pi
          JOIN public.diferencia_opcion o
            ON o.error_tipo = pi.error_tipo AND o.valor = pi.resolucion_tipo
          LEFT JOIN public.pedidos p          ON p.id = pi.pedido_id
          LEFT JOIN public.products pr        ON pr.id = pi.erp_product_id
          LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = pi.erp_sucursal_id
         WHERE pi.resolucion_status = 'acordada'
           AND pi.resolucion_vence_at IS NOT NULL
           AND pi.resolucion_vence_at < now()
           AND o.cierra_con IN ('llegada_sala', 'llegada_bodega')
           -- Ya se avisó de este renglón en las últimas 20 horas.
           AND NOT EXISTS (
                SELECT 1 FROM public.notifications n
                 WHERE n.type = 'PEDIDO_DIFERENCIA_VENCIDA'
                   AND n.created_at > now() - interval '20 hours'
                   AND (n.metadata->>'pedido_item_id')::bigint = pi.id)
    LOOP
        v_items := v_items + 1;
        v_dias  := greatest(1, (now()::date - r.resolucion_vence_at::date));

        -- El que DEBE el movimiento. La sala espera en el faltante; bodega
        -- espera en el sobrante.
        IF r.cierra_con = 'llegada_sala' THEN
            v_titulo := 'Un producto que bodega quedó de mandar';
            v_cuerpo := coalesce(r.producto, 'Un producto') || ' del pedido #'
                     || coalesce(r.pedido_numero::text, '?') || ' para '
                     || coalesce(r.sala, 'una sala') || ' — acordado «'
                     || coalesce(r.rotulo, '—') || '» y sin llegar hace '
                     || v_dias || ' día' || CASE WHEN v_dias = 1 THEN '' ELSE 's' END || '.';
            SELECT array_agg(e.id) INTO v_dest FROM public.employees e
             WHERE e.status = 'ACTIVO' AND e.branch_id = v_bodega
               AND coalesce(e.tipo_ficha, 'empleado') = 'empleado';
        ELSE
            v_titulo := 'Un producto que la sala quedó de devolver';
            v_cuerpo := coalesce(r.producto, 'Un producto') || ' del pedido #'
                     || coalesce(r.pedido_numero::text, '?') || ' — '
                     || coalesce(r.sala, 'una sala') || ' acordó «'
                     || coalesce(r.rotulo, '—') || '» y no ha vuelto hace '
                     || v_dias || ' día' || CASE WHEN v_dias = 1 THEN '' ELSE 's' END || '.';
            SELECT array_agg(e.id) INTO v_dest FROM public.employees e
             WHERE e.status = 'ACTIVO' AND e.branch_id = r.sala_branch
               AND coalesce(e.tipo_ficha, 'empleado') = 'empleado';
        END IF;

        -- Y supervisión siempre: es quien puede destrabarlo cuando el lado que
        -- debe no responde, que es exactamente el caso que llegó hasta acá.
        SELECT coalesce(v_dest, '{}'::uuid[]) || coalesce(array_agg(e.id), '{}'::uuid[])
          INTO v_dest
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
           AND public.rango_de_empleado(e.id) >= 3;

        IF coalesce(array_length(v_dest, 1), 0) = 0 THEN
            CONTINUE;
        END IF;

        INSERT INTO public.notifications
            (recipient_id, type, title, body, link, metadata, branch_id)
        SELECT DISTINCT d, 'PEDIDO_DIFERENCIA_VENCIDA', v_titulo, v_cuerpo, '/pedidos',
               jsonb_build_object('pedido_id', r.pedido_id, 'pedido_item_id', r.id,
                                  'erp_sucursal_id', r.erp_sucursal_id,
                                  'vencio_at', r.resolucion_vence_at, 'dias', v_dias),
               r.sala_branch
          FROM unnest(v_dest) d;

        v_avisos := v_avisos + coalesce(array_length(v_dest, 1), 0);
    END LOOP;

    RETURN jsonb_build_object('renglones', v_items, 'avisos', v_avisos);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.avisar_diferencias_vencidas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avisar_diferencias_vencidas() TO service_role;

-- ── 3. El cron ──────────────────────────────────────────────────────────────
-- 15:00 UTC = 09:00 en El Salvador: temprano, con la sala abierta y con el día
-- por delante para que a quien le avisan pueda hacerlo hoy. Un aviso a las 17:00
-- llega cuando ya no hay nada que mover.
--
-- Una vez al día y no más: el plazo es de días, así que revisarlo cada hora
-- serían 24 lecturas para la misma respuesta.
SELECT cron.schedule(
    'avisar-diferencias-vencidas',
    '0 15 * * *',
    $cron$ SELECT public.avisar_diferencias_vencidas(); $cron$
);
