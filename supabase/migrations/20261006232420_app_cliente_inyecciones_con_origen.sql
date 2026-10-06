SET lock_timeout = '5s';

-- La app muestra el historial completo de inyecciones (2026-10-06): cada una
-- dice si se compró en la farmacia o la trajo el cliente. Partiendo de la
-- definición viva; sólo se agrega `origen` a las dos listas.
CREATE OR REPLACE FUNCTION public.app_cliente_inyecciones(p_customer_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
    RETURN json_build_object(
      'disponibles', coalesce((
        SELECT json_agg(x ORDER BY x.pagada_at DESC) FROM (
          SELECT a.id,
                 CASE WHEN mz.otros IS NULL THEN a.producto
                      ELSE a.producto || coalesce(' ' || trim_scale(a.dosis_ml) || ' ml', '') || ' + ' || mz.otros
                 END AS producto,
                 CASE WHEN mz.otros IS NULL THEN a.dosis_ml END AS dosis_ml,
                 c.registrado_at AS pagada_at,
                 b.name AS sala,
                 a.origen
            FROM inyeccion_aplicaciones a
            JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
            JOIN branches b ON b.id = a.branch_id
            LEFT JOIN LATERAL (
              SELECT string_agg(m.producto || coalesce(' ' || trim_scale(m.dosis_ml) || ' ml', ''), ' + ' ORDER BY m.id) AS otros
                FROM inyeccion_aplicaciones m WHERE m.mezcla_de = a.id
            ) mz ON true
           WHERE a.customer_id = p_customer_id
             AND a.confirmada AND a.aplicada_at IS NULL AND a.mezcla_de IS NULL
           ORDER BY c.registrado_at DESC
           LIMIT 100
        ) x), '[]'::json),
      'aplicadas', coalesce((
        SELECT json_agg(y ORDER BY y.aplicada_at DESC) FROM (
          SELECT a.producto, a.dosis_ml, a.aplicada_at, b.name AS sala, a.origen
            FROM inyeccion_aplicaciones a
            LEFT JOIN branches b ON b.id = a.aplicada_branch_id
           WHERE a.customer_id = p_customer_id
             AND a.aplicada_at IS NOT NULL AND a.mezcla_de IS NULL
             AND a.aplicada_at > now() - interval '365 days'
           ORDER BY a.aplicada_at DESC
           LIMIT 30
        ) y), '[]'::json));
END;
$function$;
