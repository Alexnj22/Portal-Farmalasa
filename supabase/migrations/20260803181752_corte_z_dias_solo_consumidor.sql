SET lock_timeout = '5s';

-- El desglose por día mezclaba COF y CCF, y son SERIES DE CORRELATIVO DISTINTAS:
-- el rango salía `000000054 → 000031617` porque el mínimo lo ponía un crédito
-- fiscal (que va por su propia numeración, en las decenas) y el máximo una
-- factura (en los treinta mil). Un rango así no se puede cotejar contra nada.
--
-- Se acota a COF, y no es una simplificación: este desglose existe para
-- enfrentarlo al reporte DIARIO del origen, que es el de consumidor final y
-- también es solo COF. Los créditos fiscales no lo necesitan — el libro de
-- contribuyentes los lista uno por uno (7 en Salud 1 en julio), así que una
-- diferencia ahí se persigue mirando el libro, no un resumen por día.
DROP FUNCTION IF EXISTS public.get_corte_z_dias(bigint, date);
CREATE FUNCTION public.get_corte_z_dias(p_branch_id bigint, p_periodo date)
RETURNS TABLE(fecha date, documentos bigint, total numeric,
              numero_control_del text, numero_control_al text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    WITH d AS (
        SELECT si.fecha, si.total, si.numero_control,
               nullif(regexp_replace(si.correlativo, '\D', '', 'g'), '')::bigint AS corr
        FROM public.sales_invoices si
        WHERE si.branch_id = p_branch_id
          AND si.tipo_documento = 'COF'
          AND si.estado = 'FINALIZADA' AND length(si.recibido_mh) = 40
          AND si.fecha >= date_trunc('month', p_periodo)::date
          AND si.fecha <= (date_trunc('month', p_periodo) + interval '1 month - 1 day')::date
    )
    SELECT d.fecha, count(*), round(sum(d.total), 2),
           -- Por CORRELATIVO, que es el orden real de emisión (20260803161220).
           (array_agg(d.numero_control ORDER BY d.corr NULLS LAST))[1],
           (array_agg(d.numero_control ORDER BY d.corr DESC NULLS LAST))[1]
    FROM d
    WHERE (SELECT auth_has_module_permission('corte_z', 'can_view'))
      AND ((SELECT auth_module_scope('corte_z')) = 'ALL'
           OR p_branch_id = (SELECT auth_employee_branch_id()))
    GROUP BY d.fecha
    ORDER BY d.fecha;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_corte_z_dias(bigint, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_corte_z_dias(bigint, date) TO authenticated, service_role;
