-- Conteo de Inventario — sub-permiso `conteo_ver_sistema`
--
-- Hasta ahora "conteo ciego" era un <Switch> en la vista con default encendido:
-- cualquiera con can_edit lo apagaba y veía la existencia del sistema antes de
-- contar. Eso no es un conteo ciego, es una sugerencia — el mismo defecto que
-- una credencial calculada en el navegador. El ciego pasa a imponerse en las
-- RPC de lectura (v3) y quién puede ver el número del sistema DURANTE el conteo
-- se vuelve un permiso asignable.
--
-- Alcance del permiso: solo mientras el conteo está abierto (BORRADOR/EN_PROGRESO).
-- Una vez FINALIZADO ya no hay nada que sesgar y los números SON el resultado,
-- así que los ve cualquiera que pueda ver el módulo. Esa regla vive en la RPC.
--
-- Se otorga a los roles que hoy pueden APROBAR el conteo: son los que revisan y
-- firman, y los que ya podían recontar. El resto (quien cuenta en el anaquel)
-- queda ciego por defecto, que es el punto.

SET lock_timeout = '5s';

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'conteo_ver_sistema', true, false, false, 'ALL'
FROM public.role_permissions rp
WHERE rp.module_key = 'conteo_inventario'
  AND rp.can_approve = true
ON CONFLICT (role_id, module_key) DO NOTHING;
