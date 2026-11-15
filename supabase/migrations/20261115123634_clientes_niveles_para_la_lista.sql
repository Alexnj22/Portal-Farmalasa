-- El nivel de Puntos Salud de cada cliente de la página de Clientes
-- (2026-11-15, pedido del usuario: «que diga si es de mayoreo y su nivel; si
-- no, sólo el nivel»). La lista ya trae ≤100 fichas; ésta recibe sus ids y
-- devuelve, por ficha, el programa en que está y su nivel de HOY, con las
-- MISMAS reglas que acumula el motor (`ventas_elegibles_puntos`, rama v2):
--   · mostrador / empresa (cl. 2.2) / fuera del programa → sin nivel
--   · mayorista aprobado → su rango (`mayorista_rango`) y además su nivel
--   · el resto (personal incluido) → su nivel por la compra de 12 meses
-- No toca ninguna tabla: sólo crea la función.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.clientes_niveles(p_ids bigint[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('clientes', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF coalesce(cardinality(p_ids), 0) > 200 THEN
    RAISE EXCEPTION 'Se piden como máximo 200 clientes a la vez.';
  END IF;

  SELECT coalesce(json_agg(json_build_object(
           'id', c.id, 'programa', p.programa, 'rango', p.rango,
           'nivel', n.clave, 'nivel_nombre', n.nombre,
           'compra_12m', round(x.compra, 2))), '[]'::json)
    INTO v
    FROM public.customers c
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN public.es_cliente_mostrador(c.name, c.erp_id) THEN 'mostrador'
               WHEN c.tipo_persona IS NOT DISTINCT FROM 'juridica' THEN 'empresa'
               WHEN NOT coalesce(c.acumula_puntos, true)
                 OR c.acepta_programa_puntos IS NOT DISTINCT FROM false THEN 'fuera'
               WHEN EXISTS (SELECT 1 FROM public.clientes_mayoristas cm
                             WHERE cm.customer_id = c.id AND cm.estado = 'aprobado') THEN 'mayorista'
               ELSE 'socio' END AS programa
    ) q
    CROSS JOIN LATERAL (
      SELECT q.programa,
             CASE WHEN q.programa = 'mayorista' THEN public.mayorista_rango(c.id) END AS rango
    ) p
    LEFT JOIN LATERAL (
      SELECT public.puntos_compra_12m(c.id, v_hoy, NULL) AS compra
       WHERE p.programa IN ('socio', 'mayorista')
    ) x ON true
    LEFT JOIN LATERAL public.puntos_nivel_de(x.compra, v_hoy) n ON x.compra IS NOT NULL
   WHERE c.id = ANY (p_ids);

  RETURN v;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.clientes_niveles(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clientes_niveles(bigint[]) TO authenticated, service_role;
