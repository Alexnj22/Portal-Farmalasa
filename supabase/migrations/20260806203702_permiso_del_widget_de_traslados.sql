-- El permiso del widget, que es distinto del permiso de la acción.
--
-- `traslados` habilita CONFIRMAR el envío de producto de la propia sala;
-- `dash_traslados` habilita VER la baldosa en el tablero. Son dos cosas y por
-- eso son dos claves: la sala que pide un traslado necesita la baldosa para
-- recibir lo que llega, aunque no pueda confirmar los pedidos de nadie.
--
-- Sin esta fila el widget existe en el registro y no aparece para nadie salvo
-- SUPERADMIN, que pasa por encima de todo permiso.

SET lock_timeout = '5s';

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'dash_traslados', true, true, false, r.scope
FROM (VALUES
        (19, 'BRANCH'),   -- Jefe/a de Sala
        (20, 'BRANCH'),   -- Subjefe/a de Sala
        (23, 'BRANCH'),   -- Regente de Enfermeria
        (30, 'BRANCH'),   -- Dependiente de Farmacia
        (15, 'BRANCH'),   -- Auxiliar de Bodega
        (12, 'BRANCH'),   -- Jefe/a de Compras y Logistica
        (13, 'ALL'),      -- Supervisor/a de Ventas
        (2,  'ALL'),      -- Gerente General
        (3,  'ALL'),      -- Administrador
        (33, 'ALL')       -- QA / Testing (CI)
     ) AS r(id, scope)
WHERE EXISTS (SELECT 1 FROM public.roles ro WHERE ro.id = r.id)
ON CONFLICT DO NOTHING;
