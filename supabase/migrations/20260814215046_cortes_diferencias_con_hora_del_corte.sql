-- El comprobante del movimiento acumulado lista las diferencias que cubre, y una
-- sala puede tener tres cortes el mismo día: sin la hora, el papel no dice CUÁL.
-- Se agrega `hora` a la lectura.
--
-- Va con DROP + CREATE porque cambia el tipo de retorno, y `CREATE OR REPLACE`
-- no puede con eso. La ventana es la de una transacción.

SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.get_cortes_diferencias(date, date);

CREATE FUNCTION public.get_cortes_diferencias(p_desde date, p_hasta date)
RETURNS TABLE(
    id bigint, corte_id bigint, branch_id bigint, fecha date, hora time,
    monto numeric, via text, causa text,
    registrado_at timestamptz, registrado_nombre text,
    impreso_at timestamptz,
    asentado_at timestamptz, asentado_ref text, asentado_nombre text,
    anulada_at timestamptz, anulada_motivo text,
    personas jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT d.id, d.corte_id, d.branch_id, d.fecha, c.hora,
           d.monto, d.via, d.causa,
           d.registrado_at, r.name, d.impreso_at,
           d.asentado_at, d.asentado_ref, a.name,
           d.anulada_at, d.anulada_motivo,
           coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                          'employee_id', p.employee_id, 'nombre', e.name,
                          'monto', p.monto, 'del_turno', p.del_turno)
                      ORDER BY e.name)
                 FROM public.cortes_caja_diferencia_personas p
                 JOIN public.employees e ON e.id = p.employee_id
                WHERE p.diferencia_id = d.id), '[]'::jsonb)
      FROM public.cortes_caja_diferencias d
      JOIN public.cortes_caja c ON c.id = d.corte_id
      LEFT JOIN public.employees r ON r.id = d.registrado_por
      LEFT JOIN public.employees a ON a.id = d.asentado_por
     WHERE (SELECT auth_has_module_permission('cortes_caja', 'can_view'))
       AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
            OR d.branch_id = (SELECT auth_employee_branch_id()))
       AND d.fecha BETWEEN p_desde AND p_hasta
     ORDER BY d.fecha DESC, d.registrado_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_cortes_diferencias(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cortes_diferencias(date, date) TO authenticated, service_role;
