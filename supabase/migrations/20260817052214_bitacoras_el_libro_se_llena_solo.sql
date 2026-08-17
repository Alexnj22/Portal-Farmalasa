SET lock_timeout = '5s';

-- ── El libro se llena solo ──────────────────────────────────────────────────
--
-- Hasta ahora `sincronizar_bitacora_dispensaciones` existía y NADIE la llamaba:
-- agosto entro porque se corrio a mano. Una venta bajo receta de hoy no habria
-- aparecido nunca, y el hueco no se nota — el libro simplemente no crece, que
-- se ve igual que «no hubo ventas bajo receta».
--
-- Y un segundo hueco del mismo tipo: la funcion solo INSERTABA. Una factura que
-- Hacienda invalida DESPUES de que el renglon entro se quedaba «pendiente» para
-- siempre, y la sala iba a completar la receta de una venta que ya no existe.
--
-- Lo que NO toca: un renglon que una persona anulo (devolucion, carga
-- equivocada). Ese motivo lo escribio alguien y no lo pisa un proceso.

DROP FUNCTION IF EXISTS public.sincronizar_bitacora_dispensaciones(date, date, bigint);

CREATE FUNCTION public.sincronizar_bitacora_dispensaciones(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_r     record;
    v_folio integer;
    v_anio  smallint;
    v_anulada boolean;
    v_nuevos  integer := 0;
    v_anulados integer := 0;
BEGIN
    FOR v_r IN
        SELECT i.id AS item_id, s.id AS invoice_id, s.branch_id, s.fecha, s.hora,
               i.erp_product_id,
               coalesce(nullif(btrim(i.descripcion), ''), p.nombre, 'Sin descripcion') AS producto_nombre,
               l.nombre AS laboratorio,
               i.presentacion,
               i.cantidad, i.lote, i.fecha_vencimiento,
               s.codigo_generacion, s.correlativo, s.tipo_documento, s.estado AS doc_estado,
               s.cliente, s.customer_id, s.cod_vendedor, e.name AS vendedor_nombre
          FROM public.sales_invoice_items i
          JOIN public.sales_invoices s ON s.id = i.invoice_id
          JOIN public.products p       ON p.id = i.erp_product_id
          LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
          LEFT JOIN public.employees e ON e.code = s.cod_vendedor
         WHERE p.es_antibiotico
           AND s.fecha BETWEEN p_desde AND p_hasta
           AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
           AND NOT EXISTS (SELECT 1 FROM public.bitacora_dispensaciones d
                            WHERE d.sales_invoice_item_id = i.id)
         ORDER BY s.branch_id, s.fecha, s.hora NULLS LAST, s.id, i.linea_num NULLS LAST, i.id
    LOOP
        v_anio  := extract(year FROM v_r.fecha)::smallint;
        v_folio := public.bitacora_tomar_folio(v_r.branch_id, v_anio, 'disp');
        v_anulada := v_r.doc_estado ILIKE '%INVALIDADO%' OR v_r.doc_estado ILIKE '%ANULAD%';

        INSERT INTO public.bitacora_dispensaciones (
            branch_id, anio, folio, sales_invoice_item_id, invoice_id,
            fecha, hora, erp_product_id, producto_nombre, laboratorio, presentacion,
            cantidad, lote, fecha_vencimiento,
            codigo_generacion, correlativo_doc, tipo_documento, documento_estado,
            cliente_texto, customer_id, cod_vendedor, vendedor_nombre,
            estado, motivo_anulacion, anulada_at
        ) VALUES (
            v_r.branch_id, v_anio, v_folio, v_r.item_id, v_r.invoice_id,
            v_r.fecha, v_r.hora, v_r.erp_product_id, v_r.producto_nombre, v_r.laboratorio, v_r.presentacion,
            v_r.cantidad, nullif(btrim(v_r.lote), ''), v_r.fecha_vencimiento,
            v_r.codigo_generacion, v_r.correlativo, v_r.tipo_documento, v_r.doc_estado,
            v_r.cliente, v_r.customer_id, v_r.cod_vendedor, v_r.vendedor_nombre,
            CASE WHEN v_anulada THEN 'anulada' ELSE 'pendiente' END,
            CASE WHEN v_anulada THEN 'dte_invalidado' ELSE NULL END,
            CASE WHEN v_anulada THEN now() ELSE NULL END
        );
        v_nuevos := v_nuevos + 1;
    END LOOP;

    WITH invalidadas AS (
        UPDATE public.bitacora_dispensaciones d
           SET estado = 'anulada',
               motivo_anulacion = 'dte_invalidado',
               documento_estado = s.estado,
               anulada_at = now()
          FROM public.sales_invoices s
         WHERE s.id = d.invoice_id
           AND d.fecha BETWEEN p_desde AND p_hasta
           AND (p_branch_id IS NULL OR d.branch_id = p_branch_id)
           AND d.estado <> 'anulada'
           AND (s.estado ILIKE '%INVALIDADO%' OR s.estado ILIKE '%ANULAD%')
        RETURNING d.id
    )
    SELECT count(*) INTO v_anulados FROM invalidadas;

    UPDATE public.recetas r
       SET estado = CASE WHEN ent.entregado >= ri.cantidad_prescrita THEN 'cerrada' ELSE 'abierta' END
      FROM public.receta_items ri
      JOIN LATERAL (
          SELECT coalesce(sum(d2.cantidad), 0) AS entregado
            FROM public.bitacora_dispensaciones d2
           WHERE d2.receta_item_id = ri.id AND d2.estado <> 'anulada'
      ) ent ON true
     WHERE r.id = ri.receta_id
       AND r.estado <> 'anulada'
       AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
       AND r.estado IS DISTINCT FROM
           (CASE WHEN ent.entregado >= ri.cantidad_prescrita THEN 'cerrada' ELSE 'abierta' END);

    RETURN json_build_object('nuevos', v_nuevos, 'anulados', v_anulados);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.sincronizar_bitacora_dispensaciones(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sincronizar_bitacora_dispensaciones(date, date, bigint) TO service_role;

SELECT cron.schedule(
    'bitacora-dispensaciones-5min',
    '*/5 12-23,0-5 * * *',
    $cron$ SELECT public.sincronizar_bitacora_dispensaciones(
        (now() AT TIME ZONE 'America/El_Salvador')::date - 3,
        (now() AT TIME ZONE 'America/El_Salvador')::date
    ) $cron$
);

SELECT cron.schedule(
    'bitacora-dispensaciones-repaso-diario',
    '35 11 * * *',
    $cron$ SELECT public.sincronizar_bitacora_dispensaciones(
        (now() AT TIME ZONE 'America/El_Salvador')::date - 45,
        (now() AT TIME ZONE 'America/El_Salvador')::date
    ) $cron$
);
