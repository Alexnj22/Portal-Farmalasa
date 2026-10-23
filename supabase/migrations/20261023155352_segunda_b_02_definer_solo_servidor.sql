SET lock_timeout = '5s';

-- Funciones SECURITY DEFINER sin guarda que el navegador no usa (HA4, HB4).
-- Se saltan el RLS y no preguntan quién llama, pero `authenticated` las podía
-- ejecutar: creditos_pasados_del_plazo (cartera vencida de las 7 salas),
-- get_documentos_por_barrer (DTE de compra), y los montos de bolsas y cortes
-- (bolsa_sugerida, bolsa_reintegro_maximo, bolsa_saldo_para_el_corte,
-- corte_tramo, corte_trabado_por_posterior). Medido en producción el
-- 2026-10-23: sólo las llaman edge functions con la llave del servidor o
-- funciones DEFINER (corren como su dueño); ningún llamador INVOKER, policy,
-- vista ni `.rpc(` en src/ o apps/. `bolsa_saldo` NO entra: la llama
-- get_bolsas_con_diferencia (INVOKER).

REVOKE EXECUTE ON FUNCTION public.creditos_pasados_del_plazo(integer)                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_documentos_por_barrer(integer, integer)                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bolsa_sugerida(bigint)                                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bolsa_reintegro_maximo(bigint)                              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bolsa_saldo_para_el_corte(bigint, timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.corte_tramo(bigint)                                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.corte_trabado_por_posterior(bigint)                         FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.creditos_pasados_del_plazo(integer)                         TO service_role;
GRANT EXECUTE ON FUNCTION public.get_documentos_por_barrer(integer, integer)                 TO service_role;
GRANT EXECUTE ON FUNCTION public.bolsa_sugerida(bigint)                                      TO service_role;
GRANT EXECUTE ON FUNCTION public.bolsa_reintegro_maximo(bigint)                              TO service_role;
GRANT EXECUTE ON FUNCTION public.bolsa_saldo_para_el_corte(bigint, timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.corte_tramo(bigint)                                         TO service_role;
GRANT EXECUTE ON FUNCTION public.corte_trabado_por_posterior(bigint)                         TO service_role;
