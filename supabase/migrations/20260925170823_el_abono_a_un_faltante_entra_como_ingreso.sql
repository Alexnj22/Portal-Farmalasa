SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El abono a un faltante entra a la caja como INGRESO, hecho por el portal.
--
-- Decidido por el usuario el 2026-09-25. El problema: el abono mete efectivo
-- al cajón, y si nadie anotaba su ingreso antes del siguiente corte, ese corte
-- salía con un sobrante igual al abono — que con la regla «el sobrante se
-- acumula» ensuciaba el acumulado de la sala con dinero que no sobró.
--
-- Ahora el portal, al abonar, hace él mismo el ingreso en la caja de esa sala
-- (por `operar-caja`, el mismo camino que usa «Mi caja»), y liga el abono con
-- ese movimiento: queda anotado solo, con su número. Con la caja cerrada NO se
-- abona (usuario): el dinero siempre entra a un cajón abierto y a su corte.
--
-- Y como hacer un ingreso pide «Mi caja», el usuario pidió dárselo a los dos
-- cargos que podían abonar y no lo tenían: Subjefe/a de Sala (su sala) y
-- Gerente General (todas).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. El tipo de ingreso ───────────────────────────────────────────────────
-- `activo = false`: NO aparece en el selector de «Mi caja». Un abono hecho a
-- mano desde ahí no quedaría ligado a ningún faltante; se hace sólo desde la
-- pestaña Diferencias, que escribe los dos lados.
INSERT INTO public.caja_tipos_movimiento
    (codigo, etiqueta, sentido, pide_boleta, pide_persona, foto, lleva_comprobante, leyenda, orden, activo)
VALUES ('ABONO_FALTANTE', 'Abono a faltante de caja', 'ENTRADA', false, false, 'NO', false,
        'Lo hace el portal al abonar un faltante desde Diferencias.', 900, false)
ON CONFLICT (codigo) DO NOTHING;

-- ── 2. El abono sabe con qué ingreso entró ──────────────────────────────────
ALTER TABLE public.cortes_caja_diferencia_abonos
    ADD COLUMN IF NOT EXISTS movimiento_id bigint REFERENCES public.caja_movimientos_portal(id);

-- Un ingreso respalda UN abono: si dos abonos apuntaran al mismo movimiento,
-- un solo billete pagaría dos deudas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cortes_abonos_movimiento
    ON public.cortes_caja_diferencia_abonos (movimiento_id) WHERE movimiento_id IS NOT NULL;

-- Ligar el abono con su ingreso. No se confía en un número que mande el
-- navegador: se comprueba contra la fila del movimiento —misma sala, entrada,
-- del tipo del abono, por el mismo monto, y ya aceptada por la caja— y recién
-- entonces el abono queda anotado.
CREATE OR REPLACE FUNCTION public.ligar_abono_a_ingreso(p_abono_id bigint, p_movimiento_id bigint)
 RETURNS cortes_caja_diferencia_abonos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_ab  public.cortes_caja_diferencia_abonos;
    v_mov public.caja_movimientos_portal;
    v_cid bigint;
BEGIN
    IF NOT (SELECT auth_has_module_permission('cortes_caja_resolver', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    SELECT * INTO v_ab FROM public.cortes_caja_diferencia_abonos WHERE id = p_abono_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese abono no existe.'; END IF;

    IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
       AND v_ab.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF v_ab.anulada_at IS NOT NULL THEN
        RAISE EXCEPTION 'Ese abono esta anulado.';
    END IF;
    -- Ya ligado a ESE mismo movimiento: es un reintento, se contesta igual.
    IF v_ab.movimiento_id = p_movimiento_id THEN
        RETURN v_ab;
    END IF;
    IF v_ab.asentado_at IS NOT NULL THEN
        RAISE EXCEPTION 'Ese abono ya estaba anotado en el sistema.';
    END IF;

    SELECT * INTO v_mov FROM public.caja_movimientos_portal WHERE id = p_movimiento_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese ingreso no existe.'; END IF;
    IF v_mov.branch_id IS DISTINCT FROM v_ab.branch_id
       OR v_mov.tipo <> 'ENTRADA'
       OR v_mov.tipo_codigo IS DISTINCT FROM 'ABONO_FALTANTE'
       OR abs(v_mov.monto - v_ab.monto) >= 0.01 THEN
        RAISE EXCEPTION 'Ese ingreso no corresponde a este abono.';
    END IF;
    IF v_mov.erp_movimiento_id IS NULL THEN
        RAISE EXCEPTION 'La caja todavia no confirmo ese ingreso.';
    END IF;

    UPDATE public.cortes_caja_diferencia_abonos SET
        movimiento_id = p_movimiento_id,
        asentado_at   = now(),
        asentado_por  = (SELECT auth_employee_id()),
        asentado_ref  = 'Ingreso ' || v_mov.erp_movimiento_id
    WHERE id = p_abono_id RETURNING * INTO v_ab;

    SELECT d.corte_id INTO v_cid FROM public.cortes_caja_diferencias d WHERE d.id = v_ab.diferencia_id;
    INSERT INTO public.cortes_caja_eventos (corte_id, accion, motivo, nota, employee_id)
    VALUES (v_cid, 'ASENTAR', 'Ingreso ' || v_mov.erp_movimiento_id,
            'Abono ' || to_char(v_ab.monto, 'FM999999990.00') || ' entro a la caja',
            (SELECT auth_employee_id()));

    RETURN v_ab;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ligar_abono_a_ingreso(bigint, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ligar_abono_a_ingreso(bigint, bigint) TO authenticated, service_role;

-- ── 3. «Mi caja» para Subjefe/a de Sala y Gerente General ───────────────────
-- Por nombre (el branch de pruebas tiene otros ids). El alcance es el mismo que
-- ya tienen en Cortes de caja: la sala propia o todas.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'caja_vales', true, true, false, rp.scope
  FROM public.roles r
  JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.module_key = 'cortes_caja'
 WHERE r.name IN ('Subjefe/a de Sala', 'Gerente General')
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                    WHERE x.role_id = r.id AND x.module_key = 'caja_vales');

UPDATE public.role_permissions rp SET can_view = true, can_edit = true,
       scope = (SELECT c.scope FROM public.role_permissions c
                 WHERE c.role_id = rp.role_id AND c.module_key = 'cortes_caja'),
       updated_at = now()
  FROM public.roles r
 WHERE r.id = rp.role_id AND rp.module_key = 'caja_vales'
   AND r.name IN ('Subjefe/a de Sala', 'Gerente General')
   AND (NOT rp.can_view OR NOT rp.can_edit);
