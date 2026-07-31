SET lock_timeout = '5s';

-- SIN_SELLO_VENCIDO sale del catálogo: esa factura ya es de Pendiente MH.
--
-- Medido en prod el 2026-07-31, con las resoluciones de cada pestaña aplicadas:
-- 185 pendientes de MH, 27 observaciones y **25 facturas en las dos listas**.
-- El solapamiento no era casual, era estructural: dos de los códigos SON la
-- condición de Pendiente MH mirada desde el otro lado.
--
--   SELLO_INVALIDO     23 de 23 también en Pendiente MH  (sello presente pero
--                      de largo != 40 — lo agarraba el `not like` de la query)
--   SIN_SELLO_VENCIDO   2 de 3                            (subconjunto exacto:
--                      recibido_mh IS NULL + estado FINALIZADA)
--
-- La frontera queda en la CAUSA, no en la lista:
--
--   · le falta el sello y se espera a Hacienda  → **Pendiente MH** (tiene la
--     cuenta regresiva del plazo fiscal, que es lo que hace falta mirar)
--   · el dato está mal escrito                  → **Observaciones** (no se
--     arregla esperando; hay que corregirlo en el ERP)
--
-- SELLO_INVALIDO se va de Pendiente MH del lado del frontend (mismo commit):
-- un sello corrupto no se resuelve esperando, así que inflaba una cola de
-- espera con 23 casos que nunca iban a salir solos.
--
-- Y SIN_SELLO_VENCIDO se va de acá porque Pendiente MH ya lista TODAS las
-- facturas sin sello, viejas incluidas — reportarlo además como observación era
-- pedir que la misma factura se solventara dos veces, en dos tablas distintas
-- (`sales_invoice_resolutions` y `sales_observation_resolutions`), que es justo
-- lo que pasaba con la tercera: alguien la solventó en Pendiente MH y siguió
-- apareciendo acá.
--
-- Lo que ese código aportaba —"ya pasó la ventana de 2 días"— no se pierde: la
-- fila de fecha de Pendiente MH marca en `warning` los grupos que pasaron la
-- gracia. `p_dias_gracia_sello` se queda porque SIN_CODIGO_VENCIDO lo usa.
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
            -- Con gracia: el código de generación llega de Hacienda hasta 2 días
            -- después de emitida. Antes de eso no falta nada, está en camino.
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
