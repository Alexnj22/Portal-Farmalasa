-- Vincular un kiosco con un ticket impreso (2026-11-17, pedido del usuario).
--
-- Antes: el equipo se configuraba con una llave por hora que nadie podía
-- teclear (el lector sólo acepta tecleo a velocidad de escáner) y exigía una
-- sesión abierta en la computadora de la sucursal. Ahora el supervisor manda a
-- la ticketera de la sucursal un ticket con un código de barras; el equipo lo
-- escanea SIN sesión y queda vinculado de una vez.
--
-- · Lo emite sólo quien tiene `kiosco_vincular` (hoy: Supervisor/a de Ventas).
-- · Un uso, vence a los 15 minutos, guardado como hash (el código viaja una vez).
-- · El tope por tipo lo sigue poniendo `kiosk_devices_tope`.
-- · Si el equipo ya era otro kiosco, el ticket lo reemplaza: el viejo se
--   revoca en la misma transacción, probado con SU token.
-- · Traza: quién lo emitió, por qué sucursal salió y qué equipo nació.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.kiosco_tickets_vinculacion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_hash text NOT NULL UNIQUE,
  branch_id   bigint NOT NULL REFERENCES public.branches(id),
  tipo        text NOT NULL CHECK (tipo IN ('marcacion', 'caja')),
  device_name text NOT NULL,
  emitido_por uuid REFERENCES public.employees(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  vence_at    timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  usado_at    timestamptz,
  device_id   uuid REFERENCES public.kiosk_devices(id) ON DELETE SET NULL,
  reemplazo_device_id uuid
);
CREATE INDEX IF NOT EXISTS idx_kiosco_tickets_branch ON public.kiosco_tickets_vinculacion(branch_id);
CREATE INDEX IF NOT EXISTS idx_kiosco_tickets_device ON public.kiosco_tickets_vinculacion(device_id);

ALTER TABLE public.kiosco_tickets_vinculacion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kiosco_tickets_select ON public.kiosco_tickets_vinculacion;
CREATE POLICY kiosco_tickets_select ON public.kiosco_tickets_vinculacion
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('branches', 'can_view')));
-- Sin policies de escritura: sólo las dos funciones de abajo escriben.

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT 13, 'kiosco_vincular', true, true, false, 'ALL'
 WHERE EXISTS (SELECT 1 FROM public.roles WHERE id = 13)
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role_id = 13 AND module_key = 'kiosco_vincular');

CREATE OR REPLACE FUNCTION public.kiosco_ticket_emitir(p_branch_id bigint, p_tipo text, p_nombre text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_alfabeto constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(10);
  v_codigo text := 'KV';
  v_nombre text;
  v_ticket public.kiosco_tickets_vinculacion;
BEGIN
  IF NOT (SELECT auth_has_module_permission('kiosco_vincular', 'can_view')) THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF p_tipo NOT IN ('marcacion', 'caja') THEN
    RAISE EXCEPTION 'TIPO_INVALIDO';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'SUCURSAL_INVALIDA';
  END IF;

  FOR i IN 0..9 LOOP
    v_codigo := v_codigo || substr(v_alfabeto, (get_byte(v_bytes, i) % 32) + 1, 1);
  END LOOP;
  v_nombre := coalesce(nullif(btrim(p_nombre), ''),
                       CASE p_tipo WHEN 'caja' THEN 'Kiosco de caja' ELSE 'Marcador' END);

  -- Retención: los tickets se vuelven inútiles a los 15 minutos; la traza se
  -- guarda 90 días, como el resto de los registros de sincronización.
  DELETE FROM public.kiosco_tickets_vinculacion WHERE created_at < now() - interval '90 days';

  INSERT INTO public.kiosco_tickets_vinculacion (codigo_hash, branch_id, tipo, device_name, emitido_por)
  VALUES (encode(extensions.digest(v_codigo, 'sha256'), 'hex'), p_branch_id, p_tipo, v_nombre, public.auth_employee_id())
  RETURNING * INTO v_ticket;

  RETURN json_build_object('codigo', v_codigo, 'vence_at', v_ticket.vence_at,
                           'tipo', v_ticket.tipo, 'device_name', v_ticket.device_name);
END;
$function$;

CREATE OR REPLACE FUNCTION public.kiosco_vincular_con_ticket(
  p_codigo text, p_device_id uuid DEFAULT NULL, p_device_token uuid DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ticket public.kiosco_tickets_vinculacion;
  v_viejo uuid;
  v_nuevo public.kiosk_devices;
BEGIN
  SELECT * INTO v_ticket FROM public.kiosco_tickets_vinculacion
   WHERE codigo_hash = encode(extensions.digest(upper(btrim(coalesce(p_codigo, ''))), 'sha256'), 'hex')
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TICKET_INVALIDO'; END IF;
  IF v_ticket.usado_at IS NOT NULL THEN RAISE EXCEPTION 'TICKET_USADO'; END IF;
  IF v_ticket.vence_at < now() THEN RAISE EXCEPTION 'TICKET_VENCIDO'; END IF;

  -- El equipo ya era un kiosco: se reemplaza, probado con su propio token.
  IF p_device_id IS NOT NULL AND public.kiosco_sucursal(p_device_id, p_device_token) IS NOT NULL THEN
    UPDATE public.kiosk_devices SET status = 'REVOKED'
     WHERE id = p_device_id AND status = 'ACTIVE'
    RETURNING id INTO v_viejo;
  END IF;

  INSERT INTO public.kiosk_devices (branch_id, device_name, tipo)
  VALUES (v_ticket.branch_id, v_ticket.device_name, v_ticket.tipo)
  RETURNING * INTO v_nuevo;

  UPDATE public.kiosco_tickets_vinculacion
     SET usado_at = now(), device_id = v_nuevo.id, reemplazo_device_id = v_viejo
   WHERE id = v_ticket.id;

  RETURN json_build_object(
    'device_id', v_nuevo.id, 'device_token', v_nuevo.device_token,
    'branch_id', v_nuevo.branch_id, 'device_name', v_nuevo.device_name, 'tipo', v_nuevo.tipo,
    'branch_name', (SELECT name FROM public.branches WHERE id = v_nuevo.branch_id));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kiosco_ticket_emitir(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kiosco_ticket_emitir(bigint, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.kiosco_vincular_con_ticket(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosco_vincular_con_ticket(text, uuid, uuid) TO anon, authenticated, service_role;
