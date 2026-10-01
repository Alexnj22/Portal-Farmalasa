SET lock_timeout = '5s';

-- Consulta de Puntos: «deben salir todos, sin importar si tienen 0 puntos»
-- (usuario, 2026-10-01). La lista partía de `puntos_cuenta`, así que sólo
-- salían los 10,766 clientes que alguna vez tuvieron cuenta; los otros 17,722
-- de `customers` no se podían ni buscar, y la caja no podía distinguir «no
-- tiene puntos» de «no existe».
--
-- Ahora parte de `customers` y la cuenta se cruza con LEFT JOIN: quien no
-- tiene cuenta sale con saldo, acumulados y canjeados en 0. La última
-- acumulación se busca por `c.id`, que existe siempre (antes era
-- `pc.customer_id`, que en esas filas es NULL).
CREATE OR REPLACE FUNCTION public.puntos_panel_clientes(p_busqueda text DEFAULT NULL::text, p_limite integer DEFAULT 25, p_desde integer DEFAULT 0, p_orden text DEFAULT 'saldo'::text, p_dir text DEFAULT 'desc'::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v json; v_q text; v_qd text;
  v_lim int := least(greatest(coalesce(p_limite, 25), 1), 100);
  -- Lista cerrada: el nombre de la columna viaja al SQL dinámico.
  v_col text := CASE p_orden
                  WHEN 'nombre' THEN 'nombre' WHEN 'dui' THEN 'dui' WHEN 'telefono' THEN 'telefono'
                  WHEN 'acumulados' THEN 'acumulados' WHEN 'canjeados' THEN 'canjeados'
                  WHEN 'ultima' THEN 'ultima_acumulacion' ELSE 'saldo' END;
  v_dir text := CASE WHEN lower(p_dir) = 'asc' THEN 'ASC' ELSE 'DESC' END;
  -- La subconsulta de la última acumulación: en la base sólo si se ordena por
  -- ella; si no, sobre las filas de la página. Recibe la expresión del id.
  c_ultima constant text := '(SELECT max(l.ganado_el) FROM public.puntos_lote l WHERE l.customer_id = %s)';
  v_en_base text;
  v_en_pagina text;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_consulta', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para consultar puntos.' USING ERRCODE = '42501';
  END IF;
  v_q := nullif(upper(unaccent(trim(coalesce(p_busqueda, '')))), '');
  v_qd := nullif(regexp_replace(coalesce(p_busqueda, ''), '\D', '', 'g'), '');

  IF v_col = 'ultima_acumulacion' THEN
    v_en_base := ', ' || format(c_ultima, 'c.id') || ' AS ultima_acumulacion';
    v_en_pagina := '';
  ELSE
    v_en_base := '';
    v_en_pagina := ', ' || format(c_ultima, 'p.customer_id') || ' AS ultima_acumulacion';
  END IF;

  EXECUTE format($f$
    WITH base AS (
      SELECT c.id AS customer_id, c.name AS nombre, c.dui, c.phone AS telefono,
             coalesce(pc.saldo, 0) AS saldo, coalesce(pc.ganados, 0) AS acumulados,
             coalesce(pc.usados, 0) AS canjeados %s
        FROM public.customers c
        LEFT JOIN public.puntos_cuenta pc ON pc.customer_id = c.id
       WHERE $1 IS NULL
          OR upper(unaccent(c.name)) LIKE '%%' || $1 || '%%'
          OR (length($2) >= 4 AND (regexp_replace(coalesce(c.dui, ''), '\D', '', 'g') LIKE $2 || '%%'
                                   OR regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') LIKE '%%' || $2 || '%%'))
    ), pagina AS (
      SELECT * FROM base ORDER BY %I %s NULLS LAST, customer_id LIMIT $3 OFFSET $4
    )
    SELECT json_build_object(
      'total', (SELECT count(*) FROM base),
      'filas', coalesce((SELECT json_agg(to_json(x)) FROM (
                 SELECT p.* %s FROM pagina p ORDER BY p.%I %s NULLS LAST, p.customer_id) x), '[]'::json))
  $f$, v_en_base, v_col, v_dir, v_en_pagina, v_col, v_dir)
  INTO v USING v_q, v_qd, v_lim, greatest(coalesce(p_desde, 0), 0);
  RETURN v;
END;
$function$;
