-- El historial de una sala mezclaba registros de OTROS módulos (2026-10-29).
-- `target_id` es el id de lo que se tocó, y lo usan traslados, productos,
-- permisos, proveedores…: `target_id = '1'` traía el traslado 1, el producto 1
-- y el cargo 1 como si fueran de la sala 1. Medido: de 2,570 registros con un
-- `target_id` igual al id de alguna sala, 6 eran de una sala. En pantalla
-- salían como «Configuración Modificada» con el rótulo TRASLADO SOLICITADO.
-- La rama por `target_id` ahora exige además una acción de sucursal.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.audit_log_de_sucursal(p_branch_id text)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT ((SELECT public.auth_has_module_permission('branches','can_view'))
       OR (SELECT public.auth_has_module_permission('auditview','can_view'))) THEN
    RAISE EXCEPTION 'sin permiso para ver el historial de la sucursal' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT json_agg(to_json(t) ORDER BY t.created_at DESC)
    FROM (
      -- Dos ramas con UNION y no un OR: cada una entra por su índice.
      -- Las acciones que se anotan con la SALA como `target_id`:
      SELECT a.* FROM public.audit_logs a
       WHERE a.target_id = p_branch_id
         AND a.action IN ('APERTURA_OFICIAL','EDITAR_SUCURSAL','ELIMINAR_SUCURSAL','DOC_AGREGADO','PAGO_REGISTRADO',
                          'RECARGA_HISTORICO_VENTAS_INICIADA','RECARGA_HISTORICO_VENTAS_TERMINADA')
      UNION
      -- Las que nombran la sala en `details`:
      SELECT a.* FROM public.audit_logs a
       WHERE a.action IN ('VINCULAR_KIOSCO','REVOCAR_KIOSCO','EMPLEADO_ASIGNADO','EMPLEADO_RELEVADO',
                          'EMPLEADO_DESVINCULADO_SUCURSAL','PROMOTION','SINCRONIZAR_VENTAS_SUCURSAL')
         AND p_branch_id IN (a.details->>'branch_id', a.details->>'target_branch_id', a.details->>'previous_branch_id')
      ORDER BY created_at DESC
      LIMIT 200
    ) t
  ), '[]'::json);
END;
$function$;
