-- Solventar una venta de un mes ya declarado (2026-11-25).
--
-- Un consumidor final de la noche sin sello, de un mes anterior, no se manda al
-- MH (ese mes se declaró sin él: `_shared/mesCerrado.ts`). Si el cliente pide
-- su documento, se solventa con una venta NUEVA de hoy: se cargan sus
-- productos, se factura igual (mismo cliente, mismo total, mismo método de
-- pago), un vale saca el efectivo que no entró y el documento sale de la nueva.
--
-- Esta tabla es la constancia de cada paso, para que un intento cortado se
-- retome desde lo que falta y nunca se cargue, venda o saque dinero dos veces.
-- La escribe sólo `solventar-venta` (service_role).
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.solventaciones (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id        bigint NOT NULL REFERENCES public.sales_invoices(id),
  branch_id         bigint NOT NULL REFERENCES public.branches(id),
  employee_id       uuid   NOT NULL REFERENCES public.employees(id),
  -- nueva → cargada → enviando_venta → en_caja → cobrando → guardada →
  -- finalizada → vale → con_sello → lista. `incierta`: la caja no contestó y
  -- no se sabe si escribió; se revisa allá y no se reintenta solo.
  estado            text   NOT NULL DEFAULT 'nueva',
  pago              text   NOT NULL,
  total             numeric(12,2) NOT NULL,
  plan              jsonb  NOT NULL,
  carga_request_id  uuid   REFERENCES public.approval_requests(id),
  externo_id        text,
  referencia        text,
  numero            text,
  respuestas        jsonb,
  total_caja        numeric(12,2),
  vale_mov_id       bigint,
  sello             text,
  codigo_generacion uuid,
  nueva_invoice_id  bigint REFERENCES public.sales_invoices(id),
  error             text,
  tomada_hasta      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solventaciones_estado_ck CHECK (estado IN (
    'nueva','cargada','enviando_venta','en_caja','cobrando','guardada',
    'finalizada','vale','con_sello','lista','incierta','cancelada')),
  CONSTRAINT solventaciones_pago_ck CHECK (pago IN ('contado','tarjeta','transferencia','cheque'))
);

-- Una sola solventación viva por venta.
CREATE UNIQUE INDEX IF NOT EXISTS solventaciones_una_por_venta
  ON public.solventaciones (invoice_id) WHERE estado <> 'cancelada';
CREATE INDEX IF NOT EXISTS solventaciones_branch_idx ON public.solventaciones (branch_id);
CREATE INDEX IF NOT EXISTS solventaciones_employee_idx ON public.solventaciones (employee_id);
CREATE INDEX IF NOT EXISTS solventaciones_carga_idx ON public.solventaciones (carga_request_id);
CREATE INDEX IF NOT EXISTS solventaciones_nueva_idx ON public.solventaciones (nueva_invoice_id);

ALTER TABLE public.solventaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS solventaciones_select ON public.solventaciones;
CREATE POLICY solventaciones_select ON public.solventaciones FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('ventas', 'can_view')));
REVOKE ALL ON public.solventaciones FROM anon;

-- El vale que saca el efectivo de la venta nueva cuando la original fue al
-- contado. Apagado en el menú: sólo lo escribe la solventación.
INSERT INTO public.caja_tipos_movimiento
  (codigo, etiqueta, sentido, activo, orden, foto, leyenda, pide_boleta, pide_persona,
   lleva_comprobante, identifica_receptor, sin_comprobante_autoriza)
VALUES ('SOLVENTA_VENTA', 'Solventación de venta', 'SALIDA', false, 91, 'NO',
        'El efectivo de una venta de hoy que repone una de un mes ya declarado. Lo hace la solventación.',
        false, false, false, false, false)
ON CONFLICT (codigo) DO NOTHING;

-- El juez de los movimientos acepta el tipo apagado porque lo escribe un flujo
-- propio, igual que APLICA_ANTICIPO. Definición VIVA + una palabra.
CREATE OR REPLACE FUNCTION public.caja_movimiento_regla(p_sentido text, p_tipo text, p_concepto text, p_tiene_foto boolean, p_forma_pago text DEFAULT 'EFECTIVO'::text, p_tiene_receptor boolean DEFAULT false, p_de_bolsa boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  t        public.caja_tipos_movimiento%ROWTYPE;
  v_texto  text;
  v_va_en  text;
  -- Apagados en el menú pero escritos por un flujo propio: el retiro de lo
  -- apartado, el abono de un faltante desde el corte y la solventación de una
  -- venta de un mes ya declarado.
  v_de_un_flujo text[] := ARRAY['APLICA_ANTICIPO', 'ABONO_FALTANTE', 'SOLVENTA_VENTA'];
BEGIN
  IF nullif(btrim(coalesce(p_tipo, '')), '') IS NULL THEN
    RETURN json_build_object('error', 'Falta elegir qué tipo de movimiento es.');
  END IF;
  SELECT * INTO t FROM public.caja_tipos_movimiento WHERE codigo = p_tipo;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Ese tipo de movimiento no existe.');
  END IF;
  IF NOT t.activo AND NOT (t.codigo = ANY (v_de_un_flujo)) THEN
    RETURN json_build_object('error', 'Ese tipo de movimiento ya no se usa: elige otro de la lista.');
  END IF;
  IF t.sentido <> p_sentido THEN
    RETURN json_build_object('error', CASE t.sentido WHEN 'ENTRADA'
      THEN '«' || t.etiqueta || '» es una entrada, no una salida.'
      ELSE '«' || t.etiqueta || '» es una salida, no una entrada.' END);
  END IF;
  IF t.foto = 'OBLIGATORIA' AND NOT coalesce(p_tiene_foto, false)
     AND coalesce(p_forma_pago, 'EFECTIVO') = 'EFECTIVO' THEN
    RETURN json_build_object('error', 'Falta la foto del comprobante.');
  END IF;
  IF p_sentido = 'SALIDA' AND t.identifica_receptor AND NOT coalesce(p_tiene_receptor, false) THEN
    RETURN json_build_object('error', 'Falta quién se lleva el efectivo.');
  END IF;

  IF t.codigo IN ('OTRO_ENTRADA', 'OTRO_SALIDA') THEN
    -- El concepto llega con el rótulo adelante («Otro · …»): se quita para
    -- medir lo que la persona escribió de verdad.
    v_texto := btrim(regexp_replace(lower(translate(coalesce(p_concepto, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
                                    '^\s*otro\s*([·:\-]\s*)?', ''));
    IF length(regexp_replace(v_texto, '[^a-z0-9]', '', 'g')) < 10 THEN
      RETURN json_build_object('error', 'En «Otro» escribe de qué fue, con detalle.');
    END IF;
    SELECT c.va_en INTO v_va_en
      FROM public.caja_conceptos_de_otro_lado c
     WHERE c.activo AND c.sentido = p_sentido AND v_texto ~ c.patron
     ORDER BY c.orden, c.id
     LIMIT 1;
    IF v_va_en IS NOT NULL THEN
      RETURN json_build_object('error', 'Esto no va en «Otro»: ' || v_va_en || '.', 'va_en', v_va_en);
    END IF;
  END IF;

  -- Sin comprobante en un tipo que lo pide: se hace y queda pendiente de
  -- autorización, sea del cajón o de una bolsa (2026-10-22).
  IF t.sin_comprobante_autoriza AND NOT coalesce(p_tiene_foto, false) THEN
    RETURN json_build_object('error', NULL, 'autoriza', true);
  END IF;
  RETURN json_build_object('error', NULL, 'autoriza', false);
END $function$;
