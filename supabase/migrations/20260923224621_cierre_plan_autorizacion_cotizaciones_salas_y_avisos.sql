-- Cierre del plan «cerrar la autorización de la base»
-- (docs/planes-cerrados/PLAN-CERRAR-AUTORIZACION-2026-08-09.md): los tres
-- puntos que quedaban fuera de los catálogos declarados.
--
--   · D1 — `cotizacion_items_write` era `FOR ALL` con sólo el EXISTS de la
--     cotización: quien podía VER una cotización podía reescribir sus renglones.
--     Ahora escribir exige `cotizaciones.can_edit`, igual que la tabla madre.
--     Hoy los cinco cargos que ven cotizaciones también las editan: nadie pierde
--     nada, pero el día que se dé «sólo ver» ya no alcanza para escribir.
--   · `employee_branches` se leía con `true`. Ahora sigue a `employees`: se ve
--     la sala asignada de las personas que uno puede ver. Es como la usa el
--     portal —pegada a la lista de empleados (systemSlice)— y ninguna función
--     INVOKER ni policy ajena la lee.
--   · `push_subscriptions` tenía sus cuatro policies en `public`: pasan a
--     `authenticated`. No era explotable (`anon` no tiene `auth.email()`).
--
-- `session_activity_select_auth_admin` (`true`) NO se toca: es del rol
-- `supabase_auth_admin`, el del hook de inicio de sesión; `authenticated` sólo
-- ve la propia.
--
-- Medido por cargo (12) en una transacción deshecha: renglones de cotización,
-- sala de los empleados y suscripciones, idénticos antes y después.

SET lock_timeout = '5s';

DROP POLICY eb_select ON public.employee_branches;
CREATE POLICY eb_select ON public.employee_branches FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_branches.employee_id));

DROP POLICY cotizacion_items_write ON public.cotizacion_items;
CREATE POLICY cotizacion_items_insert ON public.cotizacion_items FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.auth_has_module_permission('cotizaciones', 'can_edit'))
              AND EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_items.cotizacion_id));
CREATE POLICY cotizacion_items_update ON public.cotizacion_items FOR UPDATE TO authenticated
  USING ((SELECT public.auth_has_module_permission('cotizaciones', 'can_edit'))
         AND EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_items.cotizacion_id))
  WITH CHECK ((SELECT public.auth_has_module_permission('cotizaciones', 'can_edit'))
              AND EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_items.cotizacion_id));
CREATE POLICY cotizacion_items_delete ON public.cotizacion_items FOR DELETE TO authenticated
  USING ((SELECT public.auth_has_module_permission('cotizaciones', 'can_edit'))
         AND EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_items.cotizacion_id));

ALTER POLICY push_subscriptions_select ON public.push_subscriptions TO authenticated;
ALTER POLICY push_subscriptions_write  ON public.push_subscriptions TO authenticated;
ALTER POLICY push_subscriptions_update ON public.push_subscriptions TO authenticated;
ALTER POLICY push_subscriptions_delete ON public.push_subscriptions TO authenticated;
