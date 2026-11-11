-- Mis tratamientos (2026-11-11, usuario: «si agrego un medicamento nuevo, que
-- me permita agregar cualquiera, no solo los que compré»).
--   · app_tratamiento_buscar: busca en TODO el catálogo de medicamentos con la
--     regla única (buscar_productos_ids), no sólo en lo comprado. Trae la
--     última compra si la hubo.
--   · app_tratamiento_agregar: sin compra en el último año ya no rechaza —
--     cuenta desde hoy, y como no sabemos cuánto trae lo que tiene, pide los
--     días que le dura (`pide = 'dias'`). `veces = 0` marca «nunca lo compró».
--   · app_tratamientos_de: devuelve `veces` para que la app no diga «última
--     compra» de algo que no compró.
-- app_tratamientos_detectar no cambia: sólo mira lo comprado y nunca borra lo
-- que agregó el cliente.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_tratamiento_buscar(p_customer bigint, p_q text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_ids integer[]; v json; v_q text := left(trim(coalesce(p_q, '')), 60);
BEGIN
  IF length(v_q) < 2 THEN RETURN '[]'::json; END IF;
  SELECT array_agg((x)::integer) INTO v_ids
    FROM json_array_elements_text((public.buscar_productos_ids(v_q, 200, true, true, true))->'ids') x;
  IF v_ids IS NULL THEN RETURN '[]'::json; END IF;
  WITH cand AS MATERIALIZED (
    SELECT p.id, p.nombre, array_position(v_ids, p.id) AS orden
      FROM public.products p
     WHERE p.id = ANY (v_ids) AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
       AND public.es_medicamento_de_tratamiento(p.nombre, p.principio_activo)
       AND NOT EXISTS (SELECT 1 FROM public.app_tratamientos a WHERE a.customer_id = p_customer AND a.product_id = p.id)
     ORDER BY 3 LIMIT 30)
  SELECT coalesce(json_agg(json_build_object('product_id', c.id, 'nombre', c.nombre, 'ultima', u.ultima,
           'pide', CASE WHEN u.ultima IS NULL OR public.tratamiento_dias_por_unidad(c.id) IS NULL THEN 'dias'
                        WHEN public.tratamiento_ajusta_dosis(c.id) THEN 'dosis' ELSE 'nada' END)
           ORDER BY c.orden), '[]'::json)
    INTO v
    FROM cand c
    LEFT JOIN LATERAL (
      SELECT max(si.fecha) AS ultima
        FROM public.sales_invoices si
        JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
       WHERE si.customer_id = p_customer AND si.fecha >= current_date - 365
         AND public.venta_valida(si.estado) AND ii.erp_product_id = c.id) u ON true;
  RETURN v;
END $function$;

REVOKE EXECUTE ON FUNCTION public.app_tratamiento_buscar(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_tratamiento_buscar(bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.app_tratamiento_agregar(p_customer bigint, p_product_id integer, p_dosis numeric, p_dias integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_nombre text; v_pa text; v_ultima date; v_unid numeric; v_dpu numeric; v_ajusta boolean; v_dura integer; v_se_acaba date;
  v_compro boolean;
BEGIN
  SELECT p.nombre, p.principio_activo INTO v_nombre, v_pa FROM public.products p WHERE p.id = p_product_id;
  IF v_nombre IS NULL OR NOT public.es_medicamento_de_tratamiento(v_nombre, v_pa) THEN
    RAISE EXCEPTION 'Ese producto no se puede agregar';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_tratamientos WHERE customer_id = p_customer AND product_id = p_product_id) THEN
    RAISE EXCEPTION 'Ya está en tu lista';
  END IF;
  SELECT si.fecha, sum(ii.cantidad * coalesce(ii.factor_unidades, 1)) INTO v_ultima, v_unid
    FROM public.sales_invoices si
    JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
   WHERE si.customer_id = p_customer AND si.fecha >= current_date - 365
     AND public.venta_valida(si.estado) AND ii.erp_product_id = p_product_id
   GROUP BY si.fecha ORDER BY si.fecha DESC LIMIT 1;
  v_compro := v_ultima IS NOT NULL;

  v_dpu := public.tratamiento_dias_por_unidad(p_product_id);
  v_ajusta := coalesce(public.tratamiento_ajusta_dosis(p_product_id), false);
  IF NOT v_compro THEN
    -- No lo compró aquí: se cuenta desde hoy con los días que dice que le dura.
    IF p_dias IS NULL OR p_dias < 1 OR p_dias > 365 THEN RAISE EXCEPTION 'Dinos cuántos días te dura'; END IF;
    v_ultima := current_date;
    v_dpu := NULL;
    v_dura := p_dias;
  ELSIF v_dpu IS NULL THEN
    IF p_dias IS NULL OR p_dias < 1 OR p_dias > 365 THEN RAISE EXCEPTION 'Dinos cuántos días te dura una compra'; END IF;
    v_dura := p_dias;
  ELSE
    IF v_ajusta AND (p_dosis IS NULL OR p_dosis <= 0 OR p_dosis > 24) THEN RAISE EXCEPTION 'Dinos cuánto tomas al día'; END IF;
    v_dura := round(v_unid * v_dpu / CASE WHEN v_ajusta THEN p_dosis ELSE 1 END)::int;
  END IF;

  INSERT INTO public.app_tratamientos (customer_id, product_id, nombre, intervalo_dias, ultima_compra, veces, dura_dias,
                                       origen, dura_cliente, dosis_dia, dosis_at)
  VALUES (p_customer, p_product_id, v_nombre, greatest(v_dura, 1), v_ultima, CASE WHEN v_compro THEN 1 ELSE 0 END, v_dura,
          'cliente', CASE WHEN v_dpu IS NULL THEN p_dias END,
          CASE WHEN v_dpu IS NOT NULL AND v_ajusta THEN p_dosis END,
          CASE WHEN v_dpu IS NOT NULL AND v_ajusta THEN now() END);
  -- Con todo el historial: veces, cada cuánto y la duración a su dosis.
  IF v_compro THEN PERFORM public.app_tratamientos_detectar(ARRAY[p_customer]); END IF;
  SELECT a.se_acaba INTO v_se_acaba FROM public.app_tratamientos a
   WHERE a.customer_id = p_customer AND a.product_id = p_product_id;
  RETURN json_build_object('ok', true, 'se_acaba', v_se_acaba);
END $function$;

CREATE OR REPLACE FUNCTION public.app_tratamientos_de(p_customer bigint)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(json_build_object('id', a.id, 'product_id', a.product_id, 'nombre', a.nombre,
           'intervalo', a.intervalo_dias, 'ultima', a.ultima_compra, 'se_acaba', a.se_acaba,
           'estado', a.estado, 'motivo', a.motivo,
           'dosis', a.dosis_dia, 'ajusta_dosis', coalesce(public.tratamiento_ajusta_dosis(a.product_id), false),
           'origen', a.origen, 'dura_cliente', a.dura_cliente, 'familiar_id', a.familiar_id, 'veces', a.veces)
           ORDER BY a.estado, a.se_acaba), '[]'::json)
    FROM public.app_tratamientos a WHERE a.customer_id = p_customer;
$function$;
