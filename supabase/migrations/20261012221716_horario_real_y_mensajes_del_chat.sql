-- Horario REAL para el chat y mensajes personalizables (2026-10-12). Pedido
-- del usuario: «podemos dejar esos mensajes como personalizables? además, ese
-- horario lo debe tomar del horario de las sucursales: imagina que es
-- feriado, el horario cambiará».
--
--   · El horario de una sala en una fecha (`horario_de_sala`) se decide así:
--       1. un horario ESPECIAL cargado para esa sala y esa fecha
--          (`sucursal_horario_especial`: cerrada, o abre/cierra distinto);
--       2. si la fecha es FERIADO (`holidays`, nacional o recurrente), el
--          horario de DOMINGO de la sala;
--       3. si no, el día de la semana de `branches.weekly_hours`.
--     `weekly_hours` trae horas escritas a mano («18:00 PM»): se lee HH:MM.
--   · `farmacia_estado()` junta las farmacias: abierta si al menos una lo
--     está AHORA; dice hasta qué hora y, si está cerrada, cuándo abre la
--     primera (mira hasta 8 días adelante).
--   · `app_chat_ajustes`: los dos mensajes automáticos del chat, editables por
--     quien tiene `chat_clientes` para responder. Admiten {cierra} y {abre}.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.sucursal_horario_especial (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id  bigint NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  fecha      date NOT NULL,
  cerrada    boolean NOT NULL DEFAULT false,
  abre       time,
  cierra     time,
  motivo     text CHECK (motivo IS NULL OR length(motivo) <= 120),
  creado_por uuid REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, fecha),
  CHECK (cerrada OR (abre IS NOT NULL AND cierra IS NOT NULL AND abre < cierra))
);
ALTER TABLE public.sucursal_horario_especial ENABLE ROW LEVEL SECURITY;
CREATE POLICY sucursal_horario_especial_select ON public.sucursal_horario_especial FOR SELECT TO authenticated USING (true);
CREATE POLICY sucursal_horario_especial_insert ON public.sucursal_horario_especial FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['branches'])) AND creado_por = (SELECT public.auth_employee_id()));
CREATE POLICY sucursal_horario_especial_update ON public.sucursal_horario_especial FOR UPDATE TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['branches']))) WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['branches'])));
CREATE POLICY sucursal_horario_especial_delete ON public.sucursal_horario_especial FOR DELETE TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['branches'])));
REVOKE ALL ON public.sucursal_horario_especial FROM anon;

-- El horario de una sala en una fecha: (abre, cierra), o NULL si no abre.
CREATE OR REPLACE FUNCTION public.horario_de_sala(p_branch bigint, p_fecha date)
 RETURNS TABLE (abre time, cierra time, origen text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  e public.sucursal_horario_especial;
  v_dia jsonb;
  v_feriado boolean;
  v_a text; v_c text;
BEGIN
  SELECT * INTO e FROM public.sucursal_horario_especial s WHERE s.branch_id = p_branch AND s.fecha = p_fecha;
  IF FOUND THEN
    IF e.cerrada THEN RETURN; END IF;
    abre := e.abre; cierra := e.cierra; origen := 'especial'; RETURN NEXT; RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.holidays h
                  WHERE h.municipality IS NULL
                    AND (h.holiday_date = p_fecha
                         OR (h.is_recurring AND extract(month FROM h.holiday_date) = extract(month FROM p_fecha)
                                            AND extract(day FROM h.holiday_date) = extract(day FROM p_fecha))))
    INTO v_feriado;
  SELECT b.weekly_hours -> (CASE WHEN v_feriado THEN 0 ELSE extract(dow FROM p_fecha)::int END)::text
    INTO v_dia FROM public.branches b WHERE b.id = p_branch;
  IF v_dia IS NULL OR coalesce((v_dia ->> 'isOpen')::boolean, false) IS FALSE THEN RETURN; END IF;
  v_a := substring(v_dia ->> 'start' FROM '^\s*([0-9]{1,2}:[0-9]{2})');
  v_c := substring(v_dia ->> 'end' FROM '^\s*([0-9]{1,2}:[0-9]{2})');
  IF v_a IS NULL OR v_c IS NULL THEN RETURN; END IF;
  abre := v_a::time; cierra := v_c::time;
  origen := CASE WHEN v_feriado THEN 'feriado' ELSE 'semanal' END;
  RETURN NEXT;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.horario_de_sala(bigint, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.horario_de_sala(bigint, date) TO authenticated, service_role;

-- Las farmacias en conjunto, AHORA (hora de El Salvador).
CREATE OR REPLACE FUNCTION public.farmacia_estado()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ahora timestamp := now() AT TIME ZONE 'America/El_Salvador';
  v_hoy date := v_ahora::date;
  v_hora time := v_ahora::time;
  v_abierta boolean;
  v_cierra time;
  v_abre timestamp;
  v_feriado text;
  d integer;
BEGIN
  SELECT bool_or(h.abre <= v_hora AND v_hora < h.cierra), max(h.cierra) FILTER (WHERE h.abre <= v_hora AND v_hora < h.cierra)
    INTO v_abierta, v_cierra
    FROM public.branches b CROSS JOIN LATERAL public.horario_de_sala(b.id, v_hoy) h
   WHERE b.type = 'FARMACIA';
  IF NOT coalesce(v_abierta, false) THEN
    -- La próxima apertura: hoy más tarde, o el primer día que abra alguna.
    FOR d IN 0..8 LOOP
      SELECT min((v_hoy + d) + h.abre) INTO v_abre
        FROM public.branches b CROSS JOIN LATERAL public.horario_de_sala(b.id, v_hoy + d) h
       WHERE b.type = 'FARMACIA' AND (v_hoy + d) + h.abre > v_ahora;
      EXIT WHEN v_abre IS NOT NULL;
    END LOOP;
  END IF;
  SELECT h.name INTO v_feriado FROM public.holidays h
   WHERE h.municipality IS NULL
     AND (h.holiday_date = v_hoy OR (h.is_recurring AND extract(month FROM h.holiday_date) = extract(month FROM v_hoy)
                                                    AND extract(day FROM h.holiday_date) = extract(day FROM v_hoy)))
   LIMIT 1;
  RETURN json_build_object(
    'abierta', coalesce(v_abierta, false),
    'cierra', to_char(v_cierra, 'HH24:MI'),
    'abre', CASE WHEN v_abre IS NULL THEN NULL ELSE to_char(v_abre, 'YYYY-MM-DD"T"HH24:MI') END,
    'feriado', v_feriado);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.farmacia_estado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.farmacia_estado() TO authenticated, service_role;

-- Los mensajes automáticos del chat.
CREATE TABLE IF NOT EXISTS public.app_chat_ajustes (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  mensaje_abierto text NOT NULL CHECK (length(mensaje_abierto) BETWEEN 1 AND 500),
  mensaje_cerrado text NOT NULL CHECK (length(mensaje_cerrado) BETWEEN 1 AND 500),
  updated_by      uuid REFERENCES public.employees(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.app_chat_ajustes (id, mensaje_abierto, mensaje_cerrado) VALUES (true,
  '¡Gracias por escribirnos! Recibimos tu mensaje y en un momento te atiende alguien de nuestro equipo.',
  '¡Gracias por escribirnos! En este momento estamos fuera de horario. Te responderemos a la brevedad cuando abramos, {abre}.')
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.app_chat_ajustes ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_chat_ajustes_select ON public.app_chat_ajustes FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('chat_clientes', 'can_view')));
CREATE POLICY app_chat_ajustes_update ON public.app_chat_ajustes FOR UPDATE TO authenticated
  USING ((SELECT public.auth_has_module_permission('chat_clientes', 'can_edit')))
  WITH CHECK ((SELECT public.auth_has_module_permission('chat_clientes', 'can_edit')) AND updated_by = (SELECT public.auth_employee_id()));
REVOKE ALL ON public.app_chat_ajustes FROM anon;
