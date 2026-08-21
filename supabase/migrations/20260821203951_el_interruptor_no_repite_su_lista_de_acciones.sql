SET lock_timeout = '5s';

-- La lista de acciones estaba escrita DOS veces: en el CHECK de
-- `traslado_interruptor` y otra vez adentro de esta función. El 2026-08-18 se
-- agregaron `sobrante_enviar` y `sobrante_recibir` al CHECK y no acá, así que
-- los dos frenos del sobrante se veían en la pantalla de Mantenimiento y
-- **no se podían accionar**: cualquier intento moría con `ACCION_INVALIDA`.
-- Medido en el entorno de pruebas el 2026-08-21.
--
-- La lista no se corrige: se ELIMINA. La verdad es la tabla —una fila por
-- freno—, así que el UPDATE ya dice si la acción existe: si no tocó ninguna
-- fila, la llave no es válida. Una lista que no existe no se puede
-- desincronizar.
CREATE OR REPLACE FUNCTION public.set_traslado_interruptor(
    p_accion text, p_pausado boolean, p_motivo text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
    IF NOT (SELECT auth_has_module_permission('pedidos', 'can_edit')) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;

    UPDATE public.traslado_interruptor
       SET pausado      = p_pausado,
           motivo       = nullif(btrim(coalesce(p_motivo, '')), ''),
           cambiado_por = (SELECT auth_employee_id()),
           cambiado_at  = now()
     WHERE accion = p_accion;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ACCION_INVALIDA';
    END IF;

    RETURN jsonb_build_object('accion', p_accion, 'pausado', p_pausado);
END;
$function$;
