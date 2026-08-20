SET lock_timeout = '5s';

-- El latido de la caja se ESCRIBE cada 30 s, aunque se siga preguntando cada segundo.
--
-- ── El número que lo destapó ──────────────────────────────────────────────────
-- `impresion_dispositivos` tiene **6 filas** y recibió **101.984 escrituras** en
-- 21 horas: 93.674 llamadas por día a esta función, ~1,1 por segundo, 20,7 MB de
-- WAL diarios. Es tanto como toda la sincronización de compras junta, y nadie lo
-- estaba mirando porque el UPDATE vive DENTRO de esta función y las estadísticas
-- por consulta sólo registran la llamada de arriba.
--
-- ── Lo que NO se toca: cada cuánto pregunta el agente ─────────────────────────
-- Preguntar menos seguido haría que un ticket tarde más en salir, y eso es
-- justamente lo que no se puede empeorar. El agente sigue preguntando igual: lo
-- único que cambia es que la fila de la caja se escribe cuando el dato que
-- guarda de verdad envejeció.
--
-- ── Por qué 30 segundos es seguro ─────────────────────────────────────────────
-- La pantalla de cajas pinta «ahora mismo» mientras el latido tenga **menos de
-- 2 minutos** (`CajasDeImpresion.jsx`). Con 30 s de atraso máximo quedan cuatro
-- veces de margen: ninguna caja viva va a aparecer caída. Y si el agente cambia
-- de versión o de canal, se escribe **en el acto** — ese dato sí se mira para
-- saber si una caja quedó vieja, y esperar medio minuto sería empeorarlo.
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
