SET lock_timeout = '5s';

-- Qué documentos necesitan número de control, en UN solo lugar.
--
-- El conjunto no es "todas las ventas" —serían 726 por día— sino sólo las que
-- algún libro imprime: los CCF (libro de contribuyentes), los anulados (su
-- anexo) y la PRIMERA y ÚLTIMA venta de cada sucursal-día (el rango del→al del
-- libro de consumidor final). Son ~16 por día contra 726, o sea el 2%.
--
-- Vive en la base y no en la Edge Function a propósito: la misma definición la
-- usan el backfill histórico y el cron diario, así que si algún día cambia un
-- libro, cambia acá y los dos quedan alineados. Una copia en cada lado es
-- exactamente cómo se desincronizan.
--
-- Más recientes primero: si el proveedor del ERP se cae a mitad del backfill,
-- lo que queda sin traer es lo viejo, no el mes que estás por declarar.
CREATE OR REPLACE FUNCTION public.get_docs_sin_numero_control(p_limit int DEFAULT 500)
RETURNS TABLE(id bigint, codigo_generacion uuid)
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
    ),
    todos AS (
        SELECT * FROM ccf
        UNION SELECT * FROM anul
        UNION SELECT * FROM extremos
    )
    SELECT t.id, t.codigo_generacion
    FROM todos t
    ORDER BY t.fecha DESC, t.id DESC
    LIMIT greatest(1, least(p_limit, 2000));
$$;

COMMENT ON FUNCTION public.get_docs_sin_numero_control(int) IS
    'Documentos que algún libro de IVA imprime y todavía no tienen numero_control. ~16/día contra 726 ventas. Más recientes primero. La usan el backfill y el cron.';

-- Escribe el lote. `IS DISTINCT FROM` para no reescribir una fila que ya tiene
-- el valor: sin eso, un cron que reprocesa el mismo día genera churn de WAL
-- sobre una tabla de 548K filas por nada.
CREATE OR REPLACE FUNCTION public.set_numero_control_batch(
    p_ids bigint[], p_numeros text[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_tocadas int;
BEGIN
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN 0;
    END IF;
    IF array_length(p_ids, 1) <> array_length(p_numeros, 1) THEN
        RAISE EXCEPTION 'ids y numeros tienen largos distintos (% vs %)',
            array_length(p_ids, 1), array_length(p_numeros, 1);
    END IF;

    WITH datos AS (
        SELECT unnest(p_ids) AS id, unnest(p_numeros) AS numero
    )
    UPDATE public.sales_invoices si
    SET numero_control = d.numero
    FROM datos d
    WHERE si.id = d.id
      AND nullif(btrim(d.numero), '') IS NOT NULL
      AND si.numero_control IS DISTINCT FROM d.numero;

    GET DIAGNOSTICS v_tocadas = ROW_COUNT;
    RETURN v_tocadas;
END;
$$;

COMMENT ON FUNCTION public.set_numero_control_batch(bigint[], text[]) IS
    'Escribe numero_control en lote. Ignora cadenas vacías y no reescribe filas iguales (evita churn de WAL).';

REVOKE EXECUTE ON FUNCTION public.get_docs_sin_numero_control(int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_numero_control_batch(bigint[], text[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_docs_sin_numero_control(int) TO service_role;
GRANT  EXECUTE ON FUNCTION public.set_numero_control_batch(bigint[], text[]) TO service_role;
