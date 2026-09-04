SET lock_timeout = '5s';

-- Borrar una notificación pasa a ser OCULTARLA.
--
-- Hasta hoy el botón de la campana hacía un DELETE real: la fila se iba de la
-- base y no quedaba rastro en ningún lado (sin `deleted_at`, sin trigger, sin
-- fila en `audit_logs`). Preguntado por el usuario el 2026-09-04: «una vez
-- eliminada, ¿no hay forma de verla?».
--
-- La retención NO cambia: `purge-notifications-daily` sigue limpiando a los 90
-- días, y ese cron corre como dueño del job, o sea que salta el RLS y borra de
-- verdad. Lo que cambia es que el destinatario ya no puede destruir la fila,
-- sólo sacarla de su campana.
ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.notifications.deleted_at IS
    'Cuándo su destinatario la sacó de la campana. NULL = visible. La fila NO se borra: la limpia purge-notifications-daily a los 90 días de created_at, igual que a las demás.';

-- Índice parcial sobre la condición RARA, que es la papelera.
--
-- El camino de todos los días —la campana— pregunta por `deleted_at IS NULL`,
-- que va a ser la mayoría, y para eso ya sirve `idx_notifications_recipient`
-- (recipient_id, created_at DESC). La papelera es al revés: pocas filas entre
-- muchas, que es justo donde un índice parcial paga y donde el planificador se
-- equivoca solo si no lo tiene (ver el incidente del 2026-09-01 con
-- `acumula_puntos`, un booleano con UNA fila distinta estimado en la mitad de
-- la tabla).
CREATE INDEX IF NOT EXISTS idx_notifications_papelera
    ON public.notifications (recipient_id, deleted_at DESC)
    WHERE deleted_at IS NOT NULL;

-- Se le quita al cliente el DELETE.
--
-- Sin esto la promesa sería sólo una convención del navegador: la policy
-- seguiría dejando destruir la fila desde la API, y «se puede recuperar»
-- dependería de que nadie llame al endpoint viejo. La garantía tiene que ser
-- estructural o no es una garantía.
--
-- El purgado no la necesita: corre como dueño del job y el RLS no lo mira.
DROP POLICY IF EXISTS notifications_delete ON public.notifications;
