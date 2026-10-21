SET lock_timeout = '5s';

-- El alcance de un módulo sale SÓLO de una fila que da algún permiso.
--
-- Con dos cargos, `'ALL' IN (primario, secundario)` tomaba el alcance de la
-- fila del cargo que NO da el permiso. Medido el 2026-10-21: ALEXANDER MELGAR
-- e IDALIA SERRANO quedaban con ALL en `bitacoras_configurar`,
-- `bitacoras_descargar` y `bitacoras_tab_cierre` —el permiso se lo da el cargo
-- de sala, y el ALL lo ponía una fila apagada del otro cargo—, así que
-- `aplicar_horarios_bitacora` les dejaba reprogramar bitácoras de otras salas.
--
-- Una fila apagada tampoco frena el resto de la cascada: sin permiso propio
-- sigue el superusuario y después lo heredado, como si la fila no existiera.
-- El mismo criterio vive en `AuthContext.jsx`, que arma el mapa del navegador.
CREATE OR REPLACE FUNCTION public.auth_module_scope(p_module_key text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH propio AS (
    SELECT
      (SELECT rp.scope FROM public.role_permissions rp
        WHERE rp.role_id = public.auth_employee_role_id()
          AND rp.module_key = p_module_key
          AND (rp.can_view OR rp.can_edit OR rp.can_approve))   AS primario,
      (SELECT rp.scope FROM public.role_permissions rp
        WHERE rp.role_id = public.auth_employee_secondary_role_id()
          AND rp.module_key = p_module_key
          AND (rp.can_view OR rp.can_edit OR rp.can_approve))   AS secundario
  )
  SELECT CASE
    WHEN 'ALL' IN (coalesce(p.primario, ''), coalesce(p.secundario, '')) THEN 'ALL'
    WHEN p.primario   IS NOT NULL THEN p.primario
    WHEN p.secundario IS NOT NULL THEN p.secundario
    WHEN (SELECT public.auth_is_su()) THEN 'ALL'
    WHEN (SELECT public.hay_alguien_no_disponible()) THEN coalesce(
      (SELECT h.scope FROM public.mis_permisos_heredados() h
        WHERE h.module_key = p_module_key LIMIT 1),
      'MINE')
    ELSE 'MINE'
  END
  FROM propio p;
$function$;
