-- Un ticket que espera más de 10 minutos ya no se imprime (2026-10-28).
-- IMPRESION-EN-TICKETERA §cola: con la caja apagada, el trabajo quedaba en
-- PENDIENTE y salía al día siguiente, cuando nadie lo esperaba. Ahora, al
-- reclamar, lo que lleva más de 10 minutos en la cola pasa a ERROR con el
-- motivo — el mismo estado de «no salió», así que la pantalla de la cola ya lo
-- muestra y la purga de 14 días ya lo barre. Sin tocar la tabla (no hay DDL).
-- Partida de la definición VIVA; sólo se agrega el bloque del vencimiento.
-- La versión de dos parámetros delega en ésta, así que vale para las dos.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reclamar_impresion(p_device uuid, p_token uuid, p_version text, p_canal text)
 RETURNS TABLE(id bigint, titulo text, contenido_b64 text, impresora text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_sala bigint; v_impresora text;
BEGIN
    SELECT d.branch_id, d.impresora INTO v_sala, v_impresora
      FROM public.impresion_dispositivos d
     WHERE d.id = p_device AND d.token = p_token AND d.activo;
    IF v_sala IS NULL THEN RAISE EXCEPTION 'Caja no reconocida.'; END IF;

    -- `coalesce` y no asignacion directa: la version de dos parametros llega
    -- con NULL, y no tiene por qué borrar lo que ya se sabia de esta caja.
    --
    -- El `WHERE` es lo que separa preguntar de ESCRIBIR: la fila se toca cuando
    -- el latido ya tiene 30 s, o cuando el agente dice algo distinto de lo
    -- guardado. En una caja quieta eso son 2 escrituras por minuto en vez de 60.
    UPDATE public.impresion_dispositivos d
       SET ultimo_latido  = now(),
           agente_version = coalesce(p_version, d.agente_version),
           agente_canal   = coalesce(p_canal,   d.agente_canal)
     WHERE d.id = p_device
       AND (d.ultimo_latido IS NULL
            OR d.ultimo_latido < now() - interval '30 seconds'
            OR (p_version IS NOT NULL AND p_version IS DISTINCT FROM d.agente_version)
            OR (p_canal   IS NOT NULL AND p_canal   IS DISTINCT FROM d.agente_canal));

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

    -- El que espera más de 10 minutos tampoco sale (2026-10-28): con la caja
    -- apagada, un ticket de la tarde salía a la mañana siguiente, cuando ya
    -- nadie lo esperaba. Se cuenta desde que se pidió, no desde el reintento.
    UPDATE public.cola_impresion c
       SET estado = 'ERROR',
           error  = 'No se imprimió: esperó más de 10 minutos a que la caja respondiera. Si todavía hace falta, vuelve a imprimirlo.'
     WHERE c.branch_id = v_sala AND c.estado = 'PENDIENTE'
       AND c.created_at < now() - interval '10 minutes';

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
    RETURNING c.id, c.titulo, encode(c.contenido, 'base64'), v_impresora;
END;
$function$;
