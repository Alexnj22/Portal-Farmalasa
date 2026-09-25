-- Las diferencias de caja traen el id de FICHA de quien registró, recibió,
-- anotó y anuló, no sólo el nombre: la pantalla pinta la foto junto a cada
-- nombre (usuario, 2026-09-25: «siempre la foto con los nombres»). Con el
-- nombre a secas el avatar no tiene con qué buscarla y cae a la inicial.
--
-- Cambia el RETURNS TABLE (agrega registrado_por y asentado_por), así que es
-- DROP + CREATE y se reponen los permisos de siempre. Los abonos suman las
-- claves en su jsonb, que no cambia la firma.
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.get_cortes_diferencias(date, date);

CREATE FUNCTION public.get_cortes_diferencias(p_desde date, p_hasta date)
 RETURNS TABLE(id bigint, corte_id bigint, branch_id bigint, fecha date, hora time without time zone, monto numeric, via text, causa text, registrado_at timestamp with time zone, registrado_nombre text, impreso_at timestamp with time zone, asentado_at timestamp with time zone, asentado_ref text, asentado_nombre text, anulada_at timestamp with time zone, anulada_motivo text, personas jsonb, evidencia_ref text, evidencia_foto_url text, abonos jsonb, registrado_por uuid, asentado_por uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT d.id, d.corte_id, d.branch_id, d.fecha, c.hora,
           d.monto, d.via, d.causa,
           d.registrado_at, r.name, d.impreso_at,
           d.asentado_at, d.asentado_ref, a.name,
           d.anulada_at, d.anulada_motivo,
           coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                          'persona_id', p.id,
                          'employee_id', p.employee_id, 'nombre', e.name,
                          'monto', p.monto, 'del_turno', p.del_turno,
                          'abonado', coalesce(ya.abonado, 0),
                          'saldo', p.monto - coalesce(ya.abonado, 0))
                      ORDER BY e.name)
                 FROM public.cortes_caja_diferencia_personas p
                 JOIN public.employees e ON e.id = p.employee_id
                 LEFT JOIN LATERAL (
                     SELECT sum(ab.monto) AS abonado FROM public.cortes_caja_diferencia_abonos ab
                      WHERE ab.persona_id = p.id AND ab.anulada_at IS NULL) ya ON true
                WHERE p.diferencia_id = d.id), '[]'::jsonb),
           d.evidencia_ref, d.evidencia_foto_url,
           coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                          'id', ab.id, 'persona_id', ab.persona_id,
                          'employee_id', ab.employee_id, 'nombre', e.name,
                          'monto', ab.monto, 'registrado_at', ab.registrado_at,
                          'registrado_por', ab.registrado_por,
                          'registrado_nombre', rr.name, 'impreso_at', ab.impreso_at,
                          'asentado_at', ab.asentado_at, 'asentado_ref', ab.asentado_ref,
                          'asentado_por', ab.asentado_por,
                          'asentado_nombre', aa.name,
                          'anulada_at', ab.anulada_at, 'anulada_motivo', ab.anulada_motivo,
                          'anulada_por', ab.anulada_por,
                          'anulada_nombre', an.name)
                      ORDER BY ab.registrado_at)
                 FROM public.cortes_caja_diferencia_abonos ab
                 JOIN public.employees e ON e.id = ab.employee_id
                 LEFT JOIN public.employees rr ON rr.id = ab.registrado_por
                 LEFT JOIN public.employees aa ON aa.id = ab.asentado_por
                 LEFT JOIN public.employees an ON an.id = ab.anulada_por
                WHERE ab.diferencia_id = d.id), '[]'::jsonb),
           d.registrado_por, d.asentado_por
      FROM public.cortes_caja_diferencias d
      JOIN public.cortes_caja c ON c.id = d.corte_id
      LEFT JOIN public.employees r ON r.id = d.registrado_por
      LEFT JOIN public.employees a ON a.id = d.asentado_por
     WHERE (SELECT auth_has_module_permission('cortes_caja', 'can_view'))
       AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
            OR d.branch_id = (SELECT auth_employee_branch_id()))
       AND d.fecha BETWEEN p_desde AND p_hasta
     ORDER BY d.fecha DESC, d.registrado_at DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_cortes_diferencias(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cortes_diferencias(date, date) TO authenticated, service_role;
