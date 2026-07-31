SET lock_timeout = '5s';

-- El código de generación tiene EXACTAMENTE la misma transitoriedad que el
-- sello: llegan juntos desde Hacienda. Medido el 2026-07-31, mismo corte limpio:
--
--     hoy      4
--     1 día   12
--     2 días   0   ← acá llega todo
--     3 días   1
--
-- Sin la gracia, la pestaña mostraba 17 "Sin código" de las cuales 16 eran
-- facturas en vuelo. Comparte `p_dias_gracia_sello` porque es el mismo hecho
-- físico, no dos umbrales que casualmente coinciden.
--
-- Se renombra a SIN_CODIGO_VENCIDO para que el nombre diga lo que la condición
-- hace: no es "sin código", es "sin código pasada la ventana".
--
-- Verificado que las otras clases NO son transitorias y por eso no llevan
-- gracia: SELLO_INVALIDO va de 41 a 450 días, SIN_CORRELATIVO y
-- TIPO_DOC_DESCONOCIDO son la misma factura de hace 266 días.
CREATE OR REPLACE FUNCTION public.get_invoice_observations(
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
            -- Sin gracia: un 'undefined' guardado es un defecto desde el
            -- instante cero, no un estado por el que la factura pasa.
            CASE WHEN si.recibido_mh IS NOT NULL AND length(si.recibido_mh) <> 40
                 THEN 'SELLO_INVALIDO' END,
            -- Con gracia: el sello y el código llegan de Hacienda hasta 2 días
            -- después de emitida. Antes de eso no falta nada, está en camino.
            CASE WHEN si.recibido_mh IS NULL AND si.estado = 'FINALIZADA'
                  AND si.fecha <= current_date - p_dias_gracia_sello
                 THEN 'SIN_SELLO_VENCIDO' END,
            CASE WHEN si.codigo_generacion IS NULL AND si.estado = 'FINALIZADA'
                  AND si.fecha <= current_date - p_dias_gracia_sello
                 THEN 'SIN_CODIGO_VENCIDO' END,
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
