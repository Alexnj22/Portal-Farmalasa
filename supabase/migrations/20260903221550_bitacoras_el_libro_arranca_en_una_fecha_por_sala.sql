SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El libro tiene fecha de apertura, y la decide la sala.
--
-- Sin esto, el sync sigue cargando cada venta bajo receta desde hoy, y el
-- 1 de octubre —el día que las bitácoras arrancan de verdad— el libro estrena
-- con un mes de renglones pendientes y con el folio 00200 en la primera hoja.
-- Que es exactamente el problema que la migración 20260903221013 acaba de
-- limpiar: volvería solo, por no haber puesto la fecha.
--
-- Va en `branches` y no en una constante dentro de la función: una sala puede
-- arrancar después que las demás, y un número escrito adentro de un `WHERE` no
-- se puede mover sin una migración. `branches` tiene 7 filas y ningún cron le
-- escribe, así que el ALTER no compite con nada.
--
-- NULL = el libro no ha abierto en esa sala y no entra ningún renglón. Es la
-- falla segura: una sala nueva no empieza a acumular pendientes que nadie sabe
-- que existen.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.branches
    ADD COLUMN IF NOT EXISTS libro_receta_desde date;

COMMENT ON COLUMN public.branches.libro_receta_desde IS
    'Desde qué día esta sala lleva el libro de dispensación bajo receta. NULL = todavía no abrió.';

UPDATE public.branches
   SET libro_receta_desde = DATE '2026-10-01'
 WHERE type = 'FARMACIA' AND libro_receta_desde IS NULL;

-- Lo que se cargó entre la purga y esta migración es de la ventana de prueba
-- del cron de un minuto: no es del libro.
DELETE FROM public.bitacora_dispensaciones;
UPDATE public.bitacora_folios SET ultimo = 0 WHERE serie IN ('disp', 'disp_rx', 'receta');

-- ── El sync respeta la apertura ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sincronizar_bitacora_dispensaciones(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
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
               s.cliente, s.customer_id, s.cod_vendedor, e.name AS vendedor_nombre,
               coalesce(dc.clase, CASE WHEN p.es_antibiotico THEN 'antibiotico' END) AS clase
          FROM public.sales_invoice_items i
          JOIN public.sales_invoices s ON s.id = i.invoice_id
          JOIN public.branches br      ON br.id = s.branch_id
          JOIN public.products p       ON p.id = i.erp_product_id
          LEFT JOIN public.dispensacion_clases dc ON dc.erp_product_id = p.id
          LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
          LEFT JOIN public.employees e ON e.code = s.cod_vendedor
         WHERE coalesce(dc.clase, CASE WHEN p.es_antibiotico THEN 'antibiotico' END) IS NOT NULL
           AND br.libro_receta_desde IS NOT NULL
           AND s.fecha >= br.libro_receta_desde
           AND s.fecha BETWEEN p_desde AND p_hasta
           AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
           AND NOT EXISTS (SELECT 1 FROM public.bitacora_dispensaciones d
                            WHERE d.sales_invoice_item_id = i.id)
         ORDER BY s.branch_id, s.fecha, s.hora NULLS LAST, s.id, i.linea_num NULLS LAST, i.id
    LOOP
        v_anio  := extract(year FROM v_r.fecha)::smallint;
        v_folio := public.bitacora_tomar_folio(
                       v_r.branch_id, v_anio,
                       CASE WHEN v_r.clase = 'bajo_receta' THEN 'disp_rx' ELSE 'disp' END);
        v_anulada := v_r.doc_estado ILIKE '%INVALIDADO%' OR v_r.doc_estado ILIKE '%ANULAD%';

        INSERT INTO public.bitacora_dispensaciones (
            branch_id, anio, folio, clase, sales_invoice_item_id, invoice_id,
            fecha, hora, erp_product_id, producto_nombre, laboratorio, presentacion,
            cantidad, lote, fecha_vencimiento,
            codigo_generacion, correlativo_doc, tipo_documento, documento_estado,
            cliente_texto, customer_id, cod_vendedor, vendedor_nombre,
            estado, motivo_anulacion, anulada_at
        ) VALUES (
            v_r.branch_id, v_anio, v_folio, v_r.clase, v_r.item_id, v_r.invoice_id,
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
GRANT  EXECUTE ON FUNCTION public.sincronizar_bitacora_dispensaciones(date, date, bigint) TO authenticated, service_role;
