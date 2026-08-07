-- Facturas que el barrido NO debe intentar nunca más.
--
-- El filtro por sello ya evita el caso conocido —no se puede invalidar ante
-- Hacienda un documento que Hacienda nunca recibió— pero es una regla general
-- y esto es una decisión explícita sobre facturas concretas: quedan fuera,
-- consta por qué, y si mañana cambia la situación se borra la fila.
--
-- Distinta de `sales_invoice_resolutions`, que significa "alguien ya revisó
-- esto". Acá el significado es "no lo intentes".
--
-- Las 8 primeras (2026-08-07): comprobantes de crédito fiscal anulados que
-- nunca llegaron a Hacienda. Son los números 1, 2, 4 y 5 de cada sucursal —el
-- arranque del DTE— más errores anulados antes de transmitir. El barrido los
-- reintentaba todas las noches desde que existe: 4 intentos registrados por
-- cada uno, siempre con el mismo rechazo del ERP ("Esta factura no ha sido
-- validada por MH no se puede validar la anulacion").

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dte_excluidas_del_barrido (
  invoice_id   bigint PRIMARY KEY REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  motivo       text NOT NULL,
  excluida_por text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dte_excluidas_del_barrido ENABLE ROW LEVEL SECURITY;

-- Lectura para quien ve Facturación. La escritura es de las edge functions
-- (service_role, que no pasa por RLS) y de una migración como ésta: no hay
-- policy de INSERT a propósito — que una factura deje de intentarse es una
-- decisión, no algo que se haga desde la pantalla sin dejar rastro.
-- El `(SELECT ...)` alrededor de la función auth no es opcional: sin él
-- Postgres la evalúa por fila (incidente 2026-07-08).
DROP POLICY IF EXISTS dte_excluidas_read ON public.dte_excluidas_del_barrido;
CREATE POLICY dte_excluidas_read ON public.dte_excluidas_del_barrido
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('facturacion', 'can_view')));

COMMENT ON TABLE public.dte_excluidas_del_barrido IS
  'Facturas que regularizar-dte no debe intentar. Decision explicita, con motivo.';

INSERT INTO public.dte_excluidas_del_barrido (invoice_id, motivo, excluida_por)
SELECT si.id,
       'Anulada sin sello: Hacienda nunca la recibió, así que no hay nada que '
       'invalidar. El ERP responde "Esta factura no ha sido validada por MH no '
       'se puede validar la anulacion".',
       'Decisión del usuario 2026-08-07'
FROM public.sales_invoices si
WHERE si.estado = 'NULA'
  AND (si.recibido_mh IS NULL OR si.recibido_mh NOT LIKE repeat('_', 40))
ON CONFLICT (invoice_id) DO NOTHING;
