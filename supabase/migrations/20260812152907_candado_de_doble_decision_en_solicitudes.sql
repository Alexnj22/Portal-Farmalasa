SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Dos pestañas abiertas sobre la misma solicitud.
--
-- La campana se sincroniza sola (notifications viaja por realtime), pero la
-- pantalla de Solicitudes no: `approval_requests` no está publicada, así que una
-- pestaña parada ahí sigue mostrando PENDIENTE con el botón vivo. Apretarlo otra
-- vez volvía a disparar TODO lo que cuelga de aprobar — el evento en el legajo,
-- el aviso al empleado, el aviso al siguiente nivel— porque el UPDATE era por id
-- a secas.
--
-- Acá van las dos piezas que tienen que vivir en la base. La tercera —el
-- `.eq('status','PENDING')` del lado del portal— va en el código.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. El aviso también se apaga cuando la solicitud CAMBIA DE MANO ──────────
-- El trigger sólo miraba `status`. Una solicitud que avanza de nivel sigue
-- PENDING, así que el aviso de quien acababa de aprobar nunca se marcaba
-- resuelto: le seguía ofreciendo «Aprobar / Rechazar» en todas sus pestañas, y
-- volver a apretarlo la empujaba un nivel más.
--
-- El aviso del siguiente aprobador se inserta DESPUÉS de este UPDATE (el portal
-- primero escribe el nivel y recién entonces notifica), así que este barrido no
-- lo alcanza.
CREATE OR REPLACE FUNCTION public.marcar_notificacion_solicitud_resuelta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Resuelta de verdad: dejó de estar pendiente.
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'PENDING' THEN
        UPDATE public.notifications
           SET metadata = coalesce(metadata, '{}'::jsonb)
                          || jsonb_build_object('resuelta', NEW.status),
               read_at  = coalesce(read_at, now())
         WHERE type = 'REQUEST_PENDING'
           AND metadata->>'request_id' = NEW.id::text;
        RETURN NEW;
    END IF;

    -- Sigue pendiente, pero ya no la decide quien la tenía.
    -- 'ADVANCED' es transitorio a propósito: cuando la solicitud se cierra de
    -- verdad, la rama de arriba lo pisa con el estado final, así que el aviso de
    -- nivel 1 termina diciendo en qué terminó todo y no sólo qué hizo su dueño.
    IF NEW.current_level IS DISTINCT FROM OLD.current_level
       AND NEW.status = 'PENDING' THEN
        UPDATE public.notifications
           SET metadata = coalesce(metadata, '{}'::jsonb)
                          || jsonb_build_object('resuelta', 'ADVANCED'),
               read_at  = coalesce(read_at, now())
         WHERE type = 'REQUEST_PENDING'
           AND metadata->>'request_id' = NEW.id::text;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marcar_notificacion_solicitud_resuelta ON public.approval_requests;
CREATE TRIGGER trg_marcar_notificacion_solicitud_resuelta
AFTER UPDATE OF status, current_level ON public.approval_requests
FOR EACH ROW EXECUTE FUNCTION public.marcar_notificacion_solicitud_resuelta();


-- ── 2. Un arriendo para aplicar en el sistema de origen ──────────────────────
-- `aplicar-solicitud-facturacion` y `aplicar-movimiento-inventario` ya releen el
-- estado antes de escribir afuera, pero entre esa lectura y la escritura pasan
-- segundos. Dos clics simultáneos —dos pestañas, o dos personas— pasaban los dos
-- la verificación y los dos escribían: el `.eq(status,'PENDING')` del final frena
-- la segunda escritura del ESTADO, no la segunda anulación.
--
-- El arriendo es un compare-and-set en una sola sentencia, que es lo único
-- atómico acá. Vence solo a los `p_lease_seconds` porque una Edge Function que
-- muere a los 150s no alcanza a liberar nada, y una solicitud trabada para
-- siempre sería peor que el problema que esto resuelve.
CREATE OR REPLACE FUNCTION public.reclamar_solicitud(
    p_request_id    uuid,
    p_lease_seconds integer DEFAULT 180
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_filas integer;
BEGIN
    UPDATE public.approval_requests
       SET metadata = coalesce(metadata, '{}'::jsonb)
                      || jsonb_build_object('aplicando_desde', to_jsonb(now()))
     WHERE id = p_request_id
       AND status = 'PENDING'
       AND (metadata->>'aplicando_desde' IS NULL
            OR (metadata->>'aplicando_desde')::timestamptz
               < now() - make_interval(secs => p_lease_seconds));

    GET DIAGNOSTICS v_filas = ROW_COUNT;
    RETURN v_filas > 0;
END;
$$;

-- Se suelta cuando la aplicación no entró, para que el reintento no tenga que
-- esperar a que venza el arriendo. Si entró, la solicitud ya no está PENDING y
-- la marca deja de significar nada.
CREATE OR REPLACE FUNCTION public.liberar_solicitud(p_request_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    UPDATE public.approval_requests
       SET metadata = metadata - 'aplicando_desde'
     WHERE id = p_request_id
       AND status = 'PENDING';
$$;

-- Sólo las Edge Functions las llaman: el navegador no decide quién está
-- aplicando qué.
REVOKE EXECUTE ON FUNCTION public.reclamar_solicitud(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.liberar_solicitud(uuid)           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reclamar_solicitud(uuid, integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.liberar_solicitud(uuid)           TO service_role;
