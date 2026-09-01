-- Quien atiende en la sala puede ver y editar la ficha del cliente.
--
-- Decisión del usuario (2026-09-01), al descubrir que el código de acceso a
-- «Mis puntos» sólo lo podían emitir CINCO personas —Administrador, Gerente
-- General, Talento Humano, Supervisor de Ventas y QA— mientras que el papel se
-- entrega en el mostrador:
--
--   «abrelo, igual ellos deben poder agregar clientes y demas.»
--
-- Los tres cargos son los que atienden: Dependiente de Farmacia, Regente de
-- Enfermería y Jefe/a de Sala. Ya veían `ventas` y `pedidos`; `clientes` era el
-- hueco, y era el que dejaba a quien está frente al cliente sin poder darle de
-- alta ni entregarle su código.
--
-- ⚠️ Esto abre la ficha fiscal COMPLETA: identidad (DUI/NIT/NRC), categoría,
-- contacto y ubicación de las 28,110 fichas, y con `can_edit` también
-- corregirlas. Se evaluó la alternativa acotada —una sub-capacidad sólo para el
-- código, como ya existe `clientes_ver_montos`— y el usuario eligió el módulo
-- entero porque el alta de clientes también les corresponde.
--
-- Lo que NO se toca es `clientes_ver_montos`: cuánto factura cada cliente sigue
-- siendo de quien ya lo tenía. La ficha se completa igual sin ese dato, que es
-- el motivo por el que esa sub-capacidad existe.
SET lock_timeout = '5s';

UPDATE public.role_permissions rp
   SET can_view = true, can_edit = true
  FROM public.roles r
 WHERE r.id = rp.role_id
   AND rp.module_key = 'clientes'
   AND r.name IN ('Dependiente de Farmacia', 'Regente de Enfermeria', 'Jefe/a de Sala');

-- Si alguno de los tres no tuviera fila para el módulo, se crea: un cargo sin
-- fila no es «lo tiene apagado», es «nadie decidió», y las dos cosas se ven
-- igual desde la pantalla de permisos.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit)
SELECT r.id, 'clientes', true, true
  FROM public.roles r
 WHERE r.name IN ('Dependiente de Farmacia', 'Regente de Enfermeria', 'Jefe/a de Sala')
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions p
                    WHERE p.role_id = r.id AND p.module_key = 'clientes');
