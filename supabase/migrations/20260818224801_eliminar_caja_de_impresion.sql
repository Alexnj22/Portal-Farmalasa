-- Eliminar una caja de impresión (2026-08-18).
--
-- La pantalla sabía crear cajas y no sabía sacarlas, así que un código que se
-- generó dos veces —o una instalación que se repitió porque no se pudo entrar a
-- la computadora— deja filas para siempre. Salud 3 quedó con TRES cajas: dos que
-- nunca dieron un latido y la buena. Una lista con dos cajas muertas hace dudar
-- de la que sí funciona, que es justo lo que esta pantalla existe para contestar.
--
-- Se borra de verdad, no se desactiva: `activo=false` la dejaría en la lista
-- diciendo lo mismo que hoy. Lo que sí se conserva es el historial de la cola —
-- el papel que ya salió por esa caja sigue estando, sin el puntero a la caja.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.eliminar_caja_de_impresion(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_nombre text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['impresion'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    -- Lo que quedó EN LA MANO de esa caja no puede volver a la cola: la caja se
    -- borra sin poder confirmar si el papel salió, así que reencolarlo puede
    -- imprimir dos veces el mismo documento y dejarlo en IMPRIMIENDO lo vuelve
    -- un fantasma que nadie reclama. Queda como lo que es: un trabajo que no se
    -- sabe si salió, con el motivo escrito.
    UPDATE public.cola_impresion
       SET estado = 'ERROR',
           error  = 'La caja se eliminó mientras este documento estaba en ella.'
     WHERE dispositivo = p_id AND estado = 'IMPRIMIENDO';

    -- El resto del historial se queda; lo que se va es el puntero. La FK no deja
    -- borrar la caja con filas apuntándola.
    UPDATE public.cola_impresion SET dispositivo = NULL WHERE dispositivo = p_id;

    DELETE FROM public.impresion_dispositivos d
     WHERE d.id = p_id
    RETURNING d.nombre INTO v_nombre;

    -- Sin esto, borrar dos veces desde dos pestañas contesta «listo» las dos
    -- veces y la segunda no hizo nada.
    IF v_nombre IS NULL THEN
        RAISE EXCEPTION 'Esa caja ya no existe.';
    END IF;

    RETURN v_nombre;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.eliminar_caja_de_impresion(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.eliminar_caja_de_impresion(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.eliminar_caja_de_impresion(uuid) IS
 'Saca una caja de la lista. Borra la fila y conserva el historial de la cola sin el puntero. Pide can_edit en el modulo impresion.';
