SET lock_timeout = '5s';

-- El instante en que la bolsa empezó a nacer sola al confirmar el corte. Antes
-- de eso hay cortes confirmados sin bolsa que NO son dinero perdido: son
-- historia previa al circuito.
--
-- Vive en una función y no como literal repetido porque ya estaba escrito a
-- mano dentro de `get_cortes_por_embolsar`, y un invariante que use otra fecha
-- que la lista de trabajo diría cosas distintas del mismo día.
CREATE OR REPLACE FUNCTION public.bolsas_circuito_desde()
 RETURNS timestamptz LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$ SELECT timestamptz '2026-08-15 21:43:27+00' $function$;

REVOKE EXECUTE ON FUNCTION public.bolsas_circuito_desde() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bolsas_circuito_desde() TO authenticated, service_role;

-- El invariante sólo tiene sentido en los días que nacieron DENTRO del
-- circuito. Un día mezclado —parte confirmado antes del disparador, parte
-- después— tampoco sirve: le faltarían bolsas por construcción y el descuadre
-- no diría nada sobre el dinero. Por eso se exige que el PRIMER corte
-- confirmado del día ya sea del circuito.
CREATE OR REPLACE FUNCTION public.get_bolsas_invariante(p_desde date, p_hasta date)
 RETURNS TABLE(branch_id bigint, fecha date, suma_bolsas numeric,
               declarado numeric, descuadre numeric, bolsas integer)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH dias AS (
        SELECT c.branch_id, c.fecha
          FROM public.cortes_caja c
         WHERE c.tipo = 'C' AND c.estado = 'CONFIRMADO'
           AND c.fecha BETWEEN p_desde AND p_hasta
           AND (SELECT auth_has_module_permission('bolsas','can_view'))
           AND ((SELECT auth_module_scope('bolsas')) = 'ALL'
                OR c.branch_id = (SELECT auth_employee_branch_id()))
         GROUP BY c.branch_id, c.fecha
        HAVING min(c.resuelto_at) >= public.bolsas_circuito_desde()
    )
    SELECT d.branch_id, d.fecha,
           coalesce(b.suma, 0), coalesce(u.declarado, 0),
           round(coalesce(b.suma, 0) - coalesce(u.declarado, 0), 2),
           coalesce(b.cuantas, 0)::integer
      FROM dias d
      LEFT JOIN LATERAL (
          SELECT sum(x.monto_inicial) AS suma, count(*) AS cuantas
            FROM public.bolsas x
           WHERE x.branch_id = d.branch_id AND x.fecha = d.fecha AND x.estado <> 'ANULADA'
      ) b ON true
      LEFT JOIN LATERAL (
          SELECT c.total_declarado AS declarado
            FROM public.cortes_caja c
           WHERE c.branch_id = d.branch_id AND c.fecha = d.fecha
             AND c.tipo = 'C' AND c.estado = 'CONFIRMADO'
           ORDER BY c.hora DESC, c.id DESC LIMIT 1
      ) u ON true
     ORDER BY d.fecha DESC, d.branch_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_bolsas_invariante(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_bolsas_invariante(date, date) TO authenticated, service_role;

-- Y la lista de trabajo deja de llevar la fecha escrita a mano.
CREATE OR REPLACE FUNCTION public.get_cortes_por_embolsar(p_desde date, p_hasta date)
 RETURNS TABLE(corte_id bigint, branch_id bigint, fecha date, hora time without time zone,
               caja text, total_declarado numeric, sugerida numeric)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT c.id, c.branch_id, c.fecha, c.hora, c.empleado_texto, c.total_declarado,
           public.bolsa_sugerida(c.id)
      FROM public.cortes_caja c
     WHERE (SELECT auth_has_module_permission('bolsas','can_view'))
       AND c.tipo = 'C' AND c.estado = 'CONFIRMADO'
       AND c.fecha BETWEEN p_desde AND p_hasta
       AND c.resuelto_at >= public.bolsas_circuito_desde()
       AND ((SELECT auth_module_scope('bolsas')) = 'ALL'
            OR c.branch_id = (SELECT auth_employee_branch_id()))
       AND NOT EXISTS (SELECT 1 FROM public.bolsas b
                        WHERE b.corte_id = c.id AND b.estado <> 'ANULADA')
       AND public.bolsa_sugerida(c.id) > 0
     ORDER BY c.fecha DESC, c.branch_id, c.hora;
$function$;

COMMENT ON FUNCTION public.get_bolsas_invariante(date, date) IS
 'Sigma bolsas del dia vs declarado del ultimo corte confirmado, solo para dias nacidos dentro del circuito. Descuadre negativo = efectivo contado que nunca se guardo.';
