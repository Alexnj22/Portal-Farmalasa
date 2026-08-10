SET lock_timeout = '5s';

-- ══════════════════════════════════════════════════════════════════════════
-- «No cuadra» marcaba el 100% de las facturas con retención, y ninguna otra
-- ══════════════════════════════════════════════════════════════════════════
-- Lo preguntó el usuario mirando la pestaña: «¿no será que son porque tienen
-- retención?». Medido, y es exactamente eso:
--
--     facturas marcadas «No cuadra»        44
--     de esas, con retención               44   (todas)
--     cuadran al restar la retención       44   (todas)
--     suma de las diferencias         $179.36
--     suma de las retenciones         $179.36   ← el mismo número
--
-- Y en la otra dirección, que es donde estas cosas se caen: hay 44 facturas con
-- retención en toda la base, las mismas 44, y CERO cuadran con la fórmula vieja.
-- O sea que la regla no encontraba un desvío contable: encontraba la retención.
--
-- El total del ERP ya viene con la retención restada —`subtotal + IVA −
-- retención = total`, que es lo que exige el Art. 162— y la regla comparaba
-- `subtotal + IVA` contra ese total. El descuadre era de la fórmula.
--
-- Al corregirla la categoría queda en CERO, y eso es lo que se busca: un
-- detector que sólo suena cuando pasa algo. Uno que marca 44 casos legítimos
-- enseña a ignorarlo, y el día que aparezca un descuadre real se pierde entre
-- ellos — que es justo el defecto que esta pestaña vino a cerrar.
CREATE OR REPLACE FUNCTION public.get_invoice_observations(
    p_desde     date,
    p_hasta     date,
    p_branch_id bigint DEFAULT NULL,
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
            -- La RETENCIÓN entra en la cuenta: el total ya viene con ella
            -- restada. Sin este término la regla marcaba las 44 facturas con
            -- retención de toda la base y ninguna otra.
            CASE WHEN abs(coalesce(si.subtotal, 0) + coalesce(si.iva, 0)
                          - coalesce(si.retencion, 0) - coalesce(si.total, 0)) > 0.01
                 THEN 'SUMA_NO_CUADRA' END
        ], NULL) AS observaciones
    ) obs
    WHERE si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND cardinality(obs.observaciones) > 0
    ORDER BY si.fecha DESC, si.branch_id, si.correlativo;
$$;

COMMENT ON FUNCTION public.get_invoice_observations(date, date, bigint, integer) IS
'Facturas con cualquier anomalia en el rango. Un sello de Hacienda son 40 chars: IS NOT NULL no alcanza. SUMA_NO_CUADRA descuenta la retencion: el total del ERP ya viene con ella restada.';

REVOKE EXECUTE ON FUNCTION public.get_invoice_observations(date, date, bigint, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_invoice_observations(date, date, bigint, integer) TO authenticated, service_role;
