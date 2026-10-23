-- segunda-a1-01 · Solicitudes: quien pide ya no reescribe su solicitud (H1, H3, H4)
-- 1. La policy de UPDATE pierde las ramas de quien pidió y del compañero.
-- 2. Esas acciones pasan a DEFINER: cancelar_mi_solicitud y decidir_cambio_de_turno_como_par.
-- 3. Candado BEFORE UPDATE para escrituras directas del navegador.
SET lock_timeout = '5s';

-- ── 1 · El candado ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approval_requests_candado_cliente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
    v_yo uuid;
BEGIN
    -- Sólo la escritura DIRECTA del navegador. Una función DEFINER corre como
    -- su dueño y una edge function como service_role: ésas validan por su
    -- cuenta y este candado no les aplica.
    IF current_user <> 'authenticated' THEN
        RETURN NEW;
    END IF;

    IF NEW.type IS DISTINCT FROM OLD.type
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Una solicitud no cambia de tipo ni de dueño.'
            USING ERRCODE = '42501';
    END IF;

    v_yo := public.auth_employee_id();
    IF v_yo IS NOT NULL AND v_yo = OLD.employee_id THEN
        RAISE EXCEPTION 'Tu propia solicitud no se edita: si ya no la necesitas, cancélala.'
            USING ERRCODE = '42501';
    END IF;

    -- metadata es lo que las edge functions releen al aplicar. Desde el
    -- navegador sólo se le suma el motivo de un rechazo.
    IF NEW.metadata IS DISTINCT FROM OLD.metadata THEN
        IF NOT (OLD.status = 'PENDING' AND NEW.status = 'REJECTED'
                AND (coalesce(NEW.metadata, '{}'::jsonb) - 'rejection_reason' - 'sugerencia')
                    = (coalesce(OLD.metadata, '{}'::jsonb) - 'rejection_reason' - 'sugerencia')) THEN
            RAISE EXCEPTION 'El detalle de una solicitud no se edita después de enviarla.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approval_requests_candado_cliente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS approval_requests_candado_cliente ON public.approval_requests;
CREATE TRIGGER approval_requests_candado_cliente
    BEFORE UPDATE ON public.approval_requests
    FOR EACH ROW EXECUTE FUNCTION public.approval_requests_candado_cliente();

-- ── 2 · La policy de UPDATE: sólo quien decide ────────────────────────────
-- Las ramas de módulo son copia literal de la viva (pg_policies, 2026-10-23).
DROP POLICY IF EXISTS approval_requests_update ON public.approval_requests;
CREATE POLICY approval_requests_update ON public.approval_requests
FOR UPDATE
USING (
    ((modulo_de_aprobacion(type) = 'requests_facturacion'::text)
      AND (SELECT auth_has_module_permission('requests_facturacion'::text, 'can_approve'::text))
      AND CASE (SELECT auth_module_scope('requests_facturacion'::text))
            WHEN 'ALL'::text THEN true
            WHEN 'MINE'::text THEN false
            ELSE EXISTS (SELECT 1 FROM employees e
                          WHERE e.id = approval_requests.employee_id
                            AND e.branch_id = (SELECT auth_employee_branch_id()))
          END)
 OR ((modulo_de_aprobacion(type) = 'requests_inventario'::text)
      AND (SELECT auth_has_module_permission('requests_inventario'::text, 'can_approve'::text))
      AND CASE (SELECT auth_module_scope('requests_inventario'::text))
            WHEN 'ALL'::text THEN true
            WHEN 'MINE'::text THEN false
            ELSE EXISTS (SELECT 1 FROM employees e
                          WHERE e.id = approval_requests.employee_id
                            AND e.branch_id = (SELECT auth_employee_branch_id()))
          END)
 OR ((modulo_de_aprobacion(type) = 'requests_caja'::text)
      AND (SELECT auth_has_module_permission('requests_caja'::text, 'can_approve'::text))
      AND (((SELECT auth_module_scope('requests_caja'::text)) = 'ALL'::text)
           OR ((NULLIF((metadata ->> 'branch_id'::text), ''::text))::integer = (SELECT auth_employee_branch_id()))))
 OR ((modulo_de_aprobacion(type) = 'requests_cuentas_por_cobrar'::text)
      AND (SELECT auth_has_module_permission('requests_cuentas_por_cobrar'::text, 'can_approve'::text))
      AND (((SELECT auth_module_scope('requests_cuentas_por_cobrar'::text)) = 'ALL'::text)
           OR ((NULLIF((metadata ->> 'branch_id'::text), ''::text))::integer = (SELECT auth_employee_branch_id()))))
 OR ((NOT es_solicitud_operativa(type))
      AND (SELECT auth_has_module_permission('requests_personales'::text, 'can_approve'::text))
      AND CASE (SELECT auth_module_scope('requests_personales'::text))
            WHEN 'ALL'::text THEN true
            WHEN 'MINE'::text THEN false
            ELSE EXISTS (SELECT 1 FROM employees e
                          WHERE e.id = approval_requests.employee_id
                            AND e.branch_id = (SELECT auth_employee_branch_id()))
          END)
 OR ((type = 'INVENTORY_TRANSFER_REQUEST'::text)
      AND (SELECT auth_has_module_permission('traslados'::text, 'can_approve'::text))
      AND (((SELECT auth_module_scope('traslados'::text)) = 'ALL'::text)
           OR ((NULLIF((metadata ->> 'origen_branch_id'::text), ''::text))::integer = (SELECT auth_employee_branch_id()))
           OR ((NULLIF((metadata ->> 'branch_id'::text), ''::text))::integer = (SELECT auth_employee_branch_id()))
           OR ((status = 'PENDING'::text)
               AND ((NULLIF((metadata ->> 'origen_branch_id'::text), ''::text))::integer
                    = ANY (COALESCE((SELECT salas_que_cubro_ahora()), ARRAY[]::integer[]))))))
);

-- ── 3 · Cancelar la propia ─────────────────────────────────────────────────
-- Los tipos que NO se cancelan desde aquí tienen efectos ya aplicados o su
-- propio camino: el abono en aprobación ya entró a la caja (rechazarlo es
-- deshacerlo), el ingreso sin comprobante ya está registrado, el envío se
-- cancela con `cancelar_envio`, y Distribución anula por su función.
CREATE OR REPLACE FUNCTION public.cancelar_mi_solicitud(p_solicitud uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_yo uuid := public.auth_employee_id();
    r    public.approval_requests;
BEGIN
    IF v_yo IS NULL THEN
        RAISE EXCEPTION 'Sin sesión.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO r FROM public.approval_requests WHERE id = p_solicitud FOR UPDATE;
    IF NOT FOUND OR r.employee_id IS DISTINCT FROM v_yo THEN
        RAISE EXCEPTION 'Sólo quien pidió la solicitud puede cancelarla.' USING ERRCODE = '42501';
    END IF;

    IF r.status <> 'PENDING' THEN
        RETURN json_build_object('ok', false, 'ya_resuelta', true, 'estado', r.status);
    END IF;

    IF r.type IN ('ABONO_APROBACION', 'CAJA_INGRESO_AUTORIZACION',
                  'INVENTORY_TRANSFER_PUSH', 'DIST_DESCUENTO', 'DIST_INVALIDACION') THEN
        RAISE EXCEPTION 'Esta solicitud no se cancela desde aquí: pide que la rechacen.';
    END IF;

    -- Mientras una edge function la está aplicando (arriendo de 3 minutos de
    -- `reclamar_solicitud`), cancelarla dejaría lo aplicado sin solicitud.
    IF r.metadata->>'aplicando_desde' IS NOT NULL
       AND (r.metadata->>'aplicando_desde')::timestamptz > now() - interval '180 seconds' THEN
        RAISE EXCEPTION 'La solicitud se está aplicando en este momento: espera un minuto.';
    END IF;

    UPDATE public.approval_requests
       SET status = 'CANCELLED', updated_at = now()
     WHERE id = p_solicitud;

    RETURN json_build_object('ok', true, 'estado', 'CANCELLED');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancelar_mi_solicitud(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_mi_solicitud(uuid) TO authenticated, service_role;

-- ── 4 · El compañero del cambio de turno ──────────────────────────────────
-- Nivel 1 de un SHIFT_CHANGE: lo decide el compañero (`approver_id`). Puede
-- rechazar (con motivo), pasarla al nivel 2 —a alguien que SÍ puede decidir
-- solicitudes personales— o cerrarla él mismo sólo si es jefatura/subjefatura
-- o si no hay nadie más que pueda decidirla.
CREATE OR REPLACE FUNCTION public.decidir_cambio_de_turno_como_par(
    p_solicitud uuid, p_aprobar boolean, p_nota text DEFAULT NULL, p_siguiente uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_yo    uuid := public.auth_employee_id();
    r       public.approval_requests;
    v_nota  text := nullif(btrim(coalesce(p_nota, '')), '');
    v_aprob jsonb;
    v_rango smallint;
BEGIN
    IF v_yo IS NULL THEN
        RAISE EXCEPTION 'Sin sesión.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO r FROM public.approval_requests WHERE id = p_solicitud FOR UPDATE;
    IF NOT FOUND OR r.type <> 'SHIFT_CHANGE'
       OR r.approver_id IS DISTINCT FROM v_yo OR r.employee_id = v_yo THEN
        RAISE EXCEPTION 'Esta solicitud no te toca decidirla.' USING ERRCODE = '42501';
    END IF;

    IF r.status <> 'PENDING' OR coalesce(r.current_level, 1) <> 1 THEN
        RETURN json_build_object('ok', false, 'ya_resuelta', true);
    END IF;

    IF NOT coalesce(p_aprobar, false) THEN
        IF v_nota IS NULL THEN
            RAISE EXCEPTION 'Una solicitud se rechaza con motivo: escribí por qué.';
        END IF;
        UPDATE public.approval_requests
           SET status = 'REJECTED', approver_note = v_nota, updated_at = now()
         WHERE id = p_solicitud;
        RETURN json_build_object('ok', true, 'estado', 'REJECTED');
    END IF;

    v_aprob := coalesce(r.approvals, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'level', 1, 'approverId', v_yo, 'approverNote', coalesce(v_nota, ''),
        'approvedAt', to_jsonb(now())));

    IF p_siguiente IS NOT NULL THEN
        IF p_siguiente IN (r.employee_id, v_yo)
           OR NOT public.puede_aprobar_modulo(p_siguiente, 'requests_personales') THEN
            RAISE EXCEPTION 'Esa persona no puede dar la aprobación final.' USING ERRCODE = '42501';
        END IF;
        UPDATE public.approval_requests
           SET current_level = 2, approver_id = p_siguiente, approvals = v_aprob, updated_at = now()
         WHERE id = p_solicitud;
        RETURN json_build_object('ok', true, 'estado', 'NIVEL_2', 'siguiente', p_siguiente);
    END IF;

    -- Cerrarla sin escalar: jefatura o subjefatura (rango 1–2), o nadie más
    -- que pueda decidirla.
    v_rango := public.rango_de_empleado(v_yo);
    IF NOT (coalesce(v_rango, 0) BETWEEN 1 AND 2)
       AND EXISTS (SELECT 1 FROM public.employees e
                    WHERE e.status = 'ACTIVO' AND e.id NOT IN (r.employee_id, v_yo)
                      AND public.puede_aprobar_modulo(e.id, 'requests_personales')) THEN
        RAISE EXCEPTION 'Falta la aprobación final: la solicitud tiene que pasar a quien la cierra.'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.approval_requests
       SET status = 'APPROVED', approver_note = v_nota, approvals = v_aprob, updated_at = now()
     WHERE id = p_solicitud;
    RETURN json_build_object('ok', true, 'estado', 'APPROVED');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decidir_cambio_de_turno_como_par(uuid, boolean, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decidir_cambio_de_turno_como_par(uuid, boolean, text, uuid) TO authenticated, service_role;
