SET lock_timeout = '5s';

-- El widget del Inicio con los cortes de hoy de la sala, para confirmarlos sin
-- entrar al modulo. Pedido del usuario (2026-08-14): «debe haber un widget que
-- les aparezca para ver sus cortes, y puedan ahi confirmar».
--
-- Se copia de `dash_meta_sala` porque es el otro widget que la sala mira todos
-- los dias sobre SU propio numero, y ya tiene repartido quien lo ve.
--
-- El widget no decide nada por su cuenta: confirmar y descartar pasan por
-- `resolver_corte_caja`, que exige can_edit sobre `cortes_caja` y vuelve a
-- chequear la sucursal. Ver el widget no habilita resolver.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'dash_cortes_sala', rp.can_view, rp.can_edit, false, rp.scope
FROM public.role_permissions rp
WHERE rp.module_key = 'dash_meta_sala'
ON CONFLICT (role_id, module_key) DO UPDATE
   SET can_view = EXCLUDED.can_view,
       can_edit = EXCLUDED.can_edit,
       scope    = EXCLUDED.scope
   WHERE role_permissions.can_view IS DISTINCT FROM EXCLUDED.can_view
      OR role_permissions.can_edit IS DISTINCT FROM EXCLUDED.can_edit
      OR role_permissions.scope    IS DISTINCT FROM EXCLUDED.scope;
