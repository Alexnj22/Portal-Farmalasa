SET lock_timeout = '5s';

-- Asignar a mano sólo DESPUÉS del arranque.
--
-- La copia del sistema anterior se rehace la madrugada del 1-oct y la carga
-- nueva reemplaza a la vieja — con ella se va la marca `asignada_a` de lo que
-- se hubiera asignado antes. Esa cuenta volvería a salir «por asignar» con sus
-- puntos ya en la ficha, y asignarla otra vez los DUPLICARÍA. Hasta que el
-- libro del portal mande (`puntos_config.fuente = 'portal'`), no se asigna.
CREATE OR REPLACE FUNCTION public.puntos_panel_asignar(
  p_id_cliente bigint, p_customer_id bigint, p_nota text, p_simular boolean DEFAULT true
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos', 'can_edit')) THEN
    RAISE EXCEPTION 'No tienes permiso para asignar cuentas de puntos.' USING ERRCODE = '42501';
  END IF;
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('ok', false,
      'error', 'Las cuentas se pueden asignar a partir del 1 de octubre, cuando los puntos pasen al portal.');
  END IF;
  RETURN public.puntos_asignar_cuenta_anterior(p_id_cliente, p_customer_id, p_nota, p_simular,
                                               (SELECT public.auth_employee_id()));
END;
$$;
