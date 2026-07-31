SET lock_timeout = '5s';

-- Reporta CUALQUIER anomalía de una factura, con un discriminador por tipo.
--
-- Existe porque el módulo de Facturación partía el universo en dos:
-- `recibido_mh IS NULL` = pendiente, `IS NOT NULL` = confirmada por Hacienda.
-- Esa partición dejó 24 facturas con el sello en basura ('undefined', '') del
-- lado "confirmada" — invisibles como problema y contadas como buenas. La
-- diferencia contra el libro IVA del ERP fue lo que las destapó (2026-07-31).
--
-- La regla ahora es explícita: un sello de recepción son 40 caracteres, punto.
-- Y ESTADO_DESCONOCIDO / TIPO_DOC_DESCONOCIDO son catch-alls a propósito: si el
-- sync empieza a escribir un valor que hoy no existe, aparece acá en vez de
-- pasar en silencio. Esa es la parte que evita el próximo caso de este tipo.
--
-- INVOKER (sin SECURITY DEFINER): el RLS de sales_invoices aplica al llamador.
CREATE OR REPLACE FUNCTION public.get_invoice_observations(
    p_desde     date,
    p_hasta     date,
    p_branch_id bigint DEFAULT NULL
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
            -- cosa NO es un sello, aunque no sea NULL.
            CASE WHEN si.recibido_mh IS NOT NULL AND length(si.recibido_mh) <> 40
                 THEN 'SELLO_INVALIDO' END,
            CASE WHEN si.recibido_mh IS NULL AND si.estado = 'FINALIZADA'
                 THEN 'SIN_SELLO' END,
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

COMMENT ON FUNCTION public.get_invoice_observations(date, date, bigint) IS
'Facturas con cualquier anomalía en el rango. Un sello de Hacienda son 40 chars: IS NOT NULL no alcanza.';

REVOKE EXECUTE ON FUNCTION public.get_invoice_observations(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_invoice_observations(date, date, bigint) TO authenticated, service_role;
