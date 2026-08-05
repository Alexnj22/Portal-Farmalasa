SET lock_timeout = '5s';

-- ── Aprobar en lote ──────────────────────────────────────────────────────────
-- Simétrico a `confirmar_metas_lote` (v2.372.1): recorre la función individual
-- dentro de UNA transacción, así el permiso, el candado de estado, la bitácora
-- y el aviso siguen viviendo en un solo lugar — y si una falla, no quedan tres
-- aprobadas y tres no.
CREATE OR REPLACE FUNCTION public.aprobar_metas_lote(p_ids bigint[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_id bigint;
  n integer := 0;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN RETURN 0; END IF;
  -- Tope de cordura: un mes tiene 6 salas.
  IF array_length(p_ids, 1) > 100 THEN
    RAISE EXCEPTION 'LOTE_DEMASIADO_GRANDE: %', array_length(p_ids, 1);
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    PERFORM public.aprobar_meta_gerente(v_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aprobar_metas_lote(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprobar_metas_lote(bigint[]) TO authenticated, service_role;

-- ── Registrar la autorización verbal, en lote ────────────────────────────────
-- Se pregunta UNA vez quién autorizó y cómo, y se aplica a todas: repetir el
-- mismo dato seis veces no lo hace más cierto, solo más tedioso. Cada meta
-- conserva su propio renglón en la bitácora y su propio aviso al gerente.
CREATE OR REPLACE FUNCTION public.aprobar_metas_por_autorizacion_lote(
    p_ids bigint[], p_autorizo uuid, p_nota text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_id bigint;
  n integer := 0;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN RETURN 0; END IF;
  IF array_length(p_ids, 1) > 100 THEN
    RAISE EXCEPTION 'LOTE_DEMASIADO_GRANDE: %', array_length(p_ids, 1);
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    PERFORM public.aprobar_meta_por_autorizacion(v_id, p_autorizo, p_nota);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aprobar_metas_por_autorizacion_lote(bigint[], uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprobar_metas_por_autorizacion_lote(bigint[], uuid, text)
  TO authenticated, service_role;

-- ── Un aviso pendiente no se repite: se actualiza ────────────────────────────
-- `metas_ciclo_diario` mandaba «la meta de X sigue pendiente» TODOS los días
-- mientras el mes en curso no estuviera oficial, y esta función insertaba sin
-- mirar. Medido el 2026-08-05: 3 avisos en un día, ninguno leído, y otros 2 por
-- día hasta que agosto se aprobara. Un recordatorio diario deja de leerse en
-- tres días.
--
-- Ahora, si ya hay uno SIN LEER del mismo tipo y título, se le refresca el
-- cuerpo y la fecha en vez de agregar otro: la campana muestra un solo renglón
-- y con el número de hoy, no el de la primera vez.
CREATE OR REPLACE FUNCTION public.metas_notificar_rol(
    p_role_name text, p_type text, p_title text, p_body text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_n integer;
BEGIN
  WITH destinatarios AS (
    SELECT e.id FROM public.employees e
    JOIN public.roles r ON r.name = p_role_name
    WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
      AND e.status = 'ACTIVO'
  ),
  refrescados AS (
    UPDATE public.notifications n
    SET body = p_body, created_at = now()
    WHERE n.recipient_id IN (SELECT d.id FROM destinatarios d)
      AND n.type = p_type AND n.title = p_title AND n.read_at IS NULL
    RETURNING n.recipient_id
  ),
  nuevos AS (
    INSERT INTO public.notifications (recipient_id, type, title, body, link)
    SELECT d.id, p_type, p_title, p_body, '/metas?tab=confirmacion'
    FROM destinatarios d
    WHERE d.id NOT IN (SELECT r.recipient_id FROM refrescados r)
    RETURNING recipient_id
  )
  SELECT (SELECT count(*) FROM refrescados) + (SELECT count(*) FROM nuevos) INTO v_n;

  RETURN v_n;
END;
$function$;

-- ── El ritmo del recordatorio ────────────────────────────────────────────────
-- El aviso del mes en curso pasa de diario a los días 1, 3 y después semanal.
-- El dedupe de arriba ya evita el apilamiento; esto evita además que la fecha
-- del aviso salte todos los días y lo empuje al tope de la campana sin novedad.
CREATE OR REPLACE FUNCTION public.metas_ciclo_diario()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_dia integer := EXTRACT(day FROM v_hoy)::int;
  v_ym_actual text := to_char(v_hoy, 'YYYY-MM');
  v_ym_sig text := to_char((date_trunc('month', v_hoy) + interval '1 month')::date, 'YYYY-MM');
  v_dia_propuesta integer;
  v_creadas integer := 0;
  v_n integer;
  v_out text := '';
BEGIN
  SELECT dia_propuesta INTO v_dia_propuesta FROM public.metas_config LIMIT 1;

  IF v_dia = COALESCE(v_dia_propuesta, 25) THEN
    -- Avisa `generar_propuestas_metas` misma.
    v_creadas := public.generar_propuestas_metas(v_ym_sig);
    v_out := v_out || 'propuestas=' || v_creadas || ' ';
  END IF;

  IF v_dia >= 28 THEN
    SELECT count(*) INTO v_n FROM public.metas_sucursal
    WHERE year_month = v_ym_sig AND estado IN ('propuesta', 'devuelta');
    IF v_n > 0 THEN
      PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_RECORDATORIO',
        'Metas sin confirmar',
        'Quedan ' || v_n || ' meta(s) de ' || public.metas_mes_label(v_ym_sig) || ' sin confirmar.');
      v_out := v_out || 'rec_supervisor=' || v_n || ' ';
    END IF;
  END IF;

  IF v_dia >= 30 OR v_dia <= 5 THEN
    SELECT count(*) INTO v_n FROM public.metas_sucursal
    WHERE year_month IN (v_ym_actual, v_ym_sig) AND estado = 'confirmada_supervisor';
    IF v_n > 0 THEN
      PERFORM public.metas_notificar_rol('Gerente General', 'METAS_RECORDATORIO',
        'Metas por aprobar',
        v_n || ' meta(s) confirmadas esperan tu aprobación.');
      v_out := v_out || 'rec_gerente=' || v_n || ' ';
    END IF;
  END IF;

  -- Días 1, 3 y después una vez por semana: el mes en curso sin oficializar es
  -- una situación que dura, no una novedad diaria.
  IF v_dia IN (1, 3, 8, 15, 22, 29) THEN
    SELECT count(*) INTO v_n FROM public.metas_sucursal
    WHERE year_month = v_ym_actual AND estado <> 'oficial';
    IF v_n > 0 THEN
      PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_RECORDATORIO',
        'La meta de ' || public.metas_mes_label(v_ym_actual) || ' sigue pendiente',
        v_n || ' sala(s) aún no tienen su meta oficial. Las salas la ven como pendiente.');
      PERFORM public.metas_notificar_rol('Gerente General', 'METAS_RECORDATORIO',
        'La meta de ' || public.metas_mes_label(v_ym_actual) || ' sigue pendiente',
        v_n || ' sala(s) aún no tienen su meta oficial.');
      v_out := v_out || 'pendientes_mes_actual=' || v_n;
    END IF;
  END IF;

  RETURN COALESCE(NULLIF(v_out, ''), 'sin novedades');
END;
$function$;

-- Verificado en prod dentro de una transacción revertida:
--   lote con una meta en estado inválido → rechaza el lote entero, 0 oficiales
--   lote válido de 2                     → 2 oficiales y 2 renglones de bitácora
--   3 avisos iguales seguidos            → 1 sola notificación, con el cuerpo
--                                          más reciente («quedan 2»)
--   tras marcarla leída, uno nuevo       → 2 en total: leer no tapa el siguiente
