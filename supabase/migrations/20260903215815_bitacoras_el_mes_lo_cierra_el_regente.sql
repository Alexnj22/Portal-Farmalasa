-- El cierre del mes vuelve a ser lo que el sistema ya decía que era.
--
-- `cerrar_mes_bitacora` lanza «Solo el regente puede dar por finalizado el mes»
-- desde el día que se escribió, y el permiso lo tenían SEIS cargos. El único
-- cierre registrado hasta hoy (2026-08, Salud) lo hizo un Supervisor/a de
-- Ventas. Un mensaje que afirma algo que el permiso no sostiene es peor que no
-- decir nada: se lee como una garantía.
--
-- Decisión del usuario (2026-09-03): «solo podrá hacerlo el regente, pero por
-- ahora déjame a mí mientras verifico».
--
-- Se quita a Administrador, Gerente General y Jefe/a de Talento Humano. NO hace
-- falta dejarle la fila a Supervisor/a de Ventas —que es el cargo del usuario—
-- porque ese rol tiene `is_su`, y `auth_has_module_permission` cortocircuita en
-- `auth_is_su()` antes de mirar `role_permissions`. O sea que el acceso
-- temporal existe por la vía del superusuario, que es explícita y auditable,
-- en vez de por una fila que después nadie recuerda quitar.
--
-- `QA / Testing (CI)` se queda: no es una persona, es la cuenta con la que se
-- mide que el sistema funciona, y en este repo una cuenta de pruebas a la que
-- le falta un permiso no da error — da un cero que se lee igual que un verde.
-- Queda declarada como tal en el `[FLS-PRO-02]` punto 2.2.
--
-- Ver `docs/VERIFICACION-PROCEDIMIENTOS-DIGITALES-2026-09-03.md` (B4 y §2.3).

SET lock_timeout = '5s';

UPDATE public.role_permissions rp
   SET can_view = false, can_edit = false, can_approve = false
  FROM public.roles r
 WHERE r.id = rp.role_id
   AND rp.module_key = 'bitacoras_cerrar_mes'
   AND r.name IN ('Administrador', 'Gerente General', 'Jefe/a de Talento Humano',
                  'Supervisor/a de Ventas');

-- Y el mensaje deja de mentir en el otro sentido: ahora sí nombra al regente
-- porque ahora sí es el regente (más el superusuario, que salta todo permiso).
CREATE OR REPLACE FUNCTION public.cerrar_mes_bitacora(p_branch_id bigint, p_periodo text, p_observaciones text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_resumen json;
    v_id bigint;
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras_cerrar_mes', 'can_edit') THEN
        RAISE EXCEPTION 'El cierre del mes lo autoriza el regente.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    IF public.bitacora_periodo_cerrado(p_branch_id, p_periodo) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado.' USING ERRCODE = 'P0001';
    END IF;

    IF p_periodo >= to_char(public.bitacora_hoy_sv(), 'YYYY-MM') THEN
        RAISE EXCEPTION 'Ese mes todavia no termina.' USING ERRCODE = 'P0001';
    END IF;

    v_resumen := public.get_bitacora_resumen_mes(p_branch_id, p_periodo);

    INSERT INTO public.bitacora_cierres (branch_id, periodo, accion, resumen, motivo, actor_id)
    VALUES (p_branch_id, p_periodo, 'cerrar', v_resumen, nullif(btrim(p_observaciones), ''), public.auth_employee_id())
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reabrir_mes_bitacora(p_branch_id bigint, p_periodo text, p_motivo text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint;
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras_cerrar_mes', 'can_edit') THEN
        RAISE EXCEPTION 'Reabrir un mes firmado lo autoriza el regente.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    IF coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'Reabrir un mes firmado exige decir por que.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT public.bitacora_periodo_cerrado(p_branch_id, p_periodo) THEN
        RAISE EXCEPTION 'Ese mes no esta cerrado.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.bitacora_cierres (branch_id, periodo, accion, motivo, actor_id)
    VALUES (p_branch_id, p_periodo, 'reabrir', btrim(p_motivo), public.auth_employee_id())
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$function$;
