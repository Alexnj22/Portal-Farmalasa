-- El cierre de la quincena con freno y aviso (2026-11-23).
--
-- «Talento Humano debe confirmar todo eso antes de cada 15 o fin de mes.» Lo
-- que espera a Talento Humano en una quincena son tres cosas, y mientras quede
-- una la quincena no se cierra:
--
--   · horas de más sin decidir si van a pago o al banco (CT Arts. 169/170,
--     `timesheets.extra_decision` NULL);
--   · semanas con el descanso en duda sin confirmar ni justificar (RIT Arts.
--     25 y 26, CT Art. 171; `descanso_semanal_decisiones`);
--   · marcaciones incompletas (`timesheets.status = 'INCOMPLETE'`).
--
-- `pendientes_de_quincena` es la UNA cuenta: la consulta la pantalla (portal y
-- app) antes de cerrar, la usa el freno de la escritura y la usa el aviso. La
-- regla del descanso es la de `semanasConDescansoEnDuda`
-- (`src/utils/reglasDePago.js`) escrita en la verdad de JavaScript: la semana
-- es de lunes a domingo, cuenta en la quincena donde cae su domingo, más de 10
-- minutos tarde sumando la semana o una ausencia sin tipo (`is_absent` con
-- `absence_type` nulo o vacío). Si se cambia una, se cambia la otra.
--
-- El freno vive en la base: un trigger de SENTENCIA sobre `timesheets` que
-- rechaza aprobar días de una persona con algo pendiente en esa quincena. Así
-- no importa quién escribe (el botón del portal, el de la app, el de aprobar a
-- una persona, o un UPDATE a mano). `timesheets` no es tabla caliente: la
-- consolidación está apagada y no la escribe ningún cron.
--
-- Y el concepto de las bonificaciones: la boleta de la empresa escribe en su
-- detalle el concepto de los viáticos Y de la bonificación (el bono por
-- venta). La planilla sólo guardaba el de los viáticos.
SET lock_timeout = '5s';

ALTER TABLE public.payroll_entries ADD COLUMN IF NOT EXISTS bonificaciones_detalle text;
COMMENT ON COLUMN public.payroll_entries.bonificaciones_detalle IS
  'Concepto de las bonificaciones (p. ej. bono por venta). Sale en la boleta junto al de los viáticos.';

CREATE OR REPLACE FUNCTION public.pendientes_de_quincena(
  p_desde date, p_hasta date, p_employee_ids uuid[] DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_extra  integer;
  v_inc    integer;
  v_desc   integer;
BEGIN
  SELECT count(*) INTO v_extra
    FROM public.timesheets t
   WHERE t.work_date BETWEEN p_desde AND p_hasta
     AND coalesce(t.overtime_hours, 0) > 0
     AND t.extra_decision IS NULL
     AND (p_employee_ids IS NULL OR t.employee_id = ANY (p_employee_ids));

  SELECT count(*) INTO v_inc
    FROM public.timesheets t
   WHERE t.work_date BETWEEN p_desde AND p_hasta
     AND t.status = 'INCOMPLETE'
     AND (p_employee_ids IS NULL OR t.employee_id = ANY (p_employee_ids));

  -- Las semanas cuyo domingo cae en la quincena: se leen desde su lunes.
  SELECT count(*) INTO v_desc
    FROM (
      SELECT t.employee_id,
             (t.work_date - ((extract(isodow FROM t.work_date)::int - 1)))::date AS semana,
             sum(coalesce(t.late_minutes, 0)) AS tarde,
             bool_or(coalesce(t.is_absent, false) AND coalesce(t.absence_type, '') = '') AS incompleta
        FROM public.timesheets t
       WHERE t.work_date BETWEEN (p_desde - ((extract(isodow FROM p_desde)::int - 1))) AND p_hasta
         AND (p_employee_ids IS NULL OR t.employee_id = ANY (p_employee_ids))
       GROUP BY 1, 2
    ) s
   WHERE (s.semana + 6) BETWEEN p_desde AND p_hasta
     AND (s.tarde > 10 OR s.incompleta)
     AND NOT EXISTS (SELECT 1 FROM public.descanso_semanal_decisiones d
                      WHERE d.employee_id = s.employee_id AND d.semana = s.semana);

  RETURN json_build_object(
    'horas_extra', v_extra,
    'descanso',    v_desc,
    'incompletas', v_inc,
    'total',       v_extra + v_desc + v_inc);
END;
$function$;

COMMENT ON FUNCTION public.pendientes_de_quincena(date, date, uuid[]) IS
  'Lo que Talento Humano tiene que decidir antes de cerrar la quincena: días con horas de más sin decidir, semanas con el descanso en duda y marcaciones incompletas. La regla del descanso es la de semanasConDescansoEnDuda (src/utils/reglasDePago.js).';

REVOKE EXECUTE ON FUNCTION public.pendientes_de_quincena(date, date, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pendientes_de_quincena(date, date, uuid[]) TO authenticated, service_role;

-- ── El freno de la escritura ────────────────────────────────────────────────
-- DEFINER para ver TODA la quincena aunque el RLS de quien aprueba esconda
-- alguna fila: el freno no puede dejar pasar lo que no ve.
CREATE OR REPLACE FUNCTION public.timesheets_freno_de_cierre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_q    record;
  v_p    json;
  v_txt  text;
BEGIN
  -- Aprobar una marcación incompleta tal cual: se corrige, no se aprueba.
  IF EXISTS (SELECT 1 FROM nuevas n JOIN viejas o ON o.id = n.id
              WHERE n.status = 'APPROVED' AND o.status = 'INCOMPLETE') THEN
    RAISE EXCEPTION 'No se puede cerrar la quincena: hay marcaciones incompletas. Corrígelas primero en Auditoría de tiempos.'
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_q IN
    SELECT q.desde, q.hasta, array_agg(DISTINCT q.employee_id) AS personas
      FROM (
        SELECT n.employee_id,
               CASE WHEN extract(day FROM n.work_date) <= 15 THEN date_trunc('month', n.work_date)::date
                    ELSE (date_trunc('month', n.work_date) + interval '15 days')::date END AS desde,
               CASE WHEN extract(day FROM n.work_date) <= 15 THEN (date_trunc('month', n.work_date) + interval '14 days')::date
                    ELSE (date_trunc('month', n.work_date) + interval '1 month - 1 day')::date END AS hasta
          FROM nuevas n JOIN viejas o ON o.id = n.id
         WHERE n.status = 'APPROVED' AND o.status IS DISTINCT FROM 'APPROVED'
      ) q
     GROUP BY q.desde, q.hasta
  LOOP
    v_p := public.pendientes_de_quincena(v_q.desde, v_q.hasta, v_q.personas);
    IF (v_p->>'total')::int > 0 THEN
      v_txt := concat_ws(', ',
        CASE WHEN (v_p->>'horas_extra')::int > 0 THEN (v_p->>'horas_extra') || ' con horas de más' END,
        CASE WHEN (v_p->>'descanso')::int > 0 THEN (v_p->>'descanso') || ' con el descanso en duda' END,
        CASE WHEN (v_p->>'incompletas')::int > 0 THEN (v_p->>'incompletas') || ' con marcación incompleta' END);
      RAISE EXCEPTION 'No se puede cerrar la quincena: quedan % por resolver (%). Resuélvelo en Auditoría de tiempos.',
        (v_p->>'total'), v_txt
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.timesheets_freno_de_cierre() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS timesheets_freno_de_cierre ON public.timesheets;
CREATE TRIGGER timesheets_freno_de_cierre
  AFTER UPDATE ON public.timesheets
  REFERENCING OLD TABLE AS viejas NEW TABLE AS nuevas
  FOR EACH STATEMENT EXECUTE FUNCTION public.timesheets_freno_de_cierre();

-- ── El aviso a Talento Humano ───────────────────────────────────────────────
-- 3 días antes del cierre (el 12, o el último día del mes menos 3) y el mismo
-- día del cierre si todavía queda algo. Sin pendientes no avisa. Le llega a
-- quien edita la auditoría de tiempos. El cron corre todos los días y la
-- función decide si es día de aviso: así no hay que escribir cuatro cadencias
-- (28, 29, 30 y 31) en el cron.
CREATE OR REPLACE FUNCTION public.avisar_cierre_de_quincena(p_hoy date DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy    date := coalesce(p_hoy, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_desde  date;
  v_cierre date;
  v_p      json;
  v_n      integer;
  v_dest   uuid[];
  v_det    text;
BEGIN
  IF extract(day FROM v_hoy) <= 15 THEN
    v_desde  := date_trunc('month', v_hoy)::date;
    v_cierre := v_desde + 14;
  ELSE
    v_desde  := (date_trunc('month', v_hoy) + interval '15 days')::date;
    v_cierre := (date_trunc('month', v_hoy) + interval '1 month - 1 day')::date;
  END IF;
  IF (v_cierre - v_hoy) NOT IN (3, 0) THEN
    RETURN 0;
  END IF;

  v_p := public.pendientes_de_quincena(v_desde, v_cierre);
  v_n := (v_p->>'total')::int;
  IF v_n = 0 THEN
    RETURN 0;
  END IF;

  SELECT array_agg(DISTINCT e.id) INTO v_dest
    FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                    AND rp.module_key = 'time_audit' AND rp.can_edit);

  v_det := concat_ws(', ',
    CASE WHEN (v_p->>'horas_extra')::int > 0 THEN (v_p->>'horas_extra') || ' ' ||
      CASE WHEN (v_p->>'horas_extra')::int = 1 THEN 'día con horas de más' ELSE 'días con horas de más' END END,
    CASE WHEN (v_p->>'descanso')::int > 0 THEN (v_p->>'descanso') || ' ' ||
      CASE WHEN (v_p->>'descanso')::int = 1 THEN 'semana con el descanso en duda' ELSE 'semanas con el descanso en duda' END END,
    CASE WHEN (v_p->>'incompletas')::int > 0 THEN (v_p->>'incompletas') || ' ' ||
      CASE WHEN (v_p->>'incompletas')::int = 1 THEN 'marcación incompleta' ELSE 'marcaciones incompletas' END END);

  IF v_dest IS NULL OR array_length(v_dest, 1) IS NULL THEN
    INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
    VALUES ('CIERRE_QUINCENA_SIN_DESTINATARIOS', v_desde::text, 'Vigilante', 'SYSTEM', 'CRITICAL',
            jsonb_build_object('cierre', v_cierre, 'pendientes', v_p::jsonb));
    RETURN 0;
  END IF;

  RETURN public.notify_employees(
    v_dest, 'CIERRE_QUINCENA',
    'La quincena cierra el ' || extract(day FROM v_cierre) || ': '
      || CASE WHEN v_n = 1 THEN 'queda 1 decisión' ELSE 'quedan ' || v_n || ' decisiones' END,
    initcap(substr(v_det, 1, 1)) || substr(v_det, 2) || '. Resuélvelo en Auditoría de tiempos para poder cerrarla.',
    '/auditoria-de-tiempos',
    jsonb_build_object('desde', v_desde, 'cierre', v_cierre, 'pendientes', v_p::jsonb,
                       'check_key', 'cierre_quincena:' || v_desde || ':' || v_hoy),
    true, NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.avisar_cierre_de_quincena(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_cierre_de_quincena(date) TO service_role;

-- 08:00 SV todos los días; la función sólo avisa 3 días antes y el día del
-- cierre. Guarda «sólo si existe»: `cron.unschedule` lanza si no existe.
SELECT cron.unschedule('avisar-cierre-quincena-8am-sv')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisar-cierre-quincena-8am-sv');
SELECT cron.schedule('avisar-cierre-quincena-8am-sv', '0 14 * * *',
                     $$SELECT public.avisar_cierre_de_quincena();$$);
