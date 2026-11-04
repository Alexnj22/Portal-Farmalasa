-- puntos_codigo_emitir: reemitir el código CIERRA las sesiones abiertas con
-- el código viejo (auditoría 2026-11-04, MEDIO)
--
-- Antes: la sala reemitía el código y la sesión abierta con el anterior
-- (`alcance = 'codigo'`) seguía viva hasta 180 días.
-- Ahora: al emitir se revocan las sesiones de ESA ficha cuyo alcance no sea
-- 'completo'. Las completas (DUI + teléfono) no se tocan.
--
-- Partió de pg_get_functiondef vivo (2026-11-04). SECURITY DEFINER,
-- search_path, firma y ACL iguales. Probado en el branch con execute_sql
-- (cierra la de código, deja la completa). Sin DDL sobre tablas.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puntos_codigo_emitir(p_customer_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  ALFABETO constant text := 'ACDEFGHJKMNPQRTUVWXY34679';
  v_emp uuid; v_nombre text; v_codigo text; v_veces int; i int;
  v_cerradas int := 0;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = 'hace falta permiso de edición en Clientes';
  END IF;
  SELECT name INTO v_nombre FROM public.customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ese cliente no existe'; END IF;
  v_emp := (SELECT public.auth_employee_id());

  -- Se reintenta ante choque en vez de comprobar antes: entre el SELECT y el
  -- INSERT hay un hueco por el que entra otra sesión, y el índice único es lo
  -- único que de verdad decide.
  FOR i IN 1..20 LOOP
    v_codigo := '';
    FOR i IN 1..7 LOOP
      v_codigo := v_codigo || substr(ALFABETO, 1 + floor(random() * length(ALFABETO))::int, 1);
    END LOOP;
    BEGIN
      INSERT INTO public.puntos_codigo_acceso (customer_id, codigo, emitido_por)
      VALUES (p_customer_id, v_codigo, v_emp)
      ON CONFLICT (customer_id) DO UPDATE
        SET codigo = EXCLUDED.codigo, emitido_at = now(), emitido_por = EXCLUDED.emitido_por,
            veces_emitido = public.puntos_codigo_acceso.veces_emitido + 1
      RETURNING veces_emitido INTO v_veces;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_codigo := NULL;   -- chocó con otro código: se vuelve a tirar
    END;
  END LOOP;

  IF v_codigo IS NULL THEN RAISE EXCEPTION 'no se pudo generar un código libre'; END IF;

  -- El código viejo deja de servir para entrar (eso ya lo hacía el UPDATE de
  -- arriba) Y para seguir adentro: las sesiones abiertas con él se cierran.
  UPDATE public.app_cliente_sesiones
     SET revocada_at = now(), push_token = NULL
   WHERE customer_id = p_customer_id
     AND alcance IS DISTINCT FROM 'completo'
     AND revocada_at IS NULL;
  GET DIAGNOSTICS v_cerradas = ROW_COUNT;

  -- Emitir es un acto sobre la identidad de un cliente: queda anotado siempre,
  -- y el código NO va en el detalle.
  INSERT INTO public.audit_logs (user_id, action, target_id, details, severity, source)
  VALUES (v_emp, CASE WHEN v_veces > 1 THEN 'PUNTOS_CODIGO_REEMITIDO' ELSE 'PUNTOS_CODIGO_EMITIDO' END,
          p_customer_id::text,
          jsonb_build_object('cliente', v_nombre, 'veces', v_veces, 'sesiones_cerradas', v_cerradas), 'WARNING', 'ADMIN_PANEL');

  RETURN json_build_object('ok', true, 'codigo', v_codigo, 'veces_emitido', v_veces, 'sesiones_cerradas', v_cerradas);
END;
$function$;
