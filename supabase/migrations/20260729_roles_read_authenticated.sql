-- 20260729_roles_read_authenticated
--
-- AUDITORIA-SUPABASE-2026-07-29.md, S4: la policy `read_all` de `roles` estaba
-- como `TO {anon, authenticated} USING (true)`, así que el catálogo completo de
-- roles —23 filas, incluido `is_su`— era legible por cualquiera en internet con
-- la anon key, que viaja en el bundle JS.
--
-- No es tan grave como la fuga de `employees`, pero expone la estructura
-- organizacional y, sobre todo, qué roles son superusuario: es justo el mapa que
-- alguien querría antes de intentar algo contra el portal.
--
-- Verificado antes de aplicar que ningún flujo pre-login lee `roles`:
--   · `refreshPermissions` (AuthContext.jsx:108) hace `if (!u) return` antes de
--     cualquier consulta, así que solo corre con usuario ya autenticado.
--   · Las 11 lecturas directas de `roles` en src/ viven en vistas del portal.
--   · El kiosco pre-login NO la consulta: recibe los nombres de rol resueltos
--     dentro de `get_kiosk_boot_payload`, que es SECURITY DEFINER y no pasa por
--     RLS.

SET lock_timeout = '5s';

ALTER POLICY read_all ON public.roles TO authenticated;
