-- `consolidate-timesheets` escribe `status = 'AUTO_PUNCHED'` cuando alguien
-- entró y no registró la salida: inserta la salida faltante en `attendance` y
-- marca el día para que Talento Humano lo revise.
--
-- Pero el CHECK de la tabla sólo acepta PENDING / APPROVED / DISPUTED, así que
-- ese UPDATE/INSERT **falla siempre**. Comprobado en el branch de pruebas:
--
--   ERROR 23514: new row for relation "timesheets" violates check constraint
--                "timesheets_status_check"
--
-- La consecuencia es silenciosa y cara: la salida automática SÍ queda en
-- `attendance` (esa inserción es otra sentencia y pasa), pero el timesheet del
-- día no se crea. Como la planilla se arma leyendo `timesheets`, las horas de
-- quien olvidó marcar la salida —que es el error más común de un kiosco— no
-- llegan a planilla. La función ni siquiera se rompe: cuenta el fallo en
-- `failed` y devuelve `ok: true`.
--
-- Se agrega el estado en vez de cambiar el código porque la distinción importa
-- para la revisión: «esta salida la generó el sistema» no es lo mismo que
-- «pendiente de aprobar», y la pantalla de auditoría ya lo trata como no
-- aprobado (`t.status === 'APPROVED'` es el único camino a verde).
--
-- Aplicado y verificado primero en el branch `staging`: AUTO_PUNCHED entra, un
-- estado inventado se sigue rechazando.
SET lock_timeout = '5s';

ALTER TABLE public.timesheets DROP CONSTRAINT IF EXISTS timesheets_status_check;

ALTER TABLE public.timesheets ADD CONSTRAINT timesheets_status_check
    CHECK (status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'DISPUTED'::text, 'AUTO_PUNCHED'::text]));
