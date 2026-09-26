SET lock_timeout = '5s';

-- `puntos_panel_clientes` calculaba `max(ganado_el)` de `puntos_lote` para las
-- 10,632 cuentas aunque muestre 25: ~33,000 bloques por llamada (247 MB en la
-- sección F de gate:perf). Ahora la última acumulación se calcula sólo para la
-- página visible — salvo cuando se ORDENA por esa columna, que ahí hace falta
-- para todas. El índice `puntos_lote_por_cliente_y_fecha` (otra sesión,
-- 2026-09-26) cubre las dos formas. Reescrita desde la definición VIVA.
CREATE OR REPLACE FUNCTION public.puntos_panel_clientes(
  p_busqueda text DEFAULT NULL, p_limite integer DEFAULT 25, p_desde integer DEFAULT 0,
  p_orden text DEFAULT 'saldo', p_dir text DEFAULT 'desc'
) RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
  -- ella; si no, sobre las filas de la página.
  c_ultima constant text := '(SELECT max(l.ganado_el) FROM public.puntos_lote l WHERE l.customer_id = %s.customer_id)';
  v_en_base text;
  v_en_pagina text;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_consulta', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para consultar puntos.' USING ERRCODE = '42501';
  END IF;
  v_q := nullif(upper(unaccent(trim(coalesce(p_busqueda, '')))), '');
  v_qd := nullif(regexp_replace(coalesce(p_busqueda, ''), '\D', '', 'g'), '');

  IF v_col = 'ultima_acumulacion' THEN
    v_en_base := ', ' || format(c_ultima, 'pc') || ' AS ultima_acumulacion';
    v_en_pagina := '';
  ELSE
    v_en_base := '';
    v_en_pagina := ', ' || format(c_ultima, 'p') || ' AS ultima_acumulacion';
  END IF;

  EXECUTE format($f$
    WITH base AS (
      SELECT pc.customer_id, c.name AS nombre, c.dui, c.phone AS telefono,
             pc.saldo, pc.ganados AS acumulados, pc.usados AS canjeados %s
        FROM public.puntos_cuenta pc
        JOIN public.customers c ON c.id = pc.customer_id
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
$$;
