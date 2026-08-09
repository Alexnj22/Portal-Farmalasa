SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Primera tanda del cierre de las 83 policies que no preguntaban nada.
--
-- El hallazgo salió midiendo el alcance del bloqueo (v2.535.0): de las 252
-- policies de `public`, 83 dejaban pasar a CUALQUIER autenticado — ni permiso ni
-- identidad. El bloqueo ya las frena para quien está bloqueado, pero seguían
-- abiertas para todo el personal: un empleado sin permiso de Nómina podía leer
-- la planilla si sabía pedirla.
--
-- ── Cómo se eligió la puerta de cada tabla ──────────────────────────────────
-- No por intuición: se buscó QUIÉN la lee (`grep from('tabla')` en `src/`) y con
-- qué `PermissionGuard` está protegida esa ruta en `App.jsx`. La puerta de la
-- base es la misma que la de la pantalla, así que nadie que hoy use la vista
-- legítimamente pierde nada.
--
-- Ensayado en staging con 7 casos: cierra lo sensible, deja los catálogos
-- abiertos, y quien tiene el permiso sigue viendo.
-- ════════════════════════════════════════════════════════════════════════════

DO $do$
DECLARE
  m record;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('kiosk_devices',         'kiosk_devices_select',     $q$(SELECT public.auth_has_module_permission('branches','can_view'))$q$),
      ('payroll_periods',       'payroll_periods_read',     $q$(SELECT public.auth_has_module_permission('payroll','can_view'))$q$),
      ('overtime_bank',         'overtime_bank_select',     $q$(SELECT public.auth_has_module_permission('payroll','can_view'))$q$),
      ('timesheets',            'timesheets_select',        $q$((SELECT public.auth_has_module_permission('payroll','can_view')) OR (SELECT public.auth_has_module_permission('time_audit','can_view')))$q$),
      ('survey_responses',      'survey_responses_select',  $q$(SELECT public.auth_has_module_permission('encuesta_admin','can_view'))$q$),
      ('branch_expenses',       'branch_expenses_select',   $q$((SELECT public.auth_has_module_permission('branches','can_view')) OR (SELECT public.auth_has_module_permission('metas','can_view')))$q$),
      ('branch_documents',      'branch_documents_select',  $q$(SELECT public.auth_has_module_permission('branches','can_view'))$q$),
      ('practicantes',          'practicantes_select',      $q$(SELECT public.auth_has_module_permission('staff_list','can_view'))$q$),
      ('vacation_plan_headers', 'vph_select',               $q$(SELECT public.auth_has_module_permission('vacation_plan','can_view'))$q$),
      ('customers',             'customers_select',         $q$((SELECT public.auth_has_module_permission('clientes','can_view')) OR (SELECT public.auth_has_module_permission('cotizaciones','can_view')))$q$),
      ('customer_activity',     'customer_activity_select', $q$(SELECT public.auth_has_module_permission('clientes','can_view'))$q$)
    ) AS t(tabla, policy, cond)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=m.tabla AND policyname=m.policy) THEN
      EXECUTE format('DROP POLICY %I ON public.%I', m.policy, m.tabla);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', m.policy, m.tabla, m.cond);
    ELSE
      RAISE NOTICE 'no existe %.%', m.tabla, m.policy;
    END IF;
  END LOOP;
END
$do$;
