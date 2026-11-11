-- Las tres funciones que pasaron a notificar (20261111184220) son de cron:
-- sólo service_role las llama. En vivo ya era así; esto lo deja escrito.
SET lock_timeout = '5s';
REVOKE EXECUTE ON FUNCTION public.avisar_dui_por_vencer(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_missing_roster() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.avisar_pago_seguro_vida() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_dui_por_vencer(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_missing_roster() TO service_role;
GRANT EXECUTE ON FUNCTION public.avisar_pago_seguro_vida() TO service_role;
