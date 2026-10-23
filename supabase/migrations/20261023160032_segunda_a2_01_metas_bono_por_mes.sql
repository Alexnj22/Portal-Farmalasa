-- segunda-a2-01 · metas: el bono vale mes por mes (H16, H17, H18, H22)
-- H16 cada cambio del interruptor es una fila con el mes desde el que vale;
--     un mes lo decide la ÚLTIMA fila con desde_ym <= ese mes.
-- H17 se aprueba lo PAGABLE; sin ningún mes encendido, BONO_APAGADO.
-- H18 padrón = sala de la persona AL CIERRE del mes (traslados posteriores
--     deshechos) + quien ya no está activo pero vendió ese mes.
-- H22 el tramo se decide sobre el cociente sin redondear.
-- Definiciones VIVAS de producción (pg_get_functiondef, 2026-10-23).
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.metas_bono_interruptor (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    desde_ym     text NOT NULL CHECK (desde_ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    activo       boolean NOT NULL,
    hasta_ym     text CHECK (hasta_ym IS NULL OR hasta_ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    cambiado_por uuid REFERENCES public.employees(id),
    created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.metas_bono_interruptor IS
  'Historia del interruptor de bonificaciones de Metas: cada cambio vale desde su mes. Un mes lo decide la última fila con desde_ym <= ese mes (metas_bono_activo). Sólo la escribe set_bonificaciones_metas.';
CREATE INDEX IF NOT EXISTS metas_bono_interruptor_desde_idx ON public.metas_bono_interruptor (desde_ym, id);
ALTER TABLE public.metas_bono_interruptor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metas_bono_interruptor_select ON public.metas_bono_interruptor;
CREATE POLICY metas_bono_interruptor_select ON public.metas_bono_interruptor
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('metas', 'can_view')));
REVOKE ALL ON public.metas_bono_interruptor FROM anon;

INSERT INTO public.metas_bono_interruptor (desde_ym, activo, hasta_ym)
SELECT '2000-01', c.bonificaciones_activas, c.bonificaciones_hasta_ym
  FROM public.metas_config c
 WHERE NOT EXISTS (SELECT 1 FROM public.metas_bono_interruptor)
 LIMIT 1;

CREATE OR REPLACE FUNCTION public.metas_bono_activo(p_year_month text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce((
    SELECT i.activo AND (i.hasta_ym IS NULL OR p_year_month <= i.hasta_ym)
      FROM public.metas_bono_interruptor i
     WHERE i.desde_ym <= p_year_month
     ORDER BY i.desde_ym DESC, i.id DESC
     LIMIT 1
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.set_bonificaciones_metas(p_activas boolean, p_solo_este_mes boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ym text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
  v_activas boolean := coalesce(p_activas, false);
  v_hasta text;
BEGIN
  IF NOT public.auth_has_module_permission('metas', 'can_edit') THEN
    RAISE EXCEPTION 'Sin permiso para cambiar las bonificaciones';
  END IF;

  v_hasta := CASE WHEN v_activas AND coalesce(p_solo_este_mes, false) THEN v_ym END;

  UPDATE public.metas_config
     SET bonificaciones_activas  = v_activas,
         bonificaciones_hasta_ym = v_hasta;

  INSERT INTO public.metas_bono_interruptor (desde_ym, activo, hasta_ym, cambiado_por)
  VALUES (v_ym, v_activas, v_hasta, public.auth_employee_id());

  RETURN json_build_object(
    'bonificaciones_activas',  v_activas,
    'bonificaciones_hasta_ym', v_hasta,
    'vigente_este_mes',        public.metas_bono_activo(v_ym)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_bono_semestral(p_semestre text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
    v_meses     text[];
    v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
    v_sem       public.bono_semestre%ROWTYPE;
    v_meses_json json;
    v_personas  json;
BEGIN
    IF public.auth_employee_id() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('metas', 'can_view')
       OR public.auth_module_scope('metas') <> 'ALL' THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: el pago semestral exige ver las metas de todas las salas'
            USING ERRCODE = '42501';
    END IF;
    IF coalesce(p_semestre, '') !~ '^[0-9]{4}-S[12]$' THEN
        RAISE EXCEPTION 'SEMESTRE_INVALIDO: se escribe AAAA-S1 o AAAA-S2';
    END IF;

    v_meses := public.meses_del_semestre(p_semestre);
    SELECT * INTO v_sem FROM public.bono_semestre WHERE semestre = p_semestre;

    SELECT json_agg(json_build_object(
               'ym', m.ym,
               'estado', CASE WHEN EXISTS (SELECT 1 FROM public.metas_bono_persona f
                                            WHERE f.year_month = m.ym) THEN 'cerrado'
                              WHEN m.ym <= v_ym_actual THEN 'provisional'
                              ELSE 'futuro' END,
               'informativo', NOT public.metas_bono_activo(m.ym))
           ORDER BY m.ym)
      INTO v_meses_json
      FROM unnest(v_meses) m(ym);

    IF v_sem.estado = 'aprobado' THEN
        SELECT json_agg(json_build_object(
                   'employee_id', d.employee_id, 'nombre', e.name, 'code', e.code,
                   'status', d.status_al_aprobar, 'activo', d.status_al_aprobar = 'ACTIVO',
                   'salas', (SELECT json_agg(DISTINCT b.name) FROM public.metas_bono_persona f
                               JOIN public.branches b ON b.id = f.branch_id
                              WHERE f.employee_id = d.employee_id AND f.year_month = ANY (v_meses)
                                AND f.bono > 0),
                   'por_mes', d.por_mes, 'total', d.total, 'total_pagable', d.total, 'provisional', false,
                   'pagar', d.pagar,
                   'decision', (SELECT json_build_object('pagar', x.pagar, 'motivo', x.motivo,
                                        'por', pe.name, 'at', x.decidido_at)
                                  FROM public.bono_semestre_decision x
                                  JOIN public.employees pe ON pe.id = x.decidido_por
                                 WHERE x.semestre_id = v_sem.id AND x.employee_id = d.employee_id))
               ORDER BY d.total DESC, e.name)
          INTO v_personas
          FROM public.bono_semestre_detalle d
          JOIN public.employees e ON e.id = d.employee_id
         WHERE d.semestre_id = v_sem.id;
    ELSE
        WITH
        con_foto AS (
            SELECT DISTINCT f.year_month FROM public.metas_bono_persona f
             WHERE f.year_month = ANY (v_meses)
        ),
        filas AS (
            SELECT f.year_month AS ym, f.branch_id, f.employee_id, f.bono, false AS provisional
              FROM public.metas_bono_persona f
             WHERE f.year_month = ANY (v_meses) AND f.bono > 0
            UNION ALL
            SELECT m.ym, ms.branch_id, (p ->> 'employee_id')::uuid,
                   round(coalesce((p ->> 'bono')::numeric, 0), 2), true
              FROM unnest(v_meses) m(ym)
              JOIN public.metas_sucursal ms ON ms.year_month = m.ym
             CROSS JOIN LATERAL json_array_elements(
                       public.bono_meta_sala_interno(ms.branch_id, m.ym) -> 'personas') p
             WHERE m.ym <= v_ym_actual
               AND m.ym NOT IN (SELECT c.year_month FROM con_foto c)
               AND (p ->> 'employee_id') IS NOT NULL
               AND round(coalesce((p ->> 'bono')::numeric, 0), 2) > 0
        ),
        por_mes AS (
            SELECT employee_id, ym, sum(bono) AS bono, bool_or(provisional) AS provisional
              FROM filas GROUP BY employee_id, ym
        ),
        persona AS (
            SELECT pm.employee_id,
                   sum(pm.bono) AS total,
                   coalesce(sum(pm.bono) FILTER (WHERE public.metas_bono_activo(pm.ym)), 0) AS total_pagable,
                   bool_or(pm.provisional) AS provisional,
                   json_object_agg(pm.ym, pm.bono ORDER BY pm.ym) AS por_mes
              FROM por_mes pm GROUP BY pm.employee_id
        )
        SELECT json_agg(json_build_object(
                   'employee_id', p.employee_id, 'nombre', e.name, 'code', e.code,
                   'status', e.status, 'activo', e.status = 'ACTIVO',
                   'salas', (SELECT json_agg(DISTINCT b.name) FROM filas f
                               JOIN public.branches b ON b.id = f.branch_id
                              WHERE f.employee_id = p.employee_id),
                   'por_mes', p.por_mes, 'total', round(p.total, 2),
                   'total_pagable', round(p.total_pagable, 2),
                   'provisional', p.provisional,
                   'pagar', CASE WHEN e.status = 'ACTIVO' THEN true ELSE d.pagar END,
                   'decision', CASE WHEN d.id IS NULL THEN NULL ELSE
                       json_build_object('pagar', d.pagar, 'motivo', d.motivo,
                                         'por', pe.name, 'at', d.decidido_at) END)
               ORDER BY p.total DESC, e.name)
          INTO v_personas
          FROM persona p
          JOIN public.employees e ON e.id = p.employee_id
          LEFT JOIN public.bono_semestre_decision d
                 ON d.semestre_id = v_sem.id AND d.employee_id = p.employee_id
          LEFT JOIN public.employees pe ON pe.id = d.decidido_por;
    END IF;

    RETURN json_build_object(
        'semestre',     p_semestre,
        'meses',        v_meses_json,
        'estado',       coalesce(v_sem.estado, 'borrador'),
        'aprobado_por', (SELECT e.name FROM public.employees e WHERE e.id = v_sem.aprobado_por),
        'aprobado_at',  v_sem.aprobado_at,
        'nota',         v_sem.nota,
        'personas',     coalesce(v_personas, '[]'::json)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.aprobar_bono_semestral(p_semestre text, p_aprobar boolean DEFAULT true, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor  uuid := public.auth_employee_id();
    v_sem    public.bono_semestre%ROWTYPE;
    v_nota   text := nullif(btrim(coalesce(p_nota, '')), '');
    v_meses  text[];
    v_hoja   json;
    v_faltan int;
    v_sin    int;
    v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('metas', 'can_approve') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: aprobar el pago semestral es de gerencia'
            USING ERRCODE = '42501';
    END IF;
    IF coalesce(p_semestre, '') !~ '^[0-9]{4}-S[12]$' THEN
        RAISE EXCEPTION 'SEMESTRE_INVALIDO: se escribe AAAA-S1 o AAAA-S2';
    END IF;

    v_sem := public.bono_semestre_asegurar(p_semestre);
    v_meses := public.meses_del_semestre(p_semestre);

    IF NOT p_aprobar THEN
        IF v_sem.estado <> 'aprobado' THEN
            RETURN public.get_bono_semestral(p_semestre);
        END IF;
        IF v_nota IS NULL THEN
            RAISE EXCEPTION 'MOTIVO_REQUERIDO: reabrir un semestre aprobado necesita el motivo';
        END IF;
        DELETE FROM public.bono_semestre_detalle WHERE semestre_id = v_sem.id;
        UPDATE public.bono_semestre
           SET estado = 'borrador', aprobado_por = NULL, aprobado_at = NULL,
               nota = v_nota, updated_at = now()
         WHERE id = v_sem.id;
        INSERT INTO public.bono_semestre_historial (semestre_id, evento, nota, actor)
        VALUES (v_sem.id, 'reabierto', v_nota, v_actor);
        RETURN public.get_bono_semestral(p_semestre);
    END IF;

    IF v_sem.estado = 'aprobado' THEN
        RETURN public.get_bono_semestral(p_semestre);
    END IF;

    IF v_meses[6] >= v_ym_actual THEN
        RAISE EXCEPTION 'SEMESTRE_ABIERTO: % todavía no terminó', p_semestre;
    END IF;
    SELECT count(*) INTO v_faltan FROM unnest(v_meses) m(ym)
     WHERE NOT EXISTS (SELECT 1 FROM public.metas_bono_persona f WHERE f.year_month = m.ym);
    IF v_faltan > 0 THEN
        RAISE EXCEPTION 'MESES_SIN_CERRAR: faltan % mes(es) por cerrar; el cierre corre el día 5', v_faltan;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM unnest(v_meses) m(ym) WHERE public.metas_bono_activo(m.ym)) THEN
        RAISE EXCEPTION 'BONO_APAGADO: las bonificaciones estuvieron apagadas todo %; no hay montos que pagar', p_semestre;
    END IF;

    v_hoja := public.get_bono_semestral(p_semestre);

    SELECT count(*) INTO v_sin FROM json_array_elements(v_hoja -> 'personas') p
     WHERE NOT (p ->> 'activo')::boolean AND (p ->> 'decision') IS NULL
       AND coalesce((p ->> 'total_pagable')::numeric, 0) > 0;
    IF v_sin > 0 THEN
        RAISE EXCEPTION 'FALTAN_DECISIONES: % persona(s) que ya no trabajan esperan que se decida si cobran', v_sin;
    END IF;

    INSERT INTO public.bono_semestre_detalle
        (semestre_id, employee_id, total, pagar, status_al_aprobar, por_mes)
    SELECT v_sem.id, (p ->> 'employee_id')::uuid, coalesce((p ->> 'total_pagable')::numeric, 0),
           coalesce((p ->> 'pagar')::boolean, false), p ->> 'status', (p -> 'por_mes')::jsonb
      FROM json_array_elements(v_hoja -> 'personas') p;

    UPDATE public.bono_semestre
       SET estado = 'aprobado', aprobado_por = v_actor, aprobado_at = now(),
           nota = coalesce(v_nota, nota), updated_at = now()
     WHERE id = v_sem.id;

    INSERT INTO public.bono_semestre_historial (semestre_id, evento, valor, nota, actor)
    SELECT v_sem.id, 'aprobado',
           to_char(coalesce(sum(total) FILTER (WHERE pagar), 0), 'FM999999990.00'), v_nota, v_actor
      FROM public.bono_semestre_detalle WHERE semestre_id = v_sem.id;

    RETURN public.get_bono_semestral(p_semestre);
END;
$function$;

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
                   (r.name = 'Jefe/a de Sala') AS es_jefe,
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
            WHERE s.sala_del_mes = v_branch
              AND (e.status = 'ACTIVO' OR coalesce(v.venta, 0) > 0)
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
