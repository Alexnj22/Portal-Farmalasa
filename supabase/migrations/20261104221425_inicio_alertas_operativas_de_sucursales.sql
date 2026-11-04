SET lock_timeout = '5s';

-- Alertas OPERATIVAS del widget «Alertas · Sucursales» del Inicio (2026-11-04).
-- Hasta hoy sólo miraba la ficha (contrato, encargado, permisos): el usuario
-- pidió las que sirven en el día. Tres, cada una medida antes de escribirla:
--   · cortes C sin confirmar ni descartar, con más de 30 min de hechos. Los Z
--     NO cuentan: nacen PENDIENTE y nadie los firma (7 por sala en 7 días).
--   · caja abierta de un día anterior (nadie cerró).
--   · sala abierta según `weekly_hours`, con 2 h o más desde la apertura, y sin
--     una venta válida en las últimas 2 h.
-- DEFINER porque `cortes_caja` sólo la ve quien tiene la caja; devuelve CONTEOS,
-- no montos. El alcance lo da `dash_branches`: sin ALL, sólo la sala propia.
CREATE OR REPLACE FUNCTION public.inicio_alertas_operativas()
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_t     timestamp := (now() AT TIME ZONE 'America/El_Salvador');
    v_hoy   date := v_t::date;
    v_hora  time := v_t::time;
    v_dow   text := extract(dow FROM v_t)::int::text;
    v_todas boolean;
    v_sala  bigint;
BEGIN
    IF NOT (SELECT public.auth_has_module_permission('dash_branches', 'can_view')) THEN
        RETURN '[]'::json;
    END IF;
    v_todas := (SELECT public.auth_module_scope('dash_branches')) = 'ALL';
    v_sala  := (SELECT public.auth_employee_branch_id());
    IF NOT v_todas AND v_sala IS NULL THEN RETURN '[]'::json; END IF;

    RETURN (
      SELECT coalesce(json_agg(to_json(x) ORDER BY x.branch_id), '[]'::json)
      FROM (
        SELECT b.id AS branch_id,
               (SELECT count(*) FROM public.cortes_caja c
                 WHERE c.branch_id = b.id AND c.estado = 'PENDIENTE' AND c.tipo <> 'Z'
                   AND c.fecha >= v_hoy - 7
                   AND c.capturado_at < now() - interval '30 minutes')::int AS cortes_sin_confirmar,
               (SELECT min(a.abierta_el) FROM public.cortes_caja_aperturas a
                 WHERE a.branch_id = b.id AND a.cerrada_at IS NULL
                   AND a.abierta_el < v_hoy) AS caja_sin_cerrar_desde,
               CASE WHEN coalesce((b.weekly_hours -> v_dow ->> 'isOpen')::boolean, false)
                         AND (b.weekly_hours -> v_dow ->> 'start') IS NOT NULL
                         AND (b.weekly_hours -> v_dow ->> 'end') IS NOT NULL
                         AND v_hora >= (b.weekly_hours -> v_dow ->> 'start')::time + interval '2 hours'
                         AND v_hora <  (b.weekly_hours -> v_dow ->> 'end')::time
                         -- Sólo salas que venden: Bodega y Administración no.
                         AND EXISTS (SELECT 1 FROM public.sales_invoices s0
                                      WHERE s0.branch_id = b.id AND s0.fecha >= v_hoy - 7)
                         AND NOT EXISTS (SELECT 1 FROM public.sales_invoices s
                                          WHERE s.branch_id = b.id AND s.fecha = v_hoy
                                            AND public.venta_valida(s.estado)
                                            AND s.hora >= v_hora - interval '2 hours')
                    THEN (SELECT max(s.hora) FROM public.sales_invoices s
                           WHERE s.branch_id = b.id AND s.fecha = v_hoy
                             AND public.venta_valida(s.estado))
               END AS sin_ventas_desde,
               (coalesce((b.weekly_hours -> v_dow ->> 'isOpen')::boolean, false)
                 AND v_hora >= (b.weekly_hours -> v_dow ->> 'start')::time + interval '2 hours'
                 AND v_hora <  (b.weekly_hours -> v_dow ->> 'end')::time
                 AND EXISTS (SELECT 1 FROM public.sales_invoices s0
                              WHERE s0.branch_id = b.id AND s0.fecha >= v_hoy - 7)
                 AND NOT EXISTS (SELECT 1 FROM public.sales_invoices s
                                  WHERE s.branch_id = b.id AND s.fecha = v_hoy
                                    AND public.venta_valida(s.estado)
                                    AND s.hora >= v_hora - interval '2 hours')) AS sin_ventas
        FROM public.branches b
        WHERE (v_todas OR b.id = v_sala)
      ) x
      WHERE x.cortes_sin_confirmar > 0 OR x.caja_sin_cerrar_desde IS NOT NULL OR x.sin_ventas
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.inicio_alertas_operativas() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.inicio_alertas_operativas() TO authenticated, service_role;
