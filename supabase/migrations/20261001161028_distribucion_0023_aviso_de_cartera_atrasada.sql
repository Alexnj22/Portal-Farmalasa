-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0023 — el aviso diario de cuentas atrasadas
-- ═══════════════════════════════════════════════════════════════════════════
-- Cuentas por cobrar (0014) dice quién debe, pero hay que ir a mirarlo. Cada
-- mañana, antes de salir a la ruta, cada vendedor recibe qué clientes SUYOS
-- tienen cuentas pasadas del plazo —los que vencieron ayer, aparte: son los
-- que todavía se cobran fácil—, y quien administra, el resumen de todos con lo
-- que ya pasó de 60 días.
--
-- · Campana (`notifications`) y push. Sin push (el entorno de pruebas no tiene
--   los secretos) queda la campana.
-- · Una vez por persona y día: si el cron corre dos veces, no duplica.
-- · Nadie recibe «cero atrasados»: un aviso que no dice nada entrena a no
--   leerlo.
-- · El vendedor de la cuenta es el de la venta (`dist_cxc.vendedor_id`).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.dist_avisar_cartera_atrasada()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_hoy   date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_link  text := '/torogoz/cobros?cartera=vencidos';
    g       record;
    v_tit   text;
    v_cue   text;
    n       integer := 0;
BEGIN
    -- ── A cada vendedor, sus clientes atrasados ──
    FOR g IN
        SELECT c.vendedor_id,
               count(DISTINCT c.cliente_id) AS clientes,
               sum(c.saldo) AS vencido,
               count(DISTINCT c.cliente_id) FILTER (WHERE c.vence = v_hoy - 1) AS de_ayer,
               string_agg(DISTINCT cl.nombre, ', ') FILTER (WHERE cl.nombre IS NOT NULL) AS nombres
          FROM public.dist_cxc c
          JOIN public.dist_clientes cl ON cl.id = c.cliente_id
          JOIN public.employees e ON e.id = c.vendedor_id AND e.status = 'ACTIVO'
         WHERE c.estado = 'abierta' AND c.saldo > 0 AND c.vence < v_hoy
         GROUP BY c.vendedor_id
    LOOP
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications
                               WHERE recipient_id = g.vendedor_id AND type = 'CARTERA_ATRASADA' AND metadata->>'fecha' = v_hoy::text);
        v_tit := format('%s cliente%s con cuentas atrasadas', g.clientes, CASE WHEN g.clientes = 1 THEN '' ELSE 's' END);
        v_cue := format('Deben $%s pasado del plazo%s: %s.',
                        to_char(g.vencido, 'FM999,999,990.00'),
                        CASE WHEN g.de_ayer > 0 THEN format(' (%s vencieron ayer)', g.de_ayer) ELSE '' END,
                        left(g.nombres, 160));
        INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata)
        VALUES (g.vendedor_id, 'CARTERA_ATRASADA', v_tit, v_cue, v_link,
                jsonb_build_object('fecha', v_hoy, 'clientes', g.clientes, 'vencido', g.vencido, 'de_ayer', g.de_ayer));
        BEGIN
            PERFORM net.http_post(
                url := public.push_function_url(), headers := public.push_function_headers(),
                body := jsonb_build_object('title', v_tit, 'message', v_cue, 'url', v_link,
                                           'target_type', 'EMPLOYEE', 'target_value', to_jsonb(ARRAY[g.vendedor_id])));
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'push de cartera atrasada: %', SQLERRM;
        END;
        n := n + 1;
    END LOOP;

    -- ── A quien administra, el resumen ──
    SELECT count(DISTINCT cliente_id) AS clientes, coalesce(sum(saldo), 0) AS vencido,
           coalesce(sum(saldo) FILTER (WHERE vence < v_hoy - 60), 0) AS mas_60,
           count(DISTINCT cliente_id) FILTER (WHERE vence < v_hoy - 60) AS clientes_60
      INTO g
      FROM public.dist_cxc WHERE estado = 'abierta' AND saldo > 0 AND vence < v_hoy;
    IF g.clientes > 0 THEN
        v_tit := format('Cartera atrasada: $%s en %s cliente%s', to_char(g.vencido, 'FM999,999,990.00'), g.clientes,
                        CASE WHEN g.clientes = 1 THEN '' ELSE 's' END);
        v_cue := CASE WHEN g.clientes_60 > 0
                      THEN format('De eso, $%s tiene más de 60 días (%s cliente%s): conviene cobrarlo antes de venderles más.',
                                  to_char(g.mas_60, 'FM999,999,990.00'), g.clientes_60, CASE WHEN g.clientes_60 = 1 THEN '' ELSE 's' END)
                      ELSE 'Nada pasa de 60 días.' END;
        FOR g IN
            SELECT DISTINCT e.id FROM public.employees e
              JOIN public.role_permissions rp ON rp.role_id = e.role_id AND rp.module_key = 'distribucion_config' AND rp.can_edit
             WHERE e.status = 'ACTIVO'
               AND NOT EXISTS (SELECT 1 FROM public.notifications x
                                WHERE x.recipient_id = e.id AND x.type = 'CARTERA_ATRASADA_RESUMEN' AND x.metadata->>'fecha' = v_hoy::text)
        LOOP
            INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata)
            VALUES (g.id, 'CARTERA_ATRASADA_RESUMEN', v_tit, v_cue, v_link, jsonb_build_object('fecha', v_hoy));
            n := n + 1;
        END LOOP;
    END IF;
    RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_avisar_cartera_atrasada() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_avisar_cartera_atrasada() TO service_role;

-- 07:00 de El Salvador (13:00 UTC), antes de salir a la ruta. Con la guarda de
-- «sólo si no existe» que CLAUDE.md exige a todo cron creado en una migración.
SELECT cron.schedule('dist-aviso-cartera-atrasada', '0 13 * * *', 'SELECT public.dist_avisar_cartera_atrasada()')
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dist-aviso-cartera-atrasada');
