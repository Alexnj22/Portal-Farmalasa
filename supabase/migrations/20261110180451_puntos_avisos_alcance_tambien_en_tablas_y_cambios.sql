-- La pestaña Avisos de puntos llega a la jefatura de sala con SU sala, también
-- por fuera del panel (2026-11-10).
-- 20261110171728 le dio `puntos_tab_avisos` (alcance BRANCH) a Jefe/a y
-- Subjefe/a de Sala y filtró `puntos_panel_avisos`. Pero el mismo permiso abría
-- otras tres puertas que no miraban el alcance: la función
-- `puntos_cambios_pendientes` (la lista de cambios de cliente de la misma
-- pestaña) y las tablas `puntos_irregularidad`, `puntos_anulacion_gastada` y
-- `puntos_cambio_pendiente`, legibles directo con la sesión. Las cuatro
-- quedan con la misma regla: ALL ve todas; el resto, sólo su sala.
SET lock_timeout = '5s';

DROP POLICY IF EXISTS puntos_irregularidad_select ON public.puntos_irregularidad;
CREATE POLICY puntos_irregularidad_select ON public.puntos_irregularidad
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view'))
         AND ((SELECT public.auth_module_scope('puntos_tab_avisos')) = 'ALL'
              OR sucursal = (SELECT b.codigo_puntos FROM public.branches b
                              WHERE b.id = (SELECT public.auth_employee_branch_id()))));

DROP POLICY IF EXISTS puntos_anulacion_gastada_select ON public.puntos_anulacion_gastada;
CREATE POLICY puntos_anulacion_gastada_select ON public.puntos_anulacion_gastada
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view'))
         AND ((SELECT public.auth_module_scope('puntos_tab_avisos')) = 'ALL'
              OR sucursal = (SELECT b.codigo_puntos FROM public.branches b
                              WHERE b.id = (SELECT public.auth_employee_branch_id()))));

-- Sin columna de sala: la sala es la de la venta.
DROP POLICY IF EXISTS puntos_cambio_pendiente_select ON public.puntos_cambio_pendiente;
CREATE POLICY puntos_cambio_pendiente_select ON public.puntos_cambio_pendiente
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view'))
         AND ((SELECT public.auth_module_scope('puntos_tab_avisos')) = 'ALL'
              OR EXISTS (SELECT 1 FROM public.sales_invoices si
                          WHERE si.id = puntos_cambio_pendiente.invoice_id
                            AND si.branch_id = (SELECT public.auth_employee_branch_id()))));

CREATE OR REPLACE FUNCTION public.puntos_cambios_pendientes()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json; v_todas boolean; v_sala integer;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver los avisos de puntos.' USING ERRCODE = '42501';
  END IF;
  -- Alcance (2026-11-10): ALL ve todas las salas; BRANCH, la de la venta.
  v_todas := public.auth_module_scope('puntos_tab_avisos') = 'ALL';
  v_sala  := public.auth_employee_branch_id();
  SELECT coalesce(json_agg(x ORDER BY x.resuelto_at IS NOT NULL, x.created_at DESC), '[]'::json) INTO v FROM (
    SELECT pc.solicitud_id, pc.created_at, pc.invoice_id, si.correlativo AS documento,
           l.puntos, cd.id AS de_id, cd.name AS de_nombre, ca.id AS a_id, ca.name AS a_nombre,
           pc.intentos, pc.ultimo_error, pc.ultimo_intento_at,
           pc.resuelto_at, pc.resuelto_como, pc.nota, pc.resuelto_por, er.name AS resuelto_por_nombre
      FROM public.puntos_cambio_pendiente pc
      LEFT JOIN public.sales_invoices si ON si.id = pc.invoice_id
      LEFT JOIN public.puntos_lote l ON l.invoice_id = pc.invoice_id AND l.origen = 'venta'
      LEFT JOIN public.customers cd ON cd.id = l.customer_id AND l.customer_id <> pc.customer_nuevo
      LEFT JOIN public.customers ca ON ca.id = pc.customer_nuevo
      LEFT JOIN public.employees er ON er.id = pc.resuelto_por
     WHERE (pc.resuelto_at IS NULL OR pc.resuelto_at >= now() - interval '7 days')
       AND (v_todas OR (v_sala IS NOT NULL AND si.branch_id = v_sala))
  ) x;
  RETURN v;
END;
$function$;
