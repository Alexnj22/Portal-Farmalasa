-- La notificación de "solicitud pendiente" es una FILA APARTE de la solicitud.
-- Resolverla —aprobar o rechazar— no la tocaba, así que el aviso seguía
-- ofreciendo Aprobar / Rechazar sobre algo ya decidido. Tocar el botón llevaba
-- a un diálogo que el servidor iba a rechazar con 409.
--
-- Se arregla del lado del servidor y no en la campana porque la campana es
-- global: `requests` puede no estar cargado, así que no siempre puede
-- comprobar el estado real. Acá la notificación se entera en el mismo momento
-- en que la solicitud cambia.
--
-- No se borra el aviso: queda como registro, pero deja de ser accionable y
-- pasa a leído. `metadata.resuelta` guarda el estado final para que la campana
-- pueda decirlo en vez de solo esconder los botones.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.marcar_notificacion_solicitud_resuelta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN
        RETURN NEW;
    END IF;

    UPDATE public.notifications
       SET metadata = coalesce(metadata, '{}'::jsonb)
                      || jsonb_build_object('resuelta', NEW.status),
           read_at  = coalesce(read_at, now())
     WHERE type = 'REQUEST_PENDING'
       AND metadata->>'request_id' = NEW.id::text;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.marcar_notificacion_solicitud_resuelta() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marcar_notificacion_solicitud_resuelta() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_marcar_notificacion_solicitud_resuelta ON public.approval_requests;
CREATE TRIGGER trg_marcar_notificacion_solicitud_resuelta
    AFTER UPDATE OF status ON public.approval_requests
    FOR EACH ROW EXECUTE FUNCTION public.marcar_notificacion_solicitud_resuelta();

-- Las que ya se decidieron antes de que existiera el trigger.
UPDATE public.notifications n
   SET metadata = coalesce(n.metadata, '{}'::jsonb)
                  || jsonb_build_object('resuelta', ar.status),
       read_at  = coalesce(n.read_at, now())
  FROM public.approval_requests ar
 WHERE n.type = 'REQUEST_PENDING'
   AND n.metadata->>'request_id' = ar.id::text
   AND ar.status <> 'PENDING'
   AND NOT (n.metadata ? 'resuelta');
