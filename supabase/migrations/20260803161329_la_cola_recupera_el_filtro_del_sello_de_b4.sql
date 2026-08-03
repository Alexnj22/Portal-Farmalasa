SET lock_timeout = '5s';

-- Restaura el filtro de sello que B4/H12 (20260802205606) le habia puesto a
-- `_docs_sin_numero_control` y que 20260803161220 borro sin querer: aquella
-- migracion partio del cuerpo de 20260802033604 —una version ANTERIOR a B4— en
-- vez de partir del catalogo vivo. Cambiaba el criterio de orden y de paso
-- retrocedio el filtro.
--
-- Lo que B4 arreglaba y vuelve a estar: cada rama usa EXACTAMENTE el filtro del
-- libro que la consume. CCF y los extremos del dia exigen sello de 40 —porque
-- `get_libro_ventas_contribuyente` y `get_libro_ventas_consumidor` lo exigen—;
-- los anulados NO, porque `get_libro_anulados` tampoco lo lleva. Sin el filtro,
-- cuando el primero del dia no tiene sello la cola pide el numero de control de
-- un documento que el libro no usa y no pide el del que si.
--
-- El criterio de orden queda en CORRELATIVO, que es lo que 20260803161220 venia
-- a corregir. Las dos cosas son independientes y ahora estan las dos.
--
-- La leccion, escrita para no repetirla: el cuerpo de una funcion que se va a
-- reemplazar se saca de `pg_get_functiondef`, no del ultimo archivo de migracion
-- que uno encuentre — puede haber otra posterior que ya la toco. Es la misma
-- trampa que el arbol compartido, pero en el catalogo.

CREATE OR REPLACE FUNCTION public._docs_sin_numero_control()
RETURNS TABLE(id bigint, codigo_generacion uuid, fecha date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    WITH universo AS (
        SELECT si.id, si.codigo_generacion, si.branch_id, si.fecha,
               si.tipo_documento, si.estado, si.numero_control, si.recibido_mh,
               nullif(regexp_replace(si.correlativo, '\D', '', 'g'), '')::bigint AS corr_num
        FROM public.sales_invoices si
        WHERE si.codigo_generacion IS NOT NULL
          AND si.fecha >= '2025-05-01'
    ),
    ccf AS (
        SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control FROM universo u
        WHERE u.tipo_documento = 'CCF' AND u.estado = 'FINALIZADA'
          AND length(u.recibido_mh) = 40
    ),
    anul AS (
        -- Sin filtro de sello: get_libro_anulados tampoco lo tiene.
        SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control FROM universo u
        WHERE u.estado = 'DTE INVALIDADO EN MH'
    ),
    extremos AS (
        SELECT x.id, x.codigo_generacion, x.fecha, x.numero_control FROM (
            SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control,
                   row_number() OVER (PARTITION BY u.branch_id, u.fecha ORDER BY u.corr_num ASC NULLS LAST)  AS r_asc,
                   row_number() OVER (PARTITION BY u.branch_id, u.fecha ORDER BY u.corr_num DESC NULLS LAST) AS r_desc
            FROM universo u
            WHERE u.tipo_documento = 'COF' AND u.estado = 'FINALIZADA'
              AND length(u.recibido_mh) = 40
        ) x
        WHERE x.r_asc = 1 OR x.r_desc = 1
    ),
    todos AS (
        SELECT * FROM ccf UNION SELECT * FROM anul UNION SELECT * FROM extremos
    )
    SELECT t.id, t.codigo_generacion, t.fecha
    FROM todos t
    WHERE t.numero_control IS NULL;
$fn$;

COMMENT ON FUNCTION public._docs_sin_numero_control() IS
  'B4/H12: cada rama usa EXACTAMENTE el filtro del libro que la consume — CCF y los extremos del dia exigen sello de 40, los anulados no (get_libro_anulados tampoco). Los extremos del dia se eligen por CORRELATIVO (20260803161220), que es el orden real de emision. Si se cambia el filtro o el orden de un libro, hay que cambiarlo aca el mismo dia.';

REVOKE EXECUTE ON FUNCTION public._docs_sin_numero_control() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._docs_sin_numero_control() TO service_role;
