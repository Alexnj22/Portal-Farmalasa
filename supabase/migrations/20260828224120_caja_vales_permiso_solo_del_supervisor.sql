-- Quién puede hacer que el portal le escriba un vale a la caja.
--
-- Pedido del usuario (2026-08-28): «que todo esté hecho y creado, pero no le
-- des acceso a los demás, sólo a mí (supervisor), para hacer una prueba cuando
-- lo considere necesario».
--
-- Módulo PROPIO y no una capacidad de `bolsas`: escribir en el sistema de la
-- caja corre lo que el corte espera, y eso no puede viajar de arrastre con el
-- permiso de guardar una bolsa. Hoy lo tiene un solo cargo —«Supervisor/a de
-- Ventas», que es una sola persona— y se amplía agregando filas acá, no
-- tocando código.
--
-- `can_view` y `can_edit` separados a propósito: ver qué falta anotar es
-- inofensivo y sirve para el día que esto se abra a supervisión; escribirlo es
-- el acto. Hoy los dos van al mismo cargo.

SET lock_timeout = '5s';

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
VALUES (13, 'caja_vales', true, true, false, 'ALL')
ON CONFLICT (role_id, module_key) DO UPDATE
   SET can_view = true, can_edit = true, scope = 'ALL', updated_at = now();
