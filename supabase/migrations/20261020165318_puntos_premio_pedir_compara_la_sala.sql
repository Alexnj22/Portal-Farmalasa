SET lock_timeout = '5s';

-- `puntos_premio_pedir` recibe una sucursal: el freno (sala propia, o quien
-- administra) se escribe en su cuerpo y no sólo en el ayudante, para que
-- `gate:alcance` lo vea. Misma regla que `promocionales_puede_en_sala`.
CREATE OR REPLACE FUNCTION public.puntos_premio_pedir(p_id bigint, p_branch integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v public.puntos_premios%ROWTYPE;
BEGIN
  IF NOT (public.promocionales_puede_administrar()
          OR (coalesce((SELECT public.auth_has_module_permission('puntos', 'can_view')), false)
              AND p_branch IS NOT DISTINCT FROM (SELECT public.auth_employee_branch_id()))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.puntos_premios WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v.tipo <> 'promocional' THEN RAISE EXCEPTION 'Sólo un regalo promocional se pide.'; END IF;
  IF v.estado <> 'POR_RETIRAR' OR v.vence_el < (now() AT TIME ZONE 'America/El_Salvador')::date THEN
    RAISE EXCEPTION 'Ese premio ya no se puede pedir.';
  END IF;
  -- Si estaba apartado en otra sala, se suelta: ahora se espera aquí.
  UPDATE public.puntos_premios SET branch_id = p_branch, espera_envio = true, reserva_branch = NULL WHERE id = p_id;
  RETURN json_build_object('ok', true);
END $function$;
