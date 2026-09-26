SET lock_timeout = '5s';

-- La lista de clientes de Puntos se ordena por el encabezado (pedido del
-- usuario, 2026-09-26). Pagina en la base, así que el orden TAMBIÉN va en la
-- base: ordenar en el navegador ordenaría sólo la página visible.
-- La firma cambia: se borra la vieja primero para que no quede una sobrecarga
-- con sus propios permisos (CLAUDE.md regla 4).
DROP FUNCTION IF EXISTS public.puntos_panel_clientes(text, integer, integer);

CREATE FUNCTION public.puntos_panel_clientes(
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
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_consulta', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para consultar puntos.' USING ERRCODE = '42501';
  END IF;
  v_q := nullif(upper(unaccent(trim(coalesce(p_busqueda, '')))), '');
  v_qd := nullif(regexp_replace(coalesce(p_busqueda, ''), '\D', '', 'g'), '');

  EXECUTE format($f$
    WITH base AS (
      SELECT pc.customer_id, c.name AS nombre, c.dui, c.phone AS telefono,
             pc.saldo, pc.ganados AS acumulados, pc.usados AS canjeados,
             (SELECT max(ganado_el) FROM public.puntos_lote l WHERE l.customer_id = pc.customer_id) AS ultima_acumulacion
        FROM public.puntos_cuenta pc
        JOIN public.customers c ON c.id = pc.customer_id
       WHERE $1 IS NULL
          OR upper(unaccent(c.name)) LIKE '%%' || $1 || '%%'
          OR (length($2) >= 4 AND (regexp_replace(coalesce(c.dui, ''), '\D', '', 'g') LIKE $2 || '%%'
                                   OR regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') LIKE '%%' || $2 || '%%'))
    )
    SELECT json_build_object(
      'total', (SELECT count(*) FROM base),
      'filas', coalesce((SELECT json_agg(to_json(x)) FROM (
                 SELECT * FROM base ORDER BY %I %s NULLS LAST, customer_id
                 LIMIT $3 OFFSET $4) x), '[]'::json))
  $f$, v_col, v_dir)
  INTO v USING v_q, v_qd, v_lim, greatest(coalesce(p_desde, 0), 0);
  RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.puntos_panel_clientes(text, integer, integer, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_panel_clientes(text, integer, integer, text, text) TO authenticated, service_role;
