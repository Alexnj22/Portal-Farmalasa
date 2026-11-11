-- La asistencia del regente (2026-11-10, auditoría de sucursales).
--
-- Lo que exige la norma: el regente deja constancia de su presencia —fecha,
-- horario, actividades, firma y sello— y se conserva al menos 1 año
-- (RTS 11.02.04:24 §6.3.7 de consulta / 6.1.3 publicado; guía de verificación
-- BPAD de la SRS, ítem 2.23 MAYOR: si el regente no está, el inspector revisa
-- la bitácora). Las horas mínimas por categoría salen de la Guía del Regente
-- de la SRS: tercera 20 h al mes, segunda 30 h al mes, primera 40 h por semana.
-- Un regente puede tener varias salas mientras sus horarios no choquen: por eso
-- registrar una visita que se cruza con otra del mismo regente FALLA.
--
-- El regente anota desde Bitácoras (su módulo, alcance de toda la red). Las
-- escrituras van por funciones DEFINER; la tabla no tiene policies de escritura.
-- Es historial de negocio: no se purga y no se borra (se anula con motivo).
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.regencia_visitas (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id       bigint NOT NULL REFERENCES public.branches(id),
    regente_id      uuid   NOT NULL REFERENCES public.employees(id),
    fecha           date   NOT NULL,
    entrada         time   NOT NULL,
    salida          time   NOT NULL,
    horas           numeric(5,2) GENERATED ALWAYS AS (round((extract(epoch FROM (salida - entrada)) / 3600)::numeric, 2)) STORED,
    actividades     text[] NOT NULL DEFAULT '{}',
    notas           text,
    registrado_por  uuid   REFERENCES public.employees(id),
    anulada_at      timestamptz,
    anulada_por     uuid   REFERENCES public.employees(id),
    anulada_motivo  text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT regencia_visitas_salida_despues CHECK (salida > entrada)
);
CREATE INDEX IF NOT EXISTS regencia_visitas_sala_fecha ON public.regencia_visitas (branch_id, fecha);
CREATE INDEX IF NOT EXISTS regencia_visitas_regente_fecha ON public.regencia_visitas (regente_id, fecha);

ALTER TABLE public.regencia_visitas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bloqueo_global ON public.regencia_visitas;
CREATE POLICY bloqueo_global ON public.regencia_visitas AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.auth_no_bloqueado()));
DROP POLICY IF EXISTS regencia_visitas_select ON public.regencia_visitas;
CREATE POLICY regencia_visitas_select ON public.regencia_visitas FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('bitacoras_tab_regencia', 'can_view'))
           AND ((SELECT public.auth_module_scope('bitacoras_tab_regencia')) = 'ALL'
                OR branch_id = (SELECT public.auth_employee_branch_id())));
REVOKE ALL ON public.regencia_visitas FROM anon;
GRANT SELECT ON public.regencia_visitas TO authenticated;

-- Horas mínimas al mes por categoría SRS (gemela de `horasMinimasDeRegencia`
-- en src/utils/regencia.js).
CREATE OR REPLACE FUNCTION public.regencia_horas_minimas(p_categoria text)
 RETURNS integer LANGUAGE sql IMMUTABLE
 SET search_path = public, extensions
AS $function$
  SELECT CASE p_categoria WHEN '1' THEN 174 WHEN '2' THEN 30 WHEN '3' THEN 20 ELSE NULL END;
$function$;
REVOKE EXECUTE ON FUNCTION public.regencia_horas_minimas(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regencia_horas_minimas(text) TO authenticated, service_role;

-- La regencia de una sala y sus visitas del mes.
CREATE OR REPLACE FUNCTION public.regencia_de_sala(p_branch_id bigint, p_mes date)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_yo     uuid := public.auth_employee_id();
  v_legal  jsonb;
  v_desde  date := date_trunc('month', coalesce(p_mes, (now() AT TIME ZONE 'America/El_Salvador')::date))::date;
  v_hasta  date;
BEGIN
  IF NOT public.auth_has_module_permission('bitacoras_tab_regencia', 'can_view') THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'No tienes acceso a la regencia.';
  END IF;
  IF public.auth_module_scope('bitacoras_tab_regencia') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'Esa sucursal no es la tuya.';
  END IF;
  v_hasta := (v_desde + interval '1 month')::date;
  SELECT x.datos->'legal' INTO v_legal FROM public.sucursal_expediente x WHERE x.branch_id = p_branch_id;
  v_legal := coalesce(v_legal, '{}'::jsonb);

  RETURN json_build_object(
    'branch_id', p_branch_id,
    'sala', (SELECT b.name FROM public.branches b WHERE b.id = p_branch_id),
    'categoria', v_legal->>'srsCategoria',
    'minimo', public.regencia_horas_minimas(v_legal->>'srsCategoria'),
    'horas_contratadas', nullif(v_legal->>'regentHorasMes', '')::numeric,
    'horario', v_legal->>'regentHorario',
    'jvpqf', v_legal->>'regentJvpqf',
    'regente', (SELECT json_build_object('id', e.id, 'nombre', e.name, 'foto', e.photo_url)
                  FROM public.employees e WHERE e.id::text = v_legal->>'regentEmployeeId'),
    'referente', (SELECT json_build_object('id', e.id, 'nombre', e.name, 'foto', e.photo_url)
                    FROM public.employees e WHERE e.id::text = v_legal->>'pharmacovigilanceEmployeeId'),
    'soy_el_regente', v_yo IS NOT NULL AND v_yo::text = v_legal->>'regentEmployeeId',
    'mes', v_desde,
    'horas_registradas', coalesce((SELECT sum(v.horas) FROM public.regencia_visitas v
                                    WHERE v.branch_id = p_branch_id AND v.fecha >= v_desde AND v.fecha < v_hasta
                                      AND v.anulada_at IS NULL), 0),
    'visitas', coalesce((SELECT json_agg(json_build_object(
                  'id', v.id, 'fecha', v.fecha, 'entrada', v.entrada, 'salida', v.salida, 'horas', v.horas,
                  'actividades', v.actividades, 'notas', v.notas,
                  'regente_id', v.regente_id, 'regente', (SELECT e.name FROM public.employees e WHERE e.id = v.regente_id),
                  'registrado_por', v.registrado_por, 'registrado_por_nombre', (SELECT e.name FROM public.employees e WHERE e.id = v.registrado_por),
                  'anulada_at', v.anulada_at, 'anulada_motivo', v.anulada_motivo, 'created_at', v.created_at)
                  ORDER BY v.fecha DESC, v.entrada DESC)
                FROM public.regencia_visitas v
               WHERE v.branch_id = p_branch_id AND v.fecha >= v_desde AND v.fecha < v_hasta), '[]'::json)
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.regencia_de_sala(bigint, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regencia_de_sala(bigint, date) TO authenticated, service_role;

-- Registrar una visita. La anota el regente asignado a la sala, o alguien con
-- permiso de editar la regencia de toda la red (la carga en su nombre).
CREATE OR REPLACE FUNCTION public.regencia_registrar_visita(
    p_branch_id bigint, p_fecha date, p_entrada time, p_salida time, p_actividades text[], p_notas text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_yo       uuid := public.auth_employee_id();
  v_regente  uuid;
  v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_validas  text[] := ARRAY['controlados','recetas_antibioticos','vencidos','bitacoras','capacitacion',
                             'farmacovigilancia','autoinspeccion','recepcion','otro'];
  v_choque   record;
  v_id       bigint;
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  SELECT nullif(x.datos->'legal'->>'regentEmployeeId', '')::uuid INTO v_regente
    FROM public.sucursal_expediente x WHERE x.branch_id = p_branch_id;
  IF v_regente IS NULL THEN
    RAISE EXCEPTION 'SIN_REGENTE' USING HINT = 'Esta sala no tiene regente asignado en su expediente.';
  END IF;
  IF v_yo <> v_regente AND NOT (public.auth_has_module_permission('bitacoras_tab_regencia', 'can_edit')
                                AND public.auth_module_scope('bitacoras_tab_regencia') = 'ALL') THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'Sólo el regente de la sala anota sus visitas.';
  END IF;
  IF p_fecha IS NULL OR p_fecha > v_hoy THEN
    RAISE EXCEPTION 'FECHA_INVALIDA' USING HINT = 'La visita no puede ser de un día que no ha llegado.';
  END IF;
  IF p_fecha < v_hoy - 60 THEN
    RAISE EXCEPTION 'FECHA_INVALIDA' USING HINT = 'Sólo se anotan visitas de los últimos 60 días.';
  END IF;
  IF p_entrada IS NULL OR p_salida IS NULL OR p_salida <= p_entrada THEN
    RAISE EXCEPTION 'HORARIO_INVALIDO' USING HINT = 'La salida tiene que ser después de la entrada.';
  END IF;
  IF p_salida - p_entrada > interval '12 hours' THEN
    RAISE EXCEPTION 'HORARIO_INVALIDO' USING HINT = 'Una visita no puede pasar de 12 horas.';
  END IF;
  IF coalesce(array_length(p_actividades, 1), 0) = 0 THEN
    RAISE EXCEPTION 'SIN_ACTIVIDADES' USING HINT = 'Anota al menos una actividad realizada.';
  END IF;
  IF NOT (p_actividades <@ v_validas) THEN
    RAISE EXCEPTION 'ACTIVIDAD_INVALIDA';
  END IF;
  -- El mismo regente no puede estar en dos salas a la vez.
  SELECT v.fecha, v.entrada, v.salida, b.name AS sala INTO v_choque
    FROM public.regencia_visitas v JOIN public.branches b ON b.id = v.branch_id
   WHERE v.regente_id = v_regente AND v.fecha = p_fecha AND v.anulada_at IS NULL
     AND v.entrada < p_salida AND p_entrada < v.salida
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'CHOQUE_DE_HORARIO' USING HINT = format('Ese horario se cruza con la visita de %s a %s en %s.',
      to_char(v_choque.entrada, 'HH12:MI AM'), to_char(v_choque.salida, 'HH12:MI AM'), v_choque.sala);
  END IF;

  INSERT INTO public.regencia_visitas (branch_id, regente_id, fecha, entrada, salida, actividades, notas, registrado_por)
  VALUES (p_branch_id, v_regente, p_fecha, p_entrada, p_salida, p_actividades, nullif(btrim(p_notas), ''), v_yo)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, branch_id, details)
  VALUES (v_yo, (SELECT e.name FROM public.employees e WHERE e.id = v_yo), 'REGENCIA_VISITA', v_id::text, 'ADMIN_PANEL', 'INFO', p_branch_id,
          jsonb_build_object('regente_id', v_regente, 'fecha', p_fecha, 'entrada', p_entrada, 'salida', p_salida,
                             'actividades', p_actividades, 'en_su_nombre', v_yo <> v_regente));
  RETURN json_build_object('id', v_id);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.regencia_registrar_visita(bigint, date, time, time, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regencia_registrar_visita(bigint, date, time, time, text[], text) TO authenticated, service_role;

-- Anular una visita mal anotada: nunca se borra, queda con motivo y firma.
CREATE OR REPLACE FUNCTION public.regencia_anular_visita(p_id bigint, p_motivo text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_yo uuid := public.auth_employee_id();
  v    public.regencia_visitas;
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  IF coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'SIN_MOTIVO' USING HINT = 'Escribe por qué se anula.';
  END IF;
  SELECT * INTO v FROM public.regencia_visitas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF v.anulada_at IS NOT NULL THEN RAISE EXCEPTION 'YA_ANULADA'; END IF;
  IF NOT ((v_yo IN (v.regente_id, v.registrado_por) AND v.created_at > now() - interval '48 hours')
          OR (public.auth_has_module_permission('bitacoras_tab_regencia', 'can_edit')
              AND public.auth_module_scope('bitacoras_tab_regencia') = 'ALL')) THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'Pasadas 48 horas, sólo la administración anula una visita.';
  END IF;
  UPDATE public.regencia_visitas
     SET anulada_at = now(), anulada_por = v_yo, anulada_motivo = btrim(p_motivo)
   WHERE id = p_id;
  INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, branch_id, details)
  VALUES (v_yo, (SELECT e.name FROM public.employees e WHERE e.id = v_yo), 'REGENCIA_VISITA_ANULADA', p_id::text, 'ADMIN_PANEL', 'WARNING', v.branch_id,
          jsonb_build_object('motivo', btrim(p_motivo), 'fecha', v.fecha, 'regente_id', v.regente_id));
  RETURN json_build_object('id', p_id);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.regencia_anular_visita(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regencia_anular_visita(bigint, text) TO authenticated, service_role;

-- La pestaña: la ven la administración y los químicos farmacéuticos (toda la
-- red); la editan (cargar en nombre del regente, anular) sólo la administración.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, scope)
SELECT r.id, 'bitacoras_tab_regencia', true, r.id IN (2, 3, 11, 13, 33), 'ALL'
  FROM public.roles r WHERE r.id IN (2, 3, 11, 13, 33, 8, 9)
ON CONFLICT (role_id, module_key) DO NOTHING;
