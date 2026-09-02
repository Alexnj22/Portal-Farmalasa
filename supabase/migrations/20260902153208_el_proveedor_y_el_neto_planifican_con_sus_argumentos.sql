-- Las dos funciones que alimentan el CSV de Mín·Máx en Bodega nacían con plan
-- genérico. Es la trampa 4 del CLAUDE.md: `LANGUAGE sql` + `SET search_path` no
-- se inlinea (el SET la vuelve opaca) y su cuerpo se planifica UNA vez con los
-- argumentos como `Params` — nunca ve un valor. No cae al genérico en la sexta
-- llamada: nace genérica, y no hay plan personalizado que pedir.
--
-- El plan bueno SÍ depende del argumento, que es la condición que faltaba en la
-- auditoría del 25-ago: el array trae 1,000 ids, y sin verlo el planificador
-- estima 127 filas donde hay 12,296 —97× corto— así que elige un Nested Loop
-- con un Index Scan a `purchase_receipts` POR FILA. Con el array a la vista
-- estima 12,705 y elige un Hash Join con UN barrido de las 5,442 filas.
--
-- Medido el 2026-09-02 con la definición vieja levantada en `pg_temp` al lado
-- de su cuerpo con literales (EXPLAIN ANALYZE, TIMING OFF, BUFFERS):
--
--   get_top_supplier_per_product   300 ids: 15,310 bloques   1,000 ids: 48,441
--     el mismo cuerpo con literales           633                          791
--   get_sucursal_net_stock                                   1,000 ids:  5,948
--     el mismo cuerpo con literales                                       1,078
--
-- O sea 24× y 61× el trabajo, para devolver lo mismo (verificado: md5 idéntico,
-- 1,000 y 839 filas). 379 MB para leer dos tablas que juntas pesan 15 MB.
--
-- ── Por qué la auditoría del 25-ago la declaró sana ────────────────────────
-- Su criterio de descarte era el TIEMPO: «bajo 200 ms no hace falta medirla a
-- fondo», y esta anotó 19 ms. El número no estaba mal — con la caché caliente
-- las 48,441 lecturas cuestan 43 ms, porque son casi todas `hit`. La primera
-- llamada del día, con 550 bloques que sí hay que ir a buscar al disco, costó
-- **876 ms**. Un umbral de milisegundos sobre una base en reposo no puede ver
-- una diferencia de 61× en TRABAJO; los bloques sí, y por eso el hallazgo salió
-- de la sección F de gate:perf y no de la E.
--
-- La corrección es pasarlas a `plpgsql` —que sí entra al caché de planes— y ahí
-- sí `SET plan_cache_mode TO 'force_custom_plan'`. El cuerpo no se toca; sólo
-- se renombran las columnas del SELECT final, que en plpgsql chocarían con los
-- parámetros de salida. Cuesta ~2 ms de planificación por llamada.
--
-- Verificado tras aplicar, siete llamadas seguidas (la sexta es donde plpgsql
-- cambiaría al genérico si no estuviera forzado): 806 bloques / 16 ms y 1,072 /
-- 25, iguales en la 1, la 6 y la 7.
--
-- Ojo al cerrar: las dos salen del set de `LANGUAGE sql` con SET, así que hay
-- que SACARLAS de scripts/planes-genericos.json — una entrada que ya no existe
-- en producción hace fallar la sección E igual que una sin declarar.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_top_supplier_per_product(p_product_ids integer[])
RETURNS TABLE(erp_product_id integer, proveedor text)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
    RETURN QUERY
    WITH ranked AS (
        SELECT
            pri.erp_product_id AS pid,
            pr.proveedor       AS prov,
            ROW_NUMBER() OVER (
                PARTITION BY pri.erp_product_id
                ORDER BY SUM(pri.cantidad) DESC
            ) AS rn
        FROM purchase_receipt_items pri
        JOIN purchase_receipts pr ON pr.id = pri.receipt_id
        WHERE pri.erp_product_id = ANY(p_product_ids)
          AND pr.proveedor IS NOT NULL
        GROUP BY pri.erp_product_id, pr.proveedor
    )
    SELECT r.pid::int, r.prov
    FROM ranked r
    WHERE r.rn = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sucursal_net_stock(p_product_ids integer[])
RETURNS TABLE(erp_product_id integer, net_stock bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
    RETURN QUERY
    WITH pres_factors AS (
        -- Un factor por (producto, descripcion) — evita multiplicar filas en el SUM
        SELECT pp.product_id, UPPER(pp.descripcion) AS desc_key, MAX(pp.factor) AS factor
        FROM product_precios pp
        GROUP BY pp.product_id, UPPER(pp.descripcion)
    )
    SELECT
        i.erp_product_id::int,
        SUM(i.cantidad * COALESCE(pf.factor, 1))::bigint
    FROM inventory i
    LEFT JOIN pres_factors pf
        ON pf.product_id = i.erp_product_id
        AND pf.desc_key  = UPPER(i.detalle)
    WHERE i.erp_product_id = ANY(p_product_ids)
      AND i.erp_sucursal_id <> 6
      AND i.is_vencidos = false
    GROUP BY i.erp_product_id;
END;
$function$;
