SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Desde cuándo lleva el portal la contabilidad — y por qué es un freno y no un
-- filtro de pantalla.
--
-- Decisión del usuario (2026-08-13): **el portal arranca en julio 2026.** Los
-- meses anteriores no se cierran acá; mayo y junio ya se declararon por fuera y
-- su remanente no se va a reclamar por esta vía.
--
-- Podría haberse resuelto ocultando los meses viejos en la vista, y sería peor:
-- la función de cierre seguiría aceptándolos, y basta una llamada suelta o una
-- pantalla futura que no conozca la regla para cerrar mayo y meterlo adelante de
-- julio en la cadena del remanente. La regla vive donde se puede romper.
--
-- Va en una tabla y no en una constante dentro de la función por el mismo motivo
-- que `stock_config` y `metas_config` existen: es un parámetro del negocio, no
-- del código, y el día que cambie no debería hacer falta una migración que
-- reescriba una función de cierre.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.contabilidad_config (
  id              smallint PRIMARY KEY DEFAULT 1,
  -- Primer período que el portal cierra. Siempre día 1.
  periodo_inicial date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Una sola fila, como sus dos hermanas.
  CONSTRAINT contabilidad_config_fila_unica CHECK (id = 1),
  CONSTRAINT contabilidad_config_dia1_chk    CHECK (extract(day from periodo_inicial) = 1)
);

INSERT INTO public.contabilidad_config (id, periodo_inicial)
VALUES (1, '2026-07-01')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.contabilidad_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contabilidad_config_select ON public.contabilidad_config;
CREATE POLICY contabilidad_config_select ON public.contabilidad_config
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('libros_iva', 'can_view')));

COMMENT ON TABLE public.contabilidad_config IS
  'Parámetros de contabilidad. Una sola fila, igual que stock_config y metas_config.';
COMMENT ON COLUMN public.contabilidad_config.periodo_inicial IS
  'Primer mes que el portal cierra. Julio 2026 por decisión del usuario: mayo y junio se declararon por fuera y no se reclaman por esta vía.';

-- ── El freno, dentro de la función que lo puede romper ──────────────────────
CREATE OR REPLACE FUNCTION public.cerrar_periodo_fiscal(
  p_periodo date,
  p_nota text DEFAULT NULL,
  p_declarado_real numeric DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_desde date := date_trunc('month', p_periodo)::date;
  v_hasta date := (date_trunc('month', p_periodo) + interval '1 month - 1 day')::date;
  v_deb numeric; v_ret numeric; v_cre numeric; v_per numeric; v_dec numeric;
  v_prev public.periodos_fiscales;
  v_entra numeric; v_saldo numeric;
  v_inicial date;
  v_id bigint;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['libros_iva'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT periodo_inicial INTO v_inicial FROM public.contabilidad_config WHERE id = 1;
  IF v_inicial IS NULL THEN
    RAISE EXCEPTION 'Falta configurar desde qué mes lleva el portal la contabilidad.';
  END IF;

  IF v_desde < v_inicial THEN
    RAISE EXCEPTION 'El portal lleva la contabilidad desde % — % es anterior y se declaró por fuera.',
      to_char(v_inicial,'YYYY-MM'), to_char(v_desde,'YYYY-MM');
  END IF;

  IF v_desde >= date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador'))::date THEN
    RAISE EXCEPTION 'No se puede cerrar un período que todavía está en curso (%).', to_char(v_desde,'YYYY-MM');
  END IF;

  IF EXISTS (SELECT 1 FROM public.periodos_fiscales WHERE periodo = v_desde AND estado = 'cerrado') THEN
    RAISE EXCEPTION 'El período % ya está cerrado. Hay que reabrirlo antes de volver a cerrarlo.', to_char(v_desde,'YYYY-MM');
  END IF;

  SELECT * INTO v_prev FROM public.periodos_fiscales
   WHERE periodo = (v_desde - interval '1 month')::date;

  -- El eslabón anterior sólo se exige DENTRO del alcance del portal: el mes
  -- previo al inicial no existe acá, y pedirlo dejaría el primer cierre
  -- imposible para siempre.
  IF v_desde > v_inicial AND v_prev.id IS NULL THEN
    RAISE EXCEPTION 'Falta cerrar el período anterior (%). El remanente se encadena de atrás hacia adelante.',
      to_char((v_desde - interval '1 month')::date,'YYYY-MM');
  END IF;
  IF v_prev.id IS NOT NULL AND v_prev.estado <> 'cerrado' THEN
    RAISE EXCEPTION 'El período anterior (%) está abierto: cerralo primero o el remanente que entra acá no es firme.',
      to_char(v_prev.periodo,'YYYY-MM');
  END IF;

  -- El primer período del portal arranca en cero por definición: lo de antes se
  -- declaró por fuera y su remanente no entra por acá.
  v_entra := CASE WHEN v_desde = v_inicial THEN 0 ELSE coalesce(v_prev.remanente_sale, 0) END;

  SELECT round(coalesce(sum(coalesce(iva,0)),0),2), round(coalesce(sum(coalesce(retencion,0)),0),2)
    INTO v_deb, v_ret
    FROM public.sales_invoices
   WHERE fecha BETWEEN v_desde AND v_hasta
     AND estado = 'FINALIZADA' AND length(recibido_mh) = 40;

  SELECT round(coalesce(sum(coalesce(iva,0)),0),2), round(coalesce(sum(coalesce(percepcion_iva,0)),0),2)
    INTO v_cre, v_per
    FROM public.purchase_receipts
   WHERE fecha BETWEEN v_desde AND v_hasta;

  v_dec := public.calc_credito_declarable(v_desde, v_hasta);

  IF v_deb = 0 THEN
    RAISE EXCEPTION 'El período % no tiene débito fiscal. Antes de cerrarlo hay que revisar por qué: un mes sin ventas selladas casi siempre es un dato que falta, no un mes sin ventas.',
      to_char(v_desde,'YYYY-MM');
  END IF;

  v_saldo := round(v_deb - v_cre - v_per - v_ret - v_entra, 2);

  INSERT INTO public.periodos_fiscales AS pf
    (periodo, estado, debito_fiscal, credito_fiscal, credito_declarable,
     percepcion_pagada, retencion_sufrida, remanente_entra,
     remanente_sale, a_pagar, declarado_real, nota, cerrado_por, cerrado_at, updated_at)
  VALUES
    (v_desde, 'cerrado', v_deb, v_cre, v_dec, v_per, v_ret, v_entra,
     CASE WHEN v_saldo < 0 THEN -v_saldo ELSE 0 END,
     CASE WHEN v_saldo > 0 THEN  v_saldo ELSE 0 END,
     p_declarado_real, p_nota, (SELECT auth_employee_id()), now(), now())
  ON CONFLICT (periodo) DO UPDATE SET
    estado = 'cerrado',
    debito_fiscal = EXCLUDED.debito_fiscal, credito_fiscal = EXCLUDED.credito_fiscal,
    credito_declarable = EXCLUDED.credito_declarable,
    percepcion_pagada = EXCLUDED.percepcion_pagada, retencion_sufrida = EXCLUDED.retencion_sufrida,
    remanente_entra = EXCLUDED.remanente_entra, remanente_sale = EXCLUDED.remanente_sale,
    a_pagar = EXCLUDED.a_pagar, declarado_real = EXCLUDED.declarado_real,
    nota = EXCLUDED.nota, cerrado_por = EXCLUDED.cerrado_por,
    cerrado_at = EXCLUDED.cerrado_at, updated_at = now()
  RETURNING pf.id INTO v_id;

  RETURN public.get_periodo_fiscal(v_desde);
END;
$$;

-- La lectura también lo dice, para que la pantalla no tenga que saberlo aparte.
CREATE OR REPLACE FUNCTION public.get_periodo_fiscal(p_periodo date)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_desde date := date_trunc('month', p_periodo)::date;
  v_hasta date := (date_trunc('month', p_periodo) + interval '1 month - 1 day')::date;
  v_fila  public.periodos_fiscales;
  v_deb numeric; v_ret numeric; v_cre numeric; v_per numeric; v_dec numeric;
  v_prev public.periodos_fiscales;
  v_inicial date;
BEGIN
  IF NOT (SELECT auth_has_module_permission('libros_iva', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT periodo_inicial INTO v_inicial FROM public.contabilidad_config WHERE id = 1;

  SELECT * INTO v_fila FROM public.periodos_fiscales WHERE periodo = v_desde;
  SELECT * INTO v_prev FROM public.periodos_fiscales
   WHERE periodo = (v_desde - interval '1 month')::date;

  SELECT round(coalesce(sum(coalesce(iva,0)),0),2), round(coalesce(sum(coalesce(retencion,0)),0),2)
    INTO v_deb, v_ret
    FROM public.sales_invoices
   WHERE fecha BETWEEN v_desde AND v_hasta
     AND estado = 'FINALIZADA' AND length(recibido_mh) = 40;

  SELECT round(coalesce(sum(coalesce(iva,0)),0),2), round(coalesce(sum(coalesce(percepcion_iva,0)),0),2)
    INTO v_cre, v_per
    FROM public.purchase_receipts
   WHERE fecha BETWEEN v_desde AND v_hasta;

  v_dec := public.calc_credito_declarable(v_desde, v_hasta);

  RETURN json_build_object(
    'periodo', v_desde,
    'periodo_inicial', v_inicial,
    'fuera_de_alcance', v_desde < v_inicial,
    'estado', coalesce(v_fila.estado, 'abierto'),
    'remanente_disponible', CASE WHEN v_desde = v_inicial THEN 0 ELSE coalesce(v_prev.remanente_sale, 0) END,
    'periodo_anterior_cerrado', v_desde = v_inicial OR v_prev.estado = 'cerrado',
    'vivo', json_build_object(
      'debito_fiscal', v_deb, 'credito_fiscal', v_cre,
      'credito_declarable', v_dec,
      'percepcion_pagada', v_per, 'retencion_sufrida', v_ret),
    'congelado', CASE WHEN v_fila.id IS NULL THEN NULL ELSE json_build_object(
      'debito_fiscal', v_fila.debito_fiscal, 'credito_fiscal', v_fila.credito_fiscal,
      'credito_declarable', v_fila.credito_declarable,
      'percepcion_pagada', v_fila.percepcion_pagada, 'retencion_sufrida', v_fila.retencion_sufrida,
      'remanente_entra', v_fila.remanente_entra, 'remanente_sale', v_fila.remanente_sale,
      'a_pagar', v_fila.a_pagar, 'declarado_real', v_fila.declarado_real,
      'nota', v_fila.nota, 'cerrado_at', v_fila.cerrado_at,
      'cerrado_por', (SELECT e.name FROM public.employees e WHERE e.id = v_fila.cerrado_por)) END,
    'deriva', CASE WHEN v_fila.id IS NULL THEN NULL ELSE json_build_object(
      'debito_fiscal', round(v_deb - v_fila.debito_fiscal, 2),
      'credito_fiscal', round(v_cre - v_fila.credito_fiscal, 2),
      'credito_declarable', round(v_dec - v_fila.credito_declarable, 2),
      'percepcion_pagada', round(v_per - v_fila.percepcion_pagada, 2),
      'retencion_sufrida', round(v_ret - v_fila.retencion_sufrida, 2)) END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cerrar_periodo_fiscal(date, text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_periodo_fiscal(date)                   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cerrar_periodo_fiscal(date, text, numeric) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_periodo_fiscal(date)                   TO authenticated, service_role;
