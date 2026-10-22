SET lock_timeout = '5s';

-- Auditoría 2026-10-21 · grupo 6 · H2. El estado de una receta se decide por la
-- receta ENTERA, no por un renglón.
--
-- sincronizar_bitacora_dispensaciones: el último UPDATE juntaba recetas con
-- receta_items, una fila POR RENGLÓN; en un UPDATE … FROM con varias filas que
-- casan, Postgres aplica una cualquiera, y una receta con un renglón completo y
-- otro pendiente podía quedar 'cerrada'. Ahora se agrega por receta con la regla
-- de recalcular_estado_receta, set-based y con IS DISTINCT FROM para no
-- reescribir cada minuto lo que no cambió.
--
-- anular_dispensacion: miraba SÓLO el renglón anulado. Ahora llama al juez único,
-- recalcular_estado_receta. Probado en pruebas: receta con amoxicilina 2/2 y
-- azitromicina 0/1 queda 'abierta' en las dos rutas. 0 recetas en producción.
CREATE OR REPLACE FUNCTION public.sincronizar_bitacora_dispensaciones(p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

    -- H2: UNA fila por receta. 'cerrada' sólo si no queda ningún renglón
    -- pendiente (la regla de recalcular_estado_receta).
    UPDATE public.recetas r
       SET estado = calc.estado
      FROM (
          SELECT ri.receta_id,
                 CASE WHEN bool_or(ri.cantidad_prescrita > ent.entregado) THEN 'abierta' ELSE 'cerrada' END AS estado
            FROM public.receta_items ri
            JOIN LATERAL (
                SELECT coalesce(sum(d2.cantidad), 0) AS entregado
                  FROM public.bitacora_dispensaciones d2
                 WHERE d2.receta_item_id = ri.id AND d2.estado <> 'anulada'
            ) ent ON true
           GROUP BY ri.receta_id
      ) calc
     WHERE r.id = calc.receta_id
       AND r.estado <> 'anulada'
       AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
       AND r.estado IS DISTINCT FROM calc.estado;

    RETURN json_build_object('nuevos', v_nuevos, 'anulados', v_anulados);
END;
$function$;

CREATE OR REPLACE FUNCTION public.anular_dispensacion(p_dispensacion_id bigint, p_motivo text, p_detalle text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_d       public.bitacora_dispensaciones%ROWTYPE;
    v_entregado numeric;
    v_prescrito numeric;
    v_receta_id bigint;
    v_estado_receta text;
BEGIN
    SELECT * INTO v_d FROM public.bitacora_dispensaciones WHERE id = p_dispensacion_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese renglon no existe.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.bitacora_exigir_acceso(v_d.branch_id, 'can_edit');

    IF v_d.estado = 'anulada' THEN
        RAISE EXCEPTION 'Ese renglon ya esta anulado.' USING ERRCODE = 'P0001';
    END IF;
    IF public.bitacora_periodo_cerrado(v_d.branch_id, to_char(v_d.fecha, 'YYYY-MM')) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado. Hay que reabrirlo para poder anular.' USING ERRCODE = 'P0001';
    END IF;
    IF p_motivo IS NULL OR p_motivo NOT IN ('devolucion', 'error_de_carga', 'otro') THEN
        RAISE EXCEPTION 'Hay que decir por que se anula: devolucion, error de carga u otro.' USING ERRCODE = 'P0001';
    END IF;
    IF p_motivo = 'otro' AND coalesce(btrim(p_detalle), '') = '' THEN
        RAISE EXCEPTION 'Si el motivo es «otro», hay que escribir cual.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.bitacora_dispensaciones
       SET estado = 'anulada',
           motivo_anulacion = p_motivo,
           detalle_anulacion = nullif(btrim(p_detalle), ''),
           anulada_por = public.auth_employee_id(),
           anulada_at = now()
     WHERE id = p_dispensacion_id;

    IF v_d.receta_item_id IS NOT NULL THEN
        SELECT coalesce(sum(d.cantidad), 0) INTO v_entregado
          FROM public.bitacora_dispensaciones d
         WHERE d.receta_item_id = v_d.receta_item_id AND d.estado <> 'anulada';
        SELECT cantidad_prescrita, receta_id INTO v_prescrito, v_receta_id
          FROM public.receta_items WHERE id = v_d.receta_item_id;

        -- H2: el estado es de la RECETA entera, no del renglón anulado.
        IF v_receta_id IS NOT NULL THEN
            v_estado_receta := public.recalcular_estado_receta(v_receta_id);
        END IF;
    END IF;

    RETURN json_build_object(
        'anulada', true,
        'entregado', coalesce(v_entregado, 0),
        'prescrito', v_prescrito,
        'receta_reabierta', v_estado_receta = 'abierta'
    );
END;
$function$;
