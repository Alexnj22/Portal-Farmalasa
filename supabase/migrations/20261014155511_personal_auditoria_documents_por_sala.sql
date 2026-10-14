-- Auditoría de Personal 2026-10-14 · S6. docs/PLAN-PERSONAL-AUDITORIA-2026-10-14.md
--
-- La rama «por sala» de `documents_select` comparaba `split_part(e.name, …)`:
-- dentro del EXISTS, `name` a secas se resolvía a la columna `employees.name`
-- —el nombre de la persona— y no a la ruta del objeto. Nunca coincidía, así que
-- un cargo con `staff_detail` de alcance de sala no habría visto ni un
-- documento de su gente. Latente: hoy los cuatro cargos con expediente son ALL.
-- Ahora la ruta se nombra con su tabla (`objects.name`). Lo demás, idéntico.
SET lock_timeout = '5s';

DROP POLICY IF EXISTS documents_select ON storage.objects;
CREATE POLICY documents_select ON storage.objects
    FOR SELECT TO authenticated
    USING ((bucket_id = 'documents'::text) AND (((name ~~ 'employees/%'::text) AND ((split_part(name, '/'::text, 2) = (( SELECT auth_employee_id() AS auth_employee_id))::text) OR (( SELECT auth_has_module_permission('staff_detail'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('staff_detail'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM public.employees e
  WHERE (((e.id)::text = split_part(objects.name, '/'::text, 2)) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))))))) OR ((name ~~ 'solicitudes/%'::text) AND ((split_part(name, '/'::text, 2) = (( SELECT auth_employee_id() AS auth_employee_id))::text) OR ( SELECT auth_has_module_permission('requests_personales'::text, 'can_view'::text) AS auth_has_module_permission))) OR ((name ~~ 'branches/%'::text) AND ( SELECT auth_has_module_permission('branches'::text, 'can_view'::text) AS auth_has_module_permission)) OR ((name ~~ 'practicantes/%'::text) AND ( SELECT auth_has_module_permission('staff_list'::text, 'can_view'::text) AS auth_has_module_permission)) OR ((name ~~ 'disability/%'::text) AND ( SELECT auth_has_module_permission('requests_personales'::text, 'can_view'::text) AS auth_has_module_permission)) OR ((name !~~ 'employees/%'::text) AND (name !~~ 'solicitudes/%'::text) AND (name !~~ 'branches/%'::text) AND (name !~~ 'practicantes/%'::text) AND (name !~~ 'disability/%'::text) AND (name !~~ 'capturas/%'::text) AND ( SELECT auth_has_module_permission('staff_detail'::text, 'can_view'::text) AS auth_has_module_permission))));
