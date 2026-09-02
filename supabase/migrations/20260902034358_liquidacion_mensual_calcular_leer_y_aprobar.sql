-- Armar, leer y aprobar la liquidación mensual de bonos.
--
-- ── La guarda que parece de más y no lo es ─────────────────────────────────
-- El bono de meta se lee con `get_bono_meta_sala`, y esa función resuelve la
-- sala por el ALCANCE de quien pregunta: con alcance de sucursal devuelve
-- SIEMPRE la propia e ignora el parámetro. Llamarla seis veces desde acá sin
-- comprobar el alcance escribiría los números de una sola sala seis veces, y la
-- liquidación saldría completa, firmada y mal — sin un error, sin una fila de
-- menos, y con el nombre de otra sala encima.
--
-- Por eso hay DOS frenos y no uno: se exige alcance ALL antes de empezar, y
-- además se comprueba que la respuesta traiga la sala que se pidió. El segundo
-- cuesta una comparación y cubre el día que la regla del alcance cambie.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- calcular_liquidacion — rehace el detalle del mes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_liquidacion(p_year_month text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_liq   public.liquidacion%ROWTYPE;
    v_sala  record;
    v_pm    record;
    v_json  json;
    v_resp  bigint;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;
    IF coalesce(p_year_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'MES_INVALIDO: el mes se escribe como AAAA-MM';
    END IF;
    IF NOT public.auth_has_module_permission('metas','can_view')
       OR public.auth_module_scope('metas') <> 'ALL' THEN
        RAISE EXCEPTION 'FALTA_METAS: para armar la liquidación hay que poder ver las metas de TODAS las salas, y tu cargo no tiene ese alcance';
    END IF;

    SELECT * INTO v_liq FROM public.liquidacion
     WHERE year_month = p_year_month FOR UPDATE;

    IF FOUND AND v_liq.estado = 'aprobada' THEN
        RAISE EXCEPTION 'LIQUIDACION_APROBADA: % ya está aprobada y sus números están congelados', p_year_month;
    END IF;

    IF NOT FOUND THEN
        INSERT INTO public.liquidacion (year_month, informativa)
        VALUES (p_year_month, NOT public.metas_bono_activo(p_year_month))
        RETURNING * INTO v_liq;
        PERFORM public.liquidacion_log(v_liq.id, p_year_month, 'creada', NULL, NULL, NULL);
    END IF;

    -- Se rehace entero. Un cálculo incremental tendría que saber qué cambió
    -- desde la última vez, y lo que cambia son ventas de un mes ya pasado: la
    -- respuesta correcta es volver a preguntar.
    DELETE FROM public.liquidacion_detalle WHERE liquidacion_id = v_liq.id;

    -- ── 1 · El bono de META, por sala ────────────────────────────────────────
    FOR v_sala IN
        SELECT m.branch_id, b.name AS sala
          FROM public.metas_sucursal m
          JOIN public.branches b ON b.id = m.branch_id
         WHERE m.year_month = p_year_month
         ORDER BY b.name
    LOOP
        v_json := public.get_bono_meta_sala(v_sala.branch_id, p_year_month);

        IF v_json IS NULL THEN
            RAISE EXCEPTION 'META_ILEGIBLE: no se pudo leer el bono de meta de %', v_sala.sala;
        END IF;

        v_resp := (v_json ->> 'branch_id')::bigint;
        IF v_resp IS DISTINCT FROM v_sala.branch_id THEN
            RAISE EXCEPTION
              'META_DE_OTRA_SALA: se pidió el bono de % y respondió el de otra sala; no se escribe nada',
              v_sala.sala;
        END IF;

        INSERT INTO public.liquidacion_detalle
            (liquidacion_id, employee_id, branch_id, area, tipo, concepto, monto, detalle)
        SELECT v_liq.id, (p ->> 'employee_id')::uuid, v_sala.branch_id,
               'persona', 'meta',
               'Bono de meta · ' || v_sala.sala,
               round((p ->> 'bono')::numeric, 2),
               jsonb_build_object(
                   'pct',       v_json ->> 'pct',
                   'tramo',     v_json ->> 'tramo',
                   'es_jefe',   (p ->> 'es_jefe')::boolean,
                   'en_prueba', (p ->> 'en_prueba')::boolean)
          FROM json_array_elements(v_json -> 'personas') p
         WHERE (p ->> 'employee_id') IS NOT NULL
           AND round(coalesce((p ->> 'bono')::numeric, 0), 2) > 0;
    END LOOP;

    -- ── 2 · El bono de LABORATORIO, de las promociones de ESTE mes ───────────
    FOR v_pm IN
        SELECT pm.id, pm.nombre
          FROM public.promociones pm
         WHERE pm.tipo = 'laboratorio'
           AND pm.year_month = p_year_month
           AND pm.estado <> 'borrador'
         ORDER BY pm.nombre
    LOOP
        INSERT INTO public.liquidacion_detalle
            (liquidacion_id, employee_id, branch_id, area, tipo, concepto, monto, detalle)
        SELECT v_liq.id, e.id, s.branch_id, 'persona', 'laboratorio',
               'Bono de laboratorio · ' || v_pm.nombre,
               s.monto_por_persona,
               jsonb_build_object(
                   'promocion_id',      v_pm.id,
                   'nivel',             s.nivel,
                   'venta_de_la_sala',  s.venta,
                   'congelado',         s.congelado,
                   -- Cuánta gente había cuando el mes cerró. Si difiere de las
                   -- filas escritas acá, alguien entró o salió después — y eso
                   -- se puede mirar en vez de descubrirlo cuadrando a mano.
                   'personas_al_cierre', s.personas)
          FROM (
              -- El mes cerrado manda con sus números CONGELADOS. El abierto se
              -- calcula en vivo, y por eso una liquidación de un mes en curso
              -- es una foto que todavía se mueve.
              SELECT c.branch_id, c.nivel, c.monto_por_persona, c.venta, c.personas,
                     true AS congelado
                FROM public.promocion_cierre_sala c
               WHERE c.promocion_id = v_pm.id
              UNION ALL
              SELECT a.branch_id, a.nivel, a.monto_por_persona, a.venta, a.personas,
                     false
                FROM public.promocion_laboratorio_avance(v_pm.id, p_year_month) a
               WHERE NOT EXISTS (SELECT 1 FROM public.promocion_cierre_sala c2
                                  WHERE c2.promocion_id = v_pm.id)
          ) s
          JOIN public.employees e
            ON e.branch_id = s.branch_id
           AND e.status = 'ACTIVO'
           AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
         WHERE s.nivel IS NOT NULL AND s.monto_por_persona > 0;
    END LOOP;

    -- ── 3 · El bono de PRODUCTO, de las promociones que TERMINARON este mes ──
    -- Va entera al mes del cierre y no se parte: ver el encabezado de la
    -- migración de las tablas. El corte del lote sólo es definitivo cuando la
    -- promoción termina, y partir por mes evapora tramos de `unidades_por_bono`.
    FOR v_pm IN
        SELECT pm.id, pm.nombre
          FROM public.promociones pm
         WHERE pm.tipo = 'producto'
           AND pm.estado = 'finalizada'
           AND (SELECT to_char(max(r.cerrado_at) AT TIME ZONE 'America/El_Salvador',
                               'YYYY-MM')
                  FROM public.promocion_renglon r
                 WHERE r.promocion_id = pm.id) = p_year_month
         ORDER BY pm.nombre
    LOOP
        INSERT INTO public.liquidacion_detalle
            (liquidacion_id, employee_id, branch_id, area, tipo, concepto, monto, detalle)
        SELECT v_liq.id, c.employee_id, c.branch_id, 'persona', 'producto',
               'Bono de promoción · ' || v_pm.nombre,
               round(sum(c.monto_dentro), 2),
               jsonb_build_object('promocion_id', v_pm.id,
                                  'unidades', round(sum(c.u_dentro), 2))
          FROM public.promocion_corte_del_lote(v_pm.id) c
         WHERE c.employee_id IS NOT NULL
         GROUP BY c.employee_id, c.branch_id
        HAVING round(sum(c.monto_dentro), 2) > 0;

        -- Los fondos NO llevan sala ni persona: son del área. Se filtran por
        -- «> 0» para no escribir una fila de cero, que en la hoja se leería
        -- como que el área participó y no le tocó nada.
        INSERT INTO public.liquidacion_detalle
            (liquidacion_id, employee_id, branch_id, area, tipo, concepto, monto, detalle)
        SELECT v_liq.id, NULL, NULL, x.area, 'producto',
               x.rotulo || ' · ' || v_pm.nombre, x.monto,
               jsonb_build_object('promocion_id', v_pm.id)
          FROM (
            SELECT 'administracion'::text AS area, 'Fondo de Administración'::text AS rotulo,
                   round(sum(c.fondo_adm), 2) AS monto
              FROM public.promocion_corte_del_lote(v_pm.id) c
            UNION ALL
            SELECT 'bodega', 'Fondo de Bodega',
                   round(sum(c.fondo_bodega), 2)
              FROM public.promocion_corte_del_lote(v_pm.id) c
          ) x
         WHERE coalesce(x.monto, 0) > 0;
    END LOOP;

    -- ── 4 · Los EXCEDENTES aprobados este mes ────────────────────────────────
    -- Se ubican por la fecha en que se DECIDIERON: no pertenecen a un programa
    -- mensual, son un pago extraordinario que alguien autorizó un día.
    INSERT INTO public.liquidacion_detalle
        (liquidacion_id, employee_id, branch_id, area, tipo, concepto, monto, detalle)
    SELECT v_liq.id, ex.employee_id, ex.branch_id, 'persona', 'excedente',
           'Excedente aprobado · ' || pm.nombre,
           ex.monto,
           jsonb_build_object('renglon_id', ex.renglon_id,
                              'unidades',   ex.unidades,
                              'decidido_at', ex.decidido_at)
      FROM public.promocion_excedente ex
      JOIN public.promocion_renglon r ON r.id = ex.renglon_id
      JOIN public.promociones      pm ON pm.id = r.promocion_id
     WHERE ex.estado = 'aprobado'
       AND ex.monto > 0
       AND to_char(ex.decidido_at AT TIME ZONE 'America/El_Salvador', 'YYYY-MM')
           = p_year_month;

    UPDATE public.liquidacion
       SET calculada_at  = now(),
           calculada_por = v_actor,
           informativa   = NOT public.metas_bono_activo(p_year_month),
           updated_at    = now()
     WHERE id = v_liq.id;

    PERFORM public.liquidacion_log(
        v_liq.id, p_year_month, 'calculada', NULL,
        (SELECT count(*)::text || ' conceptos · ' ||
                to_char(coalesce(sum(monto),0), 'FM999999990.00')
           FROM public.liquidacion_detalle WHERE liquidacion_id = v_liq.id),
        NULL);

    RETURN public.get_liquidacion(p_year_month);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_liquidacion — la hoja del mes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_liquidacion(p_year_month text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_liq public.liquidacion%ROWTYPE;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_view') THEN
        RETURN NULL;
    END IF;
    IF coalesce(p_year_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'MES_INVALIDO: el mes se escribe como AAAA-MM';
    END IF;

    SELECT * INTO v_liq FROM public.liquidacion WHERE year_month = p_year_month;

    -- Un mes sin liquidación NO es un error: es un mes que nadie armó todavía.
    -- Se devuelve la cabecera vacía para que la pantalla pueda decir eso y
    -- ofrecer el botón, en vez de un hueco que se lee como una falla.
    IF NOT FOUND THEN
        RETURN json_build_object(
            'year_month', p_year_month,
            'existe',     false,
            'estado',     'sin_armar',
            'informativa', NOT public.metas_bono_activo(p_year_month),
            'personas',   '[]'::json,
            'fondos',     '[]'::json,
            'total',      0,
            'total_personas', 0,
            'total_fondos',   0);
    END IF;

    RETURN json_build_object(
        'id',           v_liq.id,
        'year_month',   v_liq.year_month,
        'existe',       true,
        'estado',       v_liq.estado,
        'informativa',  v_liq.informativa,
        'nota',         v_liq.nota,
        'calculada_at', v_liq.calculada_at,
        'calculada_por',(SELECT e.name FROM public.employees e WHERE e.id = v_liq.calculada_por),
        'aprobada_at',  v_liq.aprobada_at,
        'aprobada_por', (SELECT e.name FROM public.employees e WHERE e.id = v_liq.aprobada_por),
        'personas', coalesce((
            SELECT json_agg(to_json(x) ORDER BY x.sala NULLS LAST, x.nombre)
              FROM (
                SELECT d.employee_id, e.name AS nombre, e.code,
                       b.name AS sala,
                       round(sum(d.monto), 2) AS total,
                       round(sum(d.monto) FILTER (WHERE d.tipo = 'meta'), 2)        AS meta,
                       round(sum(d.monto) FILTER (WHERE d.tipo = 'producto'), 2)    AS producto,
                       round(sum(d.monto) FILTER (WHERE d.tipo = 'laboratorio'), 2) AS laboratorio,
                       round(sum(d.monto) FILTER (WHERE d.tipo = 'excedente'), 2)   AS excedente,
                       (SELECT json_agg(json_build_object(
                                   'tipo', dd.tipo, 'concepto', dd.concepto,
                                   'monto', dd.monto, 'detalle', dd.detalle)
                                ORDER BY dd.tipo, dd.concepto)
                          FROM public.liquidacion_detalle dd
                         WHERE dd.liquidacion_id = v_liq.id
                           AND dd.employee_id = d.employee_id) AS conceptos
                  FROM public.liquidacion_detalle d
                  JOIN public.employees e ON e.id = d.employee_id
                  LEFT JOIN public.branches b ON b.id = e.branch_id
                 WHERE d.liquidacion_id = v_liq.id AND d.area = 'persona'
                 GROUP BY d.employee_id, e.name, e.code, b.name
              ) x), '[]'::json),
        'fondos', coalesce((
            SELECT json_agg(to_json(y) ORDER BY y.area)
              FROM (
                SELECT d.area,
                       round(sum(d.monto), 2) AS total,
                       (SELECT json_agg(json_build_object(
                                   'concepto', dd.concepto, 'monto', dd.monto)
                                ORDER BY dd.concepto)
                          FROM public.liquidacion_detalle dd
                         WHERE dd.liquidacion_id = v_liq.id AND dd.area = d.area) AS conceptos
                  FROM public.liquidacion_detalle d
                 WHERE d.liquidacion_id = v_liq.id AND d.area <> 'persona'
                 GROUP BY d.area
              ) y), '[]'::json),
        'total', coalesce((SELECT round(sum(monto), 2) FROM public.liquidacion_detalle
                            WHERE liquidacion_id = v_liq.id), 0),
        'total_personas', coalesce((SELECT round(sum(monto), 2) FROM public.liquidacion_detalle
                                     WHERE liquidacion_id = v_liq.id AND area = 'persona'), 0),
        'total_fondos', coalesce((SELECT round(sum(monto), 2) FROM public.liquidacion_detalle
                                   WHERE liquidacion_id = v_liq.id AND area <> 'persona'), 0),
        'gente', coalesce((SELECT count(DISTINCT employee_id) FROM public.liquidacion_detalle
                            WHERE liquidacion_id = v_liq.id AND area = 'persona'), 0)
    );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- aprobar_liquidacion — congelar (o devolver a borrador)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aprobar_liquidacion(
    p_year_month text,
    p_aprobar    boolean DEFAULT true,
    p_nota       text    DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_liq   public.liquidacion%ROWTYPE;
    v_n     integer;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_approve') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: aprobar la liquidación es del gerente';
    END IF;

    SELECT * INTO v_liq FROM public.liquidacion
     WHERE year_month = p_year_month FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_EXISTE: no hay liquidación armada para %', p_year_month;
    END IF;

    IF p_aprobar AND v_liq.estado = 'aprobada' THEN
        RETURN json_build_object('year_month', p_year_month, 'estado', 'aprobada',
                                 'sin_cambio', true);
    END IF;

    IF p_aprobar THEN
        SELECT count(*) INTO v_n FROM public.liquidacion_detalle
         WHERE liquidacion_id = v_liq.id;
        -- Aprobar una hoja vacía la deja congelada en cero y nadie vuelve a
        -- mirarla. Si no hay nada que pagar, es que falta calcularla.
        IF v_n = 0 THEN
            RAISE EXCEPTION 'LIQUIDACION_VACIA: % no tiene ni un concepto; hay que calcularla primero', p_year_month;
        END IF;

        UPDATE public.liquidacion
           SET estado = 'aprobada', aprobada_por = v_actor, aprobada_at = now(),
               nota = coalesce(nullif(btrim(coalesce(p_nota,'')), ''), nota),
               updated_at = now()
         WHERE id = v_liq.id;
    ELSE
        -- Reabrir EXIGE motivo: devolver a borrador un mes ya aprobado deshace
        -- una firma, y quien lo haga tiene que decir por qué.
        IF nullif(btrim(coalesce(p_nota,'')), '') IS NULL THEN
            RAISE EXCEPTION 'MOTIVO_REQUERIDO: reabrir una liquidación aprobada necesita el motivo';
        END IF;
        UPDATE public.liquidacion
           SET estado = 'borrador', aprobada_por = NULL, aprobada_at = NULL,
               nota = btrim(p_nota), updated_at = now()
         WHERE id = v_liq.id;
    END IF;

    PERFORM public.liquidacion_log(
        v_liq.id, p_year_month,
        CASE WHEN p_aprobar THEN 'aprobada' ELSE 'reabierta' END,
        v_liq.estado, CASE WHEN p_aprobar THEN 'aprobada' ELSE 'borrador' END,
        nullif(btrim(coalesce(p_nota,'')), ''));

    RETURN public.get_liquidacion(p_year_month);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_liquidaciones — la lista de meses armados
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_liquidaciones()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_out json;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_view') THEN
        RETURN NULL;
    END IF;

    SELECT coalesce(json_agg(to_json(x) ORDER BY x.year_month DESC), '[]'::json)
      INTO v_out
      FROM (
        SELECT l.year_month, l.estado, l.informativa, l.calculada_at, l.aprobada_at,
               coalesce((SELECT round(sum(d.monto),2) FROM public.liquidacion_detalle d
                          WHERE d.liquidacion_id = l.id), 0) AS total,
               coalesce((SELECT count(DISTINCT d.employee_id) FROM public.liquidacion_detalle d
                          WHERE d.liquidacion_id = l.id AND d.area = 'persona'), 0) AS gente
          FROM public.liquidacion l
      ) x;

    RETURN v_out;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.calcular_liquidacion(text)                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_liquidacion(text)                       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_liquidaciones()                         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.aprobar_liquidacion(text, boolean, text)    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.calcular_liquidacion(text)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_liquidacion(text)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_liquidaciones()                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aprobar_liquidacion(text, boolean, text)  TO authenticated, service_role;
