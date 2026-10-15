SET lock_timeout = '5s';

-- Documentos de personal COMPARTIDOS (el acuse del MTPS de una recontratación
-- nombra a varios). Viven una sola vez en `compartidos/` y cada ficha apunta
-- ahí. La carpeta de una persona (`employees/<id>/`) sólo la lee esa persona,
-- así que guardar el acuse común en la carpeta de uno lo dejaba invisible para
-- los demás que nombra.
--
-- Lee un archivo de `compartidos/`:
--   · quien ya lo leía por la rama general (staff_detail can_view), y
--   · la persona cuya PROPIA ficha lo nombra.
DROP POLICY IF EXISTS documents_select ON storage.objects;
CREATE POLICY documents_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'documents' AND (
    (name ~~ 'employees/%' AND (
        split_part(name, '/', 2) = ((SELECT auth_employee_id()))::text
        OR ((SELECT auth_has_module_permission('staff_detail', 'can_view'))
            AND (((SELECT auth_module_scope('staff_detail')) = 'ALL')
                 OR EXISTS (SELECT 1 FROM public.employees e
                            WHERE e.id::text = split_part(objects.name, '/', 2)
                              AND e.branch_id = (SELECT auth_employee_branch_id()))))))
    OR (name ~~ 'compartidos/%' AND (
        (SELECT auth_has_module_permission('staff_detail', 'can_view'))
        OR EXISTS (SELECT 1 FROM public.employees e
                   WHERE e.id = (SELECT auth_employee_id())
                     AND position(objects.name IN e.employee_documents::text) > 0)))
    OR (name ~~ 'solicitudes/%' AND (
        split_part(name, '/', 2) = ((SELECT auth_employee_id()))::text
        OR (SELECT auth_has_module_permission('requests_personales', 'can_view'))))
    OR (name ~~ 'branches/%' AND (SELECT auth_has_module_permission('branches', 'can_view')))
    OR (name ~~ 'practicantes/%' AND (SELECT auth_has_module_permission('staff_list', 'can_view')))
    OR (name ~~ 'disability/%' AND (SELECT auth_has_module_permission('requests_personales', 'can_view')))
    OR (name !~~ 'employees/%' AND name !~~ 'solicitudes/%' AND name !~~ 'branches/%'
        AND name !~~ 'practicantes/%' AND name !~~ 'disability/%' AND name !~~ 'capturas/%'
        AND name !~~ 'compartidos/%'
        AND (SELECT auth_has_module_permission('staff_detail', 'can_view')))
  )
);
