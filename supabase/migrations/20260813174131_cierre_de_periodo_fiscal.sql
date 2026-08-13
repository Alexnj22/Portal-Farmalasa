SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Cierre de período fiscal — el remanente se arrastra y lo declarado se congela.
--
-- DOS PROBLEMAS, UNA TABLA.
--
-- 1. EL REMANENTE NO SE ARRASTRA (Art. 67 LIVA). Junio cerró con remanente a
--    favor y nadie lo llevó a julio; julio cerró igual y nadie lo lleva a
--    agosto. Cada mes se declara como si el anterior no hubiera existido.
--
-- 2. EL LIBRO CAMBIA DESPUÉS DE DECLARADO Y NADIE SE ENTERA. Ya pasó dos veces:
--    los sellos que llegaron el 2026-08-02 subieron el débito de mayo $27.23 y
--    el de junio $5.29 — después de presentadas. Sin una foto de lo declarado no
--    hay contra qué comparar, así que la diferencia no existe para nadie.
--
-- LA FÓRMULA, VERIFICADA CONTRA EL ÚNICO MES CUYO DECLARADO SE CONOCE.
-- Junio 2026 se declaró en **$1,077.16**; la auditoría lo reconstruyó en
-- $1,069.57 con el libro tal cual. Esta fórmula da exactamente eso:
--
--   débito 25,893.52 − crédito 23,286.48 − percepción 1,531.44 − retención 6.03
--   = 1,069.57
--
--   saldo = débito − crédito − percepción pagada − retención sufrida − remanente que entra
--   saldo > 0 → a pagar        saldo < 0 → remanente que sale
--
-- SE GUARDAN DOS CRÉDITOS, NO UNO. `credito_fiscal` es el del libro que se
-- declara hoy —el que reproduce la declaración— y `credito_declarable` es el del
-- libro nuevo, con las notas de crédito restadas y la deducibilidad confirmada.
-- Las dos verdades conviven y su diferencia se mide; elegir cuál se presenta es
-- de la contadora, no de una función.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.periodos_fiscales (
  id                  bigserial PRIMARY KEY,
  -- Siempre el día 1 del mes. Un CHECK lo hace cumplir: con dos filas para el
  -- mismo mes, la cadena del remanente deja de tener un eslabón único.
  periodo             date        NOT NULL UNIQUE,
  estado              text        NOT NULL DEFAULT 'abierto',

  debito_fiscal       numeric(14,2) NOT NULL DEFAULT 0,
  credito_fiscal      numeric(14,2) NOT NULL DEFAULT 0,
  credito_declarable  numeric(14,2) NOT NULL DEFAULT 0,
  percepcion_pagada   numeric(14,2) NOT NULL DEFAULT 0,
  retencion_sufrida   numeric(14,2) NOT NULL DEFAULT 0,

  remanente_entra     numeric(14,2) NOT NULL DEFAULT 0,
  remanente_sale      numeric(14,2) NOT NULL DEFAULT 0,
  a_pagar             numeric(14,2) NOT NULL DEFAULT 0,

  -- Lo que la contadora presentó de verdad, si difiere de lo calculado. Nace
  -- NULL: «no se sabe» no es «coincide».
  declarado_real      numeric(14,2),

  nota                text,
  cerrado_por         uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  cerrado_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.periodos_fiscales
  DROP CONSTRAINT IF EXISTS periodos_fiscales_periodo_dia1_chk;
ALTER TABLE public.periodos_fiscales
  ADD CONSTRAINT periodos_fiscales_periodo_dia1_chk
  CHECK (extract(day from periodo) = 1);

ALTER TABLE public.periodos_fiscales
  DROP CONSTRAINT IF EXISTS periodos_fiscales_estado_chk;
ALTER TABLE public.periodos_fiscales
  ADD CONSTRAINT periodos_fiscales_estado_chk
  CHECK (estado IN ('abierto', 'cerrado'));

-- Un período cerrado tiene autor y fecha. Sin esto, «cerrado» sería una palabra.
ALTER TABLE public.periodos_fiscales
  DROP CONSTRAINT IF EXISTS periodos_fiscales_cerrado_tiene_autor_chk;
ALTER TABLE public.periodos_fiscales
  ADD CONSTRAINT periodos_fiscales_cerrado_tiene_autor_chk
  CHECK (estado <> 'cerrado' OR cerrado_at IS NOT NULL);

-- Y no puede pagar Y arrastrar a la vez: es uno u otro.
ALTER TABLE public.periodos_fiscales
  DROP CONSTRAINT IF EXISTS periodos_fiscales_pago_o_remanente_chk;
ALTER TABLE public.periodos_fiscales
  ADD CONSTRAINT periodos_fiscales_pago_o_remanente_chk
  CHECK (a_pagar = 0 OR remanente_sale = 0);

CREATE INDEX IF NOT EXISTS idx_periodos_fiscales_cerrado_por
  ON public.periodos_fiscales(cerrado_por);

ALTER TABLE public.periodos_fiscales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS periodos_fiscales_select ON public.periodos_fiscales;
CREATE POLICY periodos_fiscales_select ON public.periodos_fiscales
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('libros_iva', 'can_view')));

-- Sin policies de escritura a propósito: se cierra y se reabre por RPC, que es
-- donde viven la cadena del remanente y la bitácora. Un UPDATE suelto rompería
-- el eslabón sin que nada lo note.

COMMENT ON TABLE public.periodos_fiscales IS
  'Un renglón por mes con lo declarado CONGELADO. Sirve para dos cosas: arrastrar el remanente a favor (Art. 67 LIVA) y para que la deriva —el libro que cambia después de presentado— tenga contra qué compararse.';

-- ── Crédito declarable del período, sin guarda ──────────────────────────────
-- Existe porque `get_libro_compras_declarable` lleva su chequeo de permiso
-- DENTRO del WHERE: llamada desde un contexto sin sesión de empleado devolvería
-- cero filas SIN ERROR, y el cierre congelaría un crédito de $0.00 que se vería
-- igual que uno real. Esta no tiene guarda y no se le concede a nadie: sólo la
-- alcanza el DEFINER del cierre, que corre como dueño.
CREATE OR REPLACE FUNCTION public.calc_credito_declarable(p_desde date, p_hasta date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH compras_norm AS (
    SELECT pr.id, pr.total, pr.fecha, pr.sello_recibido,
           upper(replace(replace(replace(btrim(pr.documento_numero), ' ', ''), '.', ''), 'O', '0')) AS doc
      FROM public.purchase_receipts pr
     WHERE (length(btrim(coalesce(pr.documento_numero, ''))) >= 8 OR pr.sello_recibido IS NOT NULL)
       AND pr.fecha BETWEEN p_desde - 5 AND p_hasta + 5
  ),
  tipos AS (
    SELECT * FROM (VALUES ('03',1,true), ('05',-1,true), ('06',1,true),
                          ('01',1,false), ('09',1,false), ('07',1,false)
    ) AS t(tipo_dte, signo, da_credito)
  ),
  del_erp AS (
    SELECT coalesce(pr.iva,0) AS iva, 1 AS signo, true AS da_credito,
           pm.clasificacion_estado, pm.iva_deducible
      FROM public.purchase_receipts pr
      LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
     WHERE pr.fecha BETWEEN p_desde AND p_hasta
       AND coalesce(pr.estado,'') <> 'anulada'
  ),
  solo_doc AS (
    SELECT coalesce(d.total_iva,0) AS iva, t.signo, t.da_credito,
           pm.clasificacion_estado, pm.iva_deducible
      FROM public.purchase_dte_documents d
      JOIN tipos t ON t.tipo_dte = d.tipo_dte
      LEFT JOIN public.proveedores_maestro pm ON pm.id = d.proveedor_id
     WHERE coalesce(d.invalidado,false) = false
       AND d.fecha_emision BETWEEN p_desde AND p_hasta
       AND NOT EXISTS (SELECT 1 FROM compras_norm c
                        WHERE d.sello_recibido IS NOT NULL AND c.sello_recibido = d.sello_recibido)
       AND NOT EXISTS (SELECT 1 FROM compras_norm c
                        WHERE c.doc IN (left(upper(d.codigo_generacion::text),20),
                                        left(replace(upper(d.codigo_generacion::text),'-',''),20),
                                        upper(d.codigo_generacion::text)))
       AND NOT EXISTS (SELECT 1 FROM public.purchase_receipts pr
                         JOIN public.proveedores_maestro pm2 ON pm2.supplier_id = pr.supplier_id
                        WHERE pm2.nit = d.emisor_nit
                          AND abs(pr.total - coalesce(d.monto_total,0)) < 0.01
                          AND pr.fecha BETWEEN d.fecha_emision - 3 AND d.fecha_emision + 3)
  )
  SELECT round(coalesce(sum(
           CASE WHEN da_credito
                     AND clasificacion_estado = 'confirmada'
                     AND iva_deducible IS TRUE
                THEN iva * signo ELSE 0 END), 0), 2)
    FROM (SELECT * FROM del_erp UNION ALL SELECT * FROM solo_doc) t;
$$;

REVOKE EXECUTE ON FUNCTION public.calc_credito_declarable(date, date) FROM PUBLIC, anon, authenticated;

-- ── Cómo va el período: lo congelado, lo vivo, y la diferencia ──────────────
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
BEGIN
  IF NOT (SELECT auth_has_module_permission('libros_iva', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

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
    'estado', coalesce(v_fila.estado, 'abierto'),
    'remanente_disponible', coalesce(v_prev.remanente_sale, 0),
    'periodo_anterior_cerrado', v_prev.estado = 'cerrado',
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
    -- La deriva: cuánto se movió el libro DESPUÉS de cerrar. Es el punto de
    -- congelar; sin esto el cambio ocurre igual y no lo ve nadie.
    'deriva', CASE WHEN v_fila.id IS NULL THEN NULL ELSE json_build_object(
      'debito_fiscal', round(v_deb - v_fila.debito_fiscal, 2),
      'credito_fiscal', round(v_cre - v_fila.credito_fiscal, 2),
      'credito_declarable', round(v_dec - v_fila.credito_declarable, 2),
      'percepcion_pagada', round(v_per - v_fila.percepcion_pagada, 2),
      'retencion_sufrida', round(v_ret - v_fila.retencion_sufrida, 2)) END
  );
END;
$$;

-- ── Cerrar ──────────────────────────────────────────────────────────────────
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
  v_id bigint;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['libros_iva'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- Un mes en curso no se cierra: todavía le entran documentos, y congelarlo
  -- fabricaría una deriva que es sólo el resto del mes.
  IF v_desde >= date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador'))::date THEN
    RAISE EXCEPTION 'No se puede cerrar un período que todavía está en curso (%).', to_char(v_desde,'YYYY-MM');
  END IF;

  IF EXISTS (SELECT 1 FROM public.periodos_fiscales WHERE periodo = v_desde AND estado = 'cerrado') THEN
    RAISE EXCEPTION 'El período % ya está cerrado. Hay que reabrirlo antes de volver a cerrarlo.', to_char(v_desde,'YYYY-MM');
  END IF;

  SELECT * INTO v_prev FROM public.periodos_fiscales
   WHERE periodo = (v_desde - interval '1 month')::date;

  -- La cadena del remanente sólo vale si el eslabón anterior está firme. Si el
  -- mes anterior existe y está abierto, cerrar éste arrastraría un número que
  -- todavía puede cambiar.
  IF v_prev.id IS NOT NULL AND v_prev.estado <> 'cerrado' THEN
    RAISE EXCEPTION 'El período anterior (%) está abierto: cerralo primero o el remanente que entra acá no es firme.',
      to_char(v_prev.periodo,'YYYY-MM');
  END IF;

  v_entra := coalesce(v_prev.remanente_sale, 0);

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

  -- Un mes sin ventas selladas no es un mes cerrado: es un mes que no se leyó.
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

-- ── Reabrir ─────────────────────────────────────────────────────────────────
-- Existe porque la alternativa es peor: sin reabrir, un período mal cerrado se
-- corrige con un UPDATE a mano y la cadena del remanente se rompe en silencio.
-- Exige motivo: reabrir un período cerrado es un acto, no un clic.
CREATE OR REPLACE FUNCTION public.reabrir_periodo_fiscal(p_periodo date, p_motivo text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_desde date := date_trunc('month', p_periodo)::date;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['libros_iva'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Reabrir un período cerrado necesita un motivo escrito.';
  END IF;

  -- Si un mes posterior ya está cerrado, reabrir éste dejaría a aquél arrastrando
  -- un remanente que puede cambiar. Se reabre de atrás para adelante.
  IF EXISTS (SELECT 1 FROM public.periodos_fiscales
              WHERE periodo > v_desde AND estado = 'cerrado') THEN
    RAISE EXCEPTION 'Hay períodos posteriores cerrados. Reabrí primero el más reciente: el remanente se encadena hacia adelante.';
  END IF;

  UPDATE public.periodos_fiscales
     SET estado = 'abierto',
         nota = coalesce(nota || E'\n', '') || 'Reabierto: ' || btrim(p_motivo),
         updated_at = now()
   WHERE periodo = v_desde AND estado = 'cerrado';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El período % no está cerrado.', to_char(v_desde,'YYYY-MM');
  END IF;

  RETURN public.get_periodo_fiscal(v_desde);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_periodo_fiscal(date)                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cerrar_periodo_fiscal(date, text, numeric)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reabrir_periodo_fiscal(date, text)                FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_periodo_fiscal(date)                          TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.cerrar_periodo_fiscal(date, text, numeric)        TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.reabrir_periodo_fiscal(date, text)                TO authenticated, service_role;
