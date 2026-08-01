SET lock_timeout = '5s';

-- El conjunto, en una sola definición que comparten el listado y el conteo.
--
-- Antes vivía dentro de `get_docs_sin_numero_control`, y contar "los que
-- faltan" pidiéndole 2000 filas devolvía 1000 SIEMPRE: PostgREST tiene
-- max-rows=1000 y trunca sin error. O sea que el backfill no podía saber si
-- quedaban 1000 o 7000. El conteo tiene que salir de una función que devuelve
-- un ESCALAR, que es lo único que ese cap no toca.
CREATE OR REPLACE FUNCTION public._docs_sin_numero_control()
RETURNS TABLE(id bigint, codigo_generacion uuid, fecha date)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    WITH base AS (
        SELECT si.id, si.codigo_generacion, si.branch_id, si.fecha,
               si.correlativo, si.tipo_documento, si.estado
        FROM public.sales_invoices si
        WHERE si.codigo_generacion IS NOT NULL
          AND si.numero_control IS NULL
          AND si.fecha >= '2025-05-01'
    ),
    ccf AS (
        SELECT b.id, b.codigo_generacion, b.fecha FROM base b
        WHERE b.tipo_documento = 'CCF' AND b.estado = 'FINALIZADA'
    ),
    anul AS (
        SELECT b.id, b.codigo_generacion, b.fecha FROM base b
        WHERE b.estado = 'DTE INVALIDADO EN MH'
    ),
    extremos AS (
        SELECT x.id, x.codigo_generacion, x.fecha FROM (
            SELECT b.id, b.codigo_generacion, b.fecha,
                   row_number() OVER (PARTITION BY b.branch_id, b.fecha ORDER BY b.correlativo ASC)  AS r_asc,
                   row_number() OVER (PARTITION BY b.branch_id, b.fecha ORDER BY b.correlativo DESC) AS r_desc
            FROM base b
            WHERE b.tipo_documento <> 'CCF' AND b.estado = 'FINALIZADA'
        ) x
        WHERE x.r_asc = 1 OR x.r_desc = 1
    )
    SELECT * FROM ccf
    UNION SELECT * FROM anul
    UNION SELECT * FROM extremos;
$$;

COMMENT ON FUNCTION public._docs_sin_numero_control() IS
    'Conjunto crudo de documentos que algún libro de IVA imprime y no tienen numero_control. Interna: la usan get_docs_sin_numero_control y count_docs_sin_numero_control para no tener dos definiciones que se desincronicen.';

CREATE OR REPLACE FUNCTION public.get_docs_sin_numero_control(p_limit int DEFAULT 500)
RETURNS TABLE(id bigint, codigo_generacion uuid)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    -- Más recientes primero: si el proveedor del ERP se cae a mitad del
    -- backfill, lo que queda sin traer es lo viejo, no el mes que está por
    -- declararse.
    SELECT d.id, d.codigo_generacion
    FROM public._docs_sin_numero_control() d
    ORDER BY d.fecha DESC, d.id DESC
    LIMIT greatest(1, least(p_limit, 1000));
$$;

-- Escalar a propósito: PostgREST no lo puede truncar.
CREATE OR REPLACE FUNCTION public.count_docs_sin_numero_control()
RETURNS int
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT count(*)::int FROM public._docs_sin_numero_control();
$$;

COMMENT ON FUNCTION public.count_docs_sin_numero_control() IS
    'Cuántos documentos siguen sin numero_control. Devuelve un escalar porque un SETOF lo truncaría PostgREST en 1000.';

REVOKE EXECUTE ON FUNCTION public._docs_sin_numero_control()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.count_docs_sin_numero_control()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_docs_sin_numero_control(int)    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._docs_sin_numero_control()          TO service_role;
GRANT  EXECUTE ON FUNCTION public.count_docs_sin_numero_control()     TO service_role;
GRANT  EXECUTE ON FUNCTION public.get_docs_sin_numero_control(int)    TO service_role;
