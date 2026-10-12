-- chat_cliente_contexto (2026-10-12): el panel «Cliente» del chat del portal —
-- ficha, tipo, nivel, saldo de puntos, últimas compras con sus productos,
-- reservas activas y Mis tratamientos. Quien contesta el chat no
-- necesariamente tiene permiso sobre ventas, puntos o reservas: UNA función
-- DEFINER con la guarda del módulo del chat. Devuelve un único json acotado
-- por LIMIT. Compras por idx_sales_invoices_cliente_fecha, renglones por
-- idx_sii_invoice_covering. plpgsql + force_custom_plan (el plan depende del
-- argumento).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.chat_cliente_contexto(p_customer bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, extensions
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_may json;
  v_compra numeric;
BEGIN
  IF NOT public.auth_has_module_permission('chat_clientes', 'can_view') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer) THEN
    RETURN NULL;
  END IF;

  v_may := public.mayorista_de(p_customer);
  v_compra := public.puntos_compra_12m(p_customer, v_hoy);

  RETURN json_build_object(
    'customer_id', p_customer,
    'cliente',  (SELECT c.name  FROM public.customers c WHERE c.id = p_customer),
    'telefono', (SELECT c.phone FROM public.customers c WHERE c.id = p_customer),
    'foto_ruta', (SELECT f.ruta FROM public.app_cliente_fotos f
                   WHERE f.customer_id = p_customer AND f.quitada_at IS NULL LIMIT 1),
    'es_team', public.cliente_es_empleado(p_customer),
    'es_mayoreo', (v_may ->> 'estado') = 'aprobado',
    'rango', v_may ->> 'rango',
    'compra_12m', v_compra,
    'nivel', (public.puntos_nivel_de(v_compra)).clave,
    'saldo_puntos', coalesce((SELECT pc.saldo FROM public.puntos_cuenta pc WHERE pc.customer_id = p_customer), 0),
    'compras', coalesce((
      SELECT json_agg(to_json(x) ORDER BY x.fecha DESC, x.hora DESC NULLS LAST)
        FROM (
          SELECT si.id, si.fecha, si.hora, si.tipo_documento, si.total,
                 b.name AS sala,
                 (SELECT count(*) FROM public.sales_invoice_items it WHERE it.invoice_id = si.id)::int AS n_productos,
                 (SELECT coalesce(json_agg(json_build_object(
                           'descripcion', it.descripcion,
                           'cantidad', it.cantidad,
                           'total', it.total_linea) ORDER BY it.linea_num), '[]'::json)
                    FROM (SELECT * FROM public.sales_invoice_items i2
                           WHERE i2.invoice_id = si.id
                           ORDER BY i2.linea_num LIMIT 30) it) AS productos
            FROM public.sales_invoices si
            LEFT JOIN public.branches b ON b.id = si.branch_id
           WHERE si.customer_id = p_customer
             AND public.venta_valida(si.estado)
           ORDER BY si.fecha DESC, si.hora DESC NULLS LAST
           LIMIT 10) x), '[]'::json),
    'reservas', coalesce((
      SELECT json_agg(to_json(r) ORDER BY r.created_at DESC)
        FROM (
          SELECT ar.id, ar.estado, ar.pedido, ar.producto_nombre, ar.cantidad, ar.entrega,
                 ar.receta_estado, ar.vence_at, ar.created_at, b.name AS sala
            FROM public.app_reservas ar
            LEFT JOIN public.branches b ON b.id = ar.branch_id
           WHERE ar.customer_id = p_customer
             AND ar.estado IN ('en_revision', 'pendiente', 'lista')
           ORDER BY ar.created_at DESC
           LIMIT 20) r), '[]'::json),
    'tratamientos', coalesce((
      SELECT json_agg(to_json(t) ORDER BY t.estado, t.se_acaba)
        FROM (
          SELECT a.id, a.nombre, a.intervalo_dias, a.ultima_compra,
                 a.ultima_compra + a.intervalo_dias AS se_acaba, a.estado
            FROM public.app_tratamientos a
           WHERE a.customer_id = p_customer
           ORDER BY a.estado, a.ultima_compra + a.intervalo_dias
           LIMIT 30) t), '[]'::json)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.chat_cliente_contexto(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_cliente_contexto(bigint) TO authenticated, service_role;
