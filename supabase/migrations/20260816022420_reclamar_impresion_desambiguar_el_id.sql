SET lock_timeout = '5s';

-- `RETURNS TABLE(id bigint, ...)` declara una variable `id` que existe en TODO
-- el cuerpo, así que el `WHERE id = p_device` del latido no sabía si hablaba de
-- la columna o de la salida y abortaba con «column reference "id" is
-- ambiguous». Lo destapó la prueba del circuito, no la lectura: la función se
-- creó sin quejarse porque el conflicto es de ejecución, no de compilación.
--
-- Se califica la tabla en vez de renombrar la salida: el nombre `id` es el que
-- espera quien la llama.
CREATE OR REPLACE FUNCTION public.reclamar_impresion(p_device uuid, p_token uuid)
 RETURNS TABLE(id bigint, titulo text, contenido text, impresora text)
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_sala bigint; v_impresora text;
BEGIN
    SELECT d.branch_id, d.impresora INTO v_sala, v_impresora
      FROM public.impresion_dispositivos d
     WHERE d.id = p_device AND d.token = p_token AND d.activo;
    IF v_sala IS NULL THEN RAISE EXCEPTION 'Caja no reconocida.'; END IF;

    UPDATE public.impresion_dispositivos d
       SET ultimo_latido = now()
     WHERE d.id = p_device;

    -- El que quedó a medias vuelve a la cola: el agente se murió con el papel
    -- en la mano y nadie más lo iba a reclamar.
    UPDATE public.cola_impresion c
       SET estado = 'PENDIENTE', reclamado_at = NULL
     WHERE c.branch_id = v_sala AND c.estado = 'IMPRIMIENDO'
       AND c.reclamado_at < now() - interval '2 minutes';

    -- Y el que ya falló tres veces deja de reintentarse: un ticket que no sale
    -- nunca taparía a los que sí saldrían.
    UPDATE public.cola_impresion c
       SET estado = 'ERROR', error = coalesce(c.error, 'No se pudo imprimir despues de 3 intentos.')
     WHERE c.branch_id = v_sala AND c.estado = 'PENDIENTE' AND c.intentos >= 3;

    RETURN QUERY
    UPDATE public.cola_impresion c
       SET estado = 'IMPRIMIENDO', reclamado_at = now(),
           intentos = c.intentos + 1, dispositivo = p_device
     WHERE c.id = (
        SELECT x.id FROM public.cola_impresion x
         WHERE x.branch_id = v_sala AND x.estado = 'PENDIENTE'
         ORDER BY x.id
         -- Dos agentes abiertos por error nunca se llevan la misma fila.
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
    RETURNING c.id, c.titulo, c.contenido, v_impresora;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reclamar_impresion(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reclamar_impresion(uuid, uuid) TO anon, authenticated, service_role;
