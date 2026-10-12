-- Receta por PEDIDO (2026-10-12). Un pedido del carrito con un producto bajo
-- receta nace entero en revisión (todos sus renglones), y la foto se sube una
-- vez para todo el pedido. Antes la sala decidía renglón por renglón y el
-- aviso salía una vez por producto. Ahora:
--   · `reserva_receta_decidir` decide el pedido entero (todos los renglones en
--     revisión con el mismo `pedido`);
--   · el aviso a la sala y el de supervisión salen UNA vez por pedido (por el
--     renglón de menor id).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reserva_receta_decidir(p_id bigint, p_decision text, p_motivo text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas;
  v_emp uuid := public.auth_employee_id();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_codigo text;
  v_ids bigint[];
  v_productos text;
BEGIN
  IF p_decision NOT IN ('aprobada', 'otra_foto', 'rechazada') THEN RAISE EXCEPTION 'DECISION_INVALIDA'; END IF;
  IF p_decision <> 'aprobada' AND v_motivo IS NULL THEN RAISE EXCEPTION 'FALTA_MOTIVO'; END IF;
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF r.estado <> 'en_revision' OR r.receta_estado IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'YA_DECIDIDA';
  END IF;
  -- Todos los renglones del pedido que esperan la misma receta.
  SELECT array_agg(id ORDER BY id), string_agg(producto_nombre, ', ' ORDER BY id) INTO v_ids, v_productos
    FROM public.app_reservas
   WHERE (CASE WHEN r.pedido IS NULL THEN id = r.id ELSE pedido = r.pedido END)
     AND customer_id = r.customer_id AND estado = 'en_revision';
  v_codigo := coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0'));
  UPDATE public.app_reservas
     SET receta_estado = p_decision, receta_motivo = v_motivo,
         receta_revisada_por = v_emp, receta_revisada_at = now(), updated_at = now(),
         estado = CASE p_decision WHEN 'aprobada' THEN 'pendiente' WHEN 'rechazada' THEN 'cancelada' ELSE estado END,
         cerrada_at = CASE WHEN p_decision = 'rechazada' THEN now() ELSE cerrada_at END,
         cerrada_por = CASE WHEN p_decision = 'rechazada' THEN v_emp ELSE cerrada_por END
   WHERE id = ANY (v_ids);
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (r.customer_id, 'receta', 'receta:' || v_codigo || ':' || p_decision || ':' || r.receta_fotos,
          CASE p_decision WHEN 'aprobada' THEN 'Tu receta fue aprobada'
                          WHEN 'otra_foto' THEN 'Necesitamos otra foto de tu receta'
                          ELSE 'Tu reserva no se pudo confirmar' END,
          CASE p_decision WHEN 'aprobada' THEN 'Tu reserva ' || v_codigo || ' (' || left(v_productos, 120) || ') ya está confirmada.'
                          WHEN 'otra_foto' THEN v_motivo || '. Sube otra foto desde Mis reservas.'
                          ELSE v_motivo || '.' END,
          '/reservas')
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'RECETA_' || upper(p_decision), p_id::text,
          jsonb_build_object('motivo', v_motivo, 'pedido', r.pedido, 'renglones', v_ids), r.branch_id, 'portal');
  RETURN json_build_object('ok', true, 'id', p_id, 'decision', p_decision, 'renglones', v_ids);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_reservas_avisar_receta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_dest uuid[]; v_n integer;
BEGIN
  IF NEW.estado = 'en_revision' AND NEW.receta_estado = 'pendiente'
     AND NEW.receta_subida_at IS DISTINCT FROM OLD.receta_subida_at THEN
    -- Un pedido avisa una sola vez: por su renglón de menor id.
    IF NEW.pedido IS NOT NULL AND EXISTS (SELECT 1 FROM public.app_reservas x
        WHERE x.pedido = NEW.pedido AND x.id < NEW.id AND x.estado = 'en_revision') THEN
      RETURN NEW;
    END IF;
    SELECT count(*) INTO v_n FROM public.app_reservas x
     WHERE (CASE WHEN NEW.pedido IS NULL THEN x.id = NEW.id ELSE x.pedido = NEW.pedido END) AND x.estado = 'en_revision';
    SELECT array_agg(e.id) INTO v_dest FROM public.employees e
     WHERE e.status = 'ACTIVO' AND e.branch_id = NEW.branch_id
       AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.module_key = 'dash_reservas'
                   AND rp.can_view AND rp.role_id IN (e.role_id, e.secondary_role_id));
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RECETA_APP', 'Receta por revisar',
        CASE WHEN v_n > 1 THEN 'Pedido ' || NEW.pedido || ' (' || v_n || ' productos)'
             ELSE NEW.producto_nombre || ' · ' || coalesce(NEW.pedido, 'R-' || lpad(NEW.id::text, 6, '0')) END
          || '. Revísala antes de confirmar la reserva.',
        '/', jsonb_build_object('check_key', 'receta:' || coalesce(NEW.pedido, NEW.id::text) || ':' || NEW.receta_fotos, 'reserva_id', NEW.id), true, NEW.branch_id::int);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_reservas_avisar_receta() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recetas_escalar()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r record; v_dest uuid[]; v_n integer := 0;
BEGIN
  SELECT array_agg(e.id) INTO v_dest FROM public.employees e
   WHERE e.status = 'ACTIVO' AND public.rango_de_empleado(e.id) >= 3;
  FOR r IN
    SELECT DISTINCT ON (coalesce(a.pedido, a.id::text))
           a.id, a.branch_id, a.pedido, a.producto_nombre, a.receta_fotos, b.name AS sala, c.name AS cliente
      FROM public.app_reservas a
      JOIN public.branches b ON b.id = a.branch_id
      JOIN public.customers c ON c.id = a.customer_id
     WHERE a.estado = 'en_revision' AND a.receta_estado = 'pendiente'
       AND a.receta_subida_at < now() - interval '4 hours'
       AND (a.receta_escalada_at IS NULL OR a.receta_escalada_at < a.receta_subida_at)
     ORDER BY coalesce(a.pedido, a.id::text), a.id
     LIMIT 50
  LOOP
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RECETA_SIN_REVISAR', 'Receta sin verificar',
        r.sala || ' no ha verificado la receta de ' || r.cliente || ' (' || coalesce('pedido ' || r.pedido, r.producto_nombre) || ') desde hace más de 4 horas.',
        '/', jsonb_build_object('check_key', 'receta-escalada:' || coalesce(r.pedido, r.id::text) || ':' || r.receta_fotos, 'reserva_id', r.id), true, r.branch_id::int);
    END IF;
    UPDATE public.app_reservas SET receta_escalada_at = now()
     WHERE (CASE WHEN r.pedido IS NULL THEN id = r.id ELSE pedido = r.pedido END) AND estado = 'en_revision';
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.recetas_escalar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recetas_escalar() TO service_role;
