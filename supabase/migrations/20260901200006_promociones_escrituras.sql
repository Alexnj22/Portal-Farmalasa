-- Promociones — las escrituras.
--
-- Todas plpgsql + SECURITY DEFINER + SET search_path. Ninguna tabla del módulo
-- tiene policy de escritura: se entra sólo por acá, y cada RPC deja su rastro en
-- `promocion_log` dentro de la MISMA transacción que la escritura que registra.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- crear_promocion — la promoción entera de una vez
-- ─────────────────────────────────────────────────────────────────────────────
-- Nace en BORRADOR y no cuenta hasta activarla. Se crea completa —renglones,
-- tarifa y reparto— porque un reparto que no suma el lote es un estado inválido
-- que no debería poder existir ni un instante: validarlo al crear es lo que hace
-- que «la suma cuadra» sea cierto por construcción.
--
-- `p_renglones` es un arreglo de objetos:
--   { erp_product_id, factor_unidades, inicio, fin, lote_total,
--     bono_vendedor, bono_adm, bono_bodega, unidades_por_bono,
--     reparto: [ { branch_id, unidades } ] }
CREATE OR REPLACE FUNCTION public.crear_promocion(
    p_nombre    text,
    p_renglones jsonb,
    p_nota      text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor      uuid := public.auth_employee_id();
    v_promo_id   bigint;
    v_nombre     text := nullif(btrim(coalesce(p_nombre,'')), '');
    v_r          jsonb;
    v_rep        jsonb;
    v_renglon_id bigint;
    v_suma       integer;
    v_lote       integer;
    v_producto   integer;
    v_nombre_prod text;
    v_n_renglones integer := 0;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;
    IF v_nombre IS NULL THEN
        RAISE EXCEPTION 'NOMBRE_REQUERIDO: la promoción necesita un nombre que la sala pueda reconocer';
    END IF;
    IF p_renglones IS NULL OR jsonb_array_length(p_renglones) = 0 THEN
        RAISE EXCEPTION 'SIN_PRODUCTOS: una promoción sin productos no cuenta nada';
    END IF;
    IF jsonb_array_length(p_renglones) > 50 THEN
        RAISE EXCEPTION 'DEMASIADOS_PRODUCTOS: máximo 50 por promoción';
    END IF;

    INSERT INTO public.promociones (nombre, nota, creado_por)
    VALUES (v_nombre, nullif(btrim(coalesce(p_nota,'')), ''), v_actor)
    RETURNING id INTO v_promo_id;

    FOR v_r IN SELECT * FROM jsonb_array_elements(p_renglones)
    LOOP
        v_producto := (v_r ->> 'erp_product_id')::integer;
        v_lote     := (v_r ->> 'lote_total')::integer;

        SELECT p.nombre INTO v_nombre_prod FROM public.products p WHERE p.id = v_producto;
        IF v_nombre_prod IS NULL THEN
            RAISE EXCEPTION 'PRODUCTO_INEXISTENTE: el producto % no existe', v_producto;
        END IF;
        IF v_lote IS NULL OR v_lote <= 0 THEN
            RAISE EXCEPTION 'LOTE_INVALIDO: % necesita cuántas unidades se negociaron', v_nombre_prod;
        END IF;

        INSERT INTO public.promocion_renglon
            (promocion_id, erp_product_id, factor_unidades, inicio, fin, lote_total)
        VALUES
            (v_promo_id, v_producto,
             nullif(v_r ->> 'factor_unidades','')::smallint,
             (v_r ->> 'inicio')::date,
             (v_r ->> 'fin')::date,
             v_lote)
        RETURNING id INTO v_renglon_id;

        -- La tarifa arranca el día que arranca el renglón. Cambiarla después
        -- agrega una fila; nunca se pisa la vieja.
        INSERT INTO public.promocion_renglon_tarifa
            (renglon_id, desde, bono_vendedor, bono_adm, bono_bodega,
             unidades_por_bono, creado_por)
        VALUES
            (v_renglon_id, (v_r ->> 'inicio')::date,
             coalesce((v_r ->> 'bono_vendedor')::numeric, 0),
             coalesce((v_r ->> 'bono_adm')::numeric, 0),
             coalesce((v_r ->> 'bono_bodega')::numeric, 0),
             coalesce(nullif(v_r ->> 'unidades_por_bono','')::integer, 1),
             v_actor);

        -- El reparto. Se escribe con `asignado_vigente = asignado_original`: los
        -- traslados mueven el vigente y el original queda de testigo.
        v_suma := 0;
        FOR v_rep IN SELECT * FROM jsonb_array_elements(coalesce(v_r -> 'reparto', '[]'::jsonb))
        LOOP
            INSERT INTO public.promocion_reparto
                (renglon_id, branch_id, asignado_original, asignado_vigente)
            VALUES
                (v_renglon_id,
                 (v_rep ->> 'branch_id')::bigint,
                 (v_rep ->> 'unidades')::integer,
                 (v_rep ->> 'unidades')::integer);
            v_suma := v_suma + (v_rep ->> 'unidades')::integer;
        END LOOP;

        -- El freno que hace cierto el «✓ cuadra» de la pantalla. Un reparto que
        -- no suma el lote deja a alguna sala vendiendo contra un número que no
        -- es suyo, y el aviso del 80% le mentiría a todas.
        IF v_suma <> v_lote THEN
            RAISE EXCEPTION 'REPARTO_NO_CUADRA: % reparte % de un lote de %',
                v_nombre_prod, v_suma, v_lote;
        END IF;

        v_n_renglones := v_n_renglones + 1;
    END LOOP;

    PERFORM public.promocion_log(
        v_promo_id, NULL, NULL, 'creada', NULL, v_nombre,
        v_n_renglones || ' producto(s)');

    RETURN json_build_object('id', v_promo_id, 'renglones', v_n_renglones);
END;
$function$;

COMMENT ON FUNCTION public.crear_promocion(text, jsonb, text) IS
  'Crea una promoción completa en borrador. Valida que el reparto de cada renglón sume su lote: un reparto que no cuadra no puede existir ni un instante.';

-- ─────────────────────────────────────────────────────────────────────────────
-- activar_promocion / suspender: el interruptor de la promoción
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activar_promocion(
    p_id      bigint,
    p_activar boolean DEFAULT true
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor  uuid := public.auth_employee_id();
    v_row    public.promociones%ROWTYPE;
    v_nuevo  text;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;

    SELECT * INTO v_row FROM public.promociones WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: la promoción % no existe', p_id; END IF;

    IF v_row.estado = 'finalizada' THEN
        RAISE EXCEPTION 'YA_FINALIZADA: una promoción terminada no se reabre; creá una nueva';
    END IF;

    v_nuevo := CASE WHEN p_activar THEN 'activa' ELSE 'borrador' END;
    IF v_nuevo = v_row.estado THEN
        RETURN json_build_object('id', p_id, 'estado', v_row.estado, 'sin_cambio', true);
    END IF;

    UPDATE public.promociones
       SET estado = v_nuevo, updated_at = now()
     WHERE id = p_id;

    PERFORM public.promocion_log(p_id, NULL, NULL,
        CASE WHEN p_activar THEN 'activada' ELSE 'vuelta_a_borrador' END,
        v_row.estado, v_nuevo, NULL);

    RETURN json_build_object('id', p_id, 'estado', v_nuevo);
END;
$function$;

COMMENT ON FUNCTION public.activar_promocion(bigint, boolean) IS
  'Enciende o devuelve a borrador una promoción. Una finalizada no se reabre.';

-- ─────────────────────────────────────────────────────────────────────────────
-- editar_tarifa_renglon — cambiar los montos SIN reescribir lo ya ganado
-- ─────────────────────────────────────────────────────────────────────────────
-- No hace UPDATE de la tarifa: inserta una fila nueva con la fecha desde la que
-- rige. El cálculo toma la vigente a la fecha de cada venta, así que lo ganado
-- antes del cambio queda como estaba. Es la diferencia entre que la regla sea
-- cierta por construcción y que dependa de que alguien se acuerde.
CREATE OR REPLACE FUNCTION public.editar_tarifa_renglon(
    p_renglon_id        bigint,
    p_bono_vendedor     numeric,
    p_bono_adm          numeric,
    p_bono_bodega       numeric,
    p_unidades_por_bono integer DEFAULT 1,
    p_desde             date    DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_r     public.promocion_renglon%ROWTYPE;
    v_desde date;
    v_prev  public.promocion_renglon_tarifa%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;

    SELECT * INTO v_r FROM public.promocion_renglon WHERE id = p_renglon_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: el renglón % no existe', p_renglon_id; END IF;
    IF v_r.estado = 'cerrado' THEN
        RAISE EXCEPTION 'RENGLON_CERRADO: ya terminó (%), sus montos no se tocan', v_r.cerrado_motivo;
    END IF;

    -- El día del cambio lo pone el servidor, no el llamador: si se pudiera
    -- elegir una fecha pasada, «sin retroactividad» dejaría de ser cierto.
    v_desde := greatest(
        (now() AT TIME ZONE 'America/El_Salvador')::date,
        v_r.inicio);
    IF p_desde IS NOT NULL AND p_desde > v_desde THEN
        v_desde := p_desde;                      -- adelantarlo sí se permite
    END IF;

    SELECT * INTO v_prev FROM public.promocion_renglon_tarifa
     WHERE renglon_id = p_renglon_id AND desde <= v_desde
     ORDER BY desde DESC LIMIT 1;

    INSERT INTO public.promocion_renglon_tarifa
        (renglon_id, desde, bono_vendedor, bono_adm, bono_bodega,
         unidades_por_bono, creado_por)
    VALUES
        (p_renglon_id, v_desde,
         coalesce(p_bono_vendedor, 0), coalesce(p_bono_adm, 0), coalesce(p_bono_bodega, 0),
         greatest(coalesce(p_unidades_por_bono, 1), 1), v_actor)
    ON CONFLICT (renglon_id, desde) DO UPDATE
       SET bono_vendedor     = EXCLUDED.bono_vendedor,
           bono_adm          = EXCLUDED.bono_adm,
           bono_bodega       = EXCLUDED.bono_bodega,
           unidades_por_bono = EXCLUDED.unidades_por_bono,
           creado_por        = EXCLUDED.creado_por;

    PERFORM public.promocion_log(
        v_r.promocion_id, p_renglon_id, NULL, 'tarifa_cambiada',
        coalesce(v_prev.bono_vendedor::text, '—'),
        coalesce(p_bono_vendedor, 0)::text,
        'rige desde ' || v_desde::text);

    RETURN json_build_object('renglon_id', p_renglon_id, 'desde', v_desde);
END;
$function$;

COMMENT ON FUNCTION public.editar_tarifa_renglon(bigint, numeric, numeric, numeric, integer, date) IS
  'Cambia los montos de un renglón agregando una tarifa nueva con su fecha. Nunca pisa la anterior: lo ganado antes del cambio no se reescribe.';

-- ─────────────────────────────────────────────────────────────────────────────
-- extender_renglon — mover el fin de UN producto (y con él, el de la promoción)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.extender_renglon(
    p_renglon_id bigint,
    p_fin        date
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_r     public.promocion_renglon%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;
    IF p_fin IS NULL THEN
        RAISE EXCEPTION 'FECHA_REQUERIDA: hasta cuándo';
    END IF;

    SELECT * INTO v_r FROM public.promocion_renglon WHERE id = p_renglon_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: el renglón % no existe', p_renglon_id; END IF;
    IF p_fin < v_r.inicio THEN
        RAISE EXCEPTION 'FECHA_INVALIDA: el fin no puede ser antes del inicio (%)', v_r.inicio;
    END IF;

    -- Extender REABRE un renglón que había cerrado por vencimiento: es
    -- justamente para lo que sirve. Pero uno cerrado porque se acabó el lote no
    -- se reabre moviendo una fecha — no hay más producto que vender.
    IF v_r.estado = 'cerrado' AND v_r.cerrado_motivo = 'lote_agotado' THEN
        RAISE EXCEPTION 'LOTE_AGOTADO: se vendió el lote entero; extender la fecha no agrega producto';
    END IF;

    UPDATE public.promocion_renglon
       SET fin            = p_fin,
           estado         = 'abierto',
           cerrado_at     = NULL,
           cerrado_motivo = NULL,
           updated_at     = now()
     WHERE id = p_renglon_id;

    -- Si la promoción ya se había finalizado porque todos sus renglones habían
    -- cerrado, extender uno la vuelve a abrir: la vigencia de la promoción se
    -- DERIVA de sus renglones, no al revés.
    UPDATE public.promociones
       SET estado = 'activa', updated_at = now()
     WHERE id = v_r.promocion_id AND estado = 'finalizada';

    PERFORM public.promocion_log(
        v_r.promocion_id, p_renglon_id, NULL, 'extendido',
        v_r.fin::text, p_fin::text, NULL);

    RETURN json_build_object('renglon_id', p_renglon_id, 'fin', p_fin);
END;
$function$;

COMMENT ON FUNCTION public.extender_renglon(bigint, date) IS
  'Mueve el fin de un producto. Si la promoción estaba finalizada, la reabre — su vigencia se deriva de los renglones. Un renglón cerrado por lote agotado NO se reabre moviendo la fecha.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Permisos
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.crear_promocion(text, jsonb, text)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.activar_promocion(bigint, boolean)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.editar_tarifa_renglon(bigint, numeric, numeric, numeric, integer, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.extender_renglon(bigint, date)              FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.crear_promocion(text, jsonb, text)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activar_promocion(bigint, boolean)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.editar_tarifa_renglon(bigint, numeric, numeric, numeric, integer, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.extender_renglon(bigint, date)               TO authenticated, service_role;
