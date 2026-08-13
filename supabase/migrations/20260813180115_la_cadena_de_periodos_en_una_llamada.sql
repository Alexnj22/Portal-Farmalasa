SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- La cadena completa en una sola llamada, y con los frenos ya resueltos.
--
-- `get_periodo_fiscal` responde por UN mes. La pantalla necesita la cadena
-- entera —desde el primer período del portal hasta el mes en curso— y sobre todo
-- necesita saber cuál se puede cerrar.
--
-- ESO ÚLTIMO LO DECIDE EL SERVIDOR, no la vista. Las cuatro condiciones para
-- cerrar viven en `cerrar_periodo_fiscal`; si la pantalla las re-dedujera para
-- pintar el botón, la misma regla estaría escrita dos veces y el día que una
-- cambie la otra seguiría opinando. Acá se calculan una vez y se devuelven ya
-- masticadas: `puede_cerrarse` y, cuando no, el motivo en castellano.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_periodos_fiscales()
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_inicial date;
  v_mes_actual date := date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador'))::date;
  v_out json;
BEGIN
  IF NOT (SELECT auth_has_module_permission('libros_iva', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT periodo_inicial INTO v_inicial FROM public.contabilidad_config WHERE id = 1;
  IF v_inicial IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT coalesce(json_agg(to_json(t) ORDER BY t.periodo), '[]'::json) INTO v_out
  FROM (
    SELECT
      m.periodo,
      m.periodo = v_inicial                       AS es_inicial,
      m.periodo = v_mes_actual                    AS en_curso,
      coalesce(pf.estado, 'abierto')              AS estado,
      -- Vivo: lo que dicen los libros AHORA.
      v.debito                                    AS debito_fiscal,
      c.credito                                   AS credito_fiscal,
      public.calc_credito_declarable(m.periodo, m.fin) AS credito_declarable,
      c.percepcion                                AS percepcion_pagada,
      v.retencion                                 AS retencion_sufrida,
      -- El remanente que le entraría: cero si es el primero del portal.
      CASE WHEN m.periodo = v_inicial THEN 0
           ELSE coalesce(prev.remanente_sale, 0) END AS remanente_entra,
      -- Congelado, o NULL si nunca se cerró.
      pf.debito_fiscal      AS cong_debito,
      pf.credito_fiscal     AS cong_credito,
      pf.credito_declarable AS cong_declarable,
      pf.percepcion_pagada  AS cong_percepcion,
      pf.retencion_sufrida  AS cong_retencion,
      pf.remanente_entra    AS cong_entra,
      pf.remanente_sale     AS cong_remanente_sale,
      pf.a_pagar            AS cong_a_pagar,
      pf.declarado_real, pf.nota, pf.cerrado_at,
      (SELECT e.name FROM public.employees e WHERE e.id = pf.cerrado_por) AS cerrado_por,
      -- La deriva: cuánto se movió el libro DESPUÉS de congelarlo. Es el motivo
      -- de que exista esta tabla.
      CASE WHEN pf.id IS NULL THEN NULL
           ELSE round(v.debito - pf.debito_fiscal, 2) END   AS deriva_debito,
      CASE WHEN pf.id IS NULL THEN NULL
           ELSE round(c.credito - pf.credito_fiscal, 2) END AS deriva_credito,
      -- Los cuatro frenos, resueltos acá y no en la vista.
      (pf.estado IS DISTINCT FROM 'cerrado'
        AND m.periodo < v_mes_actual
        AND v.debito > 0
        AND (m.periodo = v_inicial OR prev.estado = 'cerrado'))              AS puede_cerrarse,
      CASE
        WHEN pf.estado = 'cerrado'      THEN 'Ya está cerrado.'
        WHEN m.periodo >= v_mes_actual  THEN 'Todavía está en curso: le siguen entrando documentos.'
        WHEN v.debito = 0               THEN 'No tiene débito fiscal. Un mes sin ventas selladas casi siempre es un dato que falta.'
        WHEN m.periodo <> v_inicial AND prev.estado IS DISTINCT FROM 'cerrado'
          THEN 'Falta cerrar el mes anterior: el remanente que entra acá todavía puede cambiar.'
      END                                                                     AS motivo_no_puede
    FROM (
      SELECT g::date AS periodo,
             (g + interval '1 month - 1 day')::date AS fin
        FROM generate_series(v_inicial, v_mes_actual, '1 month') g
    ) m
    LEFT JOIN public.periodos_fiscales pf   ON pf.periodo   = m.periodo
    LEFT JOIN public.periodos_fiscales prev ON prev.periodo = (m.periodo - interval '1 month')::date
    CROSS JOIN LATERAL (
      SELECT round(coalesce(sum(coalesce(si.iva,0)),0),2)       AS debito,
             round(coalesce(sum(coalesce(si.retencion,0)),0),2) AS retencion
        FROM public.sales_invoices si
       WHERE si.fecha BETWEEN m.periodo AND m.fin
         AND si.estado = 'FINALIZADA' AND length(si.recibido_mh) = 40
    ) v
    CROSS JOIN LATERAL (
      SELECT round(coalesce(sum(coalesce(pr.iva,0)),0),2)            AS credito,
             round(coalesce(sum(coalesce(pr.percepcion_iva,0)),0),2) AS percepcion
        FROM public.purchase_receipts pr
       WHERE pr.fecha BETWEEN m.periodo AND m.fin
    ) c
  ) t;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.get_periodos_fiscales() IS
  'La cadena completa desde el primer período del portal hasta el mes en curso: lo vivo, lo congelado, la deriva entre ambos, y si cada mes se puede cerrar (con el motivo cuando no). Los frenos se resuelven acá para que la pantalla no los re-deduzca.';

REVOKE EXECUTE ON FUNCTION public.get_periodos_fiscales() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_periodos_fiscales() TO authenticated, service_role;
