-- Cuentas por pagar — qué le debemos a cada proveedor, y si podemos comprarle.
--
-- Decisiones del usuario (2026-08-16):
--   · La deuda se cuenta desde **la fecha del DTE**, no desde la compra
--     registrada. Es lo que el proveedor va a cobrar exista o no la carga — y
--     así aparecen las facturas que llegaron por correo y nadie registró, que
--     hoy no están en ningún control.
--   · **Compras registra el pago; Gerencia lo aprueba.** Por eso el pago tiene
--     estado: mientras está pendiente NO baja el saldo (el cheque todavía no
--     salió), pero sí se ve, para que nadie lo pague dos veces.
--
-- Escala medida antes de escribir esto: ~700 documentos al mes de ~80
-- proveedores, ~$250,000. 163 proveedores en el maestro, 24 ya con nombre para
-- cheque.

SET lock_timeout = '5s';

-- ── 1. Lo que le falta a la ficha del proveedor ─────────────────────────────
-- `dias_credito` se propone del propio documento (`resumen.pagos[].periodo`) y
-- se confirma una vez: está medido que **es constante por proveedor** —COFARSAL
-- 30, MONTREAL 60, y ninguno varía entre facturas—.
ALTER TABLE public.proveedores_maestro
    ADD COLUMN IF NOT EXISTS dias_credito   integer,
    ADD COLUMN IF NOT EXISTS limite_credito numeric(12,2),
    ADD COLUMN IF NOT EXISTS forma_pago     text;

ALTER TABLE public.proveedores_maestro
    DROP CONSTRAINT IF EXISTS proveedores_maestro_forma_pago_check;
ALTER TABLE public.proveedores_maestro
    ADD CONSTRAINT proveedores_maestro_forma_pago_check
    CHECK (forma_pago IS NULL OR forma_pago IN ('efectivo','cheque','transferencia','otro'));

ALTER TABLE public.proveedores_maestro
    DROP CONSTRAINT IF EXISTS proveedores_maestro_dias_credito_check;
ALTER TABLE public.proveedores_maestro
    ADD CONSTRAINT proveedores_maestro_dias_credito_check
    CHECK (dias_credito IS NULL OR (dias_credito >= 0 AND dias_credito <= 365));

COMMENT ON COLUMN public.proveedores_maestro.dias_credito IS
    'Plazo de pago en días. Se propone de `resumen.pagos[].periodo` del DTE y se confirma una vez: medido, es constante por proveedor.';
COMMENT ON COLUMN public.proveedores_maestro.limite_credito IS
    'Techo de crédito. `limite - saldo` es lo que contesta «¿podemos comprarle?».';

-- ── 2. El pago ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.compra_pagos (
    id            bigserial PRIMARY KEY,
    emisor_nit    text        NOT NULL,
    fecha         date        NOT NULL,
    monto         numeric(12,2) NOT NULL CHECK (monto > 0),
    forma         text        NOT NULL CHECK (forma IN ('efectivo','cheque','transferencia','otro')),
    -- Número de cheque o de transferencia. Es lo que permite cuadrar contra el
    -- banco; sin eso el control es una lista de buenas intenciones.
    referencia    text,
    -- `pendiente` lo puso Compras y todavía no baja el saldo · `aprobado` lo
    -- autorizó Gerencia · `anulado` no cuenta y conserva el motivo.
    estado        text        NOT NULL DEFAULT 'pendiente'
                              CHECK (estado IN ('pendiente','aprobado','anulado')),
    nota          text,
    registrado_por uuid REFERENCES public.employees(id),
    registrado_at  timestamptz NOT NULL DEFAULT now(),
    aprobado_por   uuid REFERENCES public.employees(id),
    aprobado_at    timestamptz,
    anulado_por    uuid REFERENCES public.employees(id),
    anulado_at     timestamptz,
    anulado_motivo text,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS compra_pagos_nit_idx    ON public.compra_pagos (emisor_nit, fecha DESC);
CREATE INDEX IF NOT EXISTS compra_pagos_estado_idx ON public.compra_pagos (estado) WHERE estado <> 'anulado';

-- ── 3. A qué facturas se aplica ─────────────────────────────────────────────
-- La tabla que hace que el control sirva: **un cheque paga varias facturas** y
-- una factura grande se paga en abonos. Con un solo «pagada sí/no» eso no se
-- puede representar, y a los dos meses el saldo no cuadra con el banco.
CREATE TABLE IF NOT EXISTS public.compra_pago_aplicado (
    id          bigserial PRIMARY KEY,
    pago_id     bigint  NOT NULL REFERENCES public.compra_pagos(id) ON DELETE CASCADE,
    document_id bigint  NOT NULL REFERENCES public.purchase_dte_documents(id),
    monto       numeric(12,2) NOT NULL CHECK (monto > 0),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pago_id, document_id)
);

CREATE INDEX IF NOT EXISTS compra_pago_aplicado_doc_idx  ON public.compra_pago_aplicado (document_id);
CREATE INDEX IF NOT EXISTS compra_pago_aplicado_pago_idx ON public.compra_pago_aplicado (pago_id);

ALTER TABLE public.compra_pagos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compra_pago_aplicado  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compra_pagos_select ON public.compra_pagos;
CREATE POLICY compra_pagos_select ON public.compra_pagos
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('cuentas_por_pagar', 'can_view')));

DROP POLICY IF EXISTS compra_pago_aplicado_select ON public.compra_pago_aplicado;
CREATE POLICY compra_pago_aplicado_select ON public.compra_pago_aplicado
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('cuentas_por_pagar', 'can_view')));

-- Sin policies de escritura a propósito: se escribe SOLO por los RPC de abajo,
-- que son los que validan que lo aplicado no pase del saldo del documento.
-- Un INSERT suelto podría dejar un pago aplicado por más de lo que se debe.

COMMENT ON TABLE public.compra_pagos IS
    'Pago a un proveedor. Lo registra Compras (estado `pendiente`) y lo aprueba Gerencia (`aprobado`); mientras esté pendiente NO baja el saldo, porque el cheque todavía no salió.';
COMMENT ON TABLE public.compra_pago_aplicado IS
    'A qué documentos se aplica un pago. N:M porque un cheque paga varias facturas y una factura se paga en abonos.';

-- ── 4. Lo que se debe ───────────────────────────────────────────────────────
-- Una vista para no repetir el criterio en cada consulta: qué documentos son
-- deuda y con qué signo. Las notas de crédito RESTAN (Art. 62 LIVA aplica al
-- IVA; acá es lo mismo por el lado del dinero: el proveedor cobra menos).
CREATE OR REPLACE VIEW public.compra_deuda_documentos
WITH (security_invoker = true) AS
SELECT d.id                       AS document_id,
       d.emisor_nit,
       d.emisor_nombre,
       d.fecha_emision,
       d.tipo_dte,
       d.codigo_generacion,
       d.numero_control,
       (CASE WHEN d.tipo_dte = '05' THEN -1 ELSE 1 END) * coalesce(d.monto_total, 0) AS monto,
       pm.dias_credito,
       CASE WHEN pm.dias_credito IS NOT NULL
            THEN d.fecha_emision + pm.dias_credito
       END                        AS vence,
       coalesce((SELECT sum(a.monto) FROM public.compra_pago_aplicado a
                   JOIN public.compra_pagos p ON p.id = a.pago_id
                  WHERE a.document_id = d.id AND p.estado = 'aprobado'), 0) AS aplicado,
       coalesce((SELECT sum(a.monto) FROM public.compra_pago_aplicado a
                   JOIN public.compra_pagos p ON p.id = a.pago_id
                  WHERE a.document_id = d.id AND p.estado = 'pendiente'), 0) AS en_tramite
  FROM public.purchase_dte_documents d
  LEFT JOIN LATERAL (
       SELECT m.dias_credito FROM public.proveedores_maestro m
        WHERE m.nit = d.emisor_nit ORDER BY m.id LIMIT 1) pm ON true
 WHERE NOT d.invalidado
   AND d.tipo_dte IN ('01','03','05','06')
   AND d.monto_total IS NOT NULL;

COMMENT ON VIEW public.compra_deuda_documentos IS
    'Cada documento que es deuda, con su vencimiento y lo que ya se le aplicó. La deuda se cuenta desde la FECHA DEL DTE (decisión 2026-08-16): es lo que el proveedor va a cobrar exista o no la compra registrada.';

-- ── 5. El resumen por proveedor: ¿podemos comprarle? ────────────────────────
CREATE OR REPLACE FUNCTION public.get_cuentas_por_pagar(p_desde date DEFAULT NULL)
RETURNS TABLE (
    emisor_nit       text,
    proveedor        text,
    proveedor_id     bigint,
    dias_credito     integer,
    limite_credito   numeric,
    forma_pago       text,
    documentos       integer,
    deuda            numeric,
    aplicado         numeric,
    saldo            numeric,
    en_tramite       numeric,
    vencido          numeric,
    documentos_vencidos integer,
    disponible       numeric,
    proximo_vence    date
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  WITH permitido AS (
    SELECT (SELECT auth_has_module_permission('cuentas_por_pagar','can_view')) AS ok
  ), doc AS (
    SELECT * FROM public.compra_deuda_documentos
     WHERE p_desde IS NULL OR fecha_emision >= p_desde
  )
  SELECT d.emisor_nit,
         coalesce(max(m.nombre), max(d.emisor_nombre)),
         max(m.id),
         max(m.dias_credito),
         max(m.limite_credito),
         max(m.forma_pago),
         count(*)::integer,
         round(sum(d.monto), 2),
         round(sum(d.aplicado), 2),
         round(sum(d.monto - d.aplicado), 2),
         round(sum(d.en_tramite), 2),
         -- Vencido: lo que le queda a los documentos cuya fecha de pago ya pasó.
         round(coalesce(sum(d.monto - d.aplicado) FILTER (
                 WHERE d.vence IS NOT NULL AND d.vence < current_date
                   AND d.monto - d.aplicado > 0), 0), 2),
         coalesce(count(*) FILTER (
                 WHERE d.vence IS NOT NULL AND d.vence < current_date
                   AND d.monto - d.aplicado > 0), 0)::integer,
         -- Lo que contesta «¿podemos comprarle?». Nulo si nadie puso el techo.
         CASE WHEN max(m.limite_credito) IS NOT NULL
              THEN round(max(m.limite_credito) - sum(d.monto - d.aplicado), 2) END,
         min(d.vence) FILTER (WHERE d.monto - d.aplicado > 0)
    FROM doc d, permitido pe
    LEFT JOIN LATERAL (SELECT x.* FROM public.proveedores_maestro x
                        WHERE x.nit = d.emisor_nit ORDER BY x.id LIMIT 1) m ON true
   WHERE pe.ok
   GROUP BY d.emisor_nit
  HAVING round(sum(d.monto - d.aplicado), 2) <> 0
   ORDER BY 10 DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_cuentas_por_pagar(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_cuentas_por_pagar(date) TO authenticated, service_role;

-- ── 6. El detalle de un proveedor ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cuentas_por_pagar_detalle(p_emisor_nit text)
RETURNS TABLE (
    document_id       bigint,
    fecha_emision     date,
    tipo_dte          text,
    codigo_generacion text,
    numero_control    text,
    monto             numeric,
    aplicado          numeric,
    en_tramite        numeric,
    saldo             numeric,
    vence             date,
    dias_vencido      integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT d.document_id, d.fecha_emision, d.tipo_dte, d.codigo_generacion,
         d.numero_control, round(d.monto,2), round(d.aplicado,2),
         round(d.en_tramite,2), round(d.monto - d.aplicado, 2), d.vence,
         CASE WHEN d.vence IS NOT NULL AND d.vence < current_date
              THEN (current_date - d.vence)::integer END
    FROM public.compra_deuda_documentos d
   WHERE d.emisor_nit = p_emisor_nit
     AND (SELECT auth_has_module_permission('cuentas_por_pagar','can_view'))
   ORDER BY (d.monto - d.aplicado <> 0) DESC, d.fecha_emision DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_cuentas_por_pagar_detalle(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_cuentas_por_pagar_detalle(text) TO authenticated, service_role;

-- ── 7. Registrar un pago ────────────────────────────────────────────────────
-- Toda la validación vive acá y no en policies: es lo único que puede mirar el
-- saldo del documento ANTES de escribir. Un INSERT suelto podría aplicar más
-- de lo que se debe, y ese error no se ve hasta que el saldo no cuadra.
CREATE OR REPLACE FUNCTION public.registrar_pago_compra(
    p_emisor_nit   text,
    p_fecha        date,
    p_forma        text,
    p_referencia   text,
    p_aplicaciones jsonb,     -- [{document_id, monto}, …]
    p_nota         text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_emp   uuid;
  v_pago  bigint;
  v_total numeric(12,2) := 0;
  r       record;
  v_saldo numeric(12,2);
BEGIN
  IF NOT public.auth_has_module_permission('cuentas_por_pagar','can_edit') THEN
    RAISE EXCEPTION 'No tenés permiso para registrar pagos.';
  END IF;

  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Tu usuario no está activo.'; END IF;

  IF p_aplicaciones IS NULL OR jsonb_array_length(p_aplicaciones) = 0 THEN
    RAISE EXCEPTION 'Un pago tiene que decir a qué facturas se aplica.';
  END IF;

  -- El monto del pago es la SUMA de lo aplicado, no un número aparte: así no
  -- puede haber un pago de $500 repartido en $300.
  SELECT sum((x->>'monto')::numeric) INTO v_total
    FROM jsonb_array_elements(p_aplicaciones) x;
  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'El monto del pago tiene que ser mayor que cero.';
  END IF;

  INSERT INTO public.compra_pagos (emisor_nit, fecha, monto, forma, referencia, nota, registrado_por)
  VALUES (p_emisor_nit, p_fecha, v_total, p_forma, nullif(btrim(p_referencia),''), nullif(btrim(p_nota),''), v_emp)
  RETURNING id INTO v_pago;

  FOR r IN SELECT (x->>'document_id')::bigint AS doc, (x->>'monto')::numeric AS monto
             FROM jsonb_array_elements(p_aplicaciones) x
  LOOP
    IF r.monto IS NULL OR r.monto <= 0 THEN
      RAISE EXCEPTION 'Cada aplicación tiene que ser mayor que cero.';
    END IF;

    SELECT (d.monto - d.aplicado - d.en_tramite) INTO v_saldo
      FROM public.compra_deuda_documentos d
     WHERE d.document_id = r.doc AND d.emisor_nit = p_emisor_nit;

    IF v_saldo IS NULL THEN
      RAISE EXCEPTION 'La factura % no es deuda de ese proveedor.', r.doc;
    END IF;
    -- `v_saldo` ya descuenta lo que otros pagos pendientes reservaron sobre esa
    -- factura: dos pagos en trámite no pueden sumar más de lo que se debe.
    IF r.monto > v_saldo THEN
      RAISE EXCEPTION 'A la factura % sólo le quedan % por pagar.', r.doc, v_saldo;
    END IF;

    INSERT INTO public.compra_pago_aplicado (pago_id, document_id, monto)
    VALUES (v_pago, r.doc, r.monto);
  END LOOP;

  RETURN v_pago;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_pago_compra(text, date, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_pago_compra(text, date, text, text, jsonb, text) TO authenticated, service_role;

-- ── 8. Aprobar y anular — Gerencia ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aprobar_pago_compra(p_pago_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_emp uuid; v_estado text;
BEGIN
  IF NOT public.auth_has_module_permission('cuentas_por_pagar','can_approve') THEN
    RAISE EXCEPTION 'Aprobar un pago es de Gerencia.';
  END IF;
  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Tu usuario no está activo.'; END IF;

  SELECT estado INTO v_estado FROM public.compra_pagos WHERE id = p_pago_id;
  IF v_estado IS NULL       THEN RAISE EXCEPTION 'Ese pago no existe.'; END IF;
  IF v_estado <> 'pendiente' THEN RAISE EXCEPTION 'Ese pago ya está %.', v_estado; END IF;

  UPDATE public.compra_pagos
     SET estado = 'aprobado', aprobado_por = v_emp, aprobado_at = now()
   WHERE id = p_pago_id AND estado = 'pendiente';
END;
$function$;

CREATE OR REPLACE FUNCTION public.anular_pago_compra(p_pago_id bigint, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_emp uuid; v_estado text;
BEGIN
  IF NOT public.auth_has_module_permission('cuentas_por_pagar','can_approve') THEN
    RAISE EXCEPTION 'Anular un pago es de Gerencia.';
  END IF;
  IF nullif(btrim(coalesce(p_motivo,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Anular un pago necesita un motivo.';
  END IF;
  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Tu usuario no está activo.'; END IF;

  SELECT estado INTO v_estado FROM public.compra_pagos WHERE id = p_pago_id;
  IF v_estado IS NULL     THEN RAISE EXCEPTION 'Ese pago no existe.'; END IF;
  IF v_estado = 'anulado' THEN RAISE EXCEPTION 'Ese pago ya está anulado.'; END IF;

  -- El pago NO se borra: se anula con quién y por qué. Una salida de plata que
  -- desaparece del registro es exactamente lo que un control no puede permitir.
  UPDATE public.compra_pagos
     SET estado = 'anulado', anulado_por = v_emp, anulado_at = now(),
         anulado_motivo = btrim(p_motivo)
   WHERE id = p_pago_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aprobar_pago_compra(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.aprobar_pago_compra(bigint) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.anular_pago_compra(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.anular_pago_compra(bigint, text) TO authenticated, service_role;

-- ── 9. Los pagos de un proveedor ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pagos_compra(p_emisor_nit text DEFAULT NULL, p_dias integer DEFAULT 180)
RETURNS TABLE (
    id bigint, emisor_nit text, proveedor text, fecha date, monto numeric,
    forma text, referencia text, estado text, nota text,
    registrado_por text, registrado_at timestamptz,
    aprobado_por text, aprobado_at timestamptz,
    anulado_motivo text, facturas integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT p.id, p.emisor_nit,
         coalesce((SELECT m.nombre FROM public.proveedores_maestro m
                    WHERE m.nit = p.emisor_nit ORDER BY m.id LIMIT 1), p.emisor_nit),
         p.fecha, p.monto, p.forma, p.referencia, p.estado, p.nota,
         (SELECT e.name FROM public.employees e WHERE e.id = p.registrado_por), p.registrado_at,
         (SELECT e.name FROM public.employees e WHERE e.id = p.aprobado_por),  p.aprobado_at,
         p.anulado_motivo,
         (SELECT count(*)::integer FROM public.compra_pago_aplicado a WHERE a.pago_id = p.id)
    FROM public.compra_pagos p
   WHERE (p_emisor_nit IS NULL OR p.emisor_nit = p_emisor_nit)
     AND p.fecha >= current_date - coalesce(p_dias, 180)
     AND (SELECT auth_has_module_permission('cuentas_por_pagar','can_view'))
   ORDER BY (p.estado = 'pendiente') DESC, p.fecha DESC, p.id DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_pagos_compra(text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_pagos_compra(text, integer) TO authenticated, service_role;

-- ── 10. Quién lo usa ────────────────────────────────────────────────────────
-- Decisión del usuario (2026-08-16): «compras lo marca, pero gerencia ve el
-- control y aprueba los cheques». Eso cae exacto en los tres permisos que el
-- portal ya tiene: `can_edit` registra, `can_approve` autoriza.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
VALUES (12, 'cuentas_por_pagar', true,  true,  false, 'ALL'),   -- Jefe/a de Compras y Logística
       (2,  'cuentas_por_pagar', true,  true,  true,  'ALL')    -- Gerente General
ON CONFLICT (role_id, module_key) DO UPDATE
   SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit,
       can_approve = EXCLUDED.can_approve, scope = EXCLUDED.scope;
