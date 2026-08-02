SET lock_timeout = '5s';

-- La primera version excluia la factura si estaba resuelta en CUALQUIERA de las
-- dos tablas de resoluciones. Esta mal, y es justo la confusion que el proyecto
-- ya documento al crear la segunda tabla (migracion 20260731193337):
--
--   `sales_invoice_resolutions`      = "revise el pendiente de Hacienda"
--   `sales_observation_resolutions`  = "revise la anomalia del documento"
--
-- Son dos preguntas distintas sobre la misma factura, y por eso viven separadas.
-- Colapsarlas hace que cerrar la cola de MH APAGUE una observacion que nadie
-- miro — el mismo error que se evito al separarlas, cometido en la direccion
-- contraria.
--
-- Ahora cada problema se apaga con SU resolucion, y la factura aparece mientras
-- le quede al menos uno sin cerrar.
--
-- Probado bajo BEGIN...ROLLBACK sobre un CCF real: sin sello -> 1, 'undefined'
-- -> 1 con los DOS problemas a la vez ("sin sello de Hacienda + con observacion:
-- SELLO_INVALIDO"), anulado sin completar -> 1.
CREATE OR REPLACE FUNCTION public.get_ccf_con_problema(p_desde date, p_hasta date)
 RETURNS TABLE(invoice_id bigint, branch_id bigint, branch_name text, fecha date,
               correlativo text, estado text, total numeric, problemas text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH obs AS (
        SELECT o.id, o.observaciones
        FROM public.get_invoice_observations(p_desde, p_hasta, NULL) o
        WHERE o.tipo_documento = 'CCF'
    ),
    base AS (
        SELECT si.id, si.branch_id, b.name AS branch_name, si.fecha, si.correlativo,
               si.estado, si.total, o.observaciones,
               EXISTS (SELECT 1 FROM public.sales_invoice_resolutions r WHERE r.invoice_id = si.id)      AS cerrado_mh,
               EXISTS (SELECT 1 FROM public.sales_observation_resolutions r WHERE r.invoice_id = si.id)  AS cerrado_obs
        FROM public.sales_invoices si
        JOIN public.branches b ON b.id = si.branch_id
        LEFT JOIN obs o ON o.id = si.id
        WHERE si.tipo_documento = 'CCF'
          AND si.fecha BETWEEN p_desde AND p_hasta
    ),
    marcado AS (
        SELECT b.*,
               array_remove(ARRAY[
                   CASE WHEN NOT b.cerrado_mh AND b.estado <> 'NULA'
                         AND (b.recibido_mh IS NULL OR length(b.recibido_mh) <> 40)
                        THEN 'sin sello de Hacienda' END,
                   CASE WHEN NOT b.cerrado_mh AND b.estado = 'NULA'
                        THEN 'anulado sin completar ante Hacienda' END,
                   CASE WHEN NOT b.cerrado_obs AND b.observaciones IS NOT NULL
                         AND array_length(b.observaciones, 1) > 0
                        THEN 'con observacion: ' || array_to_string(b.observaciones, ', ') END
               ], NULL) AS problemas
        FROM (SELECT b.*, si.recibido_mh FROM base b
              JOIN public.sales_invoices si ON si.id = b.id) b
    )
    SELECT m.id, m.branch_id::bigint, m.branch_name, m.fecha, m.correlativo,
           m.estado, m.total, m.problemas
    FROM marcado m
    WHERE array_length(m.problemas, 1) > 0
    ORDER BY m.fecha, m.branch_name, m.correlativo;
$function$;

COMMENT ON FUNCTION public.get_ccf_con_problema(date, date) IS
  'Los CCF que necesitan que alguien haga algo: sin sello, anulados sin completar ante Hacienda, o con observacion. Cada problema se apaga con SU tabla de resoluciones — sales_invoice_resolutions para los dos primeros, sales_observation_resolutions para el tercero. Colapsarlas haria que cerrar la cola de MH silencie una observacion que nadie miro. Las observaciones salen de get_invoice_observations y no se recalculan aca.';

REVOKE EXECUTE ON FUNCTION public.get_ccf_con_problema(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ccf_con_problema(date, date) TO authenticated, service_role;
