SET lock_timeout = '5s';

-- Distribución · H7 · dos «facturar» simultáneos del mismo pedido quemaban un
-- número de control.
--
-- `dist_asignar_lotes` y `dist_siguiente_correlativo` corrían ANTES del INSERT
-- con el índice único por pedido: el segundo tomaba el correlativo N+1 y
-- después rebotaba con 23505, y ese número quedaba sin documento (un salto en
-- la numeración ante Hacienda). Además la segunda asignación de lotes soltaba
-- la primera.
--
-- No sirve `pg_advisory_xact_lock`: cada llamada de la edge function es su
-- propia transacción, así que el candado se soltaría al volver de la primera.
-- Hace falta un arriendo que viva entre llamadas: `facturando_desde`. Lo toma
-- `dist_tomar_para_facturar` en UNA sentencia (compare-and-set), lo suelta
-- `dist_soltar_facturacion` salga como salga, y vence solo a los 3 minutos si
-- la función se corta (el tope de una Edge Function son 150 s): nadie queda
-- trabado esperando a una corrida que ya no existe. Mismo patrón que
-- `reclamar_solicitud` / `liberar_solicitud`.
--
-- dist_pedidos tiene 0 filas en producción hoy (2026-10-22).

ALTER TABLE public.dist_pedidos ADD COLUMN IF NOT EXISTS facturando_desde timestamptz;

COMMENT ON COLUMN public.dist_pedidos.facturando_desde IS
  'Arriendo de la facturación: mientras esté vigente (3 min), nadie más pide lotes ni correlativo para este pedido.';

CREATE OR REPLACE FUNCTION public.dist_tomar_para_facturar(p_pedido bigint, p_segundos integer DEFAULT 180)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_filas integer;
BEGIN
    UPDATE public.dist_pedidos
       SET facturando_desde = now()
     WHERE id = p_pedido
       AND estado = 'confirmado'
       AND (facturando_desde IS NULL
            OR facturando_desde < now() - make_interval(secs => p_segundos));
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    RETURN v_filas > 0;
END $function$;

CREATE OR REPLACE FUNCTION public.dist_soltar_facturacion(p_pedido bigint)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    UPDATE public.dist_pedidos SET facturando_desde = NULL
     WHERE id = p_pedido AND facturando_desde IS NOT NULL;
$function$;

-- Sólo la edge function (llave de servicio) toma y suelta el arriendo.
REVOKE EXECUTE ON FUNCTION public.dist_tomar_para_facturar(bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dist_soltar_facturacion(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_tomar_para_facturar(bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.dist_soltar_facturacion(bigint) TO service_role;
