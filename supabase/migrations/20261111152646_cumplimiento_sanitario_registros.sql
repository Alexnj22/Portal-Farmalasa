-- Cumplimiento sanitario (2026-11-11, auditoría de sucursales).
--
-- Los registros que la norma pide y el portal no llevaba, en UNA tabla con un
-- `tipo` y sus campos en `datos`. Qué campos son obligatorios por tipo lo dice
-- `cumplimiento_requeridos` (gemela de `TIPOS` en src/utils/cumplimiento.js):
--   farmacovigilancia  NT FV Art. 18, 24.2, 28.2 (plazos 30/15 días, 72 h muerte)
--   reporte_cero       RTS 11.02.04:24 §6.3.6; Guía BPFV 4.6.11 (semestral)
--   vencido            RTS §6.6.7-6.6.8; Guía BPAD 6.1-6.3, 3.8
--   destruccion        Instructivo SRS §6.2.4 (aviso 72 h antes; certificado)
--   retiro             RTS §6.1.11, §6.6.4; Instructivo SRS §6.2
--   autoinspeccion     RTS §5.15 (anual, informe y plan de acción); Guía BPAD
--   a_la_vista         RGLM Art. 46; RTS §6.1.2, 6.2.3, 6.2.5, 6.3.5
--   capacitacion       RTS §6.3.2-6.3.4 (programa anual, registro y evaluación)
-- Nada se borra: se anula con motivo. La firma y el sello van en el papel que
-- imprime cada registro (mismo criterio que la asistencia del regente).
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.cumplimiento_registros (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id       bigint NOT NULL REFERENCES public.branches(id),
    tipo            text   NOT NULL CHECK (tipo IN ('farmacovigilancia','reporte_cero','vencido','destruccion',
                                                    'retiro','autoinspeccion','a_la_vista','capacitacion')),
    fecha           date   NOT NULL,
    datos           jsonb  NOT NULL DEFAULT '{}'::jsonb,
    estado          text   NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
    vence_el        date,
    registrado_por  uuid   REFERENCES public.employees(id),
    cerrado_por     uuid   REFERENCES public.employees(id),
    cerrado_at      timestamptz,
    anulado_por     uuid   REFERENCES public.employees(id),
    anulado_at      timestamptz,
    anulado_motivo  text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cumplimiento_registros_sala_tipo ON public.cumplimiento_registros (branch_id, tipo, fecha DESC);
CREATE INDEX IF NOT EXISTS cumplimiento_registros_abiertos ON public.cumplimiento_registros (tipo, vence_el)
    WHERE estado = 'abierto' AND anulado_at IS NULL;

ALTER TABLE public.cumplimiento_registros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bloqueo_global ON public.cumplimiento_registros;
CREATE POLICY bloqueo_global ON public.cumplimiento_registros AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.auth_no_bloqueado()));
DROP POLICY IF EXISTS cumplimiento_registros_select ON public.cumplimiento_registros;
CREATE POLICY cumplimiento_registros_select ON public.cumplimiento_registros FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('cumplimiento', 'can_view'))
           AND ((SELECT public.auth_module_scope('cumplimiento')) = 'ALL'
                OR branch_id = (SELECT public.auth_employee_branch_id())));
REVOKE ALL ON public.cumplimiento_registros FROM anon;
GRANT SELECT ON public.cumplimiento_registros TO authenticated;

-- La pestaña que gobierna cada tipo.
CREATE OR REPLACE FUNCTION public.cumplimiento_pestana(p_tipo text)
 RETURNS text LANGUAGE sql IMMUTABLE
 SET search_path = public, extensions
AS $function$
  SELECT 'cumplimiento_tab_' || CASE p_tipo
    WHEN 'reporte_cero' THEN 'farmacovigilancia'
    WHEN 'destruccion'  THEN 'vencidos'
    WHEN 'vencido'      THEN 'vencidos'
    WHEN 'retiro'       THEN 'retiros'
    WHEN 'a_la_vista'   THEN 'autoinspeccion'
    ELSE p_tipo END;
$function$;

-- Campos obligatorios por tipo (gemela de `TIPOS` en src/utils/cumplimiento.js).
CREATE OR REPLACE FUNCTION public.cumplimiento_requeridos(p_tipo text)
 RETURNS text[] LANGUAGE sql IMMUTABLE
 SET search_path = public, extensions
AS $function$
  SELECT CASE p_tipo
    WHEN 'farmacovigilancia' THEN ARRAY['paciente','producto','reaccion','gravedad','detectada_el','notificador']
    WHEN 'reporte_cero'      THEN ARRAY['periodo']
    WHEN 'vencido'           THEN ARRAY['producto','lote','vence','cantidad','motivo']
    WHEN 'destruccion'       THEN ARRAY['lugar','gestora','productos']
    WHEN 'retiro'            THEN ARRAY['alerta','fuente','producto','lote']
    WHEN 'autoinspeccion'    THEN ARRAY['guia','respuestas']
    WHEN 'a_la_vista'        THEN ARRAY['respuestas']
    WHEN 'capacitacion'      THEN ARRAY['tema','facilitador','asistentes']
    ELSE NULL END;
$function$;

-- ¿Puede escribir este registro? Módulo + pestaña con can_edit, y la sala
-- dentro del alcance (ALL o la propia/elegida).
CREATE OR REPLACE FUNCTION public.cumplimiento_puede_escribir(p_tipo text, p_branch_id bigint)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
  SELECT public.auth_has_module_permission('cumplimiento', 'can_edit')
     AND public.auth_has_module_permission(public.cumplimiento_pestana(p_tipo), 'can_edit')
     AND (public.auth_module_scope('cumplimiento') = 'ALL'
          OR p_branch_id = public.auth_employee_branch_id()::bigint);
$function$;

-- El plazo de cada tipo: FV según gravedad; destrucción, el aviso a la SRS
-- 72 h (3 días) antes.
CREATE OR REPLACE FUNCTION public.cumplimiento_plazo(p_tipo text, p_fecha date, p_datos jsonb)
 RETURNS date LANGUAGE sql IMMUTABLE
 SET search_path = public, extensions
AS $function$
  SELECT CASE p_tipo
    WHEN 'farmacovigilancia' THEN (p_datos->>'detectada_el')::date + CASE p_datos->>'gravedad'
                                    WHEN 'muerte' THEN 3 WHEN 'grave' THEN 15 ELSE 30 END
    WHEN 'destruccion' THEN p_fecha - 3
    ELSE NULL END;
$function$;

CREATE OR REPLACE FUNCTION public.cumplimiento_guardar(
    p_id bigint, p_branch_id bigint, p_tipo text, p_fecha date, p_datos jsonb)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_yo     uuid := public.auth_employee_id();
  v_req    text[] := public.cumplimiento_requeridos(p_tipo);
  v_falta  text;
  v_actual public.cumplimiento_registros;
  v_id     bigint;
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  IF v_req IS NULL THEN RAISE EXCEPTION 'TIPO_INVALIDO'; END IF;
  IF p_fecha IS NULL OR p_fecha > (now() AT TIME ZONE 'America/El_Salvador')::date + 60 THEN
    RAISE EXCEPTION 'FECHA_INVALIDA' USING HINT = 'Revisa la fecha del registro.';
  END IF;
  IF NOT public.cumplimiento_puede_escribir(p_tipo, p_branch_id) THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'No puedes anotar este registro en esa sala.';
  END IF;
  SELECT k INTO v_falta FROM unnest(v_req) k
   WHERE NOT (coalesce(p_datos, '{}'::jsonb) ? k)
      OR p_datos->k IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb)
   LIMIT 1;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'FALTA_DATO' USING HINT = format('Falta completar: %s.', v_falta);
  END IF;
  IF p_tipo = 'farmacovigilancia' AND (p_datos->>'gravedad') NOT IN ('no_grave','grave','muerte') THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'La gravedad no es válida.';
  END IF;
  IF p_tipo = 'reporte_cero' AND EXISTS (
       SELECT 1 FROM public.cumplimiento_registros r
        WHERE r.branch_id = p_branch_id AND r.tipo = 'reporte_cero' AND r.anulado_at IS NULL
          AND r.datos->>'periodo' = p_datos->>'periodo' AND r.id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'DUPLICADO' USING HINT = 'Esa sala ya tiene el reporte cero de ese periodo.';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.cumplimiento_registros (branch_id, tipo, fecha, datos, vence_el, registrado_por)
    VALUES (p_branch_id, p_tipo, p_fecha, p_datos, public.cumplimiento_plazo(p_tipo, p_fecha, p_datos), v_yo)
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_actual FROM public.cumplimiento_registros WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
    IF v_actual.tipo <> p_tipo OR v_actual.branch_id <> p_branch_id THEN RAISE EXCEPTION 'NO_COINCIDE'; END IF;
    IF v_actual.anulado_at IS NOT NULL OR v_actual.estado = 'cerrado' THEN
      RAISE EXCEPTION 'CERRADO' USING HINT = 'Un registro cerrado o anulado ya no se edita.';
    END IF;
    UPDATE public.cumplimiento_registros
       SET fecha = p_fecha, datos = p_datos, vence_el = public.cumplimiento_plazo(p_tipo, p_fecha, p_datos),
           updated_at = now()
     WHERE id = p_id;
    v_id := p_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, branch_id, details)
  VALUES (v_yo, (SELECT e.name FROM public.employees e WHERE e.id = v_yo),
          CASE WHEN p_id IS NULL THEN 'CUMPLIMIENTO_NUEVO' ELSE 'CUMPLIMIENTO_EDITADO' END,
          v_id::text, 'ADMIN_PANEL', 'INFO', p_branch_id, jsonb_build_object('tipo', p_tipo, 'fecha', p_fecha));
  RETURN json_build_object('id', v_id);
END;
$function$;

-- Cerrar: la notificación hecha, la destrucción realizada, el retiro devuelto.
-- Lo que llega en p_datos se agrega a lo que ya tenía.
CREATE OR REPLACE FUNCTION public.cumplimiento_cerrar(p_id bigint, p_datos jsonb)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_yo uuid := public.auth_employee_id();
  v    public.cumplimiento_registros;
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  SELECT * INTO v FROM public.cumplimiento_registros WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.cumplimiento_puede_escribir(v.tipo, v.branch_id) THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'No puedes cerrar este registro.';
  END IF;
  IF v.anulado_at IS NOT NULL OR v.estado = 'cerrado' THEN RAISE EXCEPTION 'CERRADO'; END IF;
  IF v.tipo = 'farmacovigilancia' AND coalesce(p_datos->>'notificada_el', '') = '' THEN
    RAISE EXCEPTION 'FALTA_DATO' USING HINT = 'Anota la fecha en que se notificó al CNFV.';
  END IF;
  UPDATE public.cumplimiento_registros
     SET estado = 'cerrado', cerrado_por = v_yo, cerrado_at = now(),
         datos = datos || coalesce(p_datos, '{}'::jsonb), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, branch_id, details)
  VALUES (v_yo, (SELECT e.name FROM public.employees e WHERE e.id = v_yo), 'CUMPLIMIENTO_CERRADO', p_id::text,
          'ADMIN_PANEL', 'INFO', v.branch_id, jsonb_build_object('tipo', v.tipo));
  RETURN json_build_object('id', p_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cumplimiento_anular(p_id bigint, p_motivo text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_yo uuid := public.auth_employee_id();
  v    public.cumplimiento_registros;
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  IF coalesce(btrim(p_motivo), '') = '' THEN RAISE EXCEPTION 'SIN_MOTIVO' USING HINT = 'Escribe por qué se anula.'; END IF;
  SELECT * INTO v FROM public.cumplimiento_registros WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.cumplimiento_puede_escribir(v.tipo, v.branch_id) THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'No puedes anular este registro.';
  END IF;
  IF v.anulado_at IS NOT NULL THEN RAISE EXCEPTION 'YA_ANULADO'; END IF;
  UPDATE public.cumplimiento_registros
     SET anulado_at = now(), anulado_por = v_yo, anulado_motivo = btrim(p_motivo), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, branch_id, details)
  VALUES (v_yo, (SELECT e.name FROM public.employees e WHERE e.id = v_yo), 'CUMPLIMIENTO_ANULADO', p_id::text,
          'ADMIN_PANEL', 'WARNING', v.branch_id, jsonb_build_object('tipo', v.tipo, 'motivo', btrim(p_motivo)));
  RETURN json_build_object('id', p_id);
END;
$function$;

-- Un retiro de lote que avisa la SRS o el laboratorio se anota UNA vez y le
-- llega a cada sala, que después dice cuánto tenía y si lo separó.
CREATE OR REPLACE FUNCTION public.cumplimiento_retiro_a_todas(p_fecha date, p_datos jsonb)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_yo uuid := public.auth_employee_id();
  v_n  integer;
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  IF NOT (public.auth_has_module_permission('cumplimiento_tab_retiros', 'can_edit')
          AND public.auth_module_scope('cumplimiento') = 'ALL') THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'Sólo quien ve toda la red avisa un retiro a todas las salas.';
  END IF;
  IF coalesce(p_datos->>'alerta', '') = '' OR coalesce(p_datos->>'producto', '') = '' OR coalesce(p_datos->>'lote', '') = ''
     OR coalesce(p_datos->>'fuente', '') = '' THEN
    RAISE EXCEPTION 'FALTA_DATO' USING HINT = 'Completa alerta, fuente, producto y lote.';
  END IF;
  INSERT INTO public.cumplimiento_registros (branch_id, tipo, fecha, datos, registrado_por)
  SELECT b.id, 'retiro', p_fecha, p_datos, v_yo
    FROM public.branches b WHERE b.type IN ('FARMACIA', 'BODEGA');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, details)
  VALUES (v_yo, (SELECT e.name FROM public.employees e WHERE e.id = v_yo), 'CUMPLIMIENTO_RETIRO_A_TODAS',
          p_datos->>'alerta', 'ADMIN_PANEL', 'WARNING', jsonb_build_object('salas', v_n, 'lote', p_datos->>'lote'));
  RETURN json_build_object('salas', v_n);
END;
$function$;

-- Los registros de un tipo (o varios) en un rango, como un solo JSON.
CREATE OR REPLACE FUNCTION public.cumplimiento_lista(p_tipos text[], p_branch_id bigint, p_desde date, p_hasta date)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_todas boolean;
BEGIN
  IF NOT public.auth_has_module_permission('cumplimiento', 'can_view') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  v_todas := public.auth_module_scope('cumplimiento') = 'ALL';
  IF NOT v_todas AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'Esa sucursal no es la tuya.';
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
             'id', r.id, 'branch_id', r.branch_id, 'sala', b.name, 'tipo', r.tipo, 'fecha', r.fecha,
             'datos', r.datos, 'estado', r.estado, 'vence_el', r.vence_el,
             'registrado_por', r.registrado_por, 'registrado_por_nombre', er.name,
             'cerrado_por_nombre', ec.name, 'cerrado_at', r.cerrado_at,
             'anulado_at', r.anulado_at, 'anulado_motivo', r.anulado_motivo, 'created_at', r.created_at)
           ORDER BY r.fecha DESC, r.id DESC)
      FROM public.cumplimiento_registros r
      JOIN public.branches b ON b.id = r.branch_id
      LEFT JOIN public.employees er ON er.id = r.registrado_por
      LEFT JOIN public.employees ec ON ec.id = r.cerrado_por
     WHERE r.tipo = ANY (p_tipos)
       AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
       AND (v_todas OR r.branch_id = public.auth_employee_branch_id())
       AND r.fecha >= coalesce(p_desde, '1900-01-01') AND r.fecha <= coalesce(p_hasta, '2999-12-31')), '[]'::json);
END;
$function$;

-- El tablero: por sala, lo que está al día y lo que no.
CREATE OR REPLACE FUNCTION public.cumplimiento_resumen()
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_hoy   date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_todas boolean;
  v_sem   text;
BEGIN
  IF NOT public.auth_has_module_permission('cumplimiento', 'can_view') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  v_todas := public.auth_module_scope('cumplimiento') = 'ALL';
  -- El semestre que ya cerró (el que se reporta).
  v_sem := CASE WHEN extract(month FROM v_hoy) <= 6
                THEN (extract(year FROM v_hoy)::int - 1)::text || '-S2'
                ELSE extract(year FROM v_hoy)::int::text || '-S1' END;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'branch_id', b.id, 'sala', b.name, 'tipo_sala', b.type,
      'fv_abiertas', (SELECT count(*) FROM public.cumplimiento_registros r WHERE r.branch_id = b.id
                        AND r.tipo = 'farmacovigilancia' AND r.estado = 'abierto' AND r.anulado_at IS NULL),
      'fv_vencidas', (SELECT count(*) FROM public.cumplimiento_registros r WHERE r.branch_id = b.id
                        AND r.tipo = 'farmacovigilancia' AND r.estado = 'abierto' AND r.anulado_at IS NULL
                        AND r.vence_el < v_hoy),
      'fv_semestre', v_sem,
      'fv_semestre_cubierto', EXISTS (SELECT 1 FROM public.cumplimiento_registros r WHERE r.branch_id = b.id
                        AND r.anulado_at IS NULL AND (
                          (r.tipo = 'reporte_cero' AND r.datos->>'periodo' = v_sem)
                          OR (r.tipo = 'farmacovigilancia' AND to_char(r.fecha, 'YYYY') || '-S' ||
                              CASE WHEN extract(month FROM r.fecha) <= 6 THEN '1' ELSE '2' END = v_sem))),
      'vencidos_por_destruir', (SELECT count(*) FROM public.cumplimiento_registros r WHERE r.branch_id = b.id
                        AND r.tipo = 'vencido' AND r.estado = 'abierto' AND r.anulado_at IS NULL),
      'retiros_abiertos', (SELECT count(*) FROM public.cumplimiento_registros r WHERE r.branch_id = b.id
                        AND r.tipo = 'retiro' AND r.estado = 'abierto' AND r.anulado_at IS NULL),
      'ultima_autoinspeccion', (SELECT max(r.fecha) FROM public.cumplimiento_registros r WHERE r.branch_id = b.id
                        AND r.tipo = 'autoinspeccion' AND r.anulado_at IS NULL),
      'ultima_revision_a_la_vista', (SELECT max(r.fecha) FROM public.cumplimiento_registros r WHERE r.branch_id = b.id
                        AND r.tipo = 'a_la_vista' AND r.anulado_at IS NULL),
      'capacitaciones_del_anio', (SELECT count(*) FROM public.cumplimiento_registros r WHERE r.branch_id = b.id
                        AND r.tipo = 'capacitacion' AND r.anulado_at IS NULL
                        AND r.fecha >= date_trunc('year', v_hoy)::date),
      'dependientes_sin_acreditacion', (SELECT count(*) FROM public.employees e
                        WHERE e.branch_id = b.id AND e.status ILIKE 'activ%'
                          AND e.role_id IN (30, 19, 20)  -- Dependiente, Jefe/a y Subjefe/a de Sala
                          AND NOT coalesce(e.tiene_acreditacion_dependiente, false))
    ) ORDER BY b.type DESC, b.name)
      FROM public.branches b
     WHERE b.type IN ('FARMACIA', 'BODEGA')
       AND (v_todas OR b.id = public.auth_employee_branch_id())), '[]'::json);
END;
$function$;

-- Quién atiende el mostrador en una sala y si tiene su acreditación
-- (RTS §6.3.1: acreditación vigente de la autoridad).
CREATE OR REPLACE FUNCTION public.cumplimiento_dependientes(p_branch_id bigint)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
BEGIN
  IF NOT public.auth_has_module_permission('cumplimiento_tab_dependientes', 'can_view') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  IF public.auth_module_scope('cumplimiento') <> 'ALL' AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'Esa sucursal no es la tuya.';
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object('id', e.id, 'nombre', e.name, 'cargo', ro.name, 'foto', e.photo_url,
                                      'acreditado', coalesce(e.tiene_acreditacion_dependiente, false),
                                      'carne', e.carne_dependiente_url IS NOT NULL)
                    ORDER BY coalesce(e.tiene_acreditacion_dependiente, false), e.name)
      FROM public.employees e JOIN public.roles ro ON ro.id = e.role_id
     WHERE e.branch_id = p_branch_id AND e.status ILIKE 'activ%'
       AND e.role_id IN (30, 19, 20, 41)), '[]'::json);  -- + Practicante
END;
$function$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'cumplimiento_pestana(text)', 'cumplimiento_requeridos(text)', 'cumplimiento_puede_escribir(text, bigint)',
    'cumplimiento_plazo(text, date, jsonb)', 'cumplimiento_guardar(bigint, bigint, text, date, jsonb)',
    'cumplimiento_cerrar(bigint, jsonb)', 'cumplimiento_anular(bigint, text)',
    'cumplimiento_retiro_a_todas(date, jsonb)', 'cumplimiento_lista(text[], bigint, date, date)',
    'cumplimiento_resumen()', 'cumplimiento_dependientes(bigint)']
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- Permisos. Administración: todo, toda la red. Regente y referente: su sala
-- (la que eligen), escriben farmacovigilancia, vencidos, retiros,
-- autoinspección y capacitación. Jefatura de sala: su sala; anota vencidos,
-- retiros y sospechas de reacción adversa (el referente las notifica). Bodega:
-- vencidos y retiros de su bodega.
WITH p(role_id, module_key, can_view, can_edit, scope) AS (
  SELECT r, m, true, true, 'ALL' FROM unnest(ARRAY[2, 3, 11, 13, 33]) r,
    unnest(ARRAY['cumplimiento','cumplimiento_tab_resumen','cumplimiento_tab_vencimientos','cumplimiento_tab_farmacovigilancia',
                 'cumplimiento_tab_vencidos','cumplimiento_tab_retiros','cumplimiento_tab_autoinspeccion',
                 'cumplimiento_tab_capacitacion','cumplimiento_tab_dependientes']) m
  UNION ALL
  SELECT r, m, true, m <> 'cumplimiento_tab_dependientes' AND m <> 'cumplimiento_tab_resumen', 'BRANCH'
    FROM unnest(ARRAY[8, 9]) r,
    unnest(ARRAY['cumplimiento','cumplimiento_tab_resumen','cumplimiento_tab_farmacovigilancia','cumplimiento_tab_vencidos',
                 'cumplimiento_tab_retiros','cumplimiento_tab_autoinspeccion','cumplimiento_tab_capacitacion',
                 'cumplimiento_tab_dependientes']) m
  UNION ALL
  SELECT r, m, true, m IN ('cumplimiento','cumplimiento_tab_farmacovigilancia','cumplimiento_tab_vencidos','cumplimiento_tab_retiros'), 'BRANCH'
    FROM unnest(ARRAY[19, 20]) r,
    unnest(ARRAY['cumplimiento','cumplimiento_tab_resumen','cumplimiento_tab_farmacovigilancia','cumplimiento_tab_vencidos',
                 'cumplimiento_tab_retiros','cumplimiento_tab_autoinspeccion','cumplimiento_tab_capacitacion',
                 'cumplimiento_tab_dependientes']) m
  UNION ALL
  SELECT r, m, true, m IN ('cumplimiento','cumplimiento_tab_vencidos','cumplimiento_tab_retiros'), 'BRANCH'
    FROM unnest(ARRAY[12, 15]) r,
    unnest(ARRAY['cumplimiento','cumplimiento_tab_resumen','cumplimiento_tab_vencidos','cumplimiento_tab_retiros',
                 'cumplimiento_tab_autoinspeccion']) m
)
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, scope)
SELECT p.role_id, p.module_key, p.can_view, p.can_edit, p.scope FROM p
  JOIN public.roles ro ON ro.id = p.role_id
ON CONFLICT (role_id, module_key) DO NOTHING;
