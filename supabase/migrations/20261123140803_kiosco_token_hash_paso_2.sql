-- El token del kiosco se guarda como hash (paso 2 de 2: fuera el texto plano).
--
-- Después del paso 1 (`kiosco_token_hash_paso_1`) todas las comparaciones van
-- por `kiosco_token_ok` y todos los equipos tienen su hash. Acá:
--   · `kiosco_token_ok` deja de aceptar el texto plano (el 2.º argumento queda
--     en la firma para no reescribir las seis funciones que la llaman; se ignora);
--   · se borra `device_token` de todas las filas y la columna pasa a admitir NULL;
--   · `kiosco_vincular_con_ticket` genera el token, guarda sólo su hash y lo
--     devuelve una vez;
--   · el alta desde el portal (`insertKioskDevice`, src/data/branches.js) sigue
--     igual: inserta con el `default` de la columna y lee el token del
--     `RETURNING`. Un trigger AFTER lo borra de la fila apenas termina la
--     sentencia —el RETURNING ya se calculó—, así que tampoco el frente viejo
--     que quede abierto en algún navegador se rompe.
-- Los equipos vinculados siguen con el MISMO token: sólo cambia lo guardado.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.kiosco_token_ok(p_hash text, p_plano uuid, p_dado uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT p_dado IS NOT NULL
     AND p_hash = public.kiosco_token_hash(p_dado);
$$;

ALTER TABLE public.kiosk_devices ALTER COLUMN device_token DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.kiosk_devices_borrar_token_plano()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.kiosk_devices
     SET device_token = NULL
   WHERE id = NEW.id AND device_token IS NOT NULL;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.kiosk_devices_borrar_token_plano() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_kiosk_devices_borrar_token_plano ON public.kiosk_devices;
CREATE TRIGGER trg_kiosk_devices_borrar_token_plano
  AFTER INSERT OR UPDATE OF device_token ON public.kiosk_devices
  FOR EACH ROW WHEN (NEW.device_token IS NOT NULL)
  EXECUTE FUNCTION public.kiosk_devices_borrar_token_plano();

-- Por si alguna fila quedó sin hash entre un paso y otro.
UPDATE public.kiosk_devices
   SET device_token_hash = public.kiosco_token_hash(device_token)
 WHERE device_token IS NOT NULL AND device_token_hash IS NULL;

UPDATE public.kiosk_devices SET device_token = NULL WHERE device_token IS NOT NULL;

ALTER TABLE public.kiosk_devices ALTER COLUMN device_token_hash SET NOT NULL;

CREATE OR REPLACE FUNCTION public.kiosco_vincular_con_ticket(p_codigo text, p_device_id uuid DEFAULT NULL::uuid, p_device_token uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ticket public.kiosco_tickets_vinculacion;
  v_viejo uuid;
  v_nuevo public.kiosk_devices;
  v_token uuid := gen_random_uuid();
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

  -- Sólo el hash queda guardado; el token sale una vez, en esta respuesta.
  INSERT INTO public.kiosk_devices (branch_id, device_name, tipo, device_token, device_token_hash)
  VALUES (v_ticket.branch_id, v_ticket.device_name, v_ticket.tipo, NULL, public.kiosco_token_hash(v_token))
  RETURNING * INTO v_nuevo;

  UPDATE public.kiosco_tickets_vinculacion
     SET usado_at = now(), device_id = v_nuevo.id, reemplazo_device_id = v_viejo
   WHERE id = v_ticket.id;

  RETURN json_build_object(
    'device_id', v_nuevo.id, 'device_token', v_token,
    'branch_id', v_nuevo.branch_id, 'device_name', v_nuevo.device_name, 'tipo', v_nuevo.tipo,
    'branch_name', (SELECT name FROM public.branches WHERE id = v_nuevo.branch_id));
END;
$function$;
