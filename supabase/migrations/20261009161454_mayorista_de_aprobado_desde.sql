SET lock_timeout = '5s';
-- mayorista_de: agrega 'aprobado_desde' (2026-10-09). La app muestra la
-- bienvenida a precio de mayoreo sólo a quien aprobaron hace <= 45 días.
CREATE OR REPLACE FUNCTION public.mayorista_de(p_customer bigint)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT json_build_object('estado', m.estado, 'precio', m.precio, 'motivo', m.motivo, 'retiro_programado', m.retiro_programado,
    'aprobado_desde', m.aprobado_desde,
    'rango', CASE WHEN m.estado = 'aprobado' THEN public.mayorista_rango(m.customer_id) END,
    'prom_3m', (SELECT round(coalesce(sum(total), 0) / 3.0, 2) FROM public.mayoristas_resumen_mensual r
                 WHERE r.customer_id = m.customer_id
                   AND r.mes >= date_trunc('month', current_date - interval '3 months')::date AND r.mes < date_trunc('month', current_date)::date))
    FROM public.clientes_mayoristas m WHERE m.customer_id = p_customer;
$function$;
