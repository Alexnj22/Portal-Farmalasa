-- F7 · Puntos: la corrida de cada minuto deja de rehacer la semana entera.
--
-- `sync-puntos` corre cada minuto y leía 46k bloques (360 MB) por corrida para
-- mandar, casi siempre, cero ventas: `ventas_para_puntos` re-evaluaba las ~443
-- facturas `sin_enviar` de los últimos 7 días —que casi nunca cambian— y
-- preguntaba a `puntos_enviados` por las 4,119 facturas de la semana. Eran
-- 2.4 TB por semana, más 1 TB de `puntos_marcar_sin_enviar` sobre la misma
-- ventana y 0.5 TB del barrido de «acumulado».
--
-- Decisión del usuario el 2026-09-22: cada minuto se miran 2 días y sólo las
-- facturas SIN fila en la bitácora; en el minuto 0 de cada hora, los 7 días y
-- las `sin_enviar`. Una venta del día sigue saliendo al minuto; una que entra
-- tarde o que se vuelve elegible sale en ≤1 h en vez de ≤1 min.
--
-- 1. `ventas_para_puntos` gana `p_reevaluar boolean DEFAULT true`. Con `true`
--    es la de siempre —comprobado en pg_temp en seis ventanas y márgenes, md5
--    idéntico en las seis—; con `false` sólo deja afuera facturas que ya tienen
--    fila `sin_enviar` (0 excepciones). Se BORRA la firma de cuatro argumentos
--    en vez de sumar una sobrecarga: con las dos, una llamada con cuatro
--    argumentos con nombre sería ambigua y PostgREST la rechazaría. El default
--    hace que la función que hoy llama con cuatro siga funcionando igual hasta
--    que se despliegue la que pasa el quinto.
--      corrida de cada minuto (2 días, false): 46,149 → 9,123 bloques
-- 2. `puntos_anotar_aplicado` cruza los lotes grandes con un hash join: el
--    barrido de «acumulado» (23k filas cada 10 min) pasaba de 92k bloques a 8k
--    por lote completo. El UPDATE es el mismo, con el mismo `IS DISTINCT FROM`.
SET lock_timeout = '5s';

DROP FUNCTION public.ventas_para_puntos(date, date, numeric, integer);

CREATE FUNCTION public.ventas_para_puntos(p_desde date, p_hasta date, p_margen numeric DEFAULT 0.02, p_tope integer DEFAULT 2000, p_reevaluar boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v json;
BEGIN
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    WITH inv AS (
      SELECT si.id, b.codigo_puntos AS sucursal, si.erp_invoice_id, si.correlativo,
             si.cliente, si.cod_vendedor::int AS cod_vendedor, si.total, si.fecha
      FROM public.sales_invoices si
      JOIN public.branches b
        ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
      LEFT JOIN public.puntos_enviados pe ON pe.invoice_id = si.id
      LEFT JOIN public.customers cu ON cu.id = si.customer_id
      WHERE si.fecha BETWEEN p_desde AND p_hasta
        AND si.estado = 'FINALIZADA'
        AND si.total > 1
        AND si.cod_vendedor ~ '^[0-9]{1,9}$'
        AND coalesce(cu.acumula_puntos, true)
        -- `p_reevaluar = false` es la corrida de cada minuto: sólo facturas SIN
        -- fila en la bitácora. Las `sin_enviar` se vuelven a mirar en la corrida
        -- completa de cada hora (ver el encabezado de la migración 2026-09-22).
        AND (pe.invoice_id IS NULL OR (p_reevaluar AND pe.estado_puntos = 'sin_enviar'))
    ),
    pv AS (
      SELECT p.product_id, p.id_presentacion,
             upper(regexp_replace(coalesce(pr.tipo,'') || ' ' || coalesce(p.descripcion,''),
                                  '\s+', ' ', 'g')) AS pkey,
             p.vineta, p.descuento_1, p.vip
      FROM public.product_precios p
      LEFT JOIN public.presentaciones pr ON pr.id = p.id_presentacion
      WHERE p.activo
    ),
    lin AS (
      SELECT ii.invoice_id, ii.precio_unitario, ii.erp_product_id, inv.fecha,
             upper(regexp_replace(coalesce(ii.presentacion,''), '\s+', ' ', 'g')) AS pkey,
             coalesce(lab.acumula_puntos, true) AS acumula
      FROM public.sales_invoice_items ii
      JOIN inv ON inv.id = ii.invoice_id
      LEFT JOIN public.products      prd ON prd.id = ii.erp_product_id
      LEFT JOIN public.laboratorios  lab ON lab.id = prd.laboratorio_id
    ),
    ok AS (
      SELECT lin.invoice_id, lin.acumula,
             EXISTS (
               SELECT 1
               FROM pv
               CROSS JOIN LATERAL (
                 SELECT coalesce(h.vineta,      pv.vineta)      AS p1,
                        coalesce(h.descuento_1, pv.descuento_1) AS p2,
                        coalesce(h.vip,         pv.vip)         AS p3
                 FROM (SELECT 1) z
                 LEFT JOIN LATERAL (
                   SELECT h2.vineta, h2.descuento_1, h2.vip
                   FROM public.product_precios_history h2
                   WHERE h2.product_id      = pv.product_id
                     AND h2.id_presentacion = pv.id_presentacion
                     AND h2.valid_from  <  (lin.fecha + 1)::timestamptz
                     AND (h2.valid_until IS NULL OR h2.valid_until >= lin.fecha::timestamptz)
                   ORDER BY h2.valid_from DESC
                   LIMIT 1
                 ) h ON true
               ) e
               WHERE pv.product_id = lin.erp_product_id
                 AND pv.pkey       = lin.pkey
                 AND coalesce(nullif(e.p3,0), nullif(e.p2,0), nullif(e.p1,0)) IS NOT NULL
                 AND lin.precio_unitario >=
                     coalesce(nullif(e.p3,0), nullif(e.p2,0), nullif(e.p1,0)) * (1 - p_margen)
             ) AS ok
      FROM lin
    ),
    agg AS (
      SELECT invoice_id,
             bool_and(ok)      AS todas,
             bool_or(acumula)  AS lleva_producto
      FROM ok GROUP BY 1
    )
    SELECT inv.id AS invoice_id, inv.sucursal, inv.erp_invoice_id, inv.correlativo,
           inv.cliente, inv.cod_vendedor, inv.total, inv.fecha
    FROM inv
    JOIN agg ON agg.invoice_id = inv.id
    WHERE agg.todas AND agg.lleva_producto
    ORDER BY inv.fecha, inv.id
    LIMIT p_tope
  ) t;

  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.ventas_para_puntos(date, date, numeric, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ventas_para_puntos(date, date, numeric, integer, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.puntos_anotar_aplicado(p_filas json)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  n integer;
  v_nestloop text := current_setting('enable_nestloop');
BEGIN
  -- Un lote grande se cruza con UNA lectura de la bitácora, no fila por fila.
  -- `json_array_elements` se estima siempre en 100 filas, así que el
  -- planificador elige buscar por índice cada una: con el barrido de 23k eran
  -- 92k bloques contra 8k de un hash join (medido el 2026-09-22). Con pocas
  -- filas es al revés (5 filas: 21 bloques contra 8k), y el corte está en
  -- ~2,000. `force_custom_plan` hace que el cambio de estrategia se respete en
  -- cada llamada: con un plan genérico guardado, el ajuste no llegaría.
  IF json_array_length(p_filas) >= 2000 THEN
    PERFORM set_config('enable_nestloop', 'off', true);
  END IF;

  WITH entrada AS (
    SELECT (x->>'sucursal')::text  AS sucursal,
           (x->>'id')::text        AS erp_invoice_id,
           (x->>'aplicado')::smallint AS aplicado
    FROM json_array_elements(p_filas) x
  )
  UPDATE public.puntos_enviados pe
     SET aplicado = e.aplicado,
         visto_at = now()
    FROM entrada e
   WHERE pe.sucursal = e.sucursal
     AND pe.erp_invoice_id = e.erp_invoice_id
     -- No se reescribe una fila que ya dice lo mismo: un UPDATE que no cambia
     -- nada igual gasta WAL y ensucia los índices, y esto corre cada minuto.
     -- Es la regla de los syncs recurrentes de CLAUDE.md.
     AND pe.aplicado IS DISTINCT FROM e.aplicado;

  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('enable_nestloop', v_nestloop, true);
  RETURN n;
END;
$function$;
