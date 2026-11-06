SET lock_timeout = '5s';

-- Puntos → Consulta no encontraba «edwin nunez joya» (2026-11-06): comparaba el
-- texto ENTERO como subcadena del nombre, y en la ficha está «EDWIN ALEXANDER
-- NUÑEZ JOYA». Ahora también entra todo lo que encuentra el buscador único
-- (`busqueda_clientes`: por palabras, en cualquier orden, más DUI/NIT/teléfono).
-- Las dos condiciones viejas se quedan: lo que antes aparecía sigue apareciendo.
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
  v_ids bigint[];
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_consulta', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para consultar puntos.' USING ERRCODE = '42501';
  END IF;
  v_q := nullif(upper(unaccent(trim(coalesce(p_busqueda, '')))), '');
  v_qd := nullif(regexp_replace(coalesce(p_busqueda, ''), '\D', '', 'g'), '');
  -- El buscador único, resuelto UNA vez antes del SQL dinámico.
  IF v_q IS NOT NULL THEN
    SELECT coalesce(array_agg(b.id), '{}') INTO v_ids FROM public.busqueda_clientes(p_busqueda) b;
  END IF;

  IF v_col = 'ultima_acumulacion' THEN
    v_en_base := ', CASE WHEN pc.customer_id IS NOT NULL THEN ' || format(c_ultima, 'c.id') || ' END AS ultima_acumulacion';
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
          OR c.id = ANY ($5)
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
  INTO v USING v_q, v_qd, v_lim, greatest(coalesce(p_desde, 0), 0), v_ids;
  RETURN v;
END;
$function$;
