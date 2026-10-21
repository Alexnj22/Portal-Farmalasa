SET lock_timeout = '5s';

-- Complemento de 20261021194340. Las ocho de TRIGGER no las llama nadie
-- directamente: el trigger dispara igual sin EXECUTE (probado en el entorno de
-- pruebas el 2026-10-21), así que tampoco las necesita `authenticated`.
REVOKE EXECUTE ON FUNCTION public.abonos_portal_resella_cortes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cortes_caja_avisar_cierre_del_dia() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cortes_caja_sella_cobros_portal() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.derivar_kiosk_pin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.promocion_trg_envio_recibido() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.promocion_trg_solicitud_recibida() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tocar_ultimo_abono() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_abonos_updated_at() FROM PUBLIC, anon, authenticated;

-- Estas dos SÍ se llaman con sesión: nombre_normalizado desde nombre_ordenado
-- (INVOKER, la usa el portal), puntos_fuente desde funciones DEFINER.
GRANT EXECUTE ON FUNCTION public.nombre_normalizado(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.puntos_fuente() TO authenticated, service_role;
