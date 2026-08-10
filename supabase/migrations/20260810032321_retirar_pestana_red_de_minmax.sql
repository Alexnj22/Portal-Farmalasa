SET lock_timeout = '5s';

-- ══════════════════════════════════════════════════════════════════════════
-- La pestaña «Red» de Min/Max se retira entera
-- ══════════════════════════════════════════════════════════════════════════
-- Pedido del usuario el 2026-08-09: «no se me es de utilidad».
--
-- Se va COMPLETA y no escondida detrás de un permiso apagado: la vista
-- (`TabMinMaxNetwork.jsx`), su entrada en el registro de permisos, las filas de
-- `role_permissions` y el RPC que sólo ella consumía. Una vista que nadie abre
-- pero que sigue declarada es deuda que parece función — y aparece en «Objetos
-- Huérfanos» a confundir a quien la audite.
--
-- Verificado antes de borrar: `get_network_summary_json` no lo llama ninguna
-- otra función del catálogo, y `minmax_tab_red` no lo consulta ningún otro
-- punto del frontend.

DELETE FROM public.role_permissions WHERE module_key = 'minmax_tab_red';

DROP FUNCTION IF EXISTS public.get_network_summary_json();
