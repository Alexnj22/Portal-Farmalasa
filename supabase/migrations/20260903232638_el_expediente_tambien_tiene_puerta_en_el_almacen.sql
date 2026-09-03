SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- El expediente tenía tres puertas en la base y ninguna en el almacén
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `employee_documents` (la tabla) exige `staff_detail`. `get_employee_identidad`
-- exige `staff_detail`. Pero el ARCHIVO —la foto del DUI, el contrato firmado—
-- vive en el bucket `documents`, y sus cuatro policies decían nada más que esto:
--
--     USING (bucket_id = 'documents')
--
-- Ninguna preguntaba quién es. Cualquiera de las 48 cuentas del portal podía
-- ver, reemplazar y BORRAR cualquier documento del expediente de cualquier
-- persona — y no hacía falta adivinar la ruta: `employees_safe` publica la
-- columna `employee_documents` (el jsonb con las URLs) a toda sesión, o sea que
-- viaja en el arranque a todo el mundo. En el mismo bucket viven los 24
-- documentos legales de las sucursales.
--
-- Es la regla 3 de CLAUDE.md —`USING (true)` prohibido para UPDATE/DELETE— con
-- `bucket_id` haciendo de `true`. El portal ya lo hacía bien en cuatro buckets
-- (`recetas` pide `bitacoras`, `sales-dte` pide `libros_iva`, `purchase-dte`
-- hasta acota por sala, `inventario-evidencia` pide permiso para escribir); lo
-- que faltaba era mirar éstos dos.
--
-- ── Por qué el predicado va INLINE y no en una función ─────────────────────
-- La tentación es un `puede_ver_documento(name)` STABLE. No: una función que
-- recibe la fila NO se puede izar, así que Postgres la evalúa UNA VEZ POR
-- ARCHIVO, y adentro cada `auth_*` vuelve a consultar employees+role_permissions.
-- Escrito inline, cada `(SELECT auth_…())` es un initplan que se evalúa UNA vez
-- por consulta y lo único que queda por fila es comparar texto. Es exactamente
-- la lección del incidente del 2026-07-08 (25,000 ms -> 19 ms), aplicada antes
-- de que duela.
--
-- ── El reparto, medido contra las rutas REALES de producción ───────────────
--   employees/<id>/...      el expediente             -> staff_detail (o el dueño)
--   branches/<id>/...       sucursales                -> branches
--   practicantes/<id>/...   viven dentro de /personal -> staff_list
--   disability/...          el adjunto de una incapacidad pertenece a la
--                           SOLICITUD, no a la ficha  -> requests_personales
--   capturas/...            un buzón que sólo toca service_role; su dueño recibe
--                           una URL FIRMADA, que no pasa por RLS -> nadie más
--   cualquier otra cosa     la ruta vieja `employee-documents/...` y los sueltos
--                           de la raíz, que son del expediente -> staff_detail
--
-- El último renglón es a propósito la red: lo que no cae en ningún prefijo
-- conocido queda con la llave MÁS cerrada, no con la más abierta.
--
-- Probado antes en el branch `staging` (qvctarsqvlhbzgvwbbbt) con dos identidades
-- y archivos en los siete prefijos: la de sala ve SÓLO su propio documento y no
-- puede pisar el ajeno, el de sucursal ni la foto ajena; la del expediente ve
-- todo menos `capturas/`.

-- ── documents ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS documents_authenticated_select ON storage.objects;
DROP POLICY IF EXISTS documents_authenticated_write  ON storage.objects;
DROP POLICY IF EXISTS documents_authenticated_update ON storage.objects;
DROP POLICY IF EXISTS documents_authenticated_delete ON storage.objects;

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
        OR (name LIKE 'branches/%'     AND (SELECT auth_has_module_permission('branches', 'can_view')))
        OR (name LIKE 'practicantes/%' AND (SELECT auth_has_module_permission('staff_list', 'can_view')))
        OR (name LIKE 'disability/%'   AND (SELECT auth_has_module_permission('requests_personales', 'can_view')))
        OR (name NOT LIKE 'employees/%' AND name NOT LIKE 'branches/%'
            AND name NOT LIKE 'practicantes/%' AND name NOT LIKE 'disability/%'
            AND name NOT LIKE 'capturas/%'
            AND (SELECT auth_has_module_permission('staff_detail', 'can_view')))
    )
);

-- Escribir es la misma repartición con `can_edit`. El alta de un empleado usa
-- `staff_list.can_edit` y la edición del expediente `staff_detail.can_edit`, así
-- que las rutas de personal aceptan cualquiera de las dos.
CREATE POLICY documents_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'documents' AND (
        (name LIKE 'employees/%'     AND (SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))
        OR (name LIKE 'branches/%'     AND (SELECT auth_can_edit_any(ARRAY['branches'])))
        OR (name LIKE 'practicantes/%' AND (SELECT auth_can_edit_any(ARRAY['staff_list'])))
        OR (name LIKE 'disability/%'   AND (SELECT auth_can_edit_any(ARRAY['requests_personales'])))
        OR (name NOT LIKE 'employees/%' AND name NOT LIKE 'branches/%'
            AND name NOT LIKE 'practicantes/%' AND name NOT LIKE 'disability/%'
            AND name NOT LIKE 'capturas/%'
            AND (SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))
    )
);

CREATE POLICY documents_update ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'documents' AND (
        (name LIKE 'employees/%'     AND (SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))
        OR (name LIKE 'branches/%'     AND (SELECT auth_can_edit_any(ARRAY['branches'])))
        OR (name LIKE 'practicantes/%' AND (SELECT auth_can_edit_any(ARRAY['staff_list'])))
        OR (name LIKE 'disability/%'   AND (SELECT auth_can_edit_any(ARRAY['requests_personales'])))
        OR (name NOT LIKE 'employees/%' AND name NOT LIKE 'branches/%'
            AND name NOT LIKE 'practicantes/%' AND name NOT LIKE 'disability/%'
            AND name NOT LIKE 'capturas/%'
            AND (SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))
    )
);

CREATE POLICY documents_delete ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'documents' AND (
        (name LIKE 'employees/%'     AND (SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))
        OR (name LIKE 'branches/%'     AND (SELECT auth_can_edit_any(ARRAY['branches'])))
        OR (name LIKE 'practicantes/%' AND (SELECT auth_can_edit_any(ARRAY['staff_list'])))
        OR (name LIKE 'disability/%'   AND (SELECT auth_can_edit_any(ARRAY['requests_personales'])))
        OR (name NOT LIKE 'employees/%' AND name NOT LIKE 'branches/%'
            AND name NOT LIKE 'practicantes/%' AND name NOT LIKE 'disability/%'
            AND name NOT LIKE 'capturas/%'
            AND (SELECT auth_can_edit_any(ARRAY['staff_detail','staff_list'])))
    )
);

-- ── empleados ───────────────────────────────────────────────────────────────
--
-- Acá la LECTURA se deja abierta a `authenticated` A PROPÓSITO, y conviene
-- escribir el motivo porque leído en frío parece el mismo defecto: la foto de
-- perfil se firma EN LOTE para toda la empresa en el arranque
-- (`systemSlice.js`, `signStorageUrls`) y se pinta en catorce pantallas vía
-- `signPhotosDeep` —el monitor, las solicitudes, las bolsas, los cortes, las
-- encuestas—. Cerrarla rompería medio portal para proteger una foto de carné
-- que además se ve en la sala. Lo que NO puede seguir abierto es reemplazarla o
-- borrarla: eso sí es una identidad ajena.
--
-- La ruta es `<employee_id>/foto_perfil/<archivo>` y hay UN solo escritor
-- (`uploadEmployeeFile`), así que el dueño se lee del primer segmento.
DROP POLICY IF EXISTS empleados_authenticated_select ON storage.objects;
DROP POLICY IF EXISTS empleados_authenticated_write  ON storage.objects;
DROP POLICY IF EXISTS empleados_authenticated_update ON storage.objects;
DROP POLICY IF EXISTS empleados_authenticated_delete ON storage.objects;
-- La duplicada que quedó de la consola. Dejarla habría anulado la nueva sin
-- decir nada: las policies permisivas se OR-ean, así que la más floja gana.
DROP POLICY IF EXISTS "Permitir todo a usuarios autenticados 17gkcnc_1" ON storage.objects;

CREATE POLICY empleados_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'empleados');

CREATE POLICY empleados_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'empleados' AND (
        split_part(name, '/', 1) = ((SELECT auth_employee_id()))::text
        OR (SELECT auth_can_edit_any(ARRAY['staff_list','staff_detail']))
    )
);

CREATE POLICY empleados_update ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'empleados' AND (
        split_part(name, '/', 1) = ((SELECT auth_employee_id()))::text
        OR (SELECT auth_can_edit_any(ARRAY['staff_list','staff_detail']))
    )
);

CREATE POLICY empleados_delete ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'empleados' AND (
        split_part(name, '/', 1) = ((SELECT auth_employee_id()))::text
        OR (SELECT auth_can_edit_any(ARRAY['staff_list','staff_detail']))
    )
);
