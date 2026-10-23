-- Metas: quien cubre en otra sala cobra el bono de ESA sala (decisión del
-- usuario, 2026-10-23): «el vendedor puede tener bonos de varias salas si
-- cubrió: de base está en Salud 3 (no llegaron a la meta) pero cubrió 5 días
-- en Salud 1 (sí llegaron): ganará bono».
--
-- El padrón de una sala ahora es: su gente de base ese mes (activa, o que
-- vendió) MÁS toda persona que vendió en la sala ese mes aunque su base sea
-- otra. Cada quien entra al reparto del equipo con lo que vendió AHÍ; la parte
-- de jefatura sigue siendo sólo de la jefatura de base de la sala (una jefa que
-- cubre otra sala entra como equipo con su venta). Antes esa venta caía en
-- «venta de otra sala» y su parte del bono se perdía.
--
-- metas_bono_persona ya es UNIQUE (year_month, branch_id, employee_id): una
-- persona puede tener una fila por cada sala donde ganó.
-- Definición viva (segunda_a2_01, aplicada hoy); sólo cambia el padrón.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.bono_meta_sala_interno(p_branch_id bigint, p_year_month text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch bigint;
    v_ini    date;
    v_fin    date;
    v_cfg    record;
    v_meta   numeric;
    v_estado text;
    v_venta  numeric;
    v_pct    numeric;
    v_tramo  text;
    v_tasa   numeric;
    v_bolsa  numeric;
    v_personas json;
    v_venta_jefes    numeric;
    v_venta_conocida numeric;
    v_venta_sin_codigo numeric;
    v_venta_otra_sala  numeric;
    v_pagado numeric;
    v_es_mes_actual boolean;
    v_proyeccion    numeric;
    v_pct_proy      numeric;
    v_tramo_proy    text;
    v_bolsa_proy    numeric;
    v_np_total      numeric;
    v_np_facturas   int;
    v_padron        uuid[];
BEGIN
    v_branch := p_branch_id;
    IF v_branch IS NULL THEN
        RETURN NULL;
    END IF;

    v_ini := (p_year_month || '-01')::date;
    v_fin := (v_ini + interval '1 month' - interval '1 day')::date;
    v_es_mes_actual := p_year_month
        = to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');

    SELECT * INTO v_cfg FROM public.metas_config LIMIT 1;

    SELECT m.monto_meta, m.estado INTO v_meta, v_estado
    FROM public.metas_sucursal m
    WHERE m.branch_id = v_branch AND m.year_month = p_year_month;

    SELECT coalesce(sum(v.total::numeric), 0), count(*)::int
      INTO v_np_total, v_np_facturas
    FROM public.ventas_sin_producto v
    WHERE v.branch_id = v_branch AND v.fecha BETWEEN v_ini AND v_fin;

    SELECT coalesce(sum(si.total::numeric), 0) INTO v_venta
    FROM public.sales_invoices si
    WHERE si.branch_id = v_branch
      AND si.fecha BETWEEN v_ini AND v_fin
      AND public.venta_valida(si.estado)
      AND NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v WHERE v.invoice_id = si.id);

    v_pct := CASE WHEN v_meta > 0 THEN round(v_venta / v_meta * 100, 2) END;

    v_tramo := CASE
        WHEN v_meta IS NULL OR v_meta <= 0 THEN NULL
        WHEN v_venta / v_meta * 100 >= v_cfg.umbral_bono_total THEN 'completo'
        WHEN v_venta / v_meta * 100 >= v_cfg.umbral_bono_medio THEN 'medio'
        ELSE 'nada' END;

    v_tasa := CASE v_tramo
        WHEN 'completo' THEN v_cfg.bono_pct_venta
        WHEN 'medio'    THEN round(v_cfg.bono_pct_venta * v_cfg.pago_medio_pct / 100, 6)
        ELSE 0 END;

    v_bolsa := round(v_venta * coalesce(v_tasa, 0) / 100, 2);

    IF v_es_mes_actual THEN
        SELECT d.proyeccion INTO v_proyeccion
        FROM public.get_metas_dashboard(p_year_month) d
        WHERE d.branch_id = v_branch;

        IF v_proyeccion IS NOT NULL AND v_meta > 0 THEN
            v_pct_proy := round(v_proyeccion / v_meta * 100, 2);
            v_tramo_proy := CASE
                WHEN v_proyeccion / v_meta * 100 >= v_cfg.umbral_bono_total THEN 'completo'
                WHEN v_proyeccion / v_meta * 100 >= v_cfg.umbral_bono_medio THEN 'medio'
                ELSE 'nada' END;
            v_bolsa_proy := round(v_proyeccion * CASE v_tramo_proy
                WHEN 'completo' THEN v_cfg.bono_pct_venta
                WHEN 'medio'    THEN round(v_cfg.bono_pct_venta * v_cfg.pago_medio_pct / 100, 6)
                ELSE 0 END / 100, 2);
        END IF;
    END IF;

    SELECT json_agg(to_json(x) ORDER BY x.venta DESC, x.nombre) INTO v_personas
    FROM (
        WITH ventas AS (
            SELECT si.cod_vendedor AS code, sum(si.total::numeric) AS venta
            FROM public.sales_invoices si
            WHERE si.branch_id = v_branch
              AND si.fecha BETWEEN v_ini AND v_fin
              AND public.venta_valida(si.estado)
              AND NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v WHERE v.invoice_id = si.id)
            GROUP BY si.cod_vendedor
        ),
        padron AS (
            SELECT e.id, e.code, e.name, r.name AS rol,
                   -- La jefatura cobra la cuarta parte sólo en su sala de base;
                   -- cubriendo otra sala entra como equipo con lo que vendió ahí.
                   (r.name = 'Jefe/a de Sala' AND s.sala_del_mes = v_branch) AS es_jefe,
                   (e.hire_date IS NOT NULL
                    AND e.hire_date > (v_fin - interval '3 months')) AS en_prueba,
                   coalesce(v.venta, 0) AS venta
            FROM public.employees e
            JOIN public.roles r ON r.id = e.role_id
            LEFT JOIN ventas v ON v.code = e.code
            CROSS JOIN LATERAL (
                SELECT coalesce((
                    SELECT (ev.metadata -> 'previousValues' ->> 'branch_id')::bigint
                      FROM public.employee_events ev
                     WHERE ev.employee_id = e.id
                       AND ev.type = 'TRANSFER'
                       AND ev.metadata ->> 'applyStatus' = 'APPLIED'
                       AND ev.metadata -> 'previousValues' ? 'branch_id'
                       AND coalesce(ev.date, (ev.metadata ->> 'date')::date) > v_fin
                     ORDER BY coalesce(ev.date, (ev.metadata ->> 'date')::date), ev.created_at
                     LIMIT 1), e.branch_id) AS sala_del_mes
            ) s
            -- Su gente de base ese mes, más quien vendió ahí cubriendo.
            WHERE (s.sala_del_mes = v_branch
                   AND (e.status = 'ACTIVO' OR coalesce(v.venta, 0) > 0))
               OR coalesce(v.venta, 0) > 0
        ),
        tot AS (
            SELECT coalesce(sum(p.venta) FILTER (WHERE p.es_jefe), 0) AS venta_jefes,
                   count(*) FILTER (WHERE p.es_jefe)                  AS n_jefes
            FROM padron p
        )
        SELECT
            p.id AS employee_id, p.code, p.name AS nombre, p.rol,
            p.es_jefe, p.en_prueba,
            round(p.venta, 2) AS venta,
            CASE WHEN v_venta > 0 THEN round(p.venta / v_venta * 100, 2) END AS pct_venta,
            b.bruto AS bono_bruto,
            CASE WHEN p.en_prueba THEN round(b.bruto * 0.5, 2) ELSE b.bruto END AS bono,
            CASE
                WHEN v_bolsa_proy IS NULL THEN NULL
                WHEN p.es_jefe THEN round(v_bolsa_proy / 4 / GREATEST(1, t.n_jefes), 2)
                                    * CASE WHEN p.en_prueba THEN 0.5 ELSE 1 END
                WHEN (v_venta - t.venta_jefes) > 0
                    THEN round(p.venta / (v_venta - t.venta_jefes) * (v_bolsa_proy * 0.75), 2)
                         * CASE WHEN p.en_prueba THEN 0.5 ELSE 1 END
                ELSE 0
            END AS bono_proyectado
        FROM padron p
        CROSS JOIN tot t
        CROSS JOIN LATERAL (
            SELECT CASE
                WHEN p.es_jefe THEN round(v_bolsa / 4 / GREATEST(1, t.n_jefes), 2)
                WHEN (v_venta - t.venta_jefes) > 0
                    THEN round(p.venta / (v_venta - t.venta_jefes) * (v_bolsa * 0.75), 2)
                ELSE 0
            END AS bruto
        ) b
    ) x;

    SELECT coalesce(sum((p ->> 'bono')::numeric), 0),
           coalesce(sum((p ->> 'venta')::numeric), 0),
           coalesce(sum((p ->> 'venta')::numeric) FILTER (WHERE (p ->> 'es_jefe')::boolean), 0),
           coalesce(array_agg((p ->> 'employee_id')::uuid), '{}')
      INTO v_pagado, v_venta_conocida, v_venta_jefes, v_padron
    FROM json_array_elements(coalesce(v_personas, '[]'::json)) p;

    -- Con las coberturas dentro del padrón, «otra sala» queda en cero salvo una
    -- ficha que vendió sin estar en ningún lado (no debería pasar); se conserva
    -- la columna para que la pantalla lo muestre si ocurre.
    SELECT coalesce(sum(si.total::numeric)
                    FILTER (WHERE e.id IS NULL), 0),
           coalesce(sum(si.total::numeric)
                    FILTER (WHERE e.id IS NOT NULL AND NOT (e.id = ANY (v_padron))), 0)
      INTO v_venta_sin_codigo, v_venta_otra_sala
    FROM public.sales_invoices si
    LEFT JOIN public.employees e
           ON e.code = si.cod_vendedor
    WHERE si.branch_id = v_branch
      AND si.fecha BETWEEN v_ini AND v_fin
      AND public.venta_valida(si.estado)
      AND NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v WHERE v.invoice_id = si.id);

    RETURN json_build_object(
        'branch_id',      v_branch,
        'sala',           (SELECT b.name FROM public.branches b WHERE b.id = v_branch),
        'year_month',     p_year_month,
        'es_mes_actual',  v_es_mes_actual,
        'meta',           v_meta,
        'estado_meta',    v_estado,
        'venta',          round(v_venta, 2),
        'pct',            v_pct,
        'tramo',          v_tramo,
        'tasa_pct',       v_tasa,
        'bolsa',          v_bolsa,
        'bolsa_jefatura', round(v_bolsa / 4, 2),
        'bolsa_equipo',   round(v_bolsa * 0.75, 2),
        'proyeccion',       v_proyeccion,
        'pct_proyectado',   v_pct_proy,
        'tramo_proyectado', v_tramo_proy,
        'bolsa_proyectada', v_bolsa_proy,
        'base_reparto',   round(v_venta - v_venta_jefes, 2),
        'pagado',         round(v_pagado, 2),
        'no_pagado',      round(v_bolsa - v_pagado, 2),
        'venta_sin_dueno',           round(v_venta - v_venta_conocida, 2),
        'venta_codigo_inexistente',  round(v_venta_sin_codigo, 2),
        'venta_otra_sala',           round(v_venta_otra_sala, 2),
        'bonificaciones_activas', public.metas_bono_activo(p_year_month),
        'personas',       coalesce(v_personas, '[]'::json),
        'no_producto',          coalesce(v_np_total, 0),
        'no_producto_facturas', coalesce(v_np_facturas, 0)
    );
END;
$function$;
