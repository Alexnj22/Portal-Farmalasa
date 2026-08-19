-- Cada caja cuenta qué versión del agente corre y por dónde le escribe a la
-- ticketera.
--
-- Por qué hace falta: hasta ahora la pantalla decía el latido —si la caja está
-- viva— pero no QUÉ está corriendo. Con el agente actualizándose solo, «¿ya se
-- actualizaron todas?» tiene que contestarse mirando, no yendo a cada sala. Y
-- el canal es el dato que destapó el incidente del 19-ago en Salud 1: una caja
-- que imprime por CUPS le quita la ticketera al sistema de facturación.
--
-- La versión es el hash corto del archivo, no un número escrito a mano: un
-- número hay que acordarse de subirlo.
SET lock_timeout = '5s';

ALTER TABLE public.impresion_dispositivos
    ADD COLUMN IF NOT EXISTS agente_version text,
    ADD COLUMN IF NOT EXISTS agente_canal   text;

COMMENT ON COLUMN public.impresion_dispositivos.agente_version IS
    'Hash corto (12) del agente.py que corre esta caja. Lo informa el agente en cada latido.';
COMMENT ON COLUMN public.impresion_dispositivos.agente_canal IS
    'Por donde le escribe a la ticketera: la ruta del dispositivo, o CUPS. Con CUPS le quita el aparato al sistema de facturacion.';

-- La de CUATRO parametros es la implementacion. La de dos queda como estaba y
-- delega: un agente viejo sigue llamando la suya sin enterarse, que es lo que
-- permite actualizar la base antes que las cajas.
CREATE OR REPLACE FUNCTION public.reclamar_impresion(
    p_device uuid, p_token uuid, p_version text, p_canal text)
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
    UPDATE public.impresion_dispositivos d
       SET ultimo_latido  = now(),
           agente_version = coalesce(p_version, d.agente_version),
           agente_canal   = coalesce(p_canal,   d.agente_canal)
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
    RETURNING c.id, c.titulo, encode(c.contenido, 'base64'), v_impresora;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reclamar_impresion(p_device uuid, p_token uuid)
 RETURNS TABLE(id bigint, titulo text, contenido_b64 text, impresora text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    -- Columnas calificadas a proposito: `RETURNS TABLE(id …)` deja una variable
    -- `id` viva en todo el cuerpo, y un `id` pelado adentro seria ambiguo — se
    -- crea sin quejarse y revienta recien al ejecutarse.
    RETURN QUERY
    SELECT t.id, t.titulo, t.contenido_b64, t.impresora
      FROM public.reclamar_impresion(p_device, p_token, NULL::text, NULL::text) t;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reclamar_impresion(uuid, uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reclamar_impresion(uuid, uuid, text, text)
    TO anon, authenticated, service_role;
