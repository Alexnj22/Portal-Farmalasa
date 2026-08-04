SET lock_timeout = '5s';

-- Bono por cumplimiento de meta — el cálculo completo (Fase 4).
-- Regla dictada por el usuario 2026-08-04, portada del Excel anterior:
--
--   bolsa = venta de la sala × bono_pct_venta        (si cumplió ≥ 100%)
--         = venta de la sala × bono_pct_venta × 50%  (si quedó entre 95% y 100%)
--         = 0                                        (debajo de 95%)
--   jefatura = bolsa / 4        — fijo, no depende de lo que vendió el jefe
--   equipo   = bolsa × 3/4      — repartido en proporción a lo vendido, con la
--                                 venta de la jefatura FUERA del denominador
--
-- Verificado contra el Excel de La Popular, julio 2026: bolsa $215.64
-- (43,127.94 × 0.5%), jefatura $53.91, y las partes de cada dependiente al
-- centavo ($41.14 / $15.18 / $45.24 / $34.46).
--
-- Dos cosas NO se reparten, se pierden — igual que en el Excel:
--   · la parte de las ventas cuyo código de vendedor no da con nadie de la sala;
--   · la mitad que no cobra quien está en período de prueba.
--
-- QUIÉN ENTRA AL REPARTO: el personal ACTIVO asignado a la sala. Una venta
-- registrada a nombre de alguien de OTRA sala no da bono acá — criterio del
-- usuario (2026-08-04): si no tenía turno en esta sala, lo más probable es que
-- sea un error de digitación del vendedor. El destino final es cruzarlo contra
-- la cobertura de horarios (el módulo se está terminando); hoy no se puede
-- (`schedule_coverage` está en cero, `attendance` también, los 14 `shifts`
-- tienen `branch_id` NULL y `timesheets` cubre 10 empleados), así que el proxy
-- es la asignación del empleado, que es el criterio conservador: nunca paga a
-- quien no corresponde.
-- La función devuelve las dos fugas por separado —`venta_codigo_inexistente` y
-- `venta_otra_sala`— para que se vea cuánto se pierde por cada motivo en lugar
-- de que desaparezca en un solo saco. En julio 2026 no es marginal: Salud 2
-- tuvo $11,875.48 vendidos por gente asignada a otra sala, el 26% de su mes.
ALTER TABLE public.metas_config
    ADD COLUMN IF NOT EXISTS bono_pct_venta numeric NOT NULL DEFAULT 0.5;

COMMENT ON COLUMN public.metas_config.bono_pct_venta IS
    'Porcentaje de la venta de la sala que forma la bolsa del bono de meta (0.5 = 0.5%). En el tramo medio se paga pago_medio_pct de esta bolsa.';

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
                   -- Provisional: se deriva de la fecha de ingreso, hoy cargada
                   -- en 3 de 50 empleados. Pendiente decidir si el período de
                   -- prueba se marca con un estado propio del empleado o se
                   -- completan las fechas — §12 del plan.
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
            CASE WHEN p.en_prueba THEN round(b.bruto * 0.5, 2) ELSE b.bruto END AS bono
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
        'meta',           v_meta,
        'estado_meta',    v_estado,
        'venta',          round(v_venta, 2),
        'pct',            v_pct,
        'tramo',          v_tramo,
        'tasa_pct',       v_tasa,
        'bolsa',          v_bolsa,
        'bolsa_jefatura', round(v_bolsa / 4, 2),
        'bolsa_equipo',   round(v_bolsa * 0.75, 2),
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

REVOKE EXECUTE ON FUNCTION public.get_bono_meta_sala(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bono_meta_sala(bigint, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_bono_meta_sala(bigint, text) IS
    'Bono de meta de una sala en un mes: bolsa (0.5% de la venta, mitad en el tramo 95-100), un cuarto para la jefatura y tres cuartos repartidos por venta con la jefatura fuera del denominador. Devuelve el detalle por persona. Valida metas.can_view y respeta el scope.';
