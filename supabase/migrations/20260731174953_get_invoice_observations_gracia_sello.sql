SET lock_timeout = '5s';

-- Una factura sin sello NO es una anomalía: es el estado normal de una factura
-- recién emitida, y para eso ya existe la pestaña "Pendiente MH". Sin distinguir
-- las dos cosas, Observaciones nacía con 155 filas de las cuales 151 eran
-- tráfico en vuelo — o sea 97% de ruido tapando los 42 casos que sí importan.
--
-- El umbral NO es a ojo. La distribución de facturas sin sello al 2026-07-31
-- tiene un corte limpio en 2 días:
--
--     hoy      27
--     1 día   124
--     2 días    0   ← acá sella todo
--     3 días    1
--     5 días    1
--   336 días    2
--
-- El sello siempre llega dentro de 2 días; lo que pasa de ahí está varado. Por
-- eso `p_dias_gracia_sello` viene en 2 — y es parámetro, no constante, para que
-- ajustarlo no requiera otra migración.
--
-- DROP antes del CREATE a propósito: agregar un parámetro con DEFAULT vía
-- CREATE OR REPLACE deja las dos firmas vivas y toda llamada de 3 argumentos
-- falla con 42725 (ambigua). Un overload con DEFAULT no es deuda inerte.
DROP FUNCTION IF EXISTS public.get_invoice_observations(date, date, bigint);

CREATE FUNCTION public.get_invoice_observations(
    p_desde             date,
    p_hasta             date,
    p_branch_id         bigint  DEFAULT NULL,
    p_dias_gracia_sello integer DEFAULT 2
)
RETURNS TABLE (
    id             bigint,
    branch_id      bigint,
    fecha          date,
    tipo_documento text,
    correlativo    text,
    erp_invoice_id text,
    cliente        text,
    estado         text,
    total          numeric,
    recibido_mh    text,
    observaciones  text[]
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    SELECT si.id, si.branch_id, si.fecha, si.tipo_documento, si.correlativo,
           si.erp_invoice_id, si.cliente, si.estado, si.total, si.recibido_mh,
           obs.observaciones
    FROM public.sales_invoices si
    CROSS JOIN LATERAL (
        SELECT array_remove(ARRAY[
            -- El sello de Hacienda son exactamente 40 caracteres. Cualquier otra
            -- cosa NO es un sello, aunque no sea NULL. Esta no lleva gracia: un
            -- 'undefined' guardado es un defecto desde el instante cero.
            CASE WHEN si.recibido_mh IS NOT NULL AND length(si.recibido_mh) <> 40
                 THEN 'SELLO_INVALIDO' END,
            CASE WHEN si.recibido_mh IS NULL AND si.estado = 'FINALIZADA'
                  AND si.fecha <= current_date - p_dias_gracia_sello
                 THEN 'SIN_SELLO_VENCIDO' END,
            CASE WHEN si.codigo_generacion IS NULL AND si.estado = 'FINALIZADA'
                 THEN 'SIN_CODIGO_GENERACION' END,
            -- Catch-alls: un valor nuevo se reporta solo.
            CASE WHEN si.estado IS NULL
                   OR si.estado NOT IN ('FINALIZADA', 'DTE INVALIDADO EN MH', 'NULA')
                 THEN 'ESTADO_DESCONOCIDO' END,
            CASE WHEN si.tipo_documento IS NULL
                   OR si.tipo_documento NOT IN ('CCF', 'COF')
                 THEN 'TIPO_DOC_DESCONOCIDO' END,
            CASE WHEN si.correlativo IS NULL OR btrim(si.correlativo) = ''
                 THEN 'SIN_CORRELATIVO' END,
            CASE WHEN si.total IS NULL OR si.total < 0
                 THEN 'TOTAL_INVALIDO' END,
            CASE WHEN abs(coalesce(si.subtotal, 0) + coalesce(si.iva, 0)
                          - coalesce(si.total, 0)) > 0.01
                 THEN 'SUMA_NO_CUADRA' END
        ], NULL) AS observaciones
    ) obs
    WHERE si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND cardinality(obs.observaciones) > 0
    ORDER BY si.fecha DESC, si.branch_id, si.correlativo;
$$;

COMMENT ON FUNCTION public.get_invoice_observations(date, date, bigint, integer) IS
'Facturas con cualquier anomalía en el rango. Un sello son 40 chars: IS NOT NULL no alcanza. El sello sella dentro de 2 días (medido), de ahí la gracia.';

REVOKE EXECUTE ON FUNCTION public.get_invoice_observations(date, date, bigint, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_invoice_observations(date, date, bigint, integer) TO authenticated, service_role;
