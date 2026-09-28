-- ════════════════════════════════════════════════════════════════════════════
-- Distribución — pagos por forma (con comprobante) e invalidación de documentos
-- ════════════════════════════════════════════════════════════════════════════
--
-- BORRADOR (ver 0001): se prueba en el branch con execute_sql / el CLI.
--
-- ── Pagos ──────────────────────────────────────────────────────────────────
-- Una venta se puede pagar con varias formas a la vez ($2 en efectivo y el
-- resto con tarjeta). Es legal: el Manual Funcional v2.0 §XIX lo pone de
-- ejemplo, y cuando se mezcla contado con crédito la condición es «3 · Otro».
--
-- Cada forma que no es efectivo (tarjeta, cheque, transferencia, dinero
-- electrónico) pide su COMPROBANTE. Se puede adjuntar al vender o después: la
-- venta no espera a la foto, pero el pago queda «pendiente de comprobante» a
-- la vista hasta que alguien la suba. Al subirla se LEE el monto; si no
-- coincide, la pantalla pregunta, y la respuesta queda escrita.
--
-- El monto de la ÚLTIMA forma es «el resto»: lo calcula el servidor contra el
-- total que arma el motor de DTE, así un redondeo de un centavo en la pantalla
-- no puede hacer que los pagos no sumen el documento.
--
-- ── Invalidación ───────────────────────────────────────────────────────────
-- Un documento sellado no se edita: se invalida ante Hacienda. Dos caminos:
--   · CORREGIR: se emite el documento que lo reemplaza y el original se
--     invalida por «error en la información» (CAT-024 tipo 1), citando al
--     nuevo. Lo encadena el servidor: `reemplaza_dte_id` en el pedido nuevo.
--   · ANULAR LA VENTA: se invalida por «rescindir la operación» (tipo 2), sin
--     reemplazo, y el pedido queda anulado.

SET lock_timeout = '5s';

-- ── Bucket de comprobantes ─────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('dist-comprobantes', 'dist-comprobantes', false, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY dist_comprobantes_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'dist-comprobantes' AND (SELECT public.auth_has_module_permission('distribucion', 'can_view')));
CREATE POLICY dist_comprobantes_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'dist-comprobantes' AND (SELECT public.auth_can_edit_any(ARRAY['distribucion'])));

-- ── Pagos de un pedido ─────────────────────────────────────────────────────
CREATE TABLE public.dist_pagos (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pedido_id       bigint NOT NULL REFERENCES public.dist_pedidos(id) ON DELETE CASCADE,
    orden           smallint NOT NULL,
    -- CAT-017. '13' = a crédito (cuentas por pagar del receptor).
    forma           text NOT NULL CHECK (forma IN ('01','02','03','04','05','08','13','99')),
    -- NULL = «el resto»: lo pone el servidor al facturar. Sólo la última.
    monto           numeric(12,2) CHECK (monto IS NULL OR monto > 0),
    referencia      text,        -- número de autorización, de cheque, de transferencia
    comprobante_url text,        -- URL en formato público del bucket privado (regla 10)
    -- Lo que leyó la foto: entidad, monto, número, fecha, y la respuesta cruda.
    lectura         jsonb,
    monto_leido     numeric(12,2),
    verificacion    text NOT NULL DEFAULT 'no_aplica' CHECK (verificacion IN (
                        'no_aplica',          -- efectivo o crédito: no lleva comprobante
                        'pendiente',          -- lleva comprobante y todavía no se subió
                        'coincide',           -- se subió y el monto leído es el del pago
                        'sin_lectura',        -- se subió y no se pudo leer: lo confirmó una persona
                        'diferencia_aceptada' -- no coincide y alguien dijo por qué
                    )),
    nota            text,        -- el motivo, cuando no coincide o no se pudo leer
    registrado_por  uuid DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pedido_id, orden),
    CONSTRAINT dist_pagos_diferencia_con_nota CHECK (verificacion NOT IN ('diferencia_aceptada','sin_lectura') OR nota IS NOT NULL),
    CONSTRAINT dist_pagos_verificado_con_foto CHECK (verificacion IN ('no_aplica','pendiente') OR comprobante_url IS NOT NULL)
);
CREATE INDEX dist_pagos_pedido ON public.dist_pagos (pedido_id);
CREATE INDEX dist_pagos_pendientes ON public.dist_pagos (created_at) WHERE verificacion = 'pendiente';
CREATE INDEX dist_pagos_registrado_por ON public.dist_pagos (registrado_por);
CREATE TRIGGER dist_pagos_updated BEFORE UPDATE ON public.dist_pagos FOR EACH ROW EXECUTE FUNCTION public.dist_tocar_updated_at();

-- Una forma que no es efectivo ni crédito nace «pendiente de comprobante».
CREATE OR REPLACE FUNCTION public.dist_pago_verificacion_inicial()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
    IF NEW.forma IN ('01','13') THEN
        NEW.verificacion := 'no_aplica';
    ELSIF TG_OP = 'INSERT' AND NEW.comprobante_url IS NULL THEN
        NEW.verificacion := 'pendiente';
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_pago_verificacion_inicial() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER dist_pagos_verificacion BEFORE INSERT OR UPDATE OF forma ON public.dist_pagos
    FOR EACH ROW EXECUTE FUNCTION public.dist_pago_verificacion_inicial();

ALTER TABLE public.dist_pagos ENABLE ROW LEVEL SECURITY;
CREATE POLICY dist_pagos_select ON public.dist_pagos FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
CREATE POLICY dist_pagos_insert ON public.dist_pagos FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion']))
                AND EXISTS (SELECT 1 FROM public.dist_pedidos p WHERE p.id = pedido_id AND p.estado = 'confirmado'));
-- El comprobante se adjunta también DESPUÉS de facturar; la forma y el monto no.
CREATE POLICY dist_pagos_update ON public.dist_pagos FOR UPDATE TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['distribucion'])));
CREATE POLICY dist_pagos_delete ON public.dist_pagos FOR DELETE TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['distribucion']))
           AND EXISTS (SELECT 1 FROM public.dist_pedidos p WHERE p.id = pedido_id AND p.estado = 'confirmado'));

-- Con el pedido facturado, lo que ya está en el documento no se toca.
CREATE OR REPLACE FUNCTION public.dist_pago_congelado()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.dist_pedidos p WHERE p.id = OLD.pedido_id AND p.estado <> 'confirmado')
       AND (NEW.forma IS DISTINCT FROM OLD.forma OR NEW.monto IS DISTINCT FROM OLD.monto OR NEW.orden IS DISTINCT FROM OLD.orden)
       AND (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'DIST_PAGO_FACTURADO: la forma y el monto ya están en el documento; sólo se puede adjuntar el comprobante';
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_pago_congelado() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER dist_pagos_congelado BEFORE UPDATE ON public.dist_pagos FOR EACH ROW EXECUTE FUNCTION public.dist_pago_congelado();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dist_pagos TO authenticated, service_role;
REVOKE ALL ON public.dist_pagos FROM anon;

-- ── Invalidación ───────────────────────────────────────────────────────────
ALTER TABLE public.dist_dte
    ADD COLUMN invalidacion_estado    text CHECK (invalidacion_estado IS NULL OR invalidacion_estado IN ('pendiente','procesada','rechazada')),
    ADD COLUMN invalidacion_tipo      smallint CHECK (invalidacion_tipo IS NULL OR invalidacion_tipo IN (1,2,3)),
    ADD COLUMN invalidacion_motivo    text,
    ADD COLUMN invalidacion_firmado   text,
    ADD COLUMN invalidacion_sello     text,
    ADD COLUMN invalidacion_respuesta jsonb,
    ADD COLUMN invalidado_por         uuid REFERENCES public.employees(id),
    ADD COLUMN reemplazo_id           bigint REFERENCES public.dist_dte(id);
CREATE INDEX dist_dte_invalidacion_pendiente ON public.dist_dte (id) WHERE invalidacion_estado = 'pendiente';
CREATE INDEX dist_dte_reemplazo ON public.dist_dte (reemplazo_id);
CREATE INDEX dist_dte_invalidado_por ON public.dist_dte (invalidado_por);

-- El pedido que corrige un documento sellado dice cuál reemplaza.
ALTER TABLE public.dist_pedidos
    ADD COLUMN reemplaza_dte_id bigint REFERENCES public.dist_dte(id);
CREATE INDEX dist_pedidos_reemplaza ON public.dist_pedidos (reemplaza_dte_id);
-- Un documento se reemplaza UNA vez (mientras el reemplazo esté vivo).
CREATE UNIQUE INDEX dist_pedidos_un_reemplazo ON public.dist_pedidos (reemplaza_dte_id)
    WHERE reemplaza_dte_id IS NOT NULL AND estado <> 'anulado';

-- Un sellado corregido deja de contar como el documento vivo de su pedido.
DROP INDEX public.dist_dte_un_documento_por_pedido;
CREATE UNIQUE INDEX dist_dte_un_documento_por_pedido ON public.dist_dte (pedido_id)
    WHERE tipo IN ('01','03') AND estado NOT IN ('rechazado','invalidado','descartado');
