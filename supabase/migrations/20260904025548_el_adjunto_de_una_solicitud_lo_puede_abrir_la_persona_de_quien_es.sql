SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- El adjunto de una solicitud lo puede abrir la persona de quien es
-- ─────────────────────────────────────────────────────────────────────────────
--
-- La constancia médica de una incapacidad se subía a `disability/<archivo>`, una
-- ruta que no lleva el id de nadie. Desde que las policies del bucket miran la
-- ruta (2026-09-03) eso significa que ese papel **sólo lo puede abrir quien
-- administra solicitudes — nunca la persona de quien es la incapacidad**.
--
-- Antes «funcionaba» porque el bucket estaba abierto para todos, que es
-- justamente el agujero que se cerró. El arreglo no es reabrirlo: es que la ruta
-- diga de quién es el papel. El escritor pasa a `solicitudes/<employee_id>/` y
-- esta policy resuelve al dueño desde ahí, igual que con `employees/<id>/`.
--
-- `disability/` se queda declarada porque el archivo que ya está ahí no se puede
-- mover sin saber a qué solicitud pertenece —el dato vive en
-- `approval_requests.metadata`, no en la ficha— y es uno solo. Sigue bajo
-- `requests_personales`, que es exactamente lo que tenía.
--
-- ── Y una asimetría a propósito ────────────────────────────────────────────
-- El dueño puede VER y SUBIR el adjunto de su solicitud, pero no REEMPLAZARLO
-- ni BORRARLO. Una constancia médica ya entregada es la prueba de una
-- incapacidad: quien la presentó no debería poder cambiarla después. Eso queda
-- con quien administra solicitudes.

DROP POLICY IF EXISTS documents_select ON storage.objects;
CREATE POLICY documents_select ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'documents' AND (
        (name LIKE 'employees/%' AND (
            -- El dueño SIEMPRE. Esconderle a alguien su propio documento no
            -- protege a nadie: rompe «Mis documentos».
            split_part(name, '/', 2) = ((SELECT auth_employee_id()))::text
            OR ((SELECT auth_has_module_permission('staff_detail', 'can_view'))
                AND ((SELECT auth_module_scope('staff_detail')) = 'ALL'
                     OR EXISTS (SELECT 1 FROM public.employees e
                                 WHERE e.id::text = split_part(name, '/', 2)
                                   AND e.branch_id = (SELECT auth_employee_branch_id()))))
        ))
        -- El adjunto de una solicitud personal: de su dueño, o de quien las
        -- administra. Misma forma que el expediente y por el mismo motivo.
        OR (name LIKE 'solicitudes/%' AND (
            split_part(name, '/', 2) = ((SELECT auth_employee_id()))::text
            OR (SELECT auth_has_module_permission('requests_personales', 'can_view'))
        ))
        OR (name LIKE 'branches/%'     AND (SELECT auth_has_module_permission('branches', 'can_view')))
        OR (name LIKE 'practicantes/%' AND (SELECT auth_has_module_permission('staff_list', 'can_view')))
        OR (name LIKE 'disability/%'   AND (SELECT auth_has_module_permission('requests_personales', 'can_view')))
        OR (name NOT LIKE 'employees/%' AND name NOT LIKE 'solicitudes/%' AND name NOT LIKE 'branches/%'
            AND name NOT LIKE 'practicantes/%' AND name NOT LIKE 'disability/%'
            AND name NOT LIKE 'capturas/%'
            AND (SELECT auth_has_module_permission('staff_detail', 'can_view')))
    )
);

-- Escribir el adjunto de la solicitud propia: la persona sube la constancia de
-- SU incapacidad, así que el dueño puede. Y quien administra solicitudes,
-- también — hoy es quien las carga por los demás.
DROP POLICY IF EXISTS documents_insert ON storage.objects;
CREATE POLICY documents_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'documents' AND (
        (name LIKE 'employees/%'       AND (SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))
        OR (name LIKE 'solicitudes/%' AND (
            split_part(name, '/', 2) = ((SELECT auth_employee_id()))::text
            OR (SELECT auth_can_edit_any(ARRAY['requests_personales']))
        ))
        OR (name LIKE 'branches/%'     AND (SELECT auth_can_edit_any(ARRAY['branches'])))
        OR (name LIKE 'practicantes/%' AND (SELECT auth_can_edit_any(ARRAY['staff_list'])))
        OR (name LIKE 'disability/%'   AND (SELECT auth_can_edit_any(ARRAY['requests_personales'])))
        OR (name NOT LIKE 'employees/%' AND name NOT LIKE 'solicitudes/%' AND name NOT LIKE 'branches/%'
            AND name NOT LIKE 'practicantes/%' AND name NOT LIKE 'disability/%'
            AND name NOT LIKE 'capturas/%'
            AND (SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))
    )
);

-- Reemplazar o borrar NO lo puede el dueño: una constancia médica ya entregada
-- es la prueba de una incapacidad, y quien la presentó no debería poder
-- cambiarla después. Eso queda con quien administra solicitudes.
DROP POLICY IF EXISTS documents_update ON storage.objects;
CREATE POLICY documents_update ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'documents' AND (
        (name LIKE 'employees/%'       AND (SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))
        OR (name LIKE 'solicitudes/%'  AND (SELECT auth_can_edit_any(ARRAY['requests_personales'])))
        OR (name LIKE 'branches/%'     AND (SELECT auth_can_edit_any(ARRAY['branches'])))
        OR (name LIKE 'practicantes/%' AND (SELECT auth_can_edit_any(ARRAY['staff_list'])))
        OR (name LIKE 'disability/%'   AND (SELECT auth_can_edit_any(ARRAY['requests_personales'])))
        OR (name NOT LIKE 'employees/%' AND name NOT LIKE 'solicitudes/%' AND name NOT LIKE 'branches/%'
            AND name NOT LIKE 'practicantes/%' AND name NOT LIKE 'disability/%'
            AND name NOT LIKE 'capturas/%'
            AND (SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))
    )
);

DROP POLICY IF EXISTS documents_delete ON storage.objects;
CREATE POLICY documents_delete ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'documents' AND (
        (name LIKE 'employees/%'       AND (SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))
        OR (name LIKE 'solicitudes/%'  AND (SELECT auth_can_edit_any(ARRAY['requests_personales'])))
        OR (name LIKE 'branches/%'     AND (SELECT auth_can_edit_any(ARRAY['branches'])))
        OR (name LIKE 'practicantes/%' AND (SELECT auth_can_edit_any(ARRAY['staff_list'])))
        OR (name LIKE 'disability/%'   AND (SELECT auth_can_edit_any(ARRAY['requests_personales'])))
        OR (name NOT LIKE 'employees/%' AND name NOT LIKE 'solicitudes/%' AND name NOT LIKE 'branches/%'
            AND name NOT LIKE 'practicantes/%' AND name NOT LIKE 'disability/%'
            AND name NOT LIKE 'capturas/%'
            AND (SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))
    )
);
