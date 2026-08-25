SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Revocarle a `anon` no alcanza: `authenticated` lo recibe por defecto
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Lo levantó `gate:migrations` sobre la migración de hace un rato
-- (20260825032825), y tenía razón: **`REVOKE … FROM anon, PUBLIC` deja intacto
-- el EXECUTE de `authenticated`**, porque los default privileges de Supabase se
-- lo conceden aparte. Cerrar la puerta de la calle y dejar abierta la del
-- pasillo.
--
-- La pregunta que hay que contestar por función es una sola: **¿la llama el
-- navegador?** Se contestó mirando el fuente, no de memoria:
--
--   · `es_ultimo_dia_del_mes_sv`, `nit_sv_valido`, `sello_mh_valido` — **cero**
--     apariciones en `src/`. Sólo las invocan `aplicar_barrido_proveedores` y
--     `completar_nit_proveedores`, que son SECURITY DEFINER y corren con los
--     permisos de su dueño. No necesitan `authenticated`.
--   · `update_proveedor_manual` — **sí**: la llama `FormProveedorDetail`. Se le
--     concede explícitamente en vez de dejarla con el permiso heredado, que es
--     lo que pide el gate: que el estado final de cada función esté declarado y
--     no sea un resto de la configuración de Supabase.
--
-- Los seis triggers no aparecen acá porque a una función de trigger el EXECUTE
-- no le cambia nada: Postgres no deja invocarla directamente.

REVOKE EXECUTE ON FUNCTION public.es_ultimo_dia_del_mes_sv() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.nit_sv_valido(text)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sello_mh_valido(text)      FROM PUBLIC, anon, authenticated;

-- La que SÍ es para el navegador: explícita, no heredada.
GRANT EXECUTE ON FUNCTION public.update_proveedor_manual(
  bigint, text, text, text, text, boolean, text, boolean, boolean) TO authenticated;
