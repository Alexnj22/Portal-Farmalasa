SET lock_timeout = '5s';

-- Paso 5 del alta de modulo: sin filas aca el modulo no existe para nadie.
-- Se copian de `ventas` porque es el modulo hermano: el corte de caja es el
-- dinero de esas mismas ventas, y quien mira una sala mira la otra. El scope
-- viaja tal cual, asi que quien ve solo su sucursal en Ventas ve solo su
-- sucursal en Cortes.
--
-- Efecto medido al aplicarlo: la sala (Dependiente, Jefe/a y Subjefe/a de Sala,
-- Regente) queda con can_view pero SIN can_edit, o sea que ve sus cortes y no
-- los resuelve; confirman Gerente General, Administrador, Supervisor/a de
-- Ventas y Jefe/a de Talento Humano. Es el default prudente mientras el usuario
-- decide: ampliar es un clic en Permisos, deshacer una confirmacion indebida no.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'cortes_caja', rp.can_view, rp.can_edit, false, rp.scope
FROM public.role_permissions rp
WHERE rp.module_key = 'ventas'
ON CONFLICT (role_id, module_key) DO UPDATE
   SET can_view = EXCLUDED.can_view,
       can_edit = EXCLUDED.can_edit,
       scope    = EXCLUDED.scope
   WHERE role_permissions.can_view IS DISTINCT FROM EXCLUDED.can_view
      OR role_permissions.can_edit IS DISTINCT FROM EXCLUDED.can_edit
      OR role_permissions.scope    IS DISTINCT FROM EXCLUDED.scope;

-- ── Confirmar / descartar ───────────────────────────────────────────────────
-- Entra por RPC y no por un UPDATE suelto desde el navegador: el estado de un
-- corte decide si a alguien se le cobra un faltante, asi que quien lo puso
-- tiene que quedar registrado por el servidor y no por lo que mande el cliente
-- (mismo criterio que el resto de RPCs de autoria del proyecto).
CREATE OR REPLACE FUNCTION public.resolver_corte_caja(
  p_id            bigint,
  p_estado        text,
  p_motivo        text DEFAULT NULL,
  p_observaciones text DEFAULT NULL
) RETURNS public.cortes_caja
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_corte public.cortes_caja;
  v_scope text;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_estado NOT IN ('CONFIRMADO','DESCARTADO') THEN
    RAISE EXCEPTION 'Estado invalido: %', p_estado;
  END IF;

  IF p_estado = 'DESCARTADO' AND (p_motivo IS NULL OR btrim(p_motivo) = '') THEN
    RAISE EXCEPTION 'Descartar un corte exige decir por que.';
  END IF;

  SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El corte no existe.';
  END IF;

  -- Quien ve solo su sala no resuelve la de otra. Se chequea aca porque la
  -- funcion es DEFINER y por lo tanto no pasa por la policy de la tabla.
  v_scope := (SELECT auth_module_scope('cortes_caja'));
  IF v_scope IS DISTINCT FROM 'ALL'
     AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- El Z es el cierre del dia, no un conteo: no se confirma ni se descarta.
  IF v_corte.tipo <> 'C' THEN
    RAISE EXCEPTION 'El cierre del dia no se confirma.';
  END IF;

  -- Un corte resuelto no se repisa. Si quedo mal, se corrige por el camino
  -- explicito (reabrir), no sobreescribiendo la decision anterior en silencio.
  IF v_corte.estado <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'Este corte ya fue resuelto.';
  END IF;

  UPDATE public.cortes_caja SET
    estado          = p_estado,
    motivo_descarte = CASE WHEN p_estado = 'DESCARTADO' THEN btrim(p_motivo) END,
    observaciones   = NULLIF(btrim(coalesce(p_observaciones,'')), ''),
    resuelto_por    = (SELECT auth_employee_id()),
    resuelto_at     = now(),
    updated_at      = now()
  WHERE id = p_id
  RETURNING * INTO v_corte;

  RETURN v_corte;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolver_corte_caja(bigint, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolver_corte_caja(bigint, text, text, text) TO authenticated, service_role;
