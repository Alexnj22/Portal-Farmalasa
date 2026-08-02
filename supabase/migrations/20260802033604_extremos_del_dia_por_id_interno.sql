SET lock_timeout = '5s';

-- El PRIMERO y el ÚLTIMO documento del día se eligen por ID INTERNO, no por
-- correlativo.
--
-- No son el mismo orden: hay días donde un documento con correlativo menor
-- tiene id mayor. Medido en la sucursal 2 el 2026-06-08 — el reporte del origen
-- da como primero el `…020977` (id 302651) y por correlativo salía el `…020473`
-- (id 302658). Afectaba 50 de 180 filas del libro de consumidor.
--
-- Es el mismo criterio que se corrigió en compras (20260802033106): el origen
-- lista por orden de captura.
--
-- El criterio vive en TRES lugares y los tres tienen que decir lo mismo: el
-- libro, el conjunto que alimenta el backfill del número de control, y el
-- generador que se usa para verificar. Si se desincronizan, el libro pide un
-- documento cuyo número nadie trajo. Cambiar el criterio metió 760 documentos
-- nuevos en la cola del backfill, que se drenaron el mismo día.

DROP FUNCTION IF EXISTS public.get_libro_ventas_consumidor(date, date, bigint);
CREATE FUNCTION public.get_libro_ventas_consumidor(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL)
RETURNS TABLE(branch_id bigint, fecha date, correlativo_del text, correlativo_al text,
              numero_control_del text, numero_control_al text,
              codigo_gen_del uuid, codigo_gen_al uuid, sello_del text,
              erp_id_del text, erp_id_al text, documentos bigint,
              ventas_exentas numeric, ventas_gravadas numeric,
              exportaciones numeric, total_diario numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    SELECT si.branch_id, si.fecha,
           (array_agg(si.correlativo       ORDER BY si.erp_id_num))[1],
           (array_agg(si.correlativo       ORDER BY si.erp_id_num DESC))[1],
           (array_agg(si.numero_control    ORDER BY si.erp_id_num))[1],
           (array_agg(si.numero_control    ORDER BY si.erp_id_num DESC))[1],
           (array_agg(si.codigo_generacion ORDER BY si.erp_id_num))[1],
           (array_agg(si.codigo_generacion ORDER BY si.erp_id_num DESC))[1],
           (array_agg(si.recibido_mh       ORDER BY si.erp_id_num))[1],
           (array_agg(si.erp_invoice_id    ORDER BY si.erp_id_num))[1],
           (array_agg(si.erp_invoice_id    ORDER BY si.erp_id_num DESC))[1],
           count(*),
           coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva, 0) = 0), 0),
           coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva, 0) > 0), 0),
           0::numeric,
           coalesce(sum(si.total), 0)
    FROM (
        SELECT s.*, nullif(regexp_replace(s.erp_invoice_id, '\D', '', 'g'), '')::bigint AS erp_id_num
        FROM public.sales_invoices s
    ) si
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.tipo_documento = 'COF' AND si.estado = 'FINALIZADA'
      AND length(si.recibido_mh) = 40
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    GROUP BY si.branch_id, si.fecha
    ORDER BY si.branch_id, si.fecha;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_libro_ventas_consumidor(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_ventas_consumidor(date, date, bigint) TO authenticated, service_role;

-- El conjunto del backfill usa EL MISMO criterio.
CREATE OR REPLACE FUNCTION public._docs_sin_numero_control()
RETURNS TABLE(id bigint, codigo_generacion uuid, fecha date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    WITH universo AS (
        SELECT si.id, si.codigo_generacion, si.branch_id, si.fecha,
               si.tipo_documento, si.estado, si.numero_control,
               nullif(regexp_replace(si.erp_invoice_id, '\D', '', 'g'), '')::bigint AS erp_id_num
        FROM public.sales_invoices si
        WHERE si.codigo_generacion IS NOT NULL AND si.fecha >= '2025-05-01'
    ),
    ccf AS (
        SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control FROM universo u
        WHERE u.tipo_documento = 'CCF' AND u.estado = 'FINALIZADA'
    ),
    anul AS (
        SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control FROM universo u
        WHERE u.estado = 'DTE INVALIDADO EN MH'
    ),
    extremos AS (
        SELECT x.id, x.codigo_generacion, x.fecha, x.numero_control FROM (
            SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control,
                   row_number() OVER (PARTITION BY u.branch_id, u.fecha ORDER BY u.erp_id_num ASC)  AS r_asc,
                   row_number() OVER (PARTITION BY u.branch_id, u.fecha ORDER BY u.erp_id_num DESC) AS r_desc
            FROM universo u
            WHERE u.tipo_documento = 'COF' AND u.estado = 'FINALIZADA'
        ) x
        WHERE x.r_asc = 1 OR x.r_desc = 1
    ),
    todos AS (SELECT * FROM ccf UNION SELECT * FROM anul UNION SELECT * FROM extremos)
    SELECT t.id, t.codigo_generacion, t.fecha FROM todos t WHERE t.numero_control IS NULL;
$fn$;

-- `generar_csv_libro` (la segunda implementación usada para verificar) quedó
-- alineada al mismo criterio en esta migración; su cuerpo vive en el catálogo y
-- se reconstruye desde acá junto con las dos funciones de arriba.
