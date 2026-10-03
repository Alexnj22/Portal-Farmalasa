SET lock_timeout = '5s';

-- Plan de alcance F4 (2026-10-02). Cinco funciones SECURITY DEFINER que reciben
-- una sucursal y que `authenticated` podía ejecutar sin que el portal las llame
-- nunca (grep en src/, apps/ y supabase/functions/). Las llaman sólo funciones
-- DEFINER (corren como su dueño), crons (postgres) o una edge function con la
-- llave del servidor — ninguna necesita el permiso de `authenticated`, que
-- sólo servía para que cualquiera con sesión las llamara a mano:
--   destinatarios_de_modulo          ← destinatarios_de_cortes, bolsa_al_descartar_corte, confirmar_conteo
--   resumen_ventas_diario            ← check-sales-reconciliation (service_role)
--   save_pedido_snapshot             ← nadie
--   sincronizar_bitacora_dispensaciones ← crons bitacora-dispensaciones-* (escribe dispensaciones de cualquier sala)
--   verificar_hojas_pedido           ← planificar_traslado_pedido
-- Se revoca también a PUBLIC: si no, `authenticated` lo hereda de ahí.
REVOKE EXECUTE ON FUNCTION public.destinatarios_de_modulo(p_branch_id integer, p_module_key text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resumen_ventas_diario(p_desde date, p_hasta date, p_branch_id bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.save_pedido_snapshot(p_sucursal_ids integer[], p_nombre text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sincronizar_bitacora_dispensaciones(p_desde date, p_hasta date, p_branch_id bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verificar_hojas_pedido(p_pedido_id uuid, p_sucursal_id integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.destinatarios_de_modulo(p_branch_id integer, p_module_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resumen_ventas_diario(p_desde date, p_hasta date, p_branch_id bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_pedido_snapshot(p_sucursal_ids integer[], p_nombre text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sincronizar_bitacora_dispensaciones(p_desde date, p_hasta date, p_branch_id bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.verificar_hojas_pedido(p_pedido_id uuid, p_sucursal_id integer) TO service_role;
