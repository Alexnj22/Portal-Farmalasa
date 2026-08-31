SET lock_timeout = '5s';

-- Marcar un aviso como leído es un acto del DESTINATARIO, no de quien
-- administra avisos.
--
-- Hasta hoy el portal lo hacía con un UPDATE directo desde el navegador
-- (`markAnnouncementAsRead`), y la policy `announcements_update` exige
-- `announcements/can_edit`. De 46 empleados activos, 4 lo tienen. Para los
-- otros 42 el UPDATE no tocaba ninguna fila, PostgREST devolvía 204 SIN error,
-- y el cliente lo daba por bueno y lo guardaba en su caché: el aviso
-- desaparecía de «Sin leer» y volvía en la siguiente carga, para siempre.
--
-- Medido antes de este cambio: 26 avisos, 4 con lector, y los 4 el MISMO
-- administrador. Nadie más había quedado registrado como que leyó un aviso,
-- nunca. Cendy Quintanilla tenía 9 avisos apilados desde el 3-ago sin poder
-- marcar ninguno.
--
-- El modelo es `kiosco_aviso_leido`, que ya resolvía esto bien del lado del
-- kiosco: DEFINER, idempotente, y sin pedir permiso de edición. Acá la guarda
-- no es el dispositivo sino la AUDIENCIA, escrita igual que en la policy
-- `announcements_audience` para que ver un aviso y poder marcarlo sean la
-- misma pregunta.
CREATE OR REPLACE FUNCTION public.marcar_aviso_leido(p_announcement_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_employee uuid;
    v_ann      public.announcements%ROWTYPE;
    v_alcanza  boolean;
BEGIN
    -- La ficha, no la cuenta: para 33 de las 42 personas del portal
    -- `employees.id` y `auth.users.id` no son el mismo valor.
    v_employee := (SELECT public.auth_employee_id());
    IF v_employee IS NULL THEN
        RAISE EXCEPTION 'SIN_FICHA';
    END IF;

    SELECT * INTO v_ann FROM public.announcements WHERE id = p_announcement_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AVISO_NO_EXISTE';
    END IF;

    -- Espejo exacto de `announcements_audience`. ROLE se resuelve por NOMBRE
    -- porque así lo escribe AnnouncementsView, no por role_id.
    v_alcanza :=
           (v_ann.target_type = 'GLOBAL')
        OR (v_ann.target_type = 'BRANCH'
            AND (v_ann.target_value #>> '{}') = ((SELECT public.auth_employee_branch_id()))::text)
        OR (v_ann.target_type = 'ROLE'
            AND (v_ann.target_value #>> '{}') = (SELECT r.name FROM public.roles r
                                                  WHERE r.id = (SELECT public.auth_employee_role_id())))
        OR (v_ann.target_type = 'EMPLOYEE'
            AND v_ann.target_value @> to_jsonb(v_employee::text))
        OR ((SELECT public.auth_has_module_permission('announcements', 'can_edit'))
            AND (SELECT public.auth_module_scope('announcements')) = 'ALL');

    IF NOT v_alcanza THEN
        RAISE EXCEPTION 'AVISO_FUERA_DE_AUDIENCIA';
    END IF;

    -- Idempotente, y contra las DOS formas que conviven en la columna: la
    -- vieja (array de ids sueltos) y la de hoy (array de objetos).
    UPDATE public.announcements a
       SET read_by = a.read_by || jsonb_build_array(jsonb_build_object(
                       'employeeId', v_employee::text,
                       'readAt',     now()))
     WHERE a.id = p_announcement_id
       AND NOT (a.read_by @> jsonb_build_array(jsonb_build_object('employeeId', v_employee::text)))
       AND NOT (a.read_by @> to_jsonb(ARRAY[v_employee::text]));

    RETURN json_build_object('ok', true, 'employee_id', v_employee);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.marcar_aviso_leido(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marcar_aviso_leido(uuid) TO authenticated, service_role;
