SET lock_timeout = '5s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recetas', 'recetas', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do update
   set public = excluded.public,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists recetas_select on storage.objects;
create policy recetas_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recetas'
    and (select public.auth_has_module_permission('bitacoras', 'can_view'))
  );

drop policy if exists recetas_insert on storage.objects;
create policy recetas_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recetas'
    and (select public.auth_has_module_permission('bitacoras', 'can_edit'))
  );

CREATE OR REPLACE FUNCTION public.clase_de_cliente(p_texto text, p_customer_id bigint)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public, extensions AS $fn$
    SELECT CASE
        WHEN p_customer_id IS NULL THEN 'sin_ficha'
        WHEN upper(extensions.unaccent(btrim(coalesce(p_texto, '')))) IN
             ('CLIENTE FRECUENTE','CLIENTE FRECUENTE NUEVO','CLIENTE CONSUMIDOR FINAL',
              'CONSUMIDOR FINAL','CLIENTE','CLIENTE VARIOS','VARIOS','PUBLICO EN GENERAL',
              'CF','SIN NOMBRE','N/A')
             THEN 'generico'
        WHEN upper(coalesce(p_texto, '')) ~
             '(^|[^A-Z])(S\.?A\.?( DE C\.?V\.?)?|LTDA|SOCIEDAD|DIOCESIS|IGLESIA|FUNDACION|ASOCIACION|COOPERATIVA|HOSPITAL|CLINICA|ALCALDIA|MINISTERIO|COLEGIO|EMPRESA)($|[^A-Z])'
             THEN 'entidad'
        ELSE 'persona'
    END;
$fn$;

COMMENT ON FUNCTION public.clase_de_cliente(text, bigint) IS
    'Si el cliente de la venta sirve como paciente. Medido sobre agosto 2026: 92 personas, 7 entidades, 4 genericos de 103 renglones.';

CREATE OR REPLACE FUNCTION public.buscar_o_crear_medico(
    p_numero_junta text,
    p_nombre       text,
    p_junta        text DEFAULT 'P01',
    p_carrera      text DEFAULT NULL,
    p_origen       text DEFAULT 'manual',
    p_verificado   boolean DEFAULT false
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_id  bigint;
    v_num text := btrim(coalesce(p_numero_junta, ''));
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras', 'can_edit') THEN
        RAISE EXCEPTION 'Tu cargo no puede completar el libro.' USING ERRCODE = '42501';
    END IF;
    IF v_num = '' THEN
        RAISE EXCEPTION 'Falta el numero de junta del medico.' USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(btrim(p_nombre), '') = '' THEN
        RAISE EXCEPTION 'Falta el nombre del medico.' USING ERRCODE = 'P0001';
    END IF;

    SELECT id INTO v_id FROM public.medicos
     WHERE junta = p_junta AND numero_junta = v_num;

    IF v_id IS NOT NULL THEN
        IF p_verificado THEN
            UPDATE public.medicos
               SET verificado_at = now(), origen = 'cssp',
                   carrera = coalesce(carrera, p_carrera)
             WHERE id = v_id;
        END IF;
        RETURN v_id;
    END IF;

    INSERT INTO public.medicos (numero_junta, junta, nombre, carrera, origen, verificado_at, agregado_por)
    VALUES (v_num, p_junta, btrim(p_nombre), nullif(btrim(p_carrera), ''),
            CASE WHEN p_verificado THEN 'cssp' ELSE p_origen END,
            CASE WHEN p_verificado THEN now() ELSE NULL END,
            public.auth_employee_id())
    RETURNING id INTO v_id;

    RETURN v_id;
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

    SELECT coalesce(sum(d.cantidad), 0) INTO v_entregado
      FROM public.bitacora_dispensaciones d
     WHERE d.receta_item_id = v_item_id AND d.estado <> 'anulada';

    SELECT cantidad_prescrita INTO v_prescrito FROM public.receta_items WHERE id = v_item_id;

    UPDATE public.recetas
       SET estado = CASE WHEN v_entregado >= v_prescrito THEN 'cerrada' ELSE 'abierta' END,
           foto_url = coalesce(nullif(btrim(p_foto_url), ''), foto_url)
     WHERE id = v_receta.id;

    RETURN json_build_object(
        'receta_id', v_receta.id,
        'correlativo_txt', v_receta.anio::text || '-' || lpad(v_receta.correlativo::text, 5, '0'),
        'entregado', v_entregado,
        'prescrito', v_prescrito,
        'pendiente', v_prescrito - v_entregado,
        'cerrada', v_entregado >= v_prescrito
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_recetas_abiertas(p_branch_id bigint)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE v_out json;
BEGIN
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');
    SELECT coalesce(json_agg(x ORDER BY x->>'fecha' DESC), '[]'::json) INTO v_out FROM (
        SELECT json_build_object(
            'id', r.id,
            'correlativo_txt', r.anio::text || '-' || lpad(r.correlativo::text, 5, '0'),
            'paciente', r.paciente_nombre,
            'medico', m.nombre,
            'medico_id', r.medico_id,
            'fecha', r.fecha_prescripcion,
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
        WHERE r.branch_id = p_branch_id AND r.estado = 'abierta'
    ) t;
    RETURN v_out;
END;
$fn$;

ALTER TABLE public.bitacora_dispensaciones
    DROP CONSTRAINT bitacora_dispensaciones_receta_item_id_fkey;
ALTER TABLE public.bitacora_dispensaciones
    ADD CONSTRAINT bitacora_dispensaciones_receta_item_id_fkey
    FOREIGN KEY (receta_item_id) REFERENCES public.receta_items(id) ON DELETE RESTRICT;

COMMENT ON CONSTRAINT bitacora_dispensaciones_receta_item_id_fkey ON public.bitacora_dispensaciones IS
    'RESTRICT y no SET NULL: la receta es la evidencia que el item 3.12 manda retener, y un renglon completa sin receta viola el CHECK de la propia tabla.';

REVOKE EXECUTE ON FUNCTION public.clase_de_cliente(text, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.buscar_o_crear_medico(text, text, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.completar_dispensacion(bigint, text, bigint, numeric, date, smallint, text, text, bigint, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_recetas_abiertas(bigint) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.clase_de_cliente(text, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.buscar_o_crear_medico(text, text, text, text, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.completar_dispensacion(bigint, text, bigint, numeric, date, smallint, text, text, bigint, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_recetas_abiertas(bigint) TO authenticated, service_role;
