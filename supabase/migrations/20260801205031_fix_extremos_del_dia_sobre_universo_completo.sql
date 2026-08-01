SET lock_timeout = '5s';

-- CORRIGE un conjunto que se regeneraba solo.
--
-- La versión anterior filtraba `numero_control IS NULL` en la CTE `base`, o sea
-- ANTES de calcular la primera y la última venta de cada sucursal-día. El
-- efecto: al llenar la primera venta del día, la SEGUNDA pasaba a ser "la
-- primera de las que faltan" y volvía a entrar. La cola no se vaciaba nunca —
-- se habría comido las 548K facturas de a 400 por corrida.
--
-- Medido: se llenaron 100 documentos y el pendiente bajó de 6,923 a 6,920.
--
-- Ahora el universo son TODAS las ventas candidatas y el descarte de las que ya
-- tienen número va al final. El conjunto es estable: los mismos ~6,923
-- documentos, se llenen en el orden que se llenen. Verificado tras el fix: un
-- lote de 400 bajó el pendiente de 6,902 a 6,503.
CREATE OR REPLACE FUNCTION public._docs_sin_numero_control()
RETURNS TABLE(id bigint, codigo_generacion uuid, fecha date)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    WITH universo AS (
        SELECT si.id, si.codigo_generacion, si.branch_id, si.fecha,
               si.correlativo, si.tipo_documento, si.estado, si.numero_control
        FROM public.sales_invoices si
        WHERE si.codigo_generacion IS NOT NULL
          AND si.fecha >= '2025-05-01'
    ),
    ccf AS (
        SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control FROM universo u
        WHERE u.tipo_documento = 'CCF' AND u.estado = 'FINALIZADA'
    ),
    anul AS (
        SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control FROM universo u
        WHERE u.estado = 'DTE INVALIDADO EN MH'
    ),
    -- La ventana corre sobre el día ENTERO, tenga o no número de control cada
    -- documento. Es la única forma de que "el primero del día" sea siempre el
    -- mismo documento.
    extremos AS (
        SELECT x.id, x.codigo_generacion, x.fecha, x.numero_control FROM (
            SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control,
                   row_number() OVER (PARTITION BY u.branch_id, u.fecha ORDER BY u.correlativo ASC)  AS r_asc,
                   row_number() OVER (PARTITION BY u.branch_id, u.fecha ORDER BY u.correlativo DESC) AS r_desc
            FROM universo u
            WHERE u.tipo_documento <> 'CCF' AND u.estado = 'FINALIZADA'
        ) x
        WHERE x.r_asc = 1 OR x.r_desc = 1
    ),
    todos AS (
        SELECT * FROM ccf
        UNION SELECT * FROM anul
        UNION SELECT * FROM extremos
    )
    SELECT t.id, t.codigo_generacion, t.fecha
    FROM todos t
    WHERE t.numero_control IS NULL;
$$;

COMMENT ON FUNCTION public._docs_sin_numero_control() IS
    'Documentos que algún libro de IVA imprime y no tienen numero_control. Los extremos del día se calculan sobre TODAS las ventas del día y el descarte de los ya llenos va al final: si se filtrara antes, la cola se regeneraría sola.';
