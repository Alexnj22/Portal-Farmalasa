-- La policy de lectura de documentos_por_asignar pedía el módulo 'personal',
-- que no existe en role_permissions: nadie podía leer la tabla. Es la misma
-- confusión que 20261014143719 corrigió en las tres funciones del reparto; se
-- quedó acá porque el barrido de entonces miró funciones y no policies.
-- Medido el 2026-10-14 con un barrido de TODAS las funciones y policies del
-- esquema contra role_permissions.module_key.
SET lock_timeout = '5s';

ALTER POLICY documentos_por_asignar_select ON public.documentos_por_asignar
  USING ((SELECT auth_has_module_permission('staff_list'::text, 'can_view'::text)));
