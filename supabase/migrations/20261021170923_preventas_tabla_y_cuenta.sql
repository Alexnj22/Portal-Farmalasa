-- Preventas de reservas (2026-10-21), 1 de 5: la entidad del portal.
--
-- La PREVENTA es del portal: qué se vendió, a quién, quién la armó y en qué
-- quedó. El sistema donde hoy se factura es un destino (`sistema = 'caja'`) y
-- su número viaja como referencia externa (`externo_id`). El enlace con la
-- factura también es del portal (`sales_invoice_id`). El día que se facture en
-- el portal no hay que mudar nada de la reserva.
SET lock_timeout = '5s';

-- Lo que falta pagar de una reserva: UNA definición. total = precio × cantidad
-- + envío; pagado = el anticipo, o todo si se pagó en línea (un cobro de PRUEBA
-- no es dinero); falta = total − pagado.
CREATE OR REPLACE FUNCTION public.reserva_cuenta(p_id bigint)
RETURNS TABLE (total numeric, pagado numeric, falta_pagar numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH r AS (
    SELECT round(coalesce(precio_unitario, 0) * cantidad + coalesce(costo_envio, 0), 2) AS total,
           greatest(coalesce(anticipo, 0), 0) AS anticipo,
           (pago_estado = 'pagado' AND NOT coalesce(pago_prueba, false)) AS en_linea
      FROM public.app_reservas WHERE id = p_id),
  p AS (SELECT total, round(greatest(anticipo, CASE WHEN en_linea THEN total ELSE 0 END), 2) AS pagado FROM r)
  SELECT total, pagado, round(greatest(total - pagado, 0), 2) FROM p;
$$;
REVOKE ALL ON FUNCTION public.reserva_cuenta(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserva_cuenta(bigint) TO service_role;

CREATE TABLE IF NOT EXISTS public.preventas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  branch_id bigint NOT NULL REFERENCES public.branches(id),
  customer_id bigint REFERENCES public.customers(id),
  reservas_ids bigint[] NOT NULL,
  -- La venta como la armó el portal (`armarVenta`): cliente, vendedor, renglones, nota.
  venta jsonb,
  total numeric(12, 2),
  vendedor_codigo text,
  enviada_por uuid REFERENCES public.employees(id),
  enviada_at timestamptz,
  estado text NOT NULL DEFAULT 'enviando'
    CHECK (estado IN ('enviando', 'viva', 'sin_enlace', 'facturada', 'fallida', 'descartada')),
  -- Dónde se factura. Hoy 'caja'; el día que sea el portal, 'portal'.
  sistema text NOT NULL DEFAULT 'caja' CHECK (sistema IN ('caja', 'portal')),
  externo_id text,   -- el número de la venta en ese sistema
  externo_ref text,  -- el número corto que ve la caja en su lista
  destino jsonb,     -- lo que devolvió el destino: renglones recibidos y avisos
  error text,
  -- La factura que la cerró. Sin FK a propósito: `sales_invoices` es tabla
  -- caliente y una FK nueva le pediría lock.
  sales_invoice_id bigint,
  codigo_generacion uuid,
  facturada_at timestamptz
);
COMMENT ON TABLE public.preventas IS
  'La venta de una reserva armada en el portal y enviada a donde se factura. El número del destino es referencia externa (externo_id).';

CREATE UNIQUE INDEX IF NOT EXISTS preventas_externo_uq ON public.preventas (sistema, externo_id) WHERE externo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS preventas_abiertas_idx ON public.preventas (id) WHERE estado IN ('enviando', 'viva');
CREATE INDEX IF NOT EXISTS preventas_branch_idx ON public.preventas (branch_id);
CREATE INDEX IF NOT EXISTS preventas_customer_idx ON public.preventas (customer_id);
CREATE INDEX IF NOT EXISTS preventas_factura_idx ON public.preventas (sales_invoice_id) WHERE sales_invoice_id IS NOT NULL;

ALTER TABLE public.preventas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS preventas_select ON public.preventas;
CREATE POLICY preventas_select ON public.preventas FOR SELECT TO authenticated
  USING (branch_id = (SELECT public.auth_employee_branch_id())
         OR (SELECT public.auth_module_scope('reservas')) = 'ALL');
-- Sin policies de escritura: la escriben sólo sus funciones.
REVOKE ALL ON public.preventas FROM anon;
GRANT SELECT ON public.preventas TO authenticated;

ALTER TABLE public.app_reservas ADD COLUMN IF NOT EXISTS preventa_id bigint REFERENCES public.preventas(id);
CREATE INDEX IF NOT EXISTS app_reservas_preventa_idx ON public.app_reservas (preventa_id) WHERE preventa_id IS NOT NULL;

-- A quién se le avisa de una reserva: los de ESA sala con el módulo de
-- reservas, y quienes lo tienen con alcance de toda la red.
CREATE OR REPLACE FUNCTION public.destinatarios_de_reservas(p_branch_id bigint)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT array_agg(DISTINCT e.id)
    FROM public.employees e
    JOIN public.role_permissions rp
      ON rp.role_id IN (e.role_id, e.secondary_role_id)
     AND rp.module_key = 'reservas'
     AND (rp.can_view OR rp.can_edit)
   WHERE e.status = 'ACTIVO'
     AND (e.branch_id = p_branch_id OR rp.scope = 'ALL');
$$;
REVOKE ALL ON FUNCTION public.destinatarios_de_reservas(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.destinatarios_de_reservas(bigint) TO service_role;
