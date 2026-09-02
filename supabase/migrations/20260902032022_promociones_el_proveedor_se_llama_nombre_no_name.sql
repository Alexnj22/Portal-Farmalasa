-- `suppliers` no tiene `name`: la columna se llama `nombre`.
--
-- `get_promocion_laboratorio` pedía `s.name` y toda la función moría con
-- «column s.name does not exist». En pantalla eso NO se veía como un error de
-- una columna: la matriz salía vacía y el modal en blanco, o sea igual que una
-- promoción sin umbrales. El defecto lo destapó abrir la vista en el navegador
-- —los gates estaban los ocho en verde y el módulo compilaba— y es otra vez la
-- misma lección: compilar y pasar los gates no prueba nada sobre lo que se ve.
--
-- El módulo mezcla los dos idiomas a propósito y por eso el descuido es fácil:
-- `employees.name` sí existe, `branches.name` también, y son las dos que se
-- usan tres líneas más arriba en este mismo `json_build_object`.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_promocion_laboratorio(
    p_id         bigint,
    p_year_month text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_pm        public.promociones%ROWTYPE;
    v_ym        text;
    v_simula    boolean;
    v_congelado boolean;
    v_salas     json;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_view') THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_pm FROM public.promociones WHERE id = p_id;
    IF NOT FOUND OR v_pm.tipo <> 'laboratorio' THEN
        RETURN NULL;
    END IF;

    v_ym := coalesce(nullif(btrim(coalesce(p_year_month,'')), ''), v_pm.year_month);
    IF v_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'MES_INVALIDO: el mes se escribe como AAAA-MM';
    END IF;
    v_simula := (v_ym IS DISTINCT FROM v_pm.year_month);

    -- Un mes ya cerrado devuelve lo CONGELADO, no un recálculo: el padrón de la
    -- sala cambia y el número que se pagó tiene que seguir siendo ése. La
    -- simulación siempre recalcula, porque justamente pregunta por otro mes.
    v_congelado := NOT v_simula
        AND EXISTS (SELECT 1 FROM public.promocion_cierre_sala WHERE promocion_id = p_id);

    IF v_congelado THEN
        SELECT coalesce(json_agg(to_json(x) ORDER BY x.sala), '[]'::json) INTO v_salas
          FROM (
            SELECT c.branch_id, b.name AS sala, c.venta, c.nivel,
                   c.monto_por_persona, c.personas, c.costo,
                   NULL::smallint AS siguiente_nivel,
                   NULL::numeric  AS siguiente_umbral,
                   NULL::numeric  AS falta,
                   NULL::numeric  AS siguiente_monto
              FROM public.promocion_cierre_sala c
              JOIN public.branches b ON b.id = c.branch_id
             WHERE c.promocion_id = p_id
          ) x;
    ELSE
        SELECT coalesce(json_agg(to_json(a) ORDER BY a.sala), '[]'::json) INTO v_salas
          FROM public.promocion_laboratorio_avance(p_id, v_ym) a;
    END IF;

    RETURN json_build_object(
        'id',          v_pm.id,
        'tipo',        v_pm.tipo,
        'nombre',      v_pm.nombre,
        'estado',      v_pm.estado,
        'nota',        v_pm.nota,
        'year_month',  v_pm.year_month,
        'mes_medido',  v_ym,
        'simulacion',  v_simula,
        'congelado',   v_congelado,
        'paga',        v_pm.paga,
        'supplier_id', v_pm.supplier_id,
        -- `nombre`, no `name`: ver el encabezado de esta migración.
        'proveedor',   (SELECT s.nombre FROM public.suppliers s WHERE s.id = v_pm.supplier_id),
        'creado_por',  (SELECT e.name FROM public.employees e WHERE e.id = v_pm.creado_por),
        'created_at',  v_pm.created_at,
        'bonificaciones_activas', public.metas_bono_activo(v_ym),
        'laboratorios', coalesce((
            SELECT json_agg(json_build_object('id', lb.id, 'nombre', lb.nombre)
                            ORDER BY lb.nombre)
              FROM public.promocion_laboratorio pl
              JOIN public.laboratorios lb ON lb.id = pl.laboratorio_id
             WHERE pl.promocion_id = p_id), '[]'::json),
        'niveles', coalesce((
            SELECT json_agg(json_build_object('nivel', nv.nivel,
                                              'monto', nv.monto_por_persona)
                            ORDER BY nv.nivel)
              FROM public.promocion_nivel nv WHERE nv.promocion_id = p_id), '[]'::json),
        'umbrales', coalesce((
            SELECT json_agg(json_build_object('nivel', nu.nivel,
                                              'branch_id', nu.branch_id,
                                              'umbral', nu.umbral_venta)
                            ORDER BY nu.branch_id, nu.nivel)
              FROM public.promocion_nivel_umbral nu WHERE nu.promocion_id = p_id), '[]'::json),
        'salas',       coalesce(v_salas, '[]'::json),
        'venta_total', coalesce((SELECT sum((s ->> 'venta')::numeric)
                                   FROM json_array_elements(coalesce(v_salas,'[]'::json)) s), 0),
        'costo_total', coalesce((SELECT sum((s ->> 'costo')::numeric)
                                   FROM json_array_elements(coalesce(v_salas,'[]'::json)) s), 0),
        'personas_pagadas', coalesce((SELECT sum((s ->> 'personas')::int)
                                        FROM json_array_elements(coalesce(v_salas,'[]'::json)) s
                                       WHERE (s ->> 'nivel') IS NOT NULL), 0)
    );
END;
$function$;
