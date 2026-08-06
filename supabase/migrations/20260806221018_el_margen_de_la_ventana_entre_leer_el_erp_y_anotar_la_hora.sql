-- El error de uno que quedaba en el borde del sync.
--
-- `traslados_en_vuelo()` considera despachado-y-no-reflejado a todo traslado
-- cuya hora sea POSTERIOR al último `synced_at` de esa sucursal. La suposición
-- escondida es que `synced_at` marca el momento en que se leyó el sistema.
--
-- No lo marca: se inserta **al terminar** la corrida, después de haber leído el
-- JSON y escrito las filas. Entonces un traslado despachado en el medio —entre
-- la lectura y la anotación— cae en el peor lugar posible: el JSON que se leyó
-- no lo tiene, así que `inventory` no lo refleja; pero su hora es anterior a
-- `synced_at`, así que tampoco cuenta como en vuelo. El portal lo mostraría
-- disponible hasta la corrida siguiente.
--
-- Medido el 2026-08-06: la corrida completa (8 combinaciones de sucursal y
-- ubicación) tarda entre **1,7 y 2,3 segundos**, con 0,3 s de separación
-- promedio entre una y otra. O sea que la ventana real son un par de segundos
-- por minuto. Chica, pero existe — y el modo de fallar es el peor de los dos:
-- prometer producto que ya salió.
--
-- El margen de 15 segundos la cubre con holgura. El costo es simétrico y
-- pequeño: durante 15 segundos después de la corrida que SÍ lo reflejó, el
-- traslado se resta dos veces y el portal subestima. Entre subestimar unos
-- segundos y prometer lo que no está, se elige lo primero.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.traslados_en_vuelo()
RETURNS TABLE (erp_sucursal_id integer, erp_product_id integer, unidades numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    WITH ultima AS (
        -- El margen va acá y no en la comparación para que se lea una sola vez
        -- qué significa: «el sistema se leyó, como muy tarde, 15 s antes de que
        -- lo anotáramos».
        SELECT l.erp_sucursal_id::integer AS suc,
               max(l.synced_at) - interval '15 seconds' AS at
        FROM public.inventory_sync_log l
        WHERE l.success AND l.is_vencidos = false
        GROUP BY 1
    )
    SELECT (a.metadata->>'origen_erp_sucursal_id')::integer,
           (it->>'erp_product_id')::integer,
           sum(coalesce((it->>'cantidad')::numeric, 0) * coalesce((it->>'factor')::numeric, 1))
    FROM public.approval_requests a
    CROSS JOIN LATERAL jsonb_array_elements(a.metadata->'items') it
    LEFT JOIN ultima u ON u.suc = (a.metadata->>'origen_erp_sucursal_id')::integer
    WHERE a.type = 'INVENTORY_TRANSFER_REQUEST'
      AND a.status = 'APPROVED'
      AND a.metadata ? 'erp_traslado'
      AND (a.metadata->'erp_traslado'->>'at')::timestamptz > coalesce(u.at, '-infinity'::timestamptz)
    GROUP BY 1, 2;
$$;

REVOKE EXECUTE ON FUNCTION public.traslados_en_vuelo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.traslados_en_vuelo() TO authenticated, service_role;
