-- Punto 6, parte 2 (2026-11-13): la sala firma con su carné lo que recibe de
-- la ruta, y la sala destino se entera de que su paquete viene en camino.
--
-- Decisión del usuario: «si me gusta, dejémoslo opcional por ahora, pero
-- anotada para convertirse en obligatorio».
--
--   · `ruta_firma_sala_carne(parada, carné)`: el conductor le pide el carné a
--     quien recibe y lo escanea en su teléfono. Queda en
--     `ruta_pedidos.firma_sala_por/at` y en cada paquete que se deja en esa
--     parada (`ruta_bolsas.recibio_firma_*`). No se usa `confirmado_suc_por`:
--     apunta a `auth.users` (la cuenta), y lo que firma es la FICHA.
--     Se firma ANTES de marcar la parada entregada, para que el día que sea
--     obligatoria la entrega pueda exigirla.
--   · Obligatoria = UNA fila: `security_config('ruta_firma_sala')` nace en
--     `observar`. Con `exigir`, el trigger `ruta_pedidos_exige_firma_sala`
--     rechaza marcar entregada una parada sin firma, y la app ya no ofrece
--     «Sin firma». La marcha atrás es volver la fila a `observar`.
--   · «Viene en camino»: al recoger un paquete (insert en `ruta_bolsas`) se
--     avisa a la gente de la sala destino. Sólo a la sala: si no hay nadie que
--     pueda recibir, no se escala a supervisión (es un aviso de cortesía).
SET lock_timeout = '5s';

ALTER TABLE public.ruta_pedidos
  ADD COLUMN IF NOT EXISTS firma_sala_por uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS firma_sala_at  timestamptz;

ALTER TABLE public.ruta_bolsas
  ADD COLUMN IF NOT EXISTS recibio_firma_por uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS recibio_firma_at  timestamptz;

INSERT INTO public.security_config (key, estado, nota)
VALUES ('ruta_firma_sala', 'observar',
        'Punto 6 de traslados (2026-11-13): la sala firma con carné lo que le deja la ruta de reparto. '
     || 'Opcional por decisión del usuario, «anotada para convertirse en obligatorio»: con exigir, '
     || 'ninguna parada se marca entregada sin la firma (trigger ruta_pedidos_exige_firma_sala).')
ON CONFLICT (key) DO NOTHING;

-- ── El carné → la persona, con el mismo tope y registro que el recorrido ──
CREATE OR REPLACE FUNCTION public._carne_a_empleado(p_valor text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_quien  uuid   := public.auth_employee_id();
  v_sala   bigint := public.auth_employee_branch_id();
  v_limpio text   := upper(regexp_replace(coalesce(p_valor, ''), '\s', '', 'g'));
  v_fallos integer;
  v_hit    uuid;
  v_metodo text;
BEGIN
  IF v_quien IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Sesión inválida.');
  END IF;
  IF v_limpio = '' THEN
    RETURN json_build_object('ok', false, 'codigo', 'CARNE_VACIO', 'error', 'No se leyó ningún código. Vuelve a pasar el carné.');
  END IF;
  SELECT count(*) INTO v_fallos FROM public.intentos_identidad i
   WHERE i.quien = v_quien AND i.proposito = 'CARNE_LOOKUP' AND NOT i.exito
     AND i.created_at > now() - interval '15 minutes';
  IF v_fallos >= 20 THEN
    RETURN json_build_object('ok', false, 'codigo', 'DEMASIADOS', 'error', 'Demasiados carnés sin reconocer seguidos. Espera unos minutos.');
  END IF;
  SELECT e.id, 'CARNE' INTO v_hit, v_metodo FROM public.employees e
   WHERE e.status = 'ACTIVO' AND btrim(coalesce(e.kiosk_pin, '')) <> '' AND upper(btrim(e.kiosk_pin)) = v_limpio LIMIT 1;
  IF v_hit IS NULL THEN
    SELECT e.id, 'CODIGO' INTO v_hit, v_metodo FROM public.employees e
     WHERE e.status = 'ACTIVO' AND btrim(coalesce(e.code, '')) <> '' AND upper(btrim(e.code)) = v_limpio LIMIT 1;
  END IF;
  IF v_hit IS NULL THEN
    v_hit := public.resolver_carne_temporal(v_limpio);
    IF v_hit IS NOT NULL THEN v_metodo := 'CARNE_TEMPORAL'; END IF;
  END IF;
  INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
  VALUES (v_quien, 'CARNE_LOOKUP', v_hit, coalesce(v_metodo, 'DESCONOCIDO'), v_hit IS NOT NULL, v_sala);
  IF v_hit IS NULL THEN
    RETURN json_build_object('ok', false, 'codigo', 'CARNE_DESCONOCIDO', 'error', 'Ese carné no es de nadie.');
  END IF;
  RETURN json_build_object('ok', true, 'id', v_hit);
END;
$$;
REVOKE EXECUTE ON FUNCTION public._carne_a_empleado(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._carne_a_empleado(text) TO service_role;

-- ── La firma de la sala en una parada ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ruta_firma_sala_carne(p_stop_id uuid, p_valor text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_stop   record;
  v_branch bigint;
  v_sala   text;
  v_c      json;
  v_hit    uuid;
  v_nombre text;
  v_n      integer;
BEGIN
  SELECT rp.* INTO v_stop FROM public.ruta_pedidos rp WHERE rp.id = p_stop_id FOR UPDATE;
  IF v_stop.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Esa parada no existe.');
  END IF;
  IF NOT public._ruta_puede_operar(v_stop.ruta_id) THEN
    RETURN json_build_object('ok', false, 'error', 'Sólo el conductor de la ruta puede pedir la firma.');
  END IF;
  IF v_stop.firma_sala_por IS NOT NULL THEN
    SELECT name INTO v_nombre FROM public.employees WHERE id = v_stop.firma_sala_por;
    RETURN json_build_object('ok', true, 'ya', true, 'quien', v_nombre);
  END IF;

  SELECT m.branch_id INTO v_branch FROM public.erp_sucursal_map m WHERE m.erp_sucursal_id = v_stop.erp_sucursal_id;
  SELECT name INTO v_sala FROM public.branches WHERE id = v_branch;

  v_c := public._carne_a_empleado(p_valor);
  IF NOT coalesce((v_c->>'ok')::boolean, false) THEN RETURN v_c; END IF;
  v_hit := (v_c->>'id')::uuid;
  SELECT name INTO v_nombre FROM public.employees WHERE id = v_hit;

  IF v_hit = public.auth_employee_id() THEN
    RETURN json_build_object('ok', false, 'error', 'Ése es tu carné: firma alguien de la sala que recibe.');
  END IF;
  IF v_branch IS NULL OR NOT public.puede_entregar_de(v_hit, v_branch) THEN
    RETURN json_build_object('ok', false, 'error',
      coalesce(v_nombre, 'Esa persona') || ' no es de ' || coalesce(v_sala, 'esta sala') || ': firma alguien de la sala que recibe.');
  END IF;

  UPDATE public.ruta_pedidos SET firma_sala_at = now(), firma_sala_por = v_hit WHERE id = v_stop.id;
  -- Los paquetes que se quedan en esta parada: los que llevaba para esta sala
  -- (se entregan al marcar la parada) y los que ya se entregaron aquí.
  UPDATE public.ruta_bolsas SET recibio_firma_por = v_hit, recibio_firma_at = now()
   WHERE ruta_id = v_stop.ruta_id AND destino_erp_sucursal_id = v_stop.erp_sucursal_id
     AND soltada_at IS NULL AND recibio_firma_por IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN json_build_object('ok', true, 'quien', v_nombre, 'sala', v_sala, 'paquetes', v_n);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ruta_firma_sala_carne(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ruta_firma_sala_carne(uuid, text) TO authenticated, service_role;

-- ¿Se exige hoy? La app lo lee para ofrecer (o no) «Sin firma».
CREATE OR REPLACE FUNCTION public.ruta_firma_sala_exigida()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT public.sec_exige('ruta_firma_sala');
$$;
REVOKE EXECUTE ON FUNCTION public.ruta_firma_sala_exigida() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ruta_firma_sala_exigida() TO authenticated, service_role;

-- ── El candado, apagado mientras la fila diga `observar` ─────────────────
CREATE OR REPLACE FUNCTION public.ruta_pedidos_exige_firma_sala()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF NEW.entregado_at IS NOT NULL AND OLD.entregado_at IS NULL
     AND NEW.firma_sala_por IS NULL
     AND public.sec_exige('ruta_firma_sala') THEN
    RAISE EXCEPTION 'Falta la firma de la sala: pide el carné a quien recibe.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ruta_pedidos_exige_firma_sala ON public.ruta_pedidos;
CREATE TRIGGER trg_ruta_pedidos_exige_firma_sala
  BEFORE UPDATE OF entregado_at ON public.ruta_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.ruta_pedidos_exige_firma_sala();

-- ── «Viene en camino» ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.avisar_paquete_en_camino()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_dest   uuid[];
  v_esc    text;
  v_quien  text;
  v_origen text;
BEGIN
  IF NEW.destino_branch_id IS NULL THEN RETURN NEW; END IF;
  SELECT d.destinatarios, d.escalon INTO v_dest, v_esc
    FROM public.resolver_destinatarios_traslado(NEW.destino_branch_id::integer) d;
  IF v_esc NOT IN ('SALA', 'SALA_Y_RESPALDO') OR coalesce(array_length(v_dest, 1), 0) = 0 THEN
    RETURN NEW;
  END IF;
  SELECT public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name) INTO v_quien
    FROM public.employees e WHERE e.id = NEW.recogida_por;
  SELECT name INTO v_origen FROM public.branches WHERE id = NEW.origen_branch_id;
  PERFORM public.notify_employees(v_dest, 'REQUEST_RESOLVED', 'Tu paquete viene en camino',
    coalesce(v_quien, 'La ruta de reparto') || ' lleva el paquete '
      || coalesce(NEW.codigo, '') || ' de ' || coalesce(v_origen, 'otra sala')
      || '. Llega con la ruta de hoy: revísalo y recíbelo al llegar.',
    '/traslados', jsonb_build_object('request_id', NEW.request_id, 'resuelta', 'EN_CAMINO'),
    true, NEW.destino_branch_id::integer);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_avisar_paquete_en_camino ON public.ruta_bolsas;
CREATE TRIGGER trg_avisar_paquete_en_camino
  AFTER INSERT ON public.ruta_bolsas
  FOR EACH ROW EXECUTE FUNCTION public.avisar_paquete_en_camino();
