-- ═══════════════════════════════════════════════════════════════════════════
-- 40 · Solicitudes de datos: prórroga, prevención, negativa motivada y aviso
--      a terceros (Ley para la Protección de Datos Personales, Arts. 18-22)
--
-- DEPENDE DE: 10 (`sumar_dias_habiles`).
--
-- DESDE CUÁNDO RIGE: la ley ya rige; no depende de reglas_v2_desde(). Ninguna
--   fila existente cambia: las columnas prorrogada_at, prevenida_at, negada y
--   motivo_negativa ya existían y nadie las escribía.
--
-- QUÉ CAMBIA:
--   · `solicitud_datos_accion(id, accion, texto, causal)` — una sola puerta
--     para las acciones que la pantalla sólo podía expresar como «Dar por
--     resuelta»:
--       prorrogar  Art. 20: una sola vez, otros 20 días hábiles, con motivo.
--       prevenir   Art. 18: una sola vez, qué falta; la persona tiene 10 días
--                  hábiles desde el día siguiente. El plazo de 20 NO se
--                  suspende (Procedimiento §5.2).
--       subsanar   La persona completó: vuelve a RECIBIDA.
--       archivar   Pasados los 10 días sin subsanar: se archiva sin más
--                  trámite (queda RESUELTA con esa resolución).
--       negar      Art. 22: causal (letra a–h) y motivo; queda RESUELTA y
--                  negada. La resolución motivada se notifica en 3 días hábiles.
--   · `solicitudes_datos_terceros` + `solicitud_datos_tercero(...)`: el
--     Art. 21 manda avisar la rectificación o la eliminación a quien había
--     recibido esos datos dentro de 5 días hábiles. Registro de a quién, qué,
--     hasta cuándo, y cuándo y cómo se avisó.
--   · `avisar_solicitudes_datos_por_vencer()` (cron diario existente
--     `avisar-plazo-datos-8am-sv`): además de los 20/40 días, avisa la
--     prevención vencida (ya se puede archivar) y el aviso a terceros que
--     vence mañana o ya venció. La parte vieja es la definición viva, intacta.
--
-- TABLAS: `solicitudes_datos` (+1 columna, tabla chica), `solicitudes_datos_avisos`
--   (CHECK ampliado), `solicitudes_datos_terceros` (nueva). Ninguna caliente.
--
-- VERIFICADO en staging con execute_sql (ver informe): prorrogar dos veces →
--   la segunda falla; prevenir → PREVENIDA y vence +10 hábiles; archivar antes
--   de tiempo → falla; negar sin causal → falla; tercero con vence +5 hábiles;
--   el vigilante con una prevención y un tercero vencidos manda los dos avisos
--   una sola vez (la segunda corrida devuelve 0).
-- ═══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

ALTER TABLE public.solicitudes_datos ADD COLUMN IF NOT EXISTS motivo_prorroga text;
COMMENT ON COLUMN public.solicitudes_datos.motivo_prorroga IS 'Art. 20: la causa justificada de la prórroga, que se le comunica a la persona.';

ALTER TABLE public.solicitudes_datos_avisos DROP CONSTRAINT IF EXISTS solicitudes_datos_avisos_etapa_check;
ALTER TABLE public.solicitudes_datos_avisos ADD CONSTRAINT solicitudes_datos_avisos_etapa_check
  CHECK (etapa = ANY (ARRAY['apremia'::text, 'vencida'::text, 'prevencion_vencida'::text]));

-- ── A quién se le avisó una rectificación o una eliminación (Art. 21) ──────
CREATE TABLE IF NOT EXISTS public.solicitudes_datos_terceros (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id uuid NOT NULL REFERENCES public.solicitudes_datos(id) ON DELETE CASCADE,
  tercero      text NOT NULL CHECK (btrim(tercero) <> ''),
  que          text NOT NULL CHECK (btrim(que) <> ''),
  vence        date NOT NULL,
  avisado_at   timestamptz,
  avisado_por  uuid REFERENCES public.employees(id),
  medio        text,
  creado_por   uuid REFERENCES public.employees(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS solicitudes_datos_terceros_solicitud_idx ON public.solicitudes_datos_terceros (solicitud_id);
COMMENT ON TABLE public.solicitudes_datos_terceros IS
  'Art. 21 LPDP: avisos de rectificación/eliminación a quien había recibido los datos, dentro de 5 días hábiles. Sólo se escribe por solicitud_datos_tercero().';
ALTER TABLE public.solicitudes_datos_terceros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS solicitudes_datos_terceros_select ON public.solicitudes_datos_terceros;
CREATE POLICY solicitudes_datos_terceros_select ON public.solicitudes_datos_terceros FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('datos_personales', 'can_view')));
REVOKE ALL ON public.solicitudes_datos_terceros FROM anon;
GRANT SELECT ON public.solicitudes_datos_terceros TO authenticated;

-- ── Las acciones del trámite ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.solicitud_datos_accion(p_id uuid, p_accion text, p_texto text DEFAULT NULL, p_causal text DEFAULT NULL)
 RETURNS public.solicitudes_datos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_s public.solicitudes_datos;
  v_txt text := nullif(btrim(coalesce(p_texto, '')), '');
  v_emp uuid := public.auth_employee_id();
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_causales jsonb := '{"a":"quien pide no es el titular, o el representante no está acreditado",
                        "b":"no hay datos de esa persona en los registros",
                        "c":"se perjudicarían los derechos e intereses legítimos de un tercero",
                        "d":"hay un error notorio en la identificación de los datos o falsedad en los hechos",
                        "e":"existe un impedimento legal o la resolución de una autoridad competente",
                        "f":"la cancelación o la oposición ya se había realizado",
                        "g":"la Empresa no es la competente",
                        "h":"otro caso que establece la ley"}';
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('datos_personales', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_s FROM public.solicitudes_datos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La solicitud no existe'; END IF;
  IF v_s.estado IN ('RESUELTA', 'ANULADA') THEN RAISE EXCEPTION 'La solicitud ya está cerrada'; END IF;
  IF v_s.recibida_at IS NULL THEN RAISE EXCEPTION 'Primero registra la fecha del acuse: de ella corren los plazos'; END IF;

  IF p_accion = 'prorrogar' THEN
    IF v_s.prorrogada_at IS NOT NULL THEN RAISE EXCEPTION 'La prórroga se concede una sola vez'; END IF;
    IF v_txt IS NULL THEN RAISE EXCEPTION 'Escribe la causa de la prórroga: se le comunica a la persona'; END IF;
    UPDATE public.solicitudes_datos SET prorrogada_at = now(), motivo_prorroga = v_txt, updated_at = now()
     WHERE id = p_id RETURNING * INTO v_s;

  ELSIF p_accion = 'prevenir' THEN
    IF v_s.prevenida_at IS NOT NULL THEN RAISE EXCEPTION 'La prevención se hace una sola vez'; END IF;
    IF v_txt IS NULL THEN RAISE EXCEPTION 'Escribe qué le falta presentar o completar'; END IF;
    UPDATE public.solicitudes_datos SET estado = 'PREVENIDA', prevenida_at = now(), prevencion = v_txt, updated_at = now()
     WHERE id = p_id RETURNING * INTO v_s;

  ELSIF p_accion = 'subsanar' THEN
    IF v_s.estado <> 'PREVENIDA' THEN RAISE EXCEPTION 'La solicitud no está prevenida'; END IF;
    UPDATE public.solicitudes_datos SET estado = 'RECIBIDA',
           notas = concat_ws(E'\n', nullif(notas, ''), 'Subsanada el ' || to_char(v_hoy, 'DD/MM/YYYY') || coalesce(': ' || v_txt, '')),
           updated_at = now()
     WHERE id = p_id RETURNING * INTO v_s;

  ELSIF p_accion = 'archivar' THEN
    IF v_s.estado <> 'PREVENIDA' THEN RAISE EXCEPTION 'Sólo se archiva una solicitud prevenida que no se completó'; END IF;
    IF public.sumar_dias_habiles((v_s.prevenida_at AT TIME ZONE 'America/El_Salvador')::date, 10) >= v_hoy THEN
      RAISE EXCEPTION 'Todavía corren los diez días hábiles de la prevención (vencen el %)',
        to_char(public.sumar_dias_habiles((v_s.prevenida_at AT TIME ZONE 'America/El_Salvador')::date, 10), 'DD/MM/YYYY');
    END IF;
    UPDATE public.solicitudes_datos SET estado = 'RESUELTA', resuelta_at = now(), resuelta_por = v_emp,
           resolucion = 'Archivada sin más trámite: no se completó lo prevenido dentro de los diez días hábiles (Art. 18). '
                        || 'Queda a salvo el derecho de presentar una solicitud nueva.',
           updated_at = now()
     WHERE id = p_id RETURNING * INTO v_s;

  ELSIF p_accion = 'negar' THEN
    IF p_causal IS NULL OR NOT (v_causales ? p_causal) THEN RAISE EXCEPTION 'Elige la causal del Art. 22'; END IF;
    IF v_txt IS NULL THEN RAISE EXCEPTION 'Escribe el motivo: la negativa se notifica por resolución motivada'; END IF;
    UPDATE public.solicitudes_datos SET estado = 'RESUELTA', negada = true, resuelta_at = now(), resuelta_por = v_emp,
           motivo_negativa = 'Art. 22 letra ' || p_causal || ') — ' || (v_causales ->> p_causal) || '. ' || v_txt,
           resolucion = coalesce(nullif(btrim(resolucion), ''), 'Se niega la solicitud: ' || v_txt),
           updated_at = now()
     WHERE id = p_id RETURNING * INTO v_s;

  ELSE
    RAISE EXCEPTION 'Acción no válida';
  END IF;

  INSERT INTO public.audit_logs (action, target_id, user_id, user_name, source, severity, details)
  VALUES ('SOLICITUD_DATOS_' || upper(p_accion), p_id::text, v_emp,
          coalesce((SELECT name FROM public.employees WHERE id = v_emp), 'Portal'), 'ADMIN_PANEL', 'INFO',
          jsonb_build_object('folio', v_s.folio_txt, 'texto', v_txt, 'causal', p_causal));
  RETURN v_s;
END $function$;

REVOKE EXECUTE ON FUNCTION public.solicitud_datos_accion(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitud_datos_accion(uuid, text, text, text) TO authenticated, service_role;

-- ── Aviso a terceros: anotar a quién hay que avisar, y que se avisó ────────
CREATE OR REPLACE FUNCTION public.solicitud_datos_tercero(p_accion text, p_solicitud uuid DEFAULT NULL, p_id uuid DEFAULT NULL,
                                                          p_tercero text DEFAULT NULL, p_que text DEFAULT NULL, p_medio text DEFAULT NULL)
 RETURNS public.solicitudes_datos_terceros
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_t public.solicitudes_datos_terceros;
  v_emp uuid := public.auth_employee_id();
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('datos_personales', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_accion = 'agregar' THEN
    IF NOT EXISTS (SELECT 1 FROM public.solicitudes_datos WHERE id = p_solicitud AND recibida_at IS NOT NULL AND estado <> 'ANULADA') THEN
      RAISE EXCEPTION 'La solicitud no existe o no está recibida';
    END IF;
    IF nullif(btrim(coalesce(p_tercero, '')), '') IS NULL OR nullif(btrim(coalesce(p_que, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Escribe a quién hay que avisar y qué se corrigió o eliminó';
    END IF;
    -- Art. 21: «dentro de los cinco días hábiles posteriores a la determinación
    -- de la procedencia». La procedencia se determina al anotarlo.
    INSERT INTO public.solicitudes_datos_terceros (solicitud_id, tercero, que, vence, creado_por)
    VALUES (p_solicitud, btrim(p_tercero), btrim(p_que), public.sumar_dias_habiles(v_hoy, 5), v_emp)
    RETURNING * INTO v_t;
  ELSIF p_accion = 'avisado' THEN
    IF nullif(btrim(coalesce(p_medio, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribe por qué medio se le avisó'; END IF;
    UPDATE public.solicitudes_datos_terceros SET avisado_at = now(), avisado_por = v_emp, medio = btrim(p_medio)
     WHERE id = p_id AND avisado_at IS NULL RETURNING * INTO v_t;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese aviso no existe o ya estaba anotado'; END IF;
  ELSE
    RAISE EXCEPTION 'Acción no válida';
  END IF;
  INSERT INTO public.audit_logs (action, target_id, user_id, user_name, source, severity, details)
  VALUES ('SOLICITUD_DATOS_TERCERO_' || upper(p_accion), v_t.solicitud_id::text, v_emp,
          coalesce((SELECT name FROM public.employees WHERE id = v_emp), 'Portal'), 'ADMIN_PANEL', 'INFO',
          jsonb_build_object('tercero', v_t.tercero, 'vence', v_t.vence, 'medio', v_t.medio));
  RETURN v_t;
END $function$;

REVOKE EXECUTE ON FUNCTION public.solicitud_datos_tercero(text, uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitud_datos_tercero(text, uuid, uuid, text, text, text) TO authenticated, service_role;

-- ── El vigilante diario: lo de siempre + prevención + terceros ─────────────
CREATE OR REPLACE FUNCTION public.avisar_solicitudes_datos_por_vencer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dest  uuid[];
  v_fila  record;
  v_n     integer := 0;
  v_total integer := 0;
  v_ins   integer;
  v_clave text;
BEGIN
  -- Quien puede resolverla: edita el módulo de datos personales.
  SELECT array_agg(DISTINCT e.id) INTO v_dest
    FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                    AND rp.module_key = 'datos_personales' AND rp.can_edit);

  FOR v_fila IN
    WITH viva AS (
      SELECT s.id, s.folio_txt, s.solicitante_nombre, s.recibida_at,
             CASE WHEN s.prorrogada_at IS NOT NULL THEN 40 ELSE 20 END AS total,
             -- Días hábiles desde el acuse: lunes a viernes, sin descontar
             -- asuetos. Es la MISMA regla del portal, y por el mismo motivo:
             -- sin una tabla de asuetos mantenida, descontarlos daría un plazo
             -- más largo que el real.
             (SELECT count(*) FROM generate_series(s.recibida_at::date + 1, CURRENT_DATE, interval '1 day') d
               WHERE extract(isodow FROM d) < 6) AS usados
        FROM public.solicitudes_datos s
       WHERE s.recibida_at IS NOT NULL
         AND s.estado NOT IN ('RESUELTA', 'ANULADA')
    )
    SELECT v.*, (v.total - v.usados) AS restan,
           CASE WHEN v.total - v.usados < 0 THEN 'vencida' ELSE 'apremia' END AS etapa
      FROM viva v
     WHERE v.total - v.usados <= 3
       AND NOT EXISTS (
             SELECT 1 FROM public.solicitudes_datos_avisos a
              WHERE a.solicitud_id = v.id
                AND a.etapa = CASE WHEN v.total - v.usados < 0 THEN 'vencida' ELSE 'apremia' END)
     ORDER BY v.total - v.usados
  LOOP
    v_n := 0;
    IF v_dest IS NOT NULL AND array_length(v_dest, 1) > 0 THEN
      v_n := public.notify_employees(
        v_dest, 'DATOS_PLAZO',
        CASE WHEN v_fila.etapa = 'vencida'
             THEN 'Se venció el plazo de una solicitud de datos'
             ELSE 'Una solicitud de datos vence en ' || v_fila.restan || ' día(s) hábil(es)' END,
        'Solicitud ' || coalesce(v_fila.folio_txt, '(sin folio)')
          || ' de ' || coalesce(v_fila.solicitante_nombre, 'una persona')
          || CASE WHEN v_fila.etapa = 'vencida'
                  THEN '. La ley da ' || v_fila.total || ' días hábiles desde el acuse y ya pasaron '
                       || v_fila.usados || '.'
                  ELSE '. Quedan ' || v_fila.restan || ' de los ' || v_fila.total
                       || ' días hábiles que da la ley.' END,
        '/solicitudes-datos',
        jsonb_build_object('solicitud_id', v_fila.id, 'etapa', v_fila.etapa,
                           'check_key', 'datos_plazo:' || v_fila.id || ':' || v_fila.etapa),
        true, NULL);
    ELSE
      -- Nadie con el permiso: queda en la bitácora como crítico en vez de
      -- perderse. Un plazo legal sin destinatario es peor que uno sin aviso.
      INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
      VALUES ('DATOS_PLAZO_SIN_DESTINATARIOS', v_fila.id::text, 'Vigilante', 'SYSTEM', 'CRITICAL',
              jsonb_build_object('folio', v_fila.folio_txt, 'etapa', v_fila.etapa,
                                 'restan', v_fila.restan));
    END IF;

    -- La marca se escribe SIEMPRE, aunque no le haya llegado a nadie: si no, el
    -- mismo aviso se reintentaría cada día para siempre.
    INSERT INTO public.solicitudes_datos_avisos (solicitud_id, etapa, destinatarios)
    VALUES (v_fila.id, v_fila.etapa, coalesce(v_n, 0))
    ON CONFLICT (solicitud_id, etapa) DO NOTHING;

    v_total := v_total + coalesce(v_n, 0);
  END LOOP;

  -- ── Prevención vencida (Art. 18, 2026-10-24): diez días hábiles desde el
  -- día siguiente a la prevención y la persona no completó. Ya se puede
  -- archivar; si nadie lo hace, el plazo de veinte sigue corriendo.
  FOR v_fila IN
    SELECT s.id, s.folio_txt, s.solicitante_nombre,
           public.sumar_dias_habiles((s.prevenida_at AT TIME ZONE 'America/El_Salvador')::date, 10) AS vence
      FROM public.solicitudes_datos s
     WHERE s.estado = 'PREVENIDA' AND s.prevenida_at IS NOT NULL
       AND public.sumar_dias_habiles((s.prevenida_at AT TIME ZONE 'America/El_Salvador')::date, 10)
           < (now() AT TIME ZONE 'America/El_Salvador')::date
       AND NOT EXISTS (SELECT 1 FROM public.solicitudes_datos_avisos a WHERE a.solicitud_id = s.id AND a.etapa = 'prevencion_vencida')
  LOOP
    v_n := 0;
    IF v_dest IS NOT NULL THEN
      v_n := public.notify_employees(v_dest, 'DATOS_PLAZO', 'Venció la prevención de una solicitud de datos',
        'Solicitud ' || coalesce(v_fila.folio_txt, '(sin folio)') || ' de ' || coalesce(v_fila.solicitante_nombre, 'una persona')
          || ': los diez días hábiles para completarla vencieron el ' || to_char(v_fila.vence, 'DD/MM/YYYY')
          || '. Si no se presentó, se archiva sin más trámite.',
        '/solicitudes-datos', jsonb_build_object('solicitud_id', v_fila.id, 'etapa', 'prevencion_vencida',
          'check_key', 'datos_plazo:' || v_fila.id || ':prevencion_vencida'), true, NULL);
    END IF;
    INSERT INTO public.solicitudes_datos_avisos (solicitud_id, etapa, destinatarios)
    VALUES (v_fila.id, 'prevencion_vencida', coalesce(v_n, 0)) ON CONFLICT (solicitud_id, etapa) DO NOTHING;
    v_total := v_total + coalesce(v_n, 0);
  END LOOP;

  -- ── Aviso a terceros (Art. 21): vence mañana o ya venció sin anotarse ──
  FOR v_fila IN
    SELECT t.id, t.tercero, t.vence, s.folio_txt,
           CASE WHEN t.vence < (now() AT TIME ZONE 'America/El_Salvador')::date THEN 'vencido' ELSE 'apremia' END AS etapa
      FROM public.solicitudes_datos_terceros t JOIN public.solicitudes_datos s ON s.id = t.solicitud_id
     WHERE t.avisado_at IS NULL AND s.estado <> 'ANULADA'
       AND t.vence <= (now() AT TIME ZONE 'America/El_Salvador')::date + 1
  LOOP
    v_clave := 'datos-tercero:' || v_fila.id || ':' || v_fila.etapa;
    INSERT INTO public.avisos_emitidos (clave, recipient_id) VALUES (v_clave, NULL) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    CONTINUE WHEN v_ins = 0 OR v_dest IS NULL;
    v_total := v_total + public.notify_employees(v_dest, 'DATOS_PLAZO',
      CASE WHEN v_fila.etapa = 'vencido' THEN 'Se pasó el plazo para avisar a ' || v_fila.tercero
           ELSE 'Hay que avisar a ' || v_fila.tercero || ' a más tardar el ' || to_char(v_fila.vence, 'DD/MM/YYYY') END,
      'Solicitud ' || coalesce(v_fila.folio_txt, '(sin folio)') || ': la ley da cinco días hábiles para comunicar la corrección o '
        || 'la eliminación a quien había recibido esos datos.',
      '/solicitudes-datos', jsonb_build_object('tercero_id', v_fila.id, 'check_key', v_clave), true, NULL);
  END LOOP;

  RETURN v_total;
END;
$function$;
