SET lock_timeout = '5s';

-- `bolsas_ver_cards`: el carril de resumen del circuito del efectivo.
--
-- Pedido del usuario (2026-08-20): «necesita cards la vista (con permiso, solo
-- para admin ahora, agregalo a permisos)». «Admin» acá es el ÁREA
-- administrativa —cuatro cargos, no el rol llamado Administrador—, y la lista
-- no se escribe a mano: se DERIVA de quién tiene hoy `bolsas_ver_montos`, que
-- es exactamente ese conjunto y ya fue decidido por él. Copiar los ids sería
-- fijar una lista que el día que cambie deja de coincidir sin avisar.
--
-- Es una llave aparte de `bolsas_ver_montos` a propósito: sin montos el carril
-- cuenta BOLSAS —cuántas hay en la sala, en camino, por contar—, que es lo que
-- la sala necesita para moverlas y no dice cuánta plata hay. Con una sola llave,
-- darle el resumen a alguien le daría también las cifras.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'bolsas_ver_cards', true, false, false, 'ALL'
FROM public.role_permissions rp
WHERE rp.module_key = 'bolsas_ver_montos' AND rp.can_view
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions x
    WHERE x.role_id = rp.role_id AND x.module_key = 'bolsas_ver_cards'
  );
