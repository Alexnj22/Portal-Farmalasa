SET lock_timeout = '5s';

-- Resoluciones de la pestaña Observaciones.
--
-- Tabla propia y NO `sales_invoice_resolutions` a propósito: esa tabla es la
-- cola de Hacienda (¿se gestionó el envío?). Una factura con SUMA_NO_CUADRA
-- suele estar TAMBIÉN pendiente de MH, así que compartir la tabla haría que
-- marcar "ya revisé la suma" la sacara de la cola con fecha límite del MH.
-- Dos preguntas distintas → dos registros distintos.
--
-- Sin FK a sales_invoices: mismo criterio que las otras dos tablas de
-- resoluciones del módulo (el padre es una tabla caliente que los crons
-- escriben cada minuto; una FK nueva pide lock sobre ella).
CREATE TABLE IF NOT EXISTS public.sales_observation_resolutions (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id  bigint NOT NULL,
    comment     text,
    resolved_by text,
    resolved_at timestamptz NOT NULL DEFAULT now(),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_observation_resolutions_invoice
    ON public.sales_observation_resolutions (invoice_id);

ALTER TABLE public.sales_observation_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_observation_resolutions_read ON public.sales_observation_resolutions;
CREATE POLICY sales_observation_resolutions_read
    ON public.sales_observation_resolutions FOR SELECT TO authenticated
    USING (true);

-- El INSERT exige can_edit en Facturación — el mismo gate que la UI usa para
-- decidir si dibuja el botón de solventar. `(SELECT ...)` obligatorio: sin el
-- initplan la función se evalúa por fila.
DROP POLICY IF EXISTS sales_observation_resolutions_insert ON public.sales_observation_resolutions;
CREATE POLICY sales_observation_resolutions_insert
    ON public.sales_observation_resolutions FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['facturacion'::text])));

REVOKE ALL ON public.sales_observation_resolutions FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.sales_observation_resolutions TO authenticated;
GRANT ALL ON public.sales_observation_resolutions TO service_role;
