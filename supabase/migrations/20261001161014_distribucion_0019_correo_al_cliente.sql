-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0019 — el documento se le manda al cliente por correo
-- ═══════════════════════════════════════════════════════════════════════════
-- Hacienda exige que el emisor le entregue al receptor su documento
-- electrónico —el JSON con firma y sello— y la representación gráfica. Hasta
-- hoy la distribuidora sólo imprimía el ticket.
--
-- ── Una bandeja de salida, no un «envío y listo» ─────────────────────────
-- `dist_correos` lleva UNA fila por intento de entrega. Nace sola cuando el
-- documento queda SELLADO (antes no: el cliente tiene que recibir el sello), en
-- `pendiente` si la ficha tiene correo o en `sin_correo` si no. Así Facturación
-- puede decir qué documentos todavía no le llegaron a nadie, que es justo lo
-- que se olvida: un correo que falló no da error en ninguna pantalla.
--
-- ── Quién lo manda ───────────────────────────────────────────────────────
-- La edge function `distribucion-correo`, con la sesión de quien lo pide. La
-- representación gráfica la arma el NAVEGADOR (pdfmake ya vive ahí, y es el
-- mismo PDF que se descarga) y viaja en el pedido; el JSON lo arma la función
-- desde la base, con su firma y su sello, para que nadie pueda mandar uno
-- alterado. Sin proveedor configurado, la función lo dice y no marca nada.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dist_correos (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dte_id        bigint NOT NULL REFERENCES public.dist_dte(id),
    destinatario  text,
    estado        text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'fallido', 'sin_correo')),
    intentos      smallint NOT NULL DEFAULT 0,
    ultimo_error  text,
    proveedor_id  text,
    enviado_at    timestamptz,
    enviado_por   uuid REFERENCES public.employees(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dist_correos_enviado CHECK (estado <> 'enviado' OR (enviado_at IS NOT NULL AND destinatario IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS dist_correos_dte ON public.dist_correos (dte_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dist_correos_por_resolver ON public.dist_correos (estado) WHERE estado IN ('pendiente', 'fallido', 'sin_correo');
CREATE INDEX IF NOT EXISTS dist_correos_enviado_por ON public.dist_correos (enviado_por) WHERE enviado_por IS NOT NULL;

ALTER TABLE public.dist_correos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dist_correos_select ON public.dist_correos;
CREATE POLICY dist_correos_select ON public.dist_correos FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
REVOKE ALL ON public.dist_correos FROM anon, authenticated;
GRANT SELECT ON public.dist_correos TO authenticated;
GRANT ALL ON public.dist_correos TO service_role;

-- Nace con el sello: una vez por documento de venta o nota.
CREATE OR REPLACE FUNCTION public.dist_correo_al_sellar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_correo text;
BEGIN
    IF NEW.estado <> 'sellado' OR OLD.estado IS NOT DISTINCT FROM NEW.estado OR NEW.tipo NOT IN ('01', '03', '05') THEN
        RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM public.dist_correos WHERE dte_id = NEW.id) THEN RETURN NEW; END IF;
    SELECT nullif(btrim(correo), '') INTO v_correo FROM public.dist_clientes WHERE id = NEW.cliente_id;
    INSERT INTO public.dist_correos (dte_id, destinatario, estado)
    VALUES (NEW.id, v_correo, CASE WHEN v_correo IS NULL THEN 'sin_correo' ELSE 'pendiente' END);
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_correo_al_sellar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS dist_correo_al_sellar ON public.dist_dte;
CREATE TRIGGER dist_correo_al_sellar AFTER UPDATE OF estado ON public.dist_dte
    FOR EACH ROW EXECUTE FUNCTION public.dist_correo_al_sellar();

-- El último estado de entrega de cada documento, para listas y el semáforo.
CREATE OR REPLACE VIEW public.dist_correo_vigente WITH (security_invoker = true) AS
SELECT DISTINCT ON (dte_id) dte_id, id, destinatario, estado, intentos, ultimo_error, enviado_at, created_at
  FROM public.dist_correos ORDER BY dte_id, created_at DESC, id DESC;
REVOKE ALL ON public.dist_correo_vigente FROM anon;
GRANT SELECT ON public.dist_correo_vigente TO authenticated;

-- Registro del intento, desde la edge function (service_role).
CREATE OR REPLACE FUNCTION public.dist_registrar_correo(
    p_dte bigint, p_destinatario text, p_ok boolean, p_error text, p_proveedor_id text, p_empleado uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_id bigint;
BEGIN
    -- Se reusa la fila abierta (pendiente, sin correo o fallida); si ya se
    -- había enviado, un reenvío es una fila nueva: la historia no se pisa.
    SELECT id INTO v_id FROM public.dist_correos
     WHERE dte_id = p_dte AND estado IN ('pendiente', 'fallido', 'sin_correo') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF v_id IS NULL THEN
        INSERT INTO public.dist_correos (dte_id, destinatario) VALUES (p_dte, p_destinatario) RETURNING id INTO v_id;
    END IF;
    UPDATE public.dist_correos
       SET destinatario = p_destinatario, intentos = intentos + 1,
           estado = CASE WHEN p_ok THEN 'enviado' ELSE 'fallido' END,
           ultimo_error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 500) END,
           proveedor_id = p_proveedor_id,
           enviado_at = CASE WHEN p_ok THEN now() END, enviado_por = p_empleado
     WHERE id = v_id;
    RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_registrar_correo(bigint, text, boolean, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dist_registrar_correo(bigint, text, boolean, text, text, uuid) TO service_role;

-- Lo sellado antes de este borrador también se entrega: queda pendiente.
INSERT INTO public.dist_correos (dte_id, destinatario, estado)
SELECT d.id, nullif(btrim(c.correo), ''), CASE WHEN nullif(btrim(c.correo), '') IS NULL THEN 'sin_correo' ELSE 'pendiente' END
  FROM public.dist_dte d JOIN public.dist_clientes c ON c.id = d.cliente_id
 WHERE d.estado = 'sellado' AND d.tipo IN ('01', '03', '05')
   AND d.fec_emi >= current_date - 30 AND d.json ? 'identificacion'
   AND NOT EXISTS (SELECT 1 FROM public.dist_correos x WHERE x.dte_id = d.id);
