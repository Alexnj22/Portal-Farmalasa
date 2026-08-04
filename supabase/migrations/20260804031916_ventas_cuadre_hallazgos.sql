-- El diagnóstico de una diferencia del cuadre de ventas, documento por documento.
--
-- POR QUÉ. El cuadre ya encontraba el DÍA que no cuadra, y ahí se detenía: su
-- aviso decía «faltan $X, hay que resincronizar». Auditando a mano la diferencia
-- de $9.00 de Salud 1 del 14/07 resultó que resincronizar NO servía de nada —el
-- que había perdido el registro era el origen, no el portal— así que el aviso
-- recetaba una cura que no aplicaba.
--
-- Los pasos de esa auditoría son mecánicos y caben acá: comparar los documentos
-- del día en vez de los totales, y para cada sobrante preguntarle a los dos
-- endpoints públicos de Hacienda. Lo que los distingue:
--
--   · `dteqr_json.php` devuelve el DTE  → la venta existe y está sellada
--   · `dteqr_pdf.php` revienta con      → el origen ya NO tiene la fila en su
--     `Undefined offset: 0`               base: el generador la busca y no está
--
-- Una fila por sucursal-día. Se reescribe en cada corrida (el diagnóstico es del
-- estado actual, no un histórico de intentos) y `resuelto_at` marca el día que
-- vuelve a cuadrar — sin eso, un día ya resuelto se re-diagnostica para siempre.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.ventas_cuadre_hallazgos (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id     bigint NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    fecha         date   NOT NULL,
    total_erp     numeric NOT NULL DEFAULT 0,
    total_portal  numeric NOT NULL DEFAULT 0,
    diferencia    numeric NOT NULL DEFAULT 0,
    -- Lo que no cierra con la suma de las causas encontradas. Si esto no es 0,
    -- el diagnóstico está incompleto y hay que decirlo, no taparlo.
    sin_explicar  numeric NOT NULL DEFAULT 0,
    documentos    jsonb  NOT NULL DEFAULT '[]'::jsonb,
    diagnosticado_at timestamptz NOT NULL DEFAULT now(),
    resuelto_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (branch_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_ventas_cuadre_hallazgos_branch_fecha
    ON public.ventas_cuadre_hallazgos(branch_id, fecha);

ALTER TABLE public.ventas_cuadre_hallazgos ENABLE ROW LEVEL SECURITY;

-- Solo lectura desde el cliente: quien escribe es la edge function del cuadre,
-- con service_role, que no pasa por RLS.
DROP POLICY IF EXISTS ventas_cuadre_hallazgos_select ON public.ventas_cuadre_hallazgos;
CREATE POLICY ventas_cuadre_hallazgos_select ON public.ventas_cuadre_hallazgos
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('corte_z', 'can_view')));

COMMENT ON TABLE public.ventas_cuadre_hallazgos IS
    'Diagnóstico por documento de una diferencia del cuadre diario de ventas. Lo escribe check-sales-reconciliation.';
COMMENT ON COLUMN public.ventas_cuadre_hallazgos.documentos IS
    '[{erp_invoice_id, correlativo, total, causa, impacto, detalle}] — causa: falta_en_portal | sin_sello | origen_perdio_fila | anulado | anulado_sin_invalidar | dte_inexistente | monto_distinto | sin_clasificar';
