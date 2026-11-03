-- Lotes por revisar en el libro bajo receta (PENDIENTES 22, 2026-11-03).
--
-- El renglón del libro nace de la venta con el lote que trae la factura, y a
-- veces ese lote no sirve para rastrear nada:
--   · FUNDIDO: dos lotes en un campo (`2603216_2603525`) con un solo
--     vencimiento. No nace en la caja: el inventario YA lo tiene así (medido
--     el 3-nov en Salud 1 y Salud 3), o sea que se fundió al cargar la compra.
--   · GENERICO: lote de relleno con una fecha que no significa nada.
--   · SIN LOTE.
--   · VENCIDO AL VENDER: el vencimiento es anterior a la fecha de la venta
--     (RTS 6.6.6). Puede ser el dato o puede ser de verdad.
-- Decisión del usuario: corrige el ENCARGADO DE LA SALA (Jefe/a y Subjefe/a)
-- leyendo la caja física, el REGENTE confirma. Sólo desde el 1-nov-2026: lo de
-- agosto a octubre era práctica y no vale.
--
-- Lo escrito no se pisa: el renglón conserva su lote original y la corrección
-- vive al lado, con quién y cuándo, y cada paso queda en `historial`.
SET lock_timeout = '5s';

CREATE TABLE public.libro_lote_revisiones (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dispensacion_id  bigint NOT NULL UNIQUE REFERENCES public.bitacora_dispensaciones(id),
    branch_id        bigint NOT NULL REFERENCES public.branches(id),
    motivo           text   NOT NULL CHECK (motivo IN ('sin_lote', 'generico', 'fundido', 'vencido')),
    lote_original    text,
    vence_original   date,
    estado           text   NOT NULL DEFAULT 'pendiente'
                            CHECK (estado IN ('pendiente', 'corregida', 'confirmada', 'devuelta')),
    -- [{lote, vence, cantidad}]: una venta que sacó de dos lotes se reparte.
    partes           jsonb,
    vendido_vencido  boolean NOT NULL DEFAULT false,
    nota             text,
    corregida_por    uuid REFERENCES public.employees(id),
    corregida_at     timestamptz,
    confirmada_por   uuid REFERENCES public.employees(id),
    confirmada_at    timestamptz,
    devuelta_motivo  text,
    escalada_at      timestamptz,
    historial        jsonb  NOT NULL DEFAULT '[]'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX libro_lote_revisiones_branch_estado_idx ON public.libro_lote_revisiones (branch_id, estado);

ALTER TABLE public.libro_lote_revisiones ENABLE ROW LEVEL SECURITY;
-- La misma lectura que el libro. Las escrituras van SÓLO por las funciones.
CREATE POLICY libro_lote_rev_select ON public.libro_lote_revisiones
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('bitacoras', 'can_view'))
           AND ((SELECT public.auth_module_scope('bitacoras')) = 'ALL'
                OR branch_id = (SELECT public.auth_employee_branch_id())));
REVOKE ALL ON public.libro_lote_revisiones FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.libro_lote_revisiones FROM authenticated;

-- ── El juez: qué tiene de malo un lote. UNO solo, para la base y la pantalla.
-- `-` también funde cuando junta dos números largos: el inventario tiene
-- `2603216-2603525` al lado de `2603216_2603525`. Un guion entre letras
-- (`A-123`) es un lote legítimo y no cuenta. Medido el 3-nov sobre los 3,034
-- lotes del inventario: marca 34, y los 34 son dos lotes pegados.
CREATE OR REPLACE FUNCTION public.libro_lote_motivo(p_lote text, p_vence date, p_fecha date)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
    SELECT CASE
        WHEN coalesce(btrim(p_lote), '') = '' THEN 'sin_lote'
        WHEN upper(btrim(p_lote)) = 'GENERICO' THEN 'generico'
        WHEN p_lote LIKE '%\_%' OR p_lote ~ '\d{5,}\s*[-/, ]\s*\d{5,}' THEN 'fundido'
        WHEN p_vence IS NOT NULL AND p_vence < p_fecha THEN 'vencido'
    END;
$$;

-- A quién le toca: el encargado de la sala, y el regente. Sin regente nombrado
-- (el 3-nov no hay ninguna ficha activa con ese cargo) el aviso va al
-- Administrador, para que no se pierda en una bandeja que nadie abre.
CREATE OR REPLACE FUNCTION public.libro_lote_encargados(p_branch_id bigint)
RETURNS uuid[]
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    SELECT array_agg(DISTINCT e.id)
      FROM public.employees e
      JOIN public.roles r ON r.id IN (e.role_id, e.secondary_role_id)
     WHERE e.status = 'ACTIVO' AND e.branch_id = p_branch_id
       AND r.name IN ('Jefe/a de Sala', 'Subjefe/a de Sala');
$$;

CREATE OR REPLACE FUNCTION public.libro_lote_regentes()
RETURNS uuid[]
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    SELECT coalesce(
        (SELECT array_agg(DISTINCT e.id) FROM public.employees e
           JOIN public.roles r ON r.id IN (e.role_id, e.secondary_role_id)
          WHERE e.status = 'ACTIVO' AND r.name = 'Regente'),
        (SELECT array_agg(DISTINCT e.id) FROM public.employees e
           JOIN public.roles r ON r.id IN (e.role_id, e.secondary_role_id)
          WHERE e.status = 'ACTIVO' AND r.name = 'Administrador'));
$$;

-- ── Detectar un renglón. La llama el trigger; también sirve para el repaso.
CREATE OR REPLACE FUNCTION public.libro_lote_detectar_uno(p_dispensacion_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    d record;
    v_motivo text;
    v_id bigint;
    v_dest uuid[];
BEGIN
    SELECT x.id, x.branch_id, x.fecha, x.lote, x.fecha_vencimiento, x.estado,
           x.producto_nombre, x.folio_txt, b.name AS sala
      INTO d
      FROM public.bitacora_dispensaciones x JOIN public.branches b ON b.id = x.branch_id
     WHERE x.id = p_dispensacion_id;
    IF NOT FOUND OR d.fecha < date '2026-11-01' THEN RETURN; END IF;

    v_motivo := CASE WHEN d.estado = 'anulada' THEN NULL
                     ELSE public.libro_lote_motivo(d.lote, d.fecha_vencimiento, d.fecha) END;

    IF v_motivo IS NULL THEN
        -- El renglón se anuló o el lote se arregló en origen: una revisión que
        -- nadie tocó todavía ya no tiene objeto. Una ya trabajada se queda.
        DELETE FROM public.libro_lote_revisiones
         WHERE dispensacion_id = d.id AND estado = 'pendiente';
        RETURN;
    END IF;

    INSERT INTO public.libro_lote_revisiones (dispensacion_id, branch_id, motivo, lote_original, vence_original)
    VALUES (d.id, d.branch_id, v_motivo, d.lote, d.fecha_vencimiento)
    ON CONFLICT (dispensacion_id) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN; END IF;

    v_dest := public.libro_lote_encargados(d.branch_id);
    IF coalesce(array_length(v_dest, 1), 0) > 0 THEN
        PERFORM public.notify_employees(
            v_dest, 'LIBRO_LOTE_POR_REVISAR',
            d.sala || ': un lote del libro por revisar',
            d.folio_txt || ' · ' || d.producto_nombre || ' — ' || CASE v_motivo
                WHEN 'fundido'  THEN 'trae dos lotes en uno.'
                WHEN 'generico' THEN 'trae el lote «GENERICO».'
                WHEN 'sin_lote' THEN 'no trae lote.'
                ELSE 'el lote figura vencido el día de la venta.' END
            || ' Mira la caja y escribe el lote real.',
            '/bitacoras?tab=revision',
            jsonb_build_object('revision_id', v_id, 'branch_id', d.branch_id, 'motivo', v_motivo),
            true, d.branch_id::integer);
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- La detección nunca frena la sincronización del libro: un renglón sin
    -- revisar se recupera en el repaso diario; un libro sin renglón, no.
    RAISE WARNING 'libro_lote_detectar_uno(%): %', p_dispensacion_id, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.libro_lote_detectar_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    PERFORM public.libro_lote_detectar_uno(NEW.id);
    RETURN NULL;
END;
$$;

CREATE TRIGGER libro_lote_detectar
    AFTER INSERT OR UPDATE OF lote, fecha_vencimiento, estado ON public.bitacora_dispensaciones
    FOR EACH ROW EXECUTE FUNCTION public.libro_lote_detectar_trg();

-- ── Permisos: corregir es de la sala, confirmar es firma del regente.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'bitacoras_corregir_lote', true, true, false,
       CASE WHEN r.name IN ('Administrador', 'QA / Testing (CI)') THEN 'ALL' ELSE 'BRANCH' END
  FROM public.roles r
 WHERE r.name IN ('Jefe/a de Sala', 'Subjefe/a de Sala', 'Administrador', 'QA / Testing (CI)')
ON CONFLICT (role_id, module_key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'bitacoras_confirmar_lote', true, true, false, 'ALL'
  FROM public.roles r WHERE r.name IN ('Regente', 'QA / Testing (CI)')
ON CONFLICT (role_id, module_key) DO NOTHING;

-- ── La lista. Con sala, la de esa sala; sin sala (alcance ALL), toda la red.
CREATE OR REPLACE FUNCTION public.get_libro_lotes_por_revisar(p_branch_id bigint DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_out json;
BEGIN
    IF NOT ((SELECT public.auth_has_module_permission('bitacoras_corregir_lote', 'can_view'))
            OR (SELECT public.auth_has_module_permission('bitacoras_confirmar_lote', 'can_view'))) THEN
        RAISE EXCEPTION 'Tu cargo no revisa lotes del libro.' USING ERRCODE = '42501';
    END IF;
    IF p_branch_id IS NULL THEN
        IF public.auth_module_scope('bitacoras') <> 'ALL' THEN
            RAISE EXCEPTION 'Elige tu sala.' USING ERRCODE = '42501';
        END IF;
    ELSE
        PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');
    END IF;

    SELECT coalesce(json_agg(x ORDER BY x.orden, x.fecha DESC, x.id), '[]'::json) INTO v_out
    FROM (
        SELECT r.id, r.dispensacion_id, r.branch_id, b.name AS sala, r.motivo, r.estado,
               r.lote_original, r.vence_original, r.partes, r.vendido_vencido, r.nota,
               r.devuelta_motivo, r.corregida_at, r.confirmada_at, r.created_at,
               r.corregida_por, ec.name AS corregida_por_nombre,
               r.confirmada_por, ef.name AS confirmada_por_nombre,
               d.folio_txt, d.fecha, d.hora, d.producto_nombre, d.laboratorio, d.cantidad,
               d.correlativo_doc, d.vendedor_nombre AS vendedor,
               CASE r.estado WHEN 'devuelta' THEN 0 WHEN 'pendiente' THEN 1
                             WHEN 'corregida' THEN 2 ELSE 3 END AS orden
          FROM public.libro_lote_revisiones r
          JOIN public.bitacora_dispensaciones d ON d.id = r.dispensacion_id
          JOIN public.branches b ON b.id = r.branch_id
          LEFT JOIN public.employees ec ON ec.id = r.corregida_por
          LEFT JOIN public.employees ef ON ef.id = r.confirmada_por
         WHERE (p_branch_id IS NULL OR r.branch_id = p_branch_id)
           AND (r.estado <> 'confirmada' OR r.confirmada_at > now() - interval '60 days')
    ) x;
    RETURN v_out;
END;
$$;

-- ── Corregir (la sala). Desde pendiente o devuelta.
CREATE OR REPLACE FUNCTION public.libro_lote_corregir(
    p_revision_id bigint, p_partes jsonb, p_vendido_vencido boolean DEFAULT false, p_nota text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    r record; d record;
    v_yo uuid := public.auth_employee_id();
    v_partes jsonb := '[]'::jsonb;
    v_p jsonb; v_lote text; v_vence date; v_cant numeric;
    v_suma numeric := 0; v_alguna_vencida boolean := false;
    v_dest uuid[];
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'Sin ficha de empleado.' USING ERRCODE = '42501'; END IF;
    IF NOT (SELECT public.auth_has_module_permission('bitacoras_corregir_lote', 'can_edit')) THEN
        RAISE EXCEPTION 'Corregir un lote del libro es del encargado de la sala.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO r FROM public.libro_lote_revisiones WHERE id = p_revision_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa revisión no existe.' USING ERRCODE = 'P0001'; END IF;
    PERFORM public.bitacora_exigir_acceso(r.branch_id, 'can_edit');
    IF public.auth_module_scope('bitacoras_corregir_lote') <> 'ALL'
       AND r.branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
        RAISE EXCEPTION 'Sólo corriges los lotes de tu sala.' USING ERRCODE = '42501';
    END IF;
    IF r.estado NOT IN ('pendiente', 'devuelta') THEN
        RAISE EXCEPTION 'Ese lote ya se corrigió: lo tiene que confirmar el regente.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO d FROM public.bitacora_dispensaciones WHERE id = r.dispensacion_id;

    IF jsonb_typeof(p_partes) <> 'array' OR jsonb_array_length(p_partes) NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'Escribe entre uno y cinco lotes.' USING ERRCODE = 'P0001';
    END IF;
    FOR v_p IN SELECT * FROM jsonb_array_elements(p_partes) LOOP
        v_lote := upper(btrim(coalesce(v_p->>'lote', '')));
        BEGIN
            v_vence := (v_p->>'vence')::date;
            v_cant  := (v_p->>'cantidad')::numeric;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Revisa la fecha y la cantidad de cada lote.' USING ERRCODE = 'P0001';
        END;
        IF v_lote = '' THEN RAISE EXCEPTION 'Falta el número de un lote.' USING ERRCODE = 'P0001'; END IF;
        IF public.libro_lote_motivo(v_lote, NULL, d.fecha) IS NOT NULL THEN
            RAISE EXCEPTION 'El lote % no sirve: escribe UN lote por fila, tal como está en la caja.', v_lote
                USING ERRCODE = 'P0001';
        END IF;
        IF v_vence IS NULL THEN RAISE EXCEPTION 'Falta el vencimiento del lote %.', v_lote USING ERRCODE = 'P0001'; END IF;
        IF v_cant IS NULL OR v_cant <= 0 THEN
            RAISE EXCEPTION 'La cantidad del lote % tiene que ser mayor que cero.', v_lote USING ERRCODE = 'P0001';
        END IF;
        IF v_vence < d.fecha THEN v_alguna_vencida := true; END IF;
        v_suma := v_suma + v_cant;
        v_partes := v_partes || jsonb_build_object('lote', v_lote, 'vence', v_vence, 'cantidad', v_cant);
    END LOOP;

    IF v_suma <> d.cantidad THEN
        RAISE EXCEPTION 'Los lotes suman % y la venta fue de %.', v_suma, d.cantidad USING ERRCODE = 'P0001';
    END IF;
    IF v_alguna_vencida AND NOT coalesce(p_vendido_vencido, false) THEN
        RAISE EXCEPTION 'Un lote ya estaba vencido el día de la venta. Si es así, márcalo como vendido vencido.'
            USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(p_vendido_vencido, false) AND NOT v_alguna_vencida THEN
        RAISE EXCEPTION 'Marcaste «vendido vencido» pero ningún lote vencía antes de la venta.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.libro_lote_revisiones
       SET estado = 'corregida', partes = v_partes,
           vendido_vencido = coalesce(p_vendido_vencido, false),
           nota = nullif(btrim(coalesce(p_nota, '')), ''),
           corregida_por = v_yo, corregida_at = now(), devuelta_motivo = NULL,
           historial = historial || jsonb_build_array(jsonb_build_object(
               'accion', 'corregida', 'por', v_yo, 'at', now(), 'partes', v_partes,
               'vendido_vencido', coalesce(p_vendido_vencido, false)))
     WHERE id = r.id;

    v_dest := public.libro_lote_regentes();
    IF coalesce(array_length(v_dest, 1), 0) > 0 THEN
        PERFORM public.notify_employees(
            v_dest, 'LIBRO_LOTE_POR_CONFIRMAR',
            (SELECT name FROM public.branches WHERE id = r.branch_id) || ': lote del libro por confirmar',
            d.folio_txt || ' · ' || d.producto_nombre
                || CASE WHEN coalesce(p_vendido_vencido, false) THEN ' — la sala dice que SE VENDIÓ VENCIDO.'
                        ELSE ' — la sala escribió el lote real.' END,
            '/bitacoras?tab=revision',
            jsonb_build_object('revision_id', r.id, 'branch_id', r.branch_id, 'vendido_vencido', coalesce(p_vendido_vencido, false)),
            true, r.branch_id::integer);
    END IF;

    RETURN json_build_object('ok', true, 'partes', v_partes);
END;
$$;

-- ── Confirmar o devolver (el regente). Quien corrigió no confirma lo suyo.
CREATE OR REPLACE FUNCTION public.libro_lote_confirmar(
    p_revision_id bigint, p_aceptar boolean, p_motivo text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    r record; d record;
    v_yo uuid := public.auth_employee_id();
    v_dest uuid[];
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'Sin ficha de empleado.' USING ERRCODE = '42501'; END IF;
    IF NOT (SELECT public.auth_has_module_permission('bitacoras_confirmar_lote', 'can_edit')) THEN
        RAISE EXCEPTION 'Confirmar un lote del libro es del regente.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO r FROM public.libro_lote_revisiones WHERE id = p_revision_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa revisión no existe.' USING ERRCODE = 'P0001'; END IF;
    IF r.estado <> 'corregida' THEN
        RAISE EXCEPTION 'Sólo se confirma un lote que la sala ya corrigió.' USING ERRCODE = 'P0001';
    END IF;
    IF r.corregida_por = v_yo THEN
        RAISE EXCEPTION 'Lo corregiste tú: lo tiene que confirmar otra persona.' USING ERRCODE = '42501';
    END IF;
    IF NOT coalesce(p_aceptar, false) AND coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'Para devolverlo, di qué está mal.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.libro_lote_revisiones
       SET estado = CASE WHEN p_aceptar THEN 'confirmada' ELSE 'devuelta' END,
           confirmada_por = CASE WHEN p_aceptar THEN v_yo END,
           confirmada_at  = CASE WHEN p_aceptar THEN now() END,
           devuelta_motivo = CASE WHEN p_aceptar THEN NULL ELSE btrim(p_motivo) END,
           historial = historial || jsonb_build_array(jsonb_build_object(
               'accion', CASE WHEN p_aceptar THEN 'confirmada' ELSE 'devuelta' END,
               'por', v_yo, 'at', now(), 'motivo', nullif(btrim(coalesce(p_motivo, '')), '')))
     WHERE id = r.id;

    IF NOT p_aceptar THEN
        SELECT * INTO d FROM public.bitacora_dispensaciones WHERE id = r.dispensacion_id;
        v_dest := public.libro_lote_encargados(r.branch_id);
        IF coalesce(array_length(v_dest, 1), 0) > 0 THEN
            PERFORM public.notify_employees(
                v_dest, 'LIBRO_LOTE_POR_REVISAR',
                'El regente devolvió un lote del libro',
                d.folio_txt || ' · ' || d.producto_nombre || ' — ' || btrim(p_motivo),
                '/bitacoras?tab=revision',
                jsonb_build_object('revision_id', r.id, 'branch_id', r.branch_id, 'devuelta', true),
                true, r.branch_id::integer);
        END IF;
    END IF;
    RETURN json_build_object('ok', true);
END;
$$;

-- ── Lo que lleva 3 días sin moverse sube al regente, UNA vez por revisión.
CREATE OR REPLACE FUNCTION public.avisar_lotes_del_libro_atrasados()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_dest uuid[] := public.libro_lote_regentes();
    v_ids bigint[];
    v_n integer;
    v_salas text;
BEGIN
    SELECT array_agg(r.id), count(*), string_agg(DISTINCT b.name, ', ')
      INTO v_ids, v_n, v_salas
      FROM public.libro_lote_revisiones r JOIN public.branches b ON b.id = r.branch_id
     WHERE r.estado IN ('pendiente', 'devuelta') AND r.escalada_at IS NULL
       AND coalesce(r.corregida_at, r.created_at) < now() - interval '3 days';
    IF coalesce(v_n, 0) = 0 OR coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;

    PERFORM public.notify_employees(
        v_dest, 'LIBRO_LOTE_ATRASADO',
        v_n || CASE WHEN v_n = 1 THEN ' lote del libro lleva' ELSE ' lotes del libro llevan' END
            || ' más de 3 días sin corregir',
        'Salas: ' || v_salas || '. El encargado de la sala tiene que escribir el lote real.',
        '/bitacoras?tab=revision',
        jsonb_build_object('revisiones', to_jsonb(v_ids)), true, NULL);
    UPDATE public.libro_lote_revisiones SET escalada_at = now() WHERE id = ANY(v_ids);
    RETURN v_n;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisar-lotes-del-libro-0815-sv') THEN
        PERFORM cron.schedule('avisar-lotes-del-libro-0815-sv', '15 14 * * *',
                              'SELECT public.avisar_lotes_del_libro_atrasados()');
    END IF;
END $$;

-- ── El libro muestra la corrección al lado del lote original.
CREATE OR REPLACE FUNCTION public.get_bitacora_dispensaciones(p_branch_id bigint, p_desde date, p_hasta date, p_estado text DEFAULT NULL::text, p_clase text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
            'lote_revision', CASE WHEN lr.id IS NULL THEN NULL ELSE json_build_object(
                'id', lr.id, 'estado', lr.estado, 'motivo', lr.motivo,
                'partes', lr.partes, 'vendido_vencido', lr.vendido_vencido) END,
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
        LEFT JOIN public.libro_lote_revisiones lr ON lr.dispensacion_id = d.id
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
$function$;

REVOKE EXECUTE ON FUNCTION public.libro_lote_detectar_uno(bigint), public.libro_lote_detectar_trg(),
    public.avisar_lotes_del_libro_atrasados(), public.libro_lote_encargados(bigint), public.libro_lote_regentes()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.libro_lote_detectar_uno(bigint), public.avisar_lotes_del_libro_atrasados()
    TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_libro_lotes_por_revisar(bigint), public.libro_lote_corregir(bigint, jsonb, boolean, text),
    public.libro_lote_confirmar(bigint, boolean, text), public.libro_lote_motivo(text, date, date)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_libro_lotes_por_revisar(bigint), public.libro_lote_corregir(bigint, jsonb, boolean, text),
    public.libro_lote_confirmar(bigint, boolean, text), public.libro_lote_motivo(text, date, date)
    TO authenticated, service_role;

-- Los renglones que ya están desde el 1-nov.
SELECT public.libro_lote_detectar_uno(d.id)
  FROM public.bitacora_dispensaciones d WHERE d.fecha >= date '2026-11-01';
