-- Bitácoras: una lectura imposible no entra.
--
-- Medido el 2026-10-28 sobre octubre: entraron humedades de 0 % (Salud 5,
-- sala de ventas) y 3 % (Bodega). No son lecturas: son teclas. Y una lectura
-- que no puede ser cierta incumple el «preciso» del RTS 6.1.14 aunque nadie la
-- haya inventado a propósito. El rango de AVISO (temp_min/temp_max del área)
-- sigue igual; esto es el rango de lo FÍSICAMENTE posible, y vale para anotar
-- y para corregir — la corrección es la vía para sacar esas dos de octubre.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.bitacora_validar_lectura(p_temperatura numeric, p_humedad numeric)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF p_temperatura IS NULL THEN
        RAISE EXCEPTION 'Falta la temperatura.' USING ERRCODE = 'P0001';
    END IF;
    IF p_temperatura < -20 OR p_temperatura > 50 THEN
        RAISE EXCEPTION 'Una temperatura de % °C no es posible en el termometro. Revisa el valor.', p_temperatura
            USING ERRCODE = 'P0001';
    END IF;
    IF p_humedad IS NOT NULL AND (p_humedad < 10 OR p_humedad > 100) THEN
        RAISE EXCEPTION 'Una humedad de % %% no es posible. Revisa el valor del higrometro.', p_humedad
            USING ERRCODE = 'P0001';
    END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.bitacora_validar_lectura(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bitacora_validar_lectura(numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.registrar_lectura_bitacora(p_area_id bigint, p_fecha date, p_franja text, p_temperatura numeric, p_humedad numeric DEFAULT NULL::numeric, p_accion text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_area   public.bitacora_areas%ROWTYPE;
    v_franja jsonb;
    v_fuera  boolean;
    v_tarde  boolean;
    v_ahora  timestamp := public.bitacora_ahora_sv();
    v_id     bigint;
BEGIN
    SELECT * INTO v_area FROM public.bitacora_areas WHERE id = p_area_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esa area no existe.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.bitacora_exigir_acceso(v_area.branch_id, 'can_edit');

    IF NOT v_area.activa THEN
        RAISE EXCEPTION 'Esa area esta desactivada.' USING ERRCODE = 'P0001';
    END IF;

    PERFORM public.bitacora_validar_lectura(p_temperatura,
        CASE WHEN v_area.mide_humedad THEN p_humedad ELSE NULL END);

    IF public.bitacora_periodo_cerrado(v_area.branch_id, to_char(p_fecha, 'YYYY-MM')) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado. Hay que reabrirlo para poder anotar.' USING ERRCODE = 'P0001';
    END IF;

    SELECT f INTO v_franja
      FROM jsonb_array_elements(v_area.franjas) f
     WHERE f->>'clave' = p_franja;
    IF v_franja IS NULL THEN
        RAISE EXCEPTION 'Esa franja no existe en la configuracion del area.' USING ERRCODE = 'P0002';
    END IF;

    IF p_fecha > public.bitacora_hoy_sv()
       OR (p_fecha = public.bitacora_hoy_sv()
           AND v_ahora::time < (v_franja->>'desde')::time - interval '15 minutes') THEN
        RAISE EXCEPTION 'Todavia no toca esa lectura.' USING ERRCODE = 'P0001';
    END IF;

    v_fuera := (v_area.temp_min IS NOT NULL AND p_temperatura < v_area.temp_min)
            OR (v_area.temp_max IS NOT NULL AND p_temperatura > v_area.temp_max);

    IF v_fuera AND coalesce(btrim(p_accion), '') = '' THEN
        RAISE EXCEPTION 'La temperatura esta fuera de rango: hay que anotar que se hizo.' USING ERRCODE = 'P0001';
    END IF;

    v_tarde := p_fecha <> public.bitacora_hoy_sv()
            OR v_ahora::time < (v_franja->>'desde')::time
            OR v_ahora::time > (v_franja->>'hasta')::time;

    INSERT INTO public.bitacora_lecturas (
        area_id, fecha, franja, temperatura, humedad,
        fuera_de_rango, accion_correctiva, registrado_por, registrado_at, tarde
    ) VALUES (
        p_area_id, p_fecha, p_franja, p_temperatura,
        CASE WHEN v_area.mide_humedad THEN p_humedad ELSE NULL END,
        v_fuera, nullif(btrim(p_accion), ''), public.auth_employee_id(), now(), v_tarde
    )
    RETURNING id INTO v_id;

    RETURN v_id;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Esa franja ya tiene su lectura. Para cambiarla hay que corregirla.' USING ERRCODE = 'P0001';
END;
$function$;

CREATE OR REPLACE FUNCTION public.corregir_lectura_bitacora(p_lectura_id bigint, p_temperatura numeric, p_humedad numeric, p_accion text, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_l     public.bitacora_lecturas%ROWTYPE;
    v_area  public.bitacora_areas%ROWTYPE;
    v_fuera boolean;
BEGIN
    IF coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'Una correccion sin motivo no se puede guardar.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_l FROM public.bitacora_lecturas WHERE id = p_lectura_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esa lectura no existe.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_area FROM public.bitacora_areas WHERE id = v_l.area_id;
    PERFORM public.bitacora_exigir_acceso(v_area.branch_id, 'can_edit');

    PERFORM public.bitacora_validar_lectura(p_temperatura,
        CASE WHEN v_area.mide_humedad THEN p_humedad ELSE NULL END);

    IF public.bitacora_periodo_cerrado(v_area.branch_id, to_char(v_l.fecha, 'YYYY-MM')) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado. Hay que reabrirlo para poder corregir.' USING ERRCODE = 'P0001';
    END IF;

    v_fuera := (v_area.temp_min IS NOT NULL AND p_temperatura < v_area.temp_min)
            OR (v_area.temp_max IS NOT NULL AND p_temperatura > v_area.temp_max);
    IF v_fuera AND coalesce(btrim(p_accion), '') = '' THEN
        RAISE EXCEPTION 'La temperatura esta fuera de rango: hay que anotar que se hizo.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.bitacora_correcciones (
        lectura_id, temperatura_antes, humedad_antes, accion_antes,
        temperatura_despues, humedad_despues, accion_despues, motivo, corregido_por
    ) VALUES (
        p_lectura_id, v_l.temperatura, v_l.humedad, v_l.accion_correctiva,
        p_temperatura, p_humedad, nullif(btrim(p_accion), ''), btrim(p_motivo),
        public.auth_employee_id()
    );

    UPDATE public.bitacora_lecturas
       SET temperatura = p_temperatura,
           humedad = CASE WHEN v_area.mide_humedad THEN p_humedad ELSE NULL END,
           fuera_de_rango = v_fuera,
           accion_correctiva = nullif(btrim(p_accion), '')
     WHERE id = p_lectura_id;
END;
$function$;
