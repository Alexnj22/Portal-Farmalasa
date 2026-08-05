SET lock_timeout = '5s';

-- El ingreso manual de una meta dejaba de ser «ingreso» y se volvía un atajo:
-- `ON CONFLICT DO UPDATE SET estado = 'oficial'` pisaba CUALQUIER fila, en
-- cualquier estado. Desde «Agregar meta», con solo can_edit, se podía tomar una
-- meta en «Espera aprobación» y dejarla oficial sin que el gerente la viera —
-- todo el flujo confirmar→aprobar se evitaba con un modal. Y el mismo camino
-- reescribía la meta de un mes cerrado y ya pagado, sin dejar rastro.
--
-- Ahora el RPC decide según el estado de DESTINO:
--   no existe                          → INSERT 'oficial' (el ingreso del histórico)
--   'oficial' de un mes cerrado        → permitido, pero exige el porqué
--   'oficial' del mes en curso/futuro  → se rechaza: se corrige devolviéndola
--   'propuesta' / 'devuelta'           → cambia el monto CONSERVANDO el estado
--   'confirmada_supervisor'            → se rechaza: esa meta ya es del gerente
CREATE OR REPLACE FUNCTION public.upsert_meta_manual(
    p_branch_id bigint,
    p_year_month text,
    p_monto numeric,
    p_nota text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp  uuid;
  v_row  public.metas_sucursal%ROWTYPE;
  v_nota text := NULLIF(btrim(p_nota), '');
  v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere edición en Metas';
  END IF;
  IF p_year_month IS NULL OR p_year_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_year_month;
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'MONTO_INVALIDO';
  END IF;
  -- Solo salas que venden (Bodega/Administración no llevan meta)
  IF NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map m
                 WHERE m.branch_id = p_branch_id AND NOT m.es_bodega) THEN
    RAISE EXCEPTION 'SUCURSAL_INVALIDA: %', p_branch_id;
  END IF;

  v_emp := public.auth_employee_id();  -- autoría server-side, nunca del cliente

  SELECT * INTO v_row FROM public.metas_sucursal
  WHERE branch_id = p_branch_id AND year_month = p_year_month
  FOR UPDATE;

  -- Nada que pisar: es el ingreso del histórico, entra oficial como siempre.
  IF NOT FOUND THEN
    INSERT INTO public.metas_sucursal
      (branch_id, year_month, monto_meta, estado, nota, supervisor_por, supervisor_at)
    VALUES
      (p_branch_id, p_year_month, p_monto, 'oficial', v_nota, v_emp, now());
    RETURN;
  END IF;

  -- El supervisor ya la confirmó: el siguiente paso es del gerente, y cambiarle
  -- el monto por debajo lo dejaría aprobando un número que nunca vio.
  IF v_row.estado = 'confirmada_supervisor' THEN
    RAISE EXCEPTION 'META_EN_APROBACION: esta meta ya fue confirmada y espera al gerente';
  END IF;

  -- Una meta oficial del mes en curso o de uno que todavía no arranca es la que
  -- la sala está persiguiendo. Se corrige devolviéndola, no pisándola.
  IF v_row.estado = 'oficial' AND p_year_month >= v_ym_actual THEN
    RAISE EXCEPTION 'META_YA_OFICIAL: esta meta ya está aprobada';
  END IF;

  -- Reescribir un mes cerrado cambia un bono que ya se pagó: se permite, pero
  -- nunca en silencio.
  IF v_row.estado = 'oficial' AND v_nota IS NULL THEN
    RAISE EXCEPTION 'NOTA_REQUERIDA: hay que dejar dicho por qué se corrige un mes ya cerrado';
  END IF;

  UPDATE public.metas_sucursal
  SET monto_meta = p_monto,
      nota       = COALESCE(v_nota, nota),
      -- La autoría del ingreso manual solo se firma cuando el ingreso ES la
      -- decisión (mes cerrado). Sobre una propuesta viva, firmar acá diría que
      -- el supervisor la confirmó, y no la confirmó: solo le movió el monto.
      supervisor_por = CASE WHEN v_row.estado = 'oficial' THEN v_emp ELSE supervisor_por END,
      supervisor_at  = CASE WHEN v_row.estado = 'oficial' THEN now() ELSE supervisor_at END
  WHERE id = v_row.id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.upsert_meta_manual(bigint, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_meta_manual(bigint, text, numeric, text) TO authenticated, service_role;

-- Verificado en prod dentro de una transacción revertida (7 casos, todos OK):
-- confirmada_supervisor → META_EN_APROBACION · oficial de mes futuro →
-- META_YA_OFICIAL · propuesta → cambia el monto y CONSERVA el estado ·
-- mes cerrado sin nota → NOTA_REQUERIDA · con nota → pasa · fila nueva → entra
-- oficial · Bodega → SUCURSAL_INVALIDA. Cero filas quedaron en la tabla.
