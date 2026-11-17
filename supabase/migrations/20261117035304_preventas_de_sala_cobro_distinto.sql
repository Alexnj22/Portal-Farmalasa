-- La lista de Preventa trae `cobro_distinto` (2026-11-16): la tarjeta dice
-- «Se cobró distinto» y qué cambió. Parte de la definición VIVA (md5 00fcddf9…).
SET lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.preventas_de_sala(p_branch bigint, p_dias integer DEFAULT 1)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.preventa_puede(public.auth_employee_id(), p_branch, 'can_view') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(json_agg(json_build_object(
      'id', pv.id, 'codigo', 'V-' || lpad(pv.id::text, 6, '0'), 'estado', pv.estado, 'total', pv.total,
      'externo_ref', pv.externo_ref, 'customer_id', pv.customer_id, 'cliente', c.name,
      'enviada_por', pv.enviada_por, 'vendedor', em.name, 'enviada_at', pv.enviada_at, 'created_at', pv.created_at,
      'corregida_veces', pv.corregida_veces, 'error', pv.error, 'venta', pv.venta, 'avisos', pv.destino->'avisos',
      'factura', si.correlativo, 'facturada_at', pv.facturada_at, 'anulada_at', pv.anulada_at,
      'cobro_distinto', pv.cobro_distinto)
      ORDER BY pv.created_at DESC), '[]'::json)
    FROM public.preventas pv
    LEFT JOIN public.customers c ON c.id = pv.customer_id
    LEFT JOIN public.employees em ON em.id = pv.enviada_por
    LEFT JOIN public.sales_invoices si ON si.id = pv.sales_invoice_id
   WHERE pv.branch_id = p_branch AND pv.origen = 'directa'
     AND pv.created_at >= (date_trunc('day', now() AT TIME ZONE 'America/El_Salvador') - make_interval(days => greatest(coalesce(p_dias, 1), 1) - 1))
                           AT TIME ZONE 'America/El_Salvador');
END $function$;
