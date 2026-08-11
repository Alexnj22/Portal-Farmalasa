SET lock_timeout = '5s';

-- Dos huecos que salieron al AUDITAR la migración anterior (2026-08-10).
--
-- 1 · `Auxiliar de Bodega` (rol 15, 5 personas activas) se quedó afuera del
--     centro de solicitudes. La migración anterior abría el operativo con un
--     `UPDATE ... WHERE role_id IN (...)`, y un UPDATE **no crea filas**: ese
--     rol no tenía fila de `requests`, así que el nombre estaba en la lista y
--     no pasó nada. Sin ruido, sin error — el rol simplemente no aparecía.
--
--     Es el mismo modo de fallo que ya está anotado para los índices con cero
--     scans: la operación «funcionó» y no tocó nada. Lo delató comparar el
--     resultado contra la intención rol por rol, no el `success` de la
--     migración.
--
-- 2 · `requests_personales` quedó encendido sólo para quien ya aprobaba
--     `requests` — o sea Supervisión de Ventas y la cuenta de CI. Pero las
--     personales (vacaciones, permiso, incapacidad, anticipo, constancia) son
--     de Talento Humano, y `Jefe/a de Talento Humano` tenía `requests` apagado,
--     así que la copia no le dio nada. El módulo quedaría listo pero sin dueño.
--
--     No se enciende para nadie más: las personales no están en uso hoy
--     («ahorita vacaciones y ese tipo de solicitudes no las necesito»). Esto
--     deja el circuito preparado, no abierto.

-- 1 · La fila que faltaba. Ver, nunca decidir.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'requests', true, false, false, 'BRANCH'
FROM public.roles r
WHERE r.name = 'Auxiliar de Bodega'
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id = r.id AND rp.module_key = 'requests');

-- 2 · Talento Humano es quien resuelve lo personal.
UPDATE public.role_permissions
SET can_view = true, can_approve = true, scope = 'ALL'
WHERE module_key = 'requests_personales'
  AND role_id IN (SELECT id FROM public.roles WHERE name = 'Jefe/a de Talento Humano');
