SET lock_timeout = '5s';

ALTER TABLE public.bitacora_dispensaciones
    ADD COLUMN motivo_anulacion text
        CHECK (motivo_anulacion IS NULL OR motivo_anulacion IN
               ('devolucion', 'error_de_carga', 'dte_invalidado', 'otro')),
    ADD COLUMN detalle_anulacion text,
    ADD COLUMN anulada_por uuid REFERENCES public.employees(id) ON DELETE RESTRICT,
    ADD COLUMN anulada_at timestamptz;

CREATE INDEX bitacora_disp_anulada_por_idx ON public.bitacora_dispensaciones (anulada_por);
CREATE INDEX bitacora_disp_devoluciones_idx ON public.bitacora_dispensaciones (branch_id, fecha DESC)
    WHERE motivo_anulacion = 'devolucion';

UPDATE public.bitacora_dispensaciones
   SET motivo_anulacion = 'dte_invalidado'
 WHERE estado = 'anulada' AND motivo_anulacion IS NULL;

ALTER TABLE public.bitacora_dispensaciones
    ADD CONSTRAINT bitacora_disp_anulada_con_motivo
    CHECK (estado <> 'anulada' OR motivo_anulacion IS NOT NULL);

ALTER TABLE public.recetas
    ADD COLUMN motivo_anulacion text,
    ADD COLUMN anulada_por uuid REFERENCES public.employees(id) ON DELETE RESTRICT,
    ADD COLUMN anulada_at timestamptz;

CREATE INDEX recetas_anulada_por_idx ON public.recetas (anulada_por);

ALTER TABLE public.recetas
    ADD CONSTRAINT recetas_anulada_con_motivo
    CHECK (estado <> 'anulada' OR coalesce(btrim(motivo_anulacion), '') <> '');

CREATE OR REPLACE FUNCTION public.anular_dispensacion(
    p_dispensacion_id bigint,
    p_motivo          text,
    p_detalle         text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_d       public.bitacora_dispensaciones%ROWTYPE;
    v_entregado numeric;
    v_prescrito numeric;
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
        SELECT cantidad_prescrita INTO v_prescrito
          FROM public.receta_items WHERE id = v_d.receta_item_id;

        UPDATE public.recetas r
           SET estado = CASE WHEN v_entregado >= v_prescrito THEN 'cerrada' ELSE 'abierta' END
          FROM public.receta_items ri
         WHERE ri.id = v_d.receta_item_id AND r.id = ri.receta_id AND r.estado <> 'anulada';
    END IF;

    RETURN json_build_object(
        'anulada', true,
        'entregado', coalesce(v_entregado, 0),
        'prescrito', v_prescrito,
        'receta_reabierta', v_prescrito IS NOT NULL AND coalesce(v_entregado, 0) < v_prescrito
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.anular_receta(
    p_receta_id bigint,
    p_motivo    text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_r public.recetas%ROWTYPE;
    v_n integer;
BEGIN
    SELECT * INTO v_r FROM public.recetas WHERE id = p_receta_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esa receta no existe.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.bitacora_exigir_acceso(v_r.branch_id, 'can_edit');

    IF coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'Anular una receta exige decir por que.' USING ERRCODE = 'P0001';
    END IF;
    IF v_r.estado = 'anulada' THEN
        RAISE EXCEPTION 'Esa receta ya esta anulada.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.bitacora_dispensaciones d
       SET estado = 'anulada',
           motivo_anulacion = 'error_de_carga',
           detalle_anulacion = 'Se anulo la receta ' || v_r.anio || '-' || lpad(v_r.correlativo::text, 5, '0') || ': ' || btrim(p_motivo),
           anulada_por = public.auth_employee_id(),
           anulada_at = now()
      FROM public.receta_items ri
     WHERE ri.receta_id = p_receta_id AND d.receta_item_id = ri.id AND d.estado <> 'anulada';
    GET DIAGNOSTICS v_n = ROW_COUNT;

    UPDATE public.recetas
       SET estado = 'anulada', motivo_anulacion = btrim(p_motivo),
           anulada_por = public.auth_employee_id(), anulada_at = now()
     WHERE id = p_receta_id;

    RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.sincronizar_bitacora_dispensaciones(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_r     record;
    v_folio integer;
    v_anio  smallint;
    v_anulada boolean;
    v_n     integer := 0;
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
        v_n := v_n + 1;
    END LOOP;

    RETURN v_n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.anular_dispensacion(bigint, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.anular_receta(bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sincronizar_bitacora_dispensaciones(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_dispensacion(bigint, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.anular_receta(bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sincronizar_bitacora_dispensaciones(date, date, bigint) TO service_role;
