SET lock_timeout = '5s';

-- El bono, proyectado al cierre del mes (pedido del usuario 2026-08-04).
-- El cumplimiento de hoy dice dónde va la sala; la proyección dice en cuánto
-- termina si sigue al mismo ritmo — que es lo que permite perseguir el bono en
-- vez de enterarse a fin de mes.
--
-- La proyección NO se recalcula acá: sale de `get_metas_dashboard` (perfil por
-- día de semana de las últimas 8 semanas), que es la única fuente del módulo.
-- El porcentaje proyectado sí se recalcula contra la meta que ya leyó esta
-- función, para que no discrepe con el `pct` de la misma respuesta.
--
-- Solo aplica al mes en curso: en un mes cerrado la proyección ES lo real, así
-- que los campos vienen en NULL y la pantalla no ofrece un futuro que ya pasó.
CREATE OR REPLACE FUNCTION public.get_bono_meta_sala(p_branch_id bigint, p_year_month text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
BEGIN
    IF NOT auth_has_module_permission('metas', 'can_view') THEN
        RETURN NULL;
    END IF;

    -- Scope BRANCH: solo su propia sala, el parámetro se ignora.
    IF auth_module_scope('metas') = 'ALL' THEN
        v_branch := p_branch_id;
    ELSE
        v_branch := auth_employee_branch_id();
    END IF;
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

    -- Venta de la sala en el mes. Misma fuente y mismos filtros de estado que
    -- el resto del módulo de ventas; cuadra con sales_daily_stats (verificado).
    SELECT coalesce(sum(si.total::numeric), 0) INTO v_venta
    FROM public.sales_invoices si
    WHERE si.branch_id = v_branch
      AND si.fecha BETWEEN v_ini AND v_fin
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH');

    v_pct := CASE WHEN v_meta > 0 THEN round(v_venta / v_meta * 100, 2) END;

    v_tramo := CASE
        WHEN v_meta IS NULL OR v_meta <= 0 THEN NULL
        WHEN v_pct >= v_cfg.umbral_bono_total THEN 'completo'
        WHEN v_pct >= v_cfg.umbral_bono_medio THEN 'medio'
        ELSE 'nada' END;

    v_tasa := CASE v_tramo
        WHEN 'completo' THEN v_cfg.bono_pct_venta
        WHEN 'medio'    THEN round(v_cfg.bono_pct_venta * v_cfg.pago_medio_pct / 100, 6)
        ELSE 0 END;

    v_bolsa := round(v_venta * coalesce(v_tasa, 0) / 100, 2);

    -- ── Proyección al cierre (solo el mes en curso) ─────────────────────────
    IF v_es_mes_actual THEN
        SELECT d.proyeccion INTO v_proyeccion
        FROM public.get_metas_dashboard(p_year_month) d
        WHERE d.branch_id = v_branch;

        IF v_proyeccion IS NOT NULL AND v_meta > 0 THEN
            v_pct_proy := round(v_proyeccion / v_meta * 100, 2);
            v_tramo_proy := CASE
                WHEN v_pct_proy >= v_cfg.umbral_bono_total THEN 'completo'
                WHEN v_pct_proy >= v_cfg.umbral_bono_medio THEN 'medio'
                ELSE 'nada' END;
            v_bolsa_proy := round(v_proyeccion * CASE v_tramo_proy
                WHEN 'completo' THEN v_cfg.bono_pct_venta
                WHEN 'medio'    THEN round(v_cfg.bono_pct_venta * v_cfg.pago_medio_pct / 100, 6)
                ELSE 0 END / 100, 2);
        END IF;
    END IF;

    -- El padrón: el personal ACTIVO de la sala, aunque haya vendido cero.
    SELECT json_agg(to_json(x) ORDER BY x.venta DESC, x.nombre) INTO v_personas
    FROM (
        WITH ventas AS (
            SELECT si.cod_vendedor AS code, sum(si.total::numeric) AS venta
            FROM public.sales_invoices si
            WHERE si.branch_id = v_branch
              AND si.fecha BETWEEN v_ini AND v_fin
              AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
            GROUP BY si.cod_vendedor
        ),
        padron AS (
            SELECT e.id, e.code, e.name, r.name AS rol,
                   (r.name = 'Jefe/a de Sala') AS es_jefe,
                   (e.hire_date IS NOT NULL
                    AND e.hire_date > (v_fin - interval '3 months')) AS en_prueba,
                   coalesce(v.venta, 0) AS venta
            FROM public.employees e
            JOIN public.roles r ON r.id = e.role_id
            LEFT JOIN ventas v ON v.code = e.code
            WHERE e.status = 'ACTIVO' AND e.branch_id = v_branch
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
            -- Lo mismo, pero con la bolsa proyectada: «si el mes cierra como va,
            -- te tocaría esto». NULL en un mes cerrado.
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
                -- La base del reparto es TODA la venta de la sala menos la de la
                -- jefatura: lo vendido sin dueño se queda adentro y su parte se
                -- pierde. Sacarlo del denominador repartiría esa plata entre los
                -- demás, que es justo lo que la regla NO hace.
                WHEN p.es_jefe THEN round(v_bolsa / 4 / GREATEST(1, t.n_jefes), 2)
                WHEN (v_venta - t.venta_jefes) > 0
                    THEN round(p.venta / (v_venta - t.venta_jefes) * (v_bolsa * 0.75), 2)
                ELSE 0
            END AS bruto
        ) b
    ) x;

    SELECT coalesce(sum((p ->> 'bono')::numeric), 0),
           coalesce(sum((p ->> 'venta')::numeric), 0),
           coalesce(sum((p ->> 'venta')::numeric) FILTER (WHERE (p ->> 'es_jefe')::boolean), 0)
      INTO v_pagado, v_venta_conocida, v_venta_jefes
    FROM json_array_elements(coalesce(v_personas, '[]'::json)) p;

    -- Las dos fugas, separadas: una es un código que no existe (error de
    -- digitación) y la otra es alguien registrado pero asignado a otra sala. Se
    -- muestran distintas porque se arreglan distinto — la primera corrigiendo
    -- la venta, la segunda con la cobertura de horarios cuando exista.
    SELECT coalesce(sum(si.total::numeric)
                    FILTER (WHERE e.id IS NULL), 0),
           coalesce(sum(si.total::numeric)
                    FILTER (WHERE e.id IS NOT NULL AND e.branch_id IS DISTINCT FROM v_branch), 0)
      INTO v_venta_sin_codigo, v_venta_otra_sala
    FROM public.sales_invoices si
    LEFT JOIN public.employees e
           ON e.code = si.cod_vendedor AND e.status = 'ACTIVO'
    WHERE si.branch_id = v_branch
      AND si.fecha BETWEEN v_ini AND v_fin
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH');

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
        'bonificaciones_activas', v_cfg.bonificaciones_activas,
        'personas',       coalesce(v_personas, '[]'::json)
    );
END;
$$;
