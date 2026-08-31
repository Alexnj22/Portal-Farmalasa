-- Todo activo para Supervisor/a de Ventas, Administrador y Jefe/a de Talento
-- Humano. Pedido del usuario, 2026-08-31.
--
-- QUÉ ESTABA PASANDO
--
-- Los tres son cargos de rango alto y aun así llegaban a los módulos nuevos
-- tarde o nunca: Administrador y Talento Humano veían 157 de los 160 módulos y
-- podían editar 91; Supervisión veía 158 y editaba 93. Ninguno de esos huecos
-- se decidió — son módulos que nacieron después y a los que nadie volvió.
--
-- El caso que lo destapó: `caja_vales` le quedó a Supervisión en
-- `can_view: true, can_edit: false`, o sea que veía la pantalla de Mi caja y no
-- podía operarla. Ese defecto no se anuncia con un error: la pantalla
-- sencillamente no ofrece los botones.
--
-- POR QUÉ SE ESCRIBE FILA POR FILA Y NO SE MARCA EL CARGO
--
-- Existe `roles.es_cuenta_de_pruebas`, que le da a la cuenta de QA todo módulo
-- nuevo automáticamente. **A estos tres NO se les pone esa marca**, y la
-- diferencia es deliberada: QA mide y no opera, así que un permiso de más no
-- puede hacer daño. Estos son personas que operan la empresa, y hay módulos que
-- nacen a propósito restringidos —`caja_vales` fue uno— así que dárselos todos
-- para siempre, sin que nadie vuelva a mirarlo, convertiría cada decisión futura
-- de alcance en un permiso ya concedido.
--
-- O sea: esto los pone al día HOY. Que sigan al día es una decisión de cada
-- módulo nuevo.
--
-- El ámbito queda en 'ALL' porque los tres son cargos globales (rango 3 y 4):
-- acotarlos a una sucursal sería quitarles lo que ya tenían.

SET lock_timeout = '5s';

-- Los que faltan enteros.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, m.module_key, true, true, true, 'ALL'
  FROM public.roles r
 CROSS JOIN (SELECT DISTINCT module_key FROM public.role_permissions) m
 WHERE r.name IN ('Supervisor/a de Ventas', 'Administrador', 'Jefe/a de Talento Humano')
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Los que están a medias.
UPDATE public.role_permissions rp
   SET can_view = true, can_edit = true, can_approve = true, scope = 'ALL',
       updated_at = now()
  FROM public.roles r
 WHERE r.id = rp.role_id
   AND r.name IN ('Supervisor/a de Ventas', 'Administrador', 'Jefe/a de Talento Humano')
   AND (rp.can_view, rp.can_edit, rp.can_approve, rp.scope)
       IS DISTINCT FROM (true, true, true, 'ALL');
