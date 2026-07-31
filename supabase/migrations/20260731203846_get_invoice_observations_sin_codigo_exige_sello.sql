SET lock_timeout = '5s';

-- El último solapamiento: "sin código" sin sello es la MISMA espera.
--
-- Después de sacar SIN_SELLO_VENCIDO quedaba 1 factura en las dos pestañas
-- (id 6651545, 0000062005_COF del 2026-07-28): sin sello y sin código de
-- generación. Aparecía en Pendiente MH por lo primero y acá por lo segundo,
-- siendo el mismo hecho — sello y código los emite Hacienda JUNTOS, que es
-- justo el motivo por el que comparten `p_dias_gracia_sello`.
--
-- La anomalía real es la asimetría: **el sello llegó y el código no**. Eso sí
-- es un dato inconsistente que hay que ir a corregir. Medido en prod hoy:
-- 0 facturas en esa condición, o sea que la clase queda vacía — y está bien,
-- significa que no hay ninguna inconsistencia de ese tipo, no que dejemos de
-- mirarla. La única que reportaba era una espera disfrazada.
--
-- Con esto cada factura cae en UNA sola pestaña: 157 en Pendiente MH, 25 en
-- Observaciones, 0 en las dos.
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
            -- Con gracia y CON sello: si tampoco llegó el sello, la factura
            -- está esperando a Hacienda y eso es Pendiente MH, no una anomalía.
            CASE WHEN si.codigo_generacion IS NULL AND si.recibido_mh IS NOT NULL
                  AND si.estado = 'FINALIZADA'
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
