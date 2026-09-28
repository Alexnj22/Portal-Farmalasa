SET lock_timeout = '5s';

-- ═══ Puntos · el tablero: vencimientos del mismo libro que la deuda ═══════
-- Segunda versión de `puntos_panel_tablero` (misma sesión). Único cambio: la
-- clave `vencimientos`, leída de `puntos_lote` para que cuadre con la deuda.
--
-- Encabezado de la primera versión:
-- ═══ Puntos · la pestaña Resumen contesta preguntas, no sólo muestra curvas ═
-- Pedido del usuario (2026-09-28): «mejórala, hazla útil». Las cuatro
-- preguntas de quien opera el programa, en una sola lectura:
--
--   · ¿cuánto les debemos a los clientes?          → deuda (puntos y dólares)
--   · ¿cómo va el mes contra el anterior?           → mes vs. mes anterior al
--     mismo día (comparar contra el mes entero haría ver cada mes «bajando»
--     hasta el último día)
--   · ¿se usan los puntos?                          → canjeado y su proporción
--   · ¿a quién se le puede ofrecer canjear?        → clientes con el mínimo,
--     y los que más tienen
--
-- La deuda sale del libro (`puntos_cuenta`), que desde la migración es el
-- espejo del sistema anterior y desde el arranque la única verdad. El mes, de
-- la misma fuente que `puntos_panel_resumen`: antes del arranque las ventas
-- del portal, después el libro.
CREATE OR REPLACE FUNCTION public.puntos_panel_tablero()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v json;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_mes date := date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador'))::date;
  v_ant date;
  v_ant_hasta date;
  v_min integer;
  v_portal boolean := public.puntos_fuente() = 'portal';
  v_act json; v_prev json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_resumen', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver el resumen de puntos.' USING ERRCODE = '42501';
  END IF;
  v_ant := (v_mes - interval '1 month')::date;
  -- El mismo día del mes anterior; si ese mes es más corto, su último día.
  v_ant_hasta := least(v_ant + (v_hoy - v_mes), v_mes - 1);
  SELECT coalesce(minimo_canje, 100) INTO v_min FROM public.puntos_config WHERE id;

  IF v_portal THEN
    SELECT json_build_object(
      'acumulado', coalesce(sum(puntos) FILTER (WHERE ganado_el >= v_mes), 0),
      'clientes_acumularon', count(DISTINCT customer_id) FILTER (WHERE ganado_el >= v_mes))
      INTO v_act FROM public.puntos_lote WHERE origen = 'venta' AND ganado_el >= v_mes;
    SELECT json_build_object('acumulado', coalesce(sum(puntos), 0)) INTO v_prev
      FROM public.puntos_lote WHERE origen = 'venta' AND ganado_el BETWEEN v_ant AND v_ant_hasta;
  ELSE
    SELECT json_build_object(
      'acumulado', coalesce(sum(floor(pe.total)), 0),
      'clientes_acumularon', count(DISTINCT si.customer_id))
      INTO v_act
      FROM public.puntos_enviados pe JOIN public.sales_invoices si ON si.id = pe.invoice_id
     WHERE pe.fecha >= v_mes AND pe.estado_puntos IN ('pendiente', 'acumulado');
    SELECT json_build_object('acumulado', coalesce(sum(floor(pe.total)), 0)) INTO v_prev
      FROM public.puntos_enviados pe
     WHERE pe.fecha BETWEEN v_ant AND v_ant_hasta AND pe.estado_puntos IN ('pendiente', 'acumulado');
  END IF;

  WITH canjes AS (
    -- Los canjes se leen de la venta en los dos regímenes: el descuento
    -- aplicado es lo que de verdad se dio, y es la misma fórmula del motor.
    SELECT si.fecha, si.customer_id,
           greatest(round(((SELECT coalesce(sum(ii.total_linea), 0) FROM public.sales_invoice_items ii
                             WHERE ii.invoice_id = si.id) - si.total - coalesce(si.retencion, 0)) * 100), 0)::int AS puntos
      FROM public.sales_invoices si
      JOIN public.branches b ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
      LEFT JOIN public.customers cu ON cu.id = si.customer_id
     WHERE si.fecha >= v_ant AND si.has_puntos AND public.venta_valida(si.estado)
       AND coalesce(cu.acumula_puntos, true)
  )
  SELECT json_build_object(
    'hoy', v_hoy, 'mes', v_mes, 'mes_anterior_hasta', v_ant_hasta, 'minimo_canje', v_min,
    'deuda', (SELECT json_build_object(
                'puntos', coalesce(sum(saldo), 0),
                'clientes', count(*) FILTER (WHERE saldo > 0),
                'listos_clientes', count(*) FILTER (WHERE saldo >= v_min),
                'listos_puntos', coalesce(sum(saldo) FILTER (WHERE saldo >= v_min), 0))
                FROM public.puntos_cuenta),
    'mes_actual', (SELECT json_build_object(
                     'acumulado', (v_act->>'acumulado')::bigint,
                     'clientes_acumularon', (v_act->>'clientes_acumularon')::int,
                     'canjeado', coalesce(sum(puntos) FILTER (WHERE fecha >= v_mes), 0),
                     'canjes', count(*) FILTER (WHERE fecha >= v_mes),
                     'clientes_canjearon', count(DISTINCT customer_id) FILTER (WHERE fecha >= v_mes))
                     FROM canjes),
    'mes_anterior', (SELECT json_build_object(
                     'acumulado', (v_prev->>'acumulado')::bigint,
                     'canjeado', coalesce(sum(puntos) FILTER (WHERE fecha BETWEEN v_ant AND v_ant_hasta), 0))
                     FROM canjes),
    -- Del mismo libro que la deuda, para que las dos cifras cuadren (antes
    -- «Cuándo vencen» leía la copia del sistema anterior, que incluye las
    -- cuentas sin asignar, y no coincidía con «Se les debe»).
    'vencimientos', (SELECT coalesce(json_agg(x ORDER BY x.mes), '[]'::json) FROM (
              SELECT date_trunc('month', vence_el)::date AS mes, sum(restantes)::bigint AS puntos,
                     count(DISTINCT customer_id) AS clientes
                FROM public.puntos_lote WHERE restantes > 0
               GROUP BY 1) x),
    'top', (SELECT coalesce(json_agg(x), '[]'::json) FROM (
              SELECT pc.customer_id, c.name AS nombre, pc.saldo
                FROM public.puntos_cuenta pc JOIN public.customers c ON c.id = pc.customer_id
               WHERE pc.saldo > 0
               ORDER BY pc.saldo DESC, pc.customer_id
               LIMIT 8) x)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_panel_tablero() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_panel_tablero() TO authenticated, service_role;
