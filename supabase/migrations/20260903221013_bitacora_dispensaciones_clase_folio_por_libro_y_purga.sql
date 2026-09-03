SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El libro se parte en dos, y cada uno lleva su propio correlativo.
--
-- ── Por qué series de folio separadas y no una compartida ─────────────────
-- Un libro foliado promete que sus folios van 1, 2, 3 sin huecos: un folio que
-- falta es lo primero que un inspector persigue. Con un correlativo compartido,
-- CADA libro tendría huecos justo donde está el otro — y ninguno de los dos
-- podría explicarlos. Por eso el de antibióticos usa la serie `disp` y el de
-- otros productos bajo receta la serie `disp_rx`, y los dos arrancan en 1.
--
-- Para que el folio siga siendo una dirección sin ambigüedad, el del segundo
-- libro se escribe `2026-R-00001`. Sin esa marca, «2026-00001» nombraría dos
-- renglones distintos.
--
-- ── La purga ───────────────────────────────────────────────────────────────
-- Los 421 renglones del 3-jul al 3-sep son de la etapa de construcción: ninguno
-- completo, sin recetas ni fotos que ya se puedan conseguir. Las bitácoras
-- arrancan el 1 de octubre. Dejarlos sería estrenar el libro con 414 folios que
-- dicen «se dispensó un antibiótico y no hay constancia de receta» — que un
-- inspector no lee como «era la prueba», lee como el folio que dice.
--
-- Los contadores vuelven a 0 para que el primer renglón real sea el 00001.
-- Autorizado por el usuario el 2026-09-03: «no hay problema con la bitácora,
-- esa aún no es oficial».
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.bitacora_dispensaciones
    ADD COLUMN IF NOT EXISTS clase text NOT NULL DEFAULT 'antibiotico';

ALTER TABLE public.bitacora_dispensaciones
    DROP CONSTRAINT IF EXISTS bitacora_disp_clase_check;
ALTER TABLE public.bitacora_dispensaciones
    ADD CONSTRAINT bitacora_disp_clase_check
    CHECK (clase IN ('antibiotico', 'bajo_receta'));

-- ── Se vacía la etapa de construcción ─────────────────────────────────────
DELETE FROM public.bitacora_dispensaciones;
DELETE FROM public.receta_items;
DELETE FROM public.recetas;
UPDATE public.bitacora_folios SET ultimo = 0 WHERE serie IN ('disp', 'disp_rx', 'receta');

-- ── El folio dice de qué libro es ─────────────────────────────────────────
ALTER TABLE public.bitacora_dispensaciones DROP COLUMN folio_txt;
ALTER TABLE public.bitacora_dispensaciones
    ADD COLUMN folio_txt text GENERATED ALWAYS AS (
        anio::text || '-'
        || CASE WHEN clase = 'bajo_receta' THEN 'R-' ELSE '' END
        || lpad(folio::text, 5, '0')
    ) STORED;

CREATE INDEX IF NOT EXISTS bitacora_disp_folio_txt_idx
    ON public.bitacora_dispensaciones (folio_txt);

-- ── El folio es único DENTRO de su libro ──────────────────────────────────
ALTER TABLE public.bitacora_dispensaciones
    DROP CONSTRAINT IF EXISTS bitacora_disp_folio_unico;
ALTER TABLE public.bitacora_dispensaciones
    ADD CONSTRAINT bitacora_disp_folio_unico UNIQUE (branch_id, anio, clase, folio);

CREATE INDEX IF NOT EXISTS bitacora_disp_branch_clase_fecha_idx
    ON public.bitacora_dispensaciones (branch_id, clase, fecha DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- El sync reparte cada venta al libro que le toca.
--
-- El criterio ya no es `p.es_antibiotico` a secas —esa casilla la reescribe el
-- ERP y significa «bajo receta», no «antibiótico»— sino la resolución de
-- `dispensacion_clases`, que deja mandar a la corrección escrita con su motivo.
-- ═══════════════════════════════════════════════════════════════════════════

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
          JOIN public.products p       ON p.id = i.erp_product_id
          LEFT JOIN public.dispensacion_clases dc ON dc.erp_product_id = p.id
          LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
          LEFT JOIN public.employees e ON e.code = s.cod_vendedor
         WHERE coalesce(dc.clase, CASE WHEN p.es_antibiotico THEN 'antibiotico' END) IS NOT NULL
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
