-- `audit_logs.severity` va en MAYÚSCULA y su CHECK lo exige.
--
-- Las dos funciones del código escribían `'warning'` y `'portal'`, y el CHECK
-- `audit_logs_severity_check` sólo acepta `INFO`, `WARNING` o `CRITICAL`. La
-- fila del código se generaba bien y la transacción **se deshacía entera** al
-- llegar a la bitácora: para quien apretaba el botón, «no se pudo generar el
-- código» sin más.
--
-- Y no se ve leyendo: el `INSERT` es sintácticamente perfecto. Lo delata
-- ejecutarlo. Es el mismo error que la sesión ya cometió hoy con `addToast` —
-- suponer la forma de algo en vez de leerla del propio proyecto: los registros
-- que ya existen usan `INFO`/`WARNING`/`CRITICAL` y `ADMIN_PANEL`/`SYSTEM`, y
-- bastaba mirarlos.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puntos_codigo_emitir(p_customer_id bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  ALFABETO constant text := 'ACDEFGHJKMNPQRTUVWXY34679';
  v_emp uuid; v_nombre text; v_codigo text; v_veces int; i int;
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

  -- Emitir es un acto sobre la identidad de un cliente: queda anotado siempre,
  -- y el código NO va en el detalle — la bitácora la leen los mismos que no
  -- deberían poder verlo sin pedirlo.
  INSERT INTO public.audit_logs (user_id, action, target_id, details, severity, source)
  VALUES (v_emp, CASE WHEN v_veces > 1 THEN 'PUNTOS_CODIGO_REEMITIDO' ELSE 'PUNTOS_CODIGO_EMITIDO' END,
          p_customer_id::text,
          jsonb_build_object('cliente', v_nombre, 'veces', v_veces), 'WARNING', 'ADMIN_PANEL');

  RETURN json_build_object('ok', true, 'codigo', v_codigo, 'veces_emitido', v_veces);
END;
$$;

CREATE OR REPLACE FUNCTION public.puntos_codigo_ver(p_customer_id bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_emp uuid; v_nombre text; v_codigo text;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('clientes','can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = 'hace falta permiso de ver Clientes';
  END IF;
  SELECT name INTO v_nombre FROM public.customers WHERE id = p_customer_id;
  SELECT codigo INTO v_codigo FROM public.puntos_codigo_acceso WHERE customer_id = p_customer_id;
  IF v_codigo IS NULL THEN RETURN json_build_object('ok', true, 'codigo', NULL); END IF;

  v_emp := (SELECT public.auth_employee_id());
  -- Mirar la llave de otra persona deja rastro. Sin esto, la protección de la
  -- tabla sería sólo una molestia: cualquiera la abriría y nadie sabría nunca.
  INSERT INTO public.audit_logs (user_id, action, target_id, details, severity, source)
  VALUES (v_emp, 'PUNTOS_CODIGO_VISTO', p_customer_id::text,
          jsonb_build_object('cliente', v_nombre), 'WARNING', 'ADMIN_PANEL');

  RETURN json_build_object('ok', true, 'codigo', v_codigo);
END;
$$;
