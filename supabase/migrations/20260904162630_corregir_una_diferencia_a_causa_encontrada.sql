-- Corregir una diferencia ya resuelta a «ya se encontró la causa».
--
-- Reportado por el usuario el 2026-09-04 sobre el sobrante de $50 de Salud 5 del
-- 31-ago: la causa escrita decía «ya se encontro la causa», y la fila quedó
-- guardada como RETIRA — o sea que el portal le pedía hacer un VALE por dinero
-- que nadie iba a sacar del cajón. El formulario llega con la vía PRESELECCIONADA
-- según el signo (`useState(falta ? 'REPONE' : 'RETIRA')`), así que escribir la
-- causa y guardar sin tocar el segmentado manda el default: «no lo toco» y «lo
-- mando como viene» son lo mismo.
--
-- La salida existía —anular y resolver de nuevo— pero vive en la tarjeta del
-- corte, y quien descubre el error lo descubre en «Registrar en el sistema»,
-- donde el único botón decía «Marcar registrado». Esta función es esa salida,
-- del lado del servidor y en UNA transacción: si la anulación entrara y la
-- resolución nueva no, el corte quedaría con su diferencia sin resolver y sin
-- que nadie lo pidiera.
--
-- ── Por qué anular y crear, y no un UPDATE de `via` ────────────────────────
-- Una RETIRA/REPONE puede tener el comprobante impreso y firmado (`impreso_at`).
-- Pisarle la `via` borraría el hecho de que hubo un papel que decía otra cosa.
-- Se conserva la fila anulada con su motivo, que es la misma regla que ya
-- gobierna `anular_diferencia_corte`: se anula, nunca se borra.
--
-- Y NO se puede si ya está asentada: ahí el dinero se movió en el sistema y
-- corregirlo acá dejaría las dos cuentas distintas. Mismo freno que anular.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.justificar_diferencia_corte(
    p_id bigint, p_motivo text, p_causa text DEFAULT NULL)
 RETURNS cortes_caja_diferencias
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_vieja public.cortes_caja_diferencias;
    v_nueva public.cortes_caja_diferencias;
    v_causa text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Corregir una resolucion exige decir por que.';
    END IF;

    SELECT * INTO v_vieja FROM public.cortes_caja_diferencias WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa resolucion no existe.'; END IF;

    IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
       AND v_vieja.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_vieja.anulada_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esa resolucion ya estaba anulada.';
    END IF;
    IF v_vieja.asentado_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esta resolucion ya se registro en el sistema: no se puede corregir desde aca.';
    END IF;
    IF v_vieja.via = 'JUSTIFICA' THEN
        RAISE EXCEPTION 'Esta diferencia ya esta como causa encontrada: no mueve dinero.';
    END IF;

    -- La causa se puede reescribir al corregir —es la mitad del pedido: «debe
    -- permitir poner causa»— pero vacia no la borra: se queda la que tenia.
    v_causa := coalesce(NULLIF(btrim(coalesce(p_causa, '')), ''), v_vieja.causa);

    UPDATE public.cortes_caja_diferencias SET
        anulada_at = now(), anulada_por = (SELECT auth_employee_id()),
        anulada_motivo = btrim(p_motivo), updated_at = now()
    WHERE id = p_id;

    -- Se inserta DESPUES de anular la vieja: `idx_cortes_dif_una_viva_por_corte`
    -- deja una sola sin anular por corte.
    INSERT INTO public.cortes_caja_diferencias
        (corte_id, branch_id, fecha, monto, via, causa, registrado_por)
    VALUES (v_vieja.corte_id, v_vieja.branch_id, v_vieja.fecha, v_vieja.monto,
            'JUSTIFICA', v_causa, (SELECT auth_employee_id()))
    RETURNING * INTO v_nueva;

    -- Los dos eventos, no uno: la bitacora tiene que poder contar que hubo una
    -- resolucion anterior y por que dejo de valer.
    INSERT INTO public.cortes_caja_eventos
        (corte_id, accion, motivo, nota, employee_id)
    VALUES (v_vieja.corte_id, 'ANULAR_DIFERENCIA', btrim(p_motivo),
            'Se corrige: era ' || v_vieja.via, (SELECT auth_employee_id())),
           (v_vieja.corte_id, 'RESOLVER_DIFERENCIA', v_causa,
            'JUSTIFICA ' || to_char(v_nueva.monto, 'FM999999990.00'),
            (SELECT auth_employee_id()));

    RETURN v_nueva;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.justificar_diferencia_corte(bigint, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.justificar_diferencia_corte(bigint, text, text) TO authenticated, service_role;
