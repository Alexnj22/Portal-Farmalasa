-- «En persona» como cuarto medio de aviso (2026-11-04): el cliente que sigue
-- en la sala se entera ahí mismo, y con el reglamento v2 ese aviso tiene que
-- quedar anotado igual que una llamada. Se exige qué se le dijo / respondió.
SET lock_timeout = '5s';

ALTER TABLE public.reserva_avisos_log DROP CONSTRAINT reserva_avisos_log_canal_check;
ALTER TABLE public.reserva_avisos_log ADD CONSTRAINT reserva_avisos_log_canal_check
  CHECK (canal = ANY (ARRAY['app'::text, 'whatsapp'::text, 'llamada'::text, 'en_persona'::text]));

-- Partida de la definición VIVA; cambian la lista de medios y la exigencia de respuesta.
CREATE OR REPLACE FUNCTION public.reserva_registrar_aviso(p_reserva bigint, p_encargo bigint, p_canal text, p_contesto boolean DEFAULT NULL::boolean, p_respuesta text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_branch bigint; v_emp uuid := public.auth_employee_id(); v_resp text := nullif(btrim(coalesce(p_respuesta, '')), ''); v_id bigint;
BEGIN
  IF num_nonnulls(p_reserva, p_encargo) <> 1 THEN RAISE EXCEPTION 'Indica la reserva o el encargo.'; END IF;
  IF p_canal NOT IN ('whatsapp', 'llamada', 'en_persona') THEN RAISE EXCEPTION 'Ese medio de aviso no se registra a mano.'; END IF;
  IF p_reserva IS NOT NULL THEN
    SELECT branch_id INTO v_branch FROM public.app_reservas WHERE id = p_reserva;
    IF v_branch IS NULL OR NOT public.reserva_puede_manejar(v_branch) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  ELSE
    SELECT branch_id INTO v_branch FROM public.app_encargos WHERE id = p_encargo;
    IF v_branch IS NULL OR NOT public.encargo_puede_manejar(v_branch) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  END IF;
  IF p_canal = 'llamada' THEN
    IF p_contesto IS NULL THEN RAISE EXCEPTION 'Indica si el cliente contestó.'; END IF;
    IF p_contesto AND (v_resp IS NULL OR length(v_resp) < 3) THEN RAISE EXCEPTION 'Escribe qué respondió el cliente.'; END IF;
  END IF;
  IF p_canal = 'en_persona' AND (v_resp IS NULL OR length(v_resp) < 3) THEN
    RAISE EXCEPTION 'Escribe qué se le dijo o qué respondió el cliente.';
  END IF;
  INSERT INTO public.reserva_avisos_log (reserva_id, encargo_id, branch_id, canal, employee_id, contesto, respuesta)
  VALUES (p_reserva, p_encargo, v_branch, p_canal, v_emp, CASE WHEN p_canal = 'llamada' THEN p_contesto END, left(v_resp, 300))
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, CASE WHEN p_encargo IS NOT NULL THEN 'ENCARGO_' ELSE 'RESERVA_' END || 'AVISO_' || upper(p_canal),
          coalesce(p_reserva, p_encargo)::text,
          jsonb_build_object('contesto', p_contesto, 'respuesta', left(v_resp, 300), 'registro', v_id), v_branch, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'id', v_id);
END $function$;
