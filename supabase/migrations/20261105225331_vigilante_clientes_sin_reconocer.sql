-- Vigilante de clientes sin reconocer (2026-11-05).
--
-- El 5-nov la sincronización de ventas no pudo averiguar el número de cliente
-- de NINGUNA de las 16 fichas nuevas del día (los días anteriores: 15 a 22 con
-- número, 0 a 4 sin). No quedó ni una línea en el registro: cuando la consulta
-- no trae el número, el portal crea la ficha por nombre y sigue. Así nacen las
-- fichas sueltas que parten los puntos de un cliente en dos.
--
-- Cuatro preguntas, cada una avisada una sola vez por día al cargo de alertas
-- técnicas (mismo patrón que `avisar_estados_de_venta_desconocidos`):
--   reconocimiento_caido   hoy, ≥4 fichas nuevas y ≥75% sin número.
--   fusion_con_puntos      casos en «Por revisar» con más de 2 días: desde hoy
--                          la corrida nocturna une sola lo confirmado, así que
--                          lo que queda ahí es lo que necesita una persona.
--   puntos_en_otra_ficha   puntos de una venta de los últimos 7 días que no
--                          están en la ficha de su factura. Ventana corta a
--                          propósito: con 120 días lee ~480 MB por llamada; el
--                          cruce aparece el mismo día en que se reasigna la
--                          factura, y el aviso es diario.
--   sin_numero_viejas      fichas con facturas, sin número, de 3 a 60 días: la
--                          corrida nocturna debió completarlas y no pudo.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.avisar_clientes_sin_reconocer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_dest   uuid[];
  v_n      integer := 0;
  v_total  integer; v_sin integer;
  r        record;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE erp_id IS NULL)
    INTO v_total, v_sin
    FROM public.customers
   WHERE created_at >= (v_hoy::timestamp AT TIME ZONE 'America/El_Salvador');

  FOR r IN
    SELECT * FROM (VALUES
      ('reconocimiento_caido',
       CASE WHEN v_total >= 4 AND v_sin * 4 >= v_total * 3 THEN v_sin ELSE 0 END,
       'Las ventas no están reconociendo a los clientes',
       v_sin || ' de ' || v_total || ' clientes nuevos de hoy quedaron sin número interno. '
         || 'Cada uno abre una ficha suelta y sus puntos se separan de su ficha real. '
         || 'Revisar el acceso de la sincronización de ventas al sistema de la caja.'),
      ('fusion_con_puntos',
       (SELECT count(*)::int FROM public.clientes_por_revisar
         WHERE motivo = 'fusion_con_puntos' AND descartado_at IS NULL
           AND created_at < now() - interval '2 days'),
       'Clientes con los puntos partidos en dos fichas',
       NULL),
      ('puntos_en_otra_ficha',
       (SELECT count(*)::int FROM public.puntos_lote l
          JOIN public.sales_invoices s ON s.id = l.invoice_id
         WHERE l.origen = 'venta' AND l.ganado_el >= v_hoy - 7
           AND l.customer_id <> s.customer_id
           AND public.cliente_vigente(l.customer_id) IS DISTINCT FROM public.cliente_vigente(s.customer_id)),
       'Puntos en una ficha distinta a la de su factura',
       NULL),
      ('sin_numero_viejas',
       (SELECT count(*)::int FROM public.customers c
         WHERE c.erp_id IS NULL AND c.deshabilitada_at IS NULL
           AND c.created_at < now() - interval '3 days'
           AND c.created_at > now() - interval '60 days'
           AND NOT public.es_cliente_mostrador(c.name, c.erp_id)
           AND EXISTS (SELECT 1 FROM public.sales_invoices s WHERE s.customer_id = c.id)),
       'Fichas de clientes sin número interno',
       NULL)
    ) t(tipo, n, titulo, cuerpo)
  LOOP
    CONTINUE WHEN coalesce(r.n, 0) = 0;
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.audit_logs
       WHERE action = 'CLIENTES_SIN_RECONOCER'
         AND details->>'tipo' = r.tipo AND details->>'dia' = v_hoy::text);

    IF v_dest IS NULL THEN
      SELECT array_agg(e.id) INTO v_dest
        FROM public.employees e
        JOIN public.roles ro ON ro.name = 'Sistema — Alertas Técnicas'
       WHERE e.status = 'ACTIVO'
         AND (e.role_id = ro.id OR e.secondary_role_id = ro.id);
    END IF;

    INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
    VALUES ('CLIENTES_SIN_RECONOCER', r.tipo, 'Vigilante', 'SYSTEM',
            CASE WHEN r.tipo = 'reconocimiento_caido' THEN 'CRITICAL' ELSE 'WARNING' END,
            jsonb_build_object('tipo', r.tipo, 'dia', v_hoy, 'casos', r.n,
                               'nuevas_hoy', v_total, 'sin_numero_hoy', v_sin,
                               'avisados', coalesce(array_length(v_dest, 1), 0)));

    IF coalesce(array_length(v_dest, 1), 0) > 0 THEN
      PERFORM public.notify_employees(
        v_dest, 'SYSTEM', r.titulo,
        coalesce(r.cuerpo,
          CASE r.tipo
            WHEN 'fusion_con_puntos' THEN
              r.n || ' caso' || CASE WHEN r.n = 1 THEN '' ELSE 's' END
              || ' en «Por revisar» con más de 2 días: la unión automática no pudo hacerlos y el cliente ve sólo parte de su saldo.'
            WHEN 'puntos_en_otra_ficha' THEN
              r.n || ' venta' || CASE WHEN r.n = 1 THEN '' ELSE 's' END
              || ' de la última semana tiene' || CASE WHEN r.n = 1 THEN '' ELSE 'n' END
              || ' los puntos en una ficha y la factura en otra.'
            ELSE
              r.n || ' ficha' || CASE WHEN r.n = 1 THEN '' ELSE 's' END
              || ' con compras siguen sin número interno después de 3 días.'
          END),
        '/clientes?tab=revisar',
        jsonb_build_object('origen', 'clientes-sin-reconocer', 'tipo', r.tipo, 'casos', r.n),
        true, NULL);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_clientes_sin_reconocer() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_clientes_sin_reconocer() TO service_role;

-- Cada hora en horario de sala (8:40–21:40 SV): el caso que importa —el
-- reconocimiento caído— se ve el mismo día. Cada tipo avisa una vez por día.
SELECT cron.unschedule('clientes-sin-reconocer')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clientes-sin-reconocer');
SELECT cron.schedule('clientes-sin-reconocer', '40 14-23,0-3 * * *',
                     'SELECT public.avisar_clientes_sin_reconocer()');
