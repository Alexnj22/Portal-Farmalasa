SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Dos cosas que van juntas porque se explican juntas.
--
-- 1) El cierre de mes MIRA el libro. Hasta hoy `cerrar_mes_bitacora` no
--    nombraba `bitacora_dispensaciones` ni una vez, mientras
--    `completar_dispensacion` sí rechaza escribir en un mes cerrado. Las dos
--    mitades juntas hacen que la única puerta capaz de exigir el libro completo
--    sea justamente la que lo sella incompleto: La Popular cerró agosto el
--    3-sep a las 16:23 con 39 renglones pendientes que ya no se podían
--    completar sin reabrir el mes.
--
--    El freno NO es un bloqueo duro. Un candado sin salida produce el atajo:
--    si la receta nunca va a llegar, la sala necesita poder cerrar. Entonces se
--    exige lo único que sirve — que quede ESCRITO por qué se cierra así, y
--    cuántos eran. El número queda sellado dentro del resumen del cierre, que
--    es la fila que después nadie reescribe.
--
-- 2) El libro devuelve su CLASE, para que la pantalla y el papel puedan
--    separar los dos libros.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Cuántos renglones del mes esperan su receta ───────────────────────────
-- Vive en la base y no en la vista: lo consultan el cierre y la pantalla, y dos
-- cuentas separadas terminan dando números distintos de lo mismo.
CREATE OR REPLACE FUNCTION public.bitacora_libro_pendientes(
    p_branch_id bigint, p_periodo text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
    SELECT count(*)::integer
      FROM public.bitacora_dispensaciones d
     WHERE d.branch_id = p_branch_id
       AND to_char(d.fecha, 'YYYY-MM') = p_periodo
       AND d.estado = 'pendiente';
$$;

REVOKE EXECUTE ON FUNCTION public.bitacora_libro_pendientes(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bitacora_libro_pendientes(bigint, text) TO authenticated, service_role;

-- ── El cierre ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cerrar_mes_bitacora(
    p_branch_id bigint, p_periodo text, p_observaciones text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_resumen json;
    v_pend    integer;
    v_id      bigint;
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras_cerrar_mes', 'can_edit') THEN
        RAISE EXCEPTION 'El cierre del mes lo autoriza el regente.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    IF public.bitacora_periodo_cerrado(p_branch_id, p_periodo) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado.' USING ERRCODE = 'P0001';
    END IF;

    IF p_periodo >= to_char(public.bitacora_hoy_sv(), 'YYYY-MM') THEN
        RAISE EXCEPTION 'Ese mes todavia no termina.' USING ERRCODE = 'P0001';
    END IF;

    v_pend := public.bitacora_libro_pendientes(p_branch_id, p_periodo);

    -- Cerrar sella el mes: despues de esto el libro ya no se puede completar
    -- sin reabrirlo. Si quedan renglones esperando su receta, hay que decir por
    -- que se cierra igual — y que quede escrito, no marcado.
    IF v_pend > 0 AND length(coalesce(btrim(p_observaciones), '')) < 15 THEN
        RAISE EXCEPTION
            'En el libro quedan % renglones esperando la receta, y cerrar el mes impide completarlos. Completalos, o escribi aca por que se cierra asi.',
            v_pend
            USING ERRCODE = 'P0001';
    END IF;

    v_resumen := (
        public.get_bitacora_resumen_mes(p_branch_id, p_periodo)::jsonb
        || jsonb_build_object('libro', jsonb_build_object(
               'renglones', (SELECT count(*) FROM public.bitacora_dispensaciones d
                              WHERE d.branch_id = p_branch_id
                                AND to_char(d.fecha, 'YYYY-MM') = p_periodo),
               'completos',  (SELECT count(*) FROM public.bitacora_dispensaciones d
                              WHERE d.branch_id = p_branch_id
                                AND to_char(d.fecha, 'YYYY-MM') = p_periodo
                                AND d.estado = 'completa'),
               'anulados',   (SELECT count(*) FROM public.bitacora_dispensaciones d
                              WHERE d.branch_id = p_branch_id
                                AND to_char(d.fecha, 'YYYY-MM') = p_periodo
                                AND d.estado = 'anulada'),
               'pendientes', v_pend))
    )::json;

    INSERT INTO public.bitacora_cierres (branch_id, periodo, accion, resumen, motivo, actor_id)
    VALUES (p_branch_id, p_periodo, 'cerrar', v_resumen,
            nullif(btrim(p_observaciones), ''), public.auth_employee_id())
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.cerrar_mes_bitacora(bigint, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cerrar_mes_bitacora(bigint, text, text) TO authenticated, service_role;

-- ── El libro, con su clase y filtrable por libro ──────────────────────────
DROP FUNCTION IF EXISTS public.get_bitacora_dispensaciones(bigint, date, date, text);

CREATE FUNCTION public.get_bitacora_dispensaciones(
    p_branch_id bigint, p_desde date, p_hasta date,
    p_estado text DEFAULT NULL, p_clase text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE v_out json;
BEGIN
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    SELECT coalesce(json_agg(x ORDER BY (x->>'folio')::int DESC), '[]'::json) INTO v_out
    FROM (
        SELECT json_build_object(
            'id', d.id, 'folio', d.folio, 'folio_txt', d.folio_txt, 'anio', d.anio,
            'branch_id', d.branch_id, 'clase', d.clase,
            'fecha', d.fecha, 'hora', d.hora, 'estado', d.estado,
            'motivo_anulacion', d.motivo_anulacion,
            'producto_nombre', d.producto_nombre, 'laboratorio', d.laboratorio,
            'erp_product_id', d.erp_product_id,
            'cantidad', d.cantidad, 'lote', d.lote, 'vence', d.fecha_vencimiento,
            'cliente', d.cliente_texto, 'vendedor', d.vendedor_nombre,
            'clase_cliente', public.clase_de_cliente(d.cliente_texto, d.customer_id),
            'correlativo_doc', d.correlativo_doc, 'codigo_generacion', d.codigo_generacion,
            'tiene_pdf', sd.pdf_path IS NOT NULL,
            'paciente', r.paciente_nombre,
            'medico', m.nombre, 'numero_junta', m.numero_junta,
            'receta_correlativo', CASE WHEN r.id IS NULL THEN NULL
                                       ELSE r.anio::text || '-' || lpad(r.correlativo::text, 5, '0') END,
            'receta_estado', r.estado,
            'tiene_foto', r.foto_url IS NOT NULL,
            'prescrito', ri.cantidad_prescrita,
            'entregado_total', (SELECT coalesce(sum(d2.cantidad), 0)
                                  FROM public.bitacora_dispensaciones d2
                                 WHERE d2.receta_item_id = ri.id AND d2.estado <> 'anulada')
        ) AS x
        FROM public.bitacora_dispensaciones d
        LEFT JOIN public.sales_dte_documents sd ON sd.codigo_generacion = d.codigo_generacion
        LEFT JOIN public.receta_items ri ON ri.id = d.receta_item_id
        LEFT JOIN public.recetas r ON r.id = ri.receta_id
        LEFT JOIN public.medicos m ON m.id = r.medico_id
        WHERE d.branch_id = p_branch_id
          AND d.fecha BETWEEN p_desde AND p_hasta
          AND (p_estado IS NULL OR d.estado = p_estado)
          AND (p_clase  IS NULL OR d.clase  = p_clase)
    ) t;

    RETURN v_out;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_bitacora_dispensaciones(bigint, date, date, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_bitacora_dispensaciones(bigint, date, date, text, text) TO authenticated, service_role;

-- ── Buscar un folio: hay que decir de qué libro ───────────────────────────
-- Con dos libros, «2026-00007» solo no alcanza: el mismo número existe en los
-- dos. Por defecto busca en el de antibióticos, que es el que trae escrito un
-- inspector.
DROP FUNCTION IF EXISTS public.get_dispensacion_por_folio(bigint, smallint, integer);

CREATE FUNCTION public.get_dispensacion_por_folio(
    p_branch_id bigint, p_anio smallint, p_folio integer,
    p_clase text DEFAULT 'antibiotico')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE v_out json;
BEGIN
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    SELECT json_build_object(
        'id', d.id,
        'folio', d.folio, 'folio_txt', d.folio_txt, 'anio', d.anio, 'clase', d.clase,
        'branch_id', d.branch_id, 'sucursal', b.name,
        'estado', d.estado, 'fecha', d.fecha, 'hora', d.hora,
        'motivo_anulacion', d.motivo_anulacion,
        'detalle_anulacion', d.detalle_anulacion,
        'anulada_por', emp2.name,
        'anulada_at', d.anulada_at,
        'producto', json_build_object(
            'id', d.erp_product_id, 'nombre', d.producto_nombre,
            'laboratorio', d.laboratorio, 'presentacion', d.presentacion,
            'cantidad', d.cantidad, 'lote', d.lote, 'vence', d.fecha_vencimiento
        ),
        'venta', json_build_object(
            'invoice_id', d.invoice_id,
            'codigo_generacion', d.codigo_generacion,
            'correlativo', d.correlativo_doc,
            'tipo_documento', d.tipo_documento,
            'estado', d.documento_estado,
            'cliente', d.cliente_texto,
            'customer_id', d.customer_id,
            'clase_cliente', public.clase_de_cliente(d.cliente_texto, d.customer_id),
            'cliente_dui', c.dui,
            'cliente_categoria', c.categoria,
            'vendedor', d.vendedor_nombre,
            'cod_vendedor', d.cod_vendedor,
            'pdf_path', sd.pdf_path,
            'total', s.total
        ),
        'receta', CASE WHEN r.id IS NULL THEN NULL ELSE json_build_object(
            'id', r.id,
            'correlativo', r.correlativo,
            'correlativo_txt', r.anio::text || '-' || lpad(r.correlativo::text, 5, '0'),
            'estado', r.estado,
            'fecha_prescripcion', r.fecha_prescripcion,
            'foto_url', r.foto_url,
            'motivo_pendiente', r.motivo_pendiente,
            'paciente', json_build_object(
                'nombre', r.paciente_nombre, 'edad', r.paciente_edad, 'documento', r.paciente_documento
            ),
            'medico', CASE WHEN m.id IS NULL THEN NULL ELSE json_build_object(
                'id', m.id, 'nombre', m.nombre, 'numero_junta', m.numero_junta,
                'junta', m.junta, 'carrera', m.carrera,
                'origen', m.origen, 'verificado_at', m.verificado_at
            ) END,
            'prescrito', json_build_object(
                'descripcion', ri.descripcion,
                'cantidad_prescrita', ri.cantidad_prescrita,
                'forma_farmaceutica', ri.forma_farmaceutica
            ),
            'entregado', (SELECT coalesce(sum(d2.cantidad), 0)
                            FROM public.bitacora_dispensaciones d2
                           WHERE d2.receta_item_id = ri.id AND d2.estado <> 'anulada'),
            'pendiente', ri.cantidad_prescrita - (SELECT coalesce(sum(d2.cantidad), 0)
                            FROM public.bitacora_dispensaciones d2
                           WHERE d2.receta_item_id = ri.id AND d2.estado <> 'anulada'),
            'entregas', (SELECT coalesce(json_agg(json_build_object(
                              'folio_txt', d3.folio_txt, 'fecha', d3.fecha,
                              'cantidad', d3.cantidad, 'lote', d3.lote,
                              'estado', d3.estado, 'motivo_anulacion', d3.motivo_anulacion
                          ) ORDER BY d3.fecha, d3.folio), '[]'::json)
                          FROM public.bitacora_dispensaciones d3
                         WHERE d3.receta_item_id = ri.id)
        ) END,
        'completada_por', emp.name,
        'completada_at', d.completada_at,
        'notas', d.notas,
        'created_at', d.created_at
    ) INTO v_out
    FROM public.bitacora_dispensaciones d
    JOIN public.branches b ON b.id = d.branch_id
    LEFT JOIN public.sales_invoices s ON s.id = d.invoice_id
    LEFT JOIN public.customers c ON c.id = d.customer_id
    LEFT JOIN public.sales_dte_documents sd ON sd.codigo_generacion = d.codigo_generacion
    LEFT JOIN public.receta_items ri ON ri.id = d.receta_item_id
    LEFT JOIN public.recetas r ON r.id = ri.receta_id
    LEFT JOIN public.medicos m ON m.id = r.medico_id
    LEFT JOIN public.employees emp ON emp.id = d.completada_por
    LEFT JOIN public.employees emp2 ON emp2.id = d.anulada_por
    WHERE d.branch_id = p_branch_id AND d.anio = p_anio AND d.folio = p_folio
      AND d.clase = coalesce(p_clase, 'antibiotico');

    RETURN v_out;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_dispensacion_por_folio(bigint, smallint, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dispensacion_por_folio(bigint, smallint, integer, text) TO authenticated, service_role;

-- ── El mes impreso lleva la clase de cada renglón ─────────────────────────
-- Parche quirúrgico y con guarda: `get_bitacora_mes_impreso` son ~5 KB de JSON
-- anidado y lo único que cambia es una clave. Reescribir el cuerpo entero a
-- mano para agregar un campo es donde se cuelan las erratas. Si el ancla no
-- está —porque alguien ya la tocó— la migración FALLA en vez de dejar el papel
-- sin la clase, que es el modo de falla silencioso.
DO $mig$
DECLARE v_def text;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_bitacora_mes_impreso';

    IF position('''folio'', d.folio_txt, ''fecha'', d.fecha,' IN v_def) = 0 THEN
        RAISE EXCEPTION 'get_bitacora_mes_impreso ya no tiene el ancla esperada: hay que agregar «clase» a mano.';
    END IF;

    v_def := replace(v_def,
        '''folio'', d.folio_txt, ''fecha'', d.fecha,',
        '''folio'', d.folio_txt, ''clase'', d.clase, ''fecha'', d.fecha,');
    EXECUTE v_def;
END $mig$;
