SET lock_timeout = '5s';

-- ── El estado de la receta es de TODA la receta ────────────────────────────
--
-- Estaba mal: al completar un renglon se miraba SOLO ese medicamento y con eso
-- se decidia el estado de la receta entera. Una receta con dos medicamentos
-- —que es lo normal— quedaba «cerrada» apenas se entregaba el primero.
--
-- Dos consecuencias, y las dos silenciosas:
--   · el libro decia que esa receta estaba completa con la mitad sin entregar;
--   · y como el selector solo ofrece recetas abiertas, el SEGUNDO medicamento
--     ya no se le podia anexar: obligaba a crear otra receta, y entonces el
--     correlativo dejaba de corresponder a un papel.

CREATE OR REPLACE FUNCTION public.recalcular_estado_receta(p_receta_id bigint)
RETURNS text LANGUAGE plpgsql
SET search_path = public, extensions AS $fn$
DECLARE v_pendientes integer; v_estado text;
BEGIN
    SELECT count(*) INTO v_pendientes
      FROM public.receta_items ri
     WHERE ri.receta_id = p_receta_id
       AND ri.cantidad_prescrita > (
            SELECT coalesce(sum(d.cantidad), 0)
              FROM public.bitacora_dispensaciones d
             WHERE d.receta_item_id = ri.id AND d.estado <> 'anulada');

    v_estado := CASE WHEN v_pendientes = 0 THEN 'cerrada' ELSE 'abierta' END;

    UPDATE public.recetas
       SET estado = v_estado
     WHERE id = p_receta_id AND estado <> 'anulada';

    RETURN v_estado;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.completar_dispensacion(
    p_dispensacion_id   bigint,
    p_paciente_nombre   text,
    p_medico_id         bigint,
    p_cantidad_prescrita numeric,
    p_fecha_prescripcion date DEFAULT NULL,
    p_paciente_edad     smallint DEFAULT NULL,
    p_paciente_documento text DEFAULT NULL,
    p_foto_url          text DEFAULT NULL,
    p_receta_id         bigint DEFAULT NULL,
    p_motivo_pendiente  text DEFAULT NULL,
    p_notas             text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_d        public.bitacora_dispensaciones%ROWTYPE;
    v_receta   public.recetas%ROWTYPE;
    v_item_id  bigint;
    v_corr     integer;
    v_anio     smallint;
    v_previo   numeric := 0;
    v_entregado numeric;
    v_prescrito numeric;
    v_estado   text;
BEGIN
    SELECT * INTO v_d FROM public.bitacora_dispensaciones WHERE id = p_dispensacion_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese renglon no existe.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.bitacora_exigir_acceso(v_d.branch_id, 'can_edit');

    IF v_d.estado = 'anulada' THEN
        RAISE EXCEPTION 'Ese renglon esta anulado: la venta se invalido ante Hacienda.' USING ERRCODE = 'P0001';
    END IF;
    IF public.bitacora_periodo_cerrado(v_d.branch_id, to_char(v_d.fecha, 'YYYY-MM')) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado. Hay que reabrirlo para poder completarlo.' USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(btrim(p_paciente_nombre), '') = '' THEN
        RAISE EXCEPTION 'Falta el nombre del paciente.' USING ERRCODE = 'P0001';
    END IF;
    IF p_medico_id IS NULL THEN
        RAISE EXCEPTION 'Falta el medico.' USING ERRCODE = 'P0001';
    END IF;
    IF p_cantidad_prescrita IS NULL OR p_cantidad_prescrita <= 0 THEN
        RAISE EXCEPTION 'Falta cuanto receto el medico.' USING ERRCODE = 'P0001';
    END IF;

    v_anio := extract(year FROM v_d.fecha)::smallint;

    IF p_receta_id IS NOT NULL THEN
        SELECT * INTO v_receta FROM public.recetas WHERE id = p_receta_id;
        IF NOT FOUND OR v_receta.branch_id <> v_d.branch_id THEN
            RAISE EXCEPTION 'Esa receta no es de esta sucursal.' USING ERRCODE = 'P0002';
        END IF;
        IF v_receta.estado = 'anulada' THEN
            RAISE EXCEPTION 'Esa receta esta anulada.' USING ERRCODE = 'P0001';
        END IF;

        SELECT coalesce(sum(d.cantidad), 0), max(ri.cantidad_prescrita)
          INTO v_previo, v_prescrito
          FROM public.receta_items ri
          LEFT JOIN public.bitacora_dispensaciones d
                 ON d.receta_item_id = ri.id AND d.estado <> 'anulada' AND d.id <> p_dispensacion_id
         WHERE ri.receta_id = v_receta.id
           AND ri.erp_product_id IS NOT DISTINCT FROM v_d.erp_product_id;
    END IF;

    v_prescrito := coalesce(v_prescrito, p_cantidad_prescrita);

    IF v_previo + v_d.cantidad > v_prescrito THEN
        RAISE EXCEPTION
            'No se puede entregar mas de lo recetado: la receta es de %, ya lleva % entregado y este renglon suma %.',
            v_prescrito, v_previo, v_d.cantidad
            USING ERRCODE = 'P0001';
    END IF;

    IF p_receta_id IS NULL THEN
        v_corr := public.bitacora_tomar_folio(v_d.branch_id, v_anio, 'receta');

        INSERT INTO public.recetas (
            branch_id, anio, correlativo, paciente_nombre, paciente_edad, paciente_documento,
            medico_id, fecha_prescripcion, foto_url, motivo_pendiente, notas, creada_por
        ) VALUES (
            v_d.branch_id, v_anio, v_corr, btrim(p_paciente_nombre), p_paciente_edad,
            nullif(btrim(p_paciente_documento), ''), p_medico_id,
            coalesce(p_fecha_prescripcion, v_d.fecha), nullif(btrim(p_foto_url), ''),
            p_motivo_pendiente, nullif(btrim(p_notas), ''), public.auth_employee_id()
        )
        RETURNING * INTO v_receta;
    END IF;

    SELECT id INTO v_item_id FROM public.receta_items
     WHERE receta_id = v_receta.id AND erp_product_id IS NOT DISTINCT FROM v_d.erp_product_id
     LIMIT 1;

    IF v_item_id IS NULL THEN
        INSERT INTO public.receta_items (receta_id, erp_product_id, descripcion, cantidad_prescrita)
        VALUES (v_receta.id, v_d.erp_product_id, v_d.producto_nombre, p_cantidad_prescrita)
        RETURNING id INTO v_item_id;
    END IF;

    UPDATE public.bitacora_dispensaciones
       SET receta_item_id = v_item_id,
           estado = 'completa',
           completada_por = public.auth_employee_id(),
           completada_at = now(),
           notas = coalesce(nullif(btrim(p_notas), ''), notas)
     WHERE id = p_dispensacion_id;

    UPDATE public.recetas
       SET foto_url = coalesce(nullif(btrim(p_foto_url), ''), foto_url)
     WHERE id = v_receta.id;

    v_estado := public.recalcular_estado_receta(v_receta.id);

    SELECT coalesce(sum(d.cantidad), 0) INTO v_entregado
      FROM public.bitacora_dispensaciones d
     WHERE d.receta_item_id = v_item_id AND d.estado <> 'anulada';
    SELECT cantidad_prescrita INTO v_prescrito FROM public.receta_items WHERE id = v_item_id;

    RETURN json_build_object(
        'receta_id', v_receta.id,
        'correlativo_txt', v_receta.anio::text || '-' || lpad(v_receta.correlativo::text, 5, '0'),
        'entregado', v_entregado,
        'prescrito', v_prescrito,
        'pendiente', v_prescrito - v_entregado,
        'receta_estado', v_estado
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_recetas_recientes(p_branch_id bigint, p_dias integer DEFAULT 30)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE v_out json;
BEGIN
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');
    SELECT coalesce(json_agg(x ORDER BY x->>'creada' DESC), '[]'::json) INTO v_out FROM (
        SELECT json_build_object(
            'id', r.id,
            'correlativo_txt', r.anio::text || '-' || lpad(r.correlativo::text, 5, '0'),
            'paciente', r.paciente_nombre,
            'paciente_edad', r.paciente_edad,
            'paciente_documento', r.paciente_documento,
            'medico', m.nombre,
            'medico_id', r.medico_id,
            'medico_numero', m.numero_junta,
            'medico_junta', m.junta,
            'fecha', r.fecha_prescripcion,
            'creada', r.created_at,
            'estado', r.estado,
            'tiene_foto', r.foto_url IS NOT NULL,
            'items', (SELECT coalesce(json_agg(json_build_object(
                          'id', ri.id, 'descripcion', ri.descripcion,
                          'erp_product_id', ri.erp_product_id,
                          'prescrito', ri.cantidad_prescrita,
                          'entregado', (SELECT coalesce(sum(d.cantidad), 0)
                                          FROM public.bitacora_dispensaciones d
                                         WHERE d.receta_item_id = ri.id AND d.estado <> 'anulada')
                      )), '[]'::json)
                      FROM public.receta_items ri WHERE ri.receta_id = r.id)
        ) AS x
        FROM public.recetas r
        LEFT JOIN public.medicos m ON m.id = r.medico_id
        WHERE r.branch_id = p_branch_id
          AND r.estado <> 'anulada'
          AND r.created_at >= now() - make_interval(days => p_dias)
    ) t;
    RETURN v_out;
END;
$fn$;

DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT id FROM public.recetas WHERE estado <> 'anulada' LOOP
        PERFORM public.recalcular_estado_receta(r.id);
    END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.recalcular_estado_receta(bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_recetas_recientes(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalcular_estado_receta(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_recetas_recientes(bigint, integer) TO authenticated, service_role;
