SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Siete funciones que el navegador nunca llama, y que cualquier sesión podía
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Supabase concede EXECUTE por DEFECTO a `anon, authenticated, service_role`
-- sobre toda función nueva. El patrón que usa este repo desde siempre —
--
--     REVOKE EXECUTE ON FUNCTION f(...) FROM PUBLIC, anon;
--     GRANT  EXECUTE ON FUNCTION f(...) TO service_role;
--
-- — parece cerrar la función y NO la cierra: `authenticated` queda adentro por
-- la puerta de atrás, porque nunca se le quitó.
--
-- ── Cómo se encontró ───────────────────────────────────────────────────────
-- No leyendo: MIDIENDO la diferencia entre dos bases. Al reconstruir el módulo
-- fiscal en el entorno de pruebas, `calc_credito_declarable` quedó ejecutable
-- por `authenticated` cuando en producción la ejecuta sólo `service_role`. Esa
-- diferencia era la prueba de que el REVOKE no hacía lo que dice.
--
-- El barrido después cruzó lo DECLARADO en las 545 migraciones contra el ACL
-- REAL de producción: **131 funciones tienen EXECUTE para `authenticated` sin
-- que ninguna migración se lo conceda**. De ésas, 14 son SECURITY DEFINER sin
-- ninguna guarda de permiso adentro.
--
-- ── Por qué estas siete y no las 131 ───────────────────────────────────────
-- Las otras se defienden solas y hay que decir por qué, o el número asusta sin
-- informar:
--
--   · los ayudantes `auth_*` (auth_employee_id, auth_has_module_permission…)
--     TIENEN que ser ejecutables por `authenticated`: los llaman las policies,
--     que corren como el usuario que consulta. Sin eso, RLS entero deja de
--     funcionar. Y sólo devuelven datos del propio llamador;
--   · las de disparador (`RETURNS trigger`) no se pueden llamar a mano: sin
--     `NEW` lanzan;
--   · las del kiosco (`verify_kiosk_*`, `get_kiosk_boot_payload`) están
--     abiertas a propósito y declaradas en `auditoria/superficie-anon.json`;
--   · y las que el navegador SÍ llama —`inventory_grouped`,
--     `inventory_proximos_count`, `next_cotizacion_numero`— tienen que
--     conservarlo. (`next_cotizacion_numero` además no consume ninguna
--     secuencia: calcula el siguiente leyendo la tabla, así que llamarla no
--     tiene efecto.)
--
-- Quedan estas siete: SECURITY DEFINER, sin guarda adentro, y **verificado que
-- el navegador no las llama ni una vez**. Sus llamadores son crons, edge
-- functions con `service_role`, u otras funciones DEFINER — y a esas últimas el
-- permiso del llamador no les hace falta, porque corren con el del dueño.
--
-- La más grave es `notify_employees`: acepta título, cuerpo, enlace y `push`
-- ARBITRARIOS contra cualquier lista de empleados, con el único freno de no
-- podérselo mandar a uno mismo. O sea que cualquier sesión autenticada podía
-- mandarle un aviso —y una notificación al teléfono— a toda la empresa, con el
-- portal como remitente.
-- ═══════════════════════════════════════════════════════════════════════════

-- Avisos: cualquiera podía escribirle a toda la empresa haciéndose pasar por el portal.
REVOKE EXECUTE ON FUNCTION public.notify_employees(uuid[], text, text, text, text, jsonb, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_branch(integer, text, text, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- Libro regulado: escribe folios de dispensación y anula renglones.
REVOKE EXECUTE ON FUNCTION public.sincronizar_bitacora_dispensaciones(date, date, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bitacora_tomar_folio(bigint, smallint, text) FROM PUBLIC, anon, authenticated;

-- Barrido de Hacienda: dispara el aviso del cron.
REVOKE EXECUTE ON FUNCTION public.alertar_barrido_dte() FROM PUBLIC, anon, authenticated;

-- Cierra el pedido de dato a la sala. La llama su edge function con service_role.
REVOKE EXECUTE ON FUNCTION public.cerrar_dato_pedido(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- Lista de jefaturas de logística: la arma una edge function.
REVOKE EXECUTE ON FUNCTION public.get_logistics_chief_ids() FROM PUBLIC, anon, authenticated;
