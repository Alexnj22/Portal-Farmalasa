-- La firma con carné también en el paquete SUELTO (2026-11-13): el que va a
-- una sala que no es parada de la ruta y se entrega con su propio «Entregué».
-- Hasta acá la firma sólo existía al entregar una parada (`20261113141648`).
--
--   · `ruta_entregar_bolsa_con_carne(id, carné, lat, lng)`: el carné tiene que
--     ser de alguien de la sala DESTINO del paquete (y no el del conductor);
--     entrega y firma en la misma escritura.
--   · `ruta_entregar_bolsa` (sin firma) parte de su definición viva y suma el
--     mismo candado que la parada: con `security_config('ruta_firma_sala')` en
--     `exigir`, se niega. Mientras diga `observar`, no cambia nada. De paso,
--     «entregarla» → «entregarlo» (es un paquete).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.ruta_entregar_bolsa(p_id uuid, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ruta uuid;
BEGIN
  SELECT rb.ruta_id INTO v_ruta FROM public.ruta_bolsas rb
  WHERE rb.id = p_id AND rb.entregada_at IS NULL AND rb.soltada_at IS NULL;
  IF v_ruta IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Ese paquete ya no lo llevas.');
  END IF;
  IF NOT public._ruta_puede_operar(v_ruta) THEN
    RETURN json_build_object('ok', false, 'codigo', 'FORBIDDEN', 'error', 'Sólo el conductor de la ruta puede entregarlo.');
  END IF;
  IF public.sec_exige('ruta_firma_sala') THEN
    RETURN json_build_object('ok', false, 'codigo', 'FALTA_FIRMA', 'error', 'Falta la firma de la sala: pide el carné a quien recibe.');
  END IF;
  UPDATE public.ruta_bolsas
     SET entregada_at = now(), entregada_por = public.auth_employee_id(),
         entregada_lat = p_lat, entregada_lng = p_lng
   WHERE id = p_id AND entregada_at IS NULL AND soltada_at IS NULL;
  RETURN json_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ruta_entregar_bolsa_con_carne(p_id uuid, p_valor text,
                                                                p_lat double precision DEFAULT NULL,
                                                                p_lng double precision DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_b      record;
  v_sala   text;
  v_c      json;
  v_hit    uuid;
  v_nombre text;
BEGIN
  SELECT rb.* INTO v_b FROM public.ruta_bolsas rb
   WHERE rb.id = p_id AND rb.entregada_at IS NULL AND rb.soltada_at IS NULL FOR UPDATE;
  IF v_b.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Ese paquete ya no lo llevas.');
  END IF;
  IF NOT public._ruta_puede_operar(v_b.ruta_id) THEN
    RETURN json_build_object('ok', false, 'codigo', 'FORBIDDEN', 'error', 'Sólo el conductor de la ruta puede entregarlo.');
  END IF;
  SELECT name INTO v_sala FROM public.branches WHERE id = v_b.destino_branch_id;

  v_c := public._carne_a_empleado(p_valor);
  IF NOT coalesce((v_c->>'ok')::boolean, false) THEN RETURN v_c; END IF;
  v_hit := (v_c->>'id')::uuid;
  SELECT name INTO v_nombre FROM public.employees WHERE id = v_hit;

  IF v_hit = public.auth_employee_id() THEN
    RETURN json_build_object('ok', false, 'error', 'Ése es tu carné: firma alguien de la sala que recibe.');
  END IF;
  IF v_b.destino_branch_id IS NULL OR NOT public.puede_entregar_de(v_hit, v_b.destino_branch_id) THEN
    RETURN json_build_object('ok', false, 'error',
      coalesce(v_nombre, 'Esa persona') || ' no es de ' || coalesce(v_sala, 'la sala destino') || ': firma alguien de la sala que recibe.');
  END IF;

  UPDATE public.ruta_bolsas
     SET entregada_at = now(), entregada_por = public.auth_employee_id(),
         entregada_lat = p_lat, entregada_lng = p_lng,
         recibio_firma_por = v_hit, recibio_firma_at = now()
   WHERE id = p_id;
  RETURN json_build_object('ok', true, 'quien', v_nombre, 'sala', v_sala);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ruta_entregar_bolsa_con_carne(uuid, text, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ruta_entregar_bolsa_con_carne(uuid, text, double precision, double precision) TO authenticated, service_role;
