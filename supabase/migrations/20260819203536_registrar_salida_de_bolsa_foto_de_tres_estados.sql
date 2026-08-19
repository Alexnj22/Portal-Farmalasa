SET lock_timeout = '5s';

-- Lo único que cambia contra la versión anterior es la guarda de la foto:
-- `t.pide_foto` (booleano) pasó a ser `t.foto = 'OBLIGATORIA'`. El estado
-- 'OPCIONAL' se dibuja en la pantalla y no frena acá — que es justamente el
-- punto: el proveedor que no deja DTE y la compra urgente que todavía no
-- ocurrió pueden registrarse, con la foto si la hay.
CREATE OR REPLACE FUNCTION public.registrar_salida_de_bolsa(p_tipo text, p_monto numeric, p_repartos jsonb, p_entidad text DEFAULT NULL::text, p_numero_boleta text DEFAULT NULL::text, p_foto_url text DEFAULT NULL::text, p_nota text DEFAULT NULL::text, p_recibido_por uuid DEFAULT NULL::uuid, p_metodo text DEFAULT NULL::text, p_vale uuid DEFAULT NULL::uuid)
 RETURNS bolsas_operaciones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    t public.bolsas_tipos_salida; v_oper public.bolsas_operaciones;
    v_yo uuid := (SELECT auth_employee_id());
    v_scope text := (SELECT auth_module_scope('bolsas'));
    v_mia bigint := (SELECT auth_employee_branch_id());
    v_branch bigint; v_suma numeric := 0; v_codigo text; r record; b public.bolsas;
    v_vale public.identidad_vales;
    v_entidad text := nullif(btrim(coalesce(p_entidad, '')), '');
    v_del_catalogo text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO t FROM public.bolsas_tipos_salida WHERE codigo = p_tipo AND activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese motivo no existe.'; END IF;
    IF p_monto IS NULL OR p_monto < 0 THEN RAISE EXCEPTION 'Hay que decir cuánto.'; END IF;
    IF t.signo <> 0 AND p_monto = 0 THEN RAISE EXCEPTION 'Hay que decir cuánto.'; END IF;
    IF t.etiqueta_entidad IS NOT NULL AND v_entidad IS NULL THEN
        RAISE EXCEPTION 'Falta el dato: %.', t.etiqueta_entidad; END IF;

    -- El catálogo manda cuando existe. Se compara normalizado —sin espacios de
    -- sobra y sin distinguir mayúsculas— porque el valor viene de un
    -- desplegable, pero el nombre que se GUARDA es el de la fila: así el dato
    -- coincide con el catálogo por construcción y no por suerte.
    IF t.etiqueta_entidad IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.bolsas_entidades e WHERE e.tipo = t.codigo AND e.activo) THEN
        SELECT e.nombre INTO v_del_catalogo
          FROM public.bolsas_entidades e
         WHERE e.tipo = t.codigo AND e.activo
           AND upper(btrim(e.nombre)) = upper(v_entidad);
        IF v_del_catalogo IS NULL THEN
            RAISE EXCEPTION 'Ese/a % no está en la lista.', lower(t.etiqueta_entidad); END IF;
        v_entidad := v_del_catalogo;
    END IF;

    IF t.pide_boleta AND btrim(coalesce(p_numero_boleta,'')) = '' THEN
        RAISE EXCEPTION 'Falta el número de boleta.'; END IF;
    IF t.foto = 'OBLIGATORIA' AND btrim(coalesce(p_foto_url,'')) = '' THEN
        RAISE EXCEPTION 'Falta la foto del comprobante.'; END IF;

    IF t.pide_receptor THEN
        IF p_recibido_por IS NULL THEN RAISE EXCEPTION 'Falta quién se lleva el efectivo.'; END IF;
        IF p_vale IS NULL THEN
            RAISE EXCEPTION 'Falta comprobar la identidad de quien retira el efectivo.'; END IF;

        -- El vale lo emitió la comprobación de identidad y vale para UNA sola
        -- operación: se toma con FOR UPDATE y se marca usado en la misma
        -- transacción, así dos pestañas abiertas no pueden gastarlo dos veces.
        SELECT * INTO v_vale FROM public.identidad_vales
         WHERE token = p_vale FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Hay que comprobar la identidad de nuevo.'; END IF;
        IF v_vale.usado_at IS NOT NULL THEN
            RAISE EXCEPTION 'Esa comprobación ya se usó. Hay que hacerla de nuevo.'; END IF;
        IF v_vale.created_at < now() - interval '5 minutes' THEN
            RAISE EXCEPTION 'La comprobación de identidad vencio. Hay que hacerla de nuevo.'; END IF;
        IF v_vale.employee_id IS DISTINCT FROM p_recibido_por THEN
            RAISE EXCEPTION 'La identidad comprobada no es la de quien figura retirando el efectivo.'; END IF;

        UPDATE public.identidad_vales SET usado_at = now() WHERE token = p_vale;
    END IF;

    IF p_repartos IS NULL OR jsonb_array_length(p_repartos) = 0 THEN
        RAISE EXCEPTION 'Falta decir de qué bolsa sale.'; END IF;

    FOR r IN SELECT (x->>'bolsa_id')::bigint AS bolsa_id, round((x->>'monto')::numeric, 2) AS monto
               FROM jsonb_array_elements(p_repartos) x LOOP
        SELECT * INTO b FROM public.bolsas WHERE id = r.bolsa_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Esa bolsa no existe.'; END IF;
        IF v_scope IS DISTINCT FROM 'ALL' AND b.branch_id IS DISTINCT FROM v_mia THEN
            RAISE EXCEPTION 'FORBIDDEN'; END IF;
        IF b.estado <> 'ABIERTA' THEN RAISE EXCEPTION 'La bolsa % ya salió de la sala.', b.folio; END IF;
        IF v_branch IS NULL THEN v_branch := b.branch_id;
        ELSIF v_branch <> b.branch_id THEN
            RAISE EXCEPTION 'Las bolsas de una misma salida tienen que ser de la misma sala.'; END IF;

        IF t.signo = -1 THEN
            IF r.monto <= 0 THEN RAISE EXCEPTION 'Cada monto tiene que ser mayor que cero.'; END IF;
            IF r.monto > public.bolsa_saldo(b.id) THEN
                RAISE EXCEPTION 'La bolsa % sólo tiene %.', b.folio,
                    to_char(public.bolsa_saldo(b.id), 'FM999,999,990.00'); END IF;
        ELSIF t.signo = 1 THEN
            IF r.monto <= 0 THEN RAISE EXCEPTION 'Cada monto tiene que ser mayor que cero.'; END IF;
            IF r.monto > public.bolsa_reintegro_maximo(b.id) THEN
                RAISE EXCEPTION 'A la bolsa % sólo le faltan %: una bolsa no puede tener más de lo que se guardó.',
                    b.folio, to_char(public.bolsa_reintegro_maximo(b.id), 'FM999,999,990.00'); END IF;
        END IF;
        v_suma := v_suma + r.monto;
    END LOOP;

    IF t.signo <> 0 AND round(v_suma, 2) <> round(p_monto, 2) THEN
        RAISE EXCEPTION 'Lo que sale de las bolsas (%) no cuadra con el monto (%).',
            to_char(v_suma, 'FM999,999,990.00'), to_char(p_monto, 'FM999,999,990.00'); END IF;

    SELECT upper(btrim(coalesce(br.codigo, 'B'))) INTO v_codigo FROM public.branches br WHERE br.id = v_branch;

    INSERT INTO public.bolsas_operaciones
        (folio, branch_id, tipo, monto, entidad, numero_boleta, foto_url, nota,
         recibido_por, recibido_metodo, registrado_por)
    VALUES (t.prefijo || '-' || nextval('public.bolsas_operacion_folio_seq'),
         v_branch, t.codigo, round(p_monto, 2),
         v_entidad, nullif(btrim(coalesce(p_numero_boleta,'')), ''),
         nullif(btrim(coalesce(p_foto_url,'')), ''), nullif(btrim(coalesce(p_nota,'')), ''),
         CASE WHEN t.pide_receptor THEN p_recibido_por END,
         CASE WHEN t.pide_receptor THEN coalesce(v_vale.metodo, p_metodo) END, v_yo)
    RETURNING * INTO v_oper;

    FOR r IN SELECT (x->>'bolsa_id')::bigint AS bolsa_id, round((x->>'monto')::numeric, 2) AS monto
               FROM jsonb_array_elements(p_repartos) x LOOP
        INSERT INTO public.bolsas_movimientos (bolsa_id, operacion_id, vale_folio, monto, registrado_por)
        VALUES (r.bolsa_id, v_oper.id,
                'V-' || v_codigo || '-' || nextval('public.bolsas_vale_folio_seq'),
                t.signo * r.monto, v_yo);
        UPDATE public.bolsas SET updated_at = now() WHERE id = r.bolsa_id;
        INSERT INTO public.bolsas_eventos (bolsa_id, accion, monto, employee_id, nota)
        VALUES (r.bolsa_id,
                CASE WHEN t.signo = 0 THEN 'ABRIR' WHEN t.signo = 1 THEN 'REINTEGRO' ELSE 'SALIDA' END,
                t.signo * r.monto, v_yo, t.etiqueta || ' · ' || v_oper.folio);
    END LOOP;

    RETURN v_oper;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_salida_de_bolsa(text, numeric, jsonb, text, text, text, text, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_salida_de_bolsa(text, numeric, jsonb, text, text, text, text, uuid, text, uuid) TO authenticated, service_role;
