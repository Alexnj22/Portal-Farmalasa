SET lock_timeout = '5s';
-- Inyecciones: si hay enfermería en la sala, la aplicación la marca ella.
-- Decisión del usuario (2026-10-28), complemento de 20261028180147.
--
-- «En la sala» se mide por SESIÓN, no por horario: `employee_rosters` y
-- `attendance` están vacías en producción (medido hoy), así que el horario no
-- puede contestar. Una Regente de Enfermería (roles.id 23) de esa sala con
-- sesión del portal renovada en los últimos 70 minutos cuenta como presente —
-- el token se renueva cada hora mientras la pantalla está abierta.
--
-- Dos comportamientos distintos a propósito:
--   · `inyeccion_aplicar` (canjear una pendiente): RECHAZA, con un mensaje que
--     dice qué hacer. No se movió dinero, se puede reintentar.
--   · `inyeccion_registrar` (cobrar y aplicar en el acto): NO rechaza — el cobro
--     ya está hecho en la caja. Deja la aplicación PENDIENTE para que la marque
--     enfermería, y lo devuelve en `para_enfermeria`.
CREATE OR REPLACE FUNCTION public.inyeccion_enfermeria_presente(p_branch_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.employees e
      JOIN auth.sessions s
        ON s.user_id = e.id
        OR s.user_id IN (SELECT l.auth_user_id FROM public.employee_auth_accounts l WHERE l.employee_id = e.id)
     WHERE e.role_id = 23 AND e.status = 'ACTIVO'
       AND (e.branch_id = p_branch_id
            OR EXISTS (SELECT 1 FROM public.employee_branches eb
                        WHERE eb.employee_id = e.id AND eb.branch_id = p_branch_id))
       AND coalesce(s.refreshed_at, s.updated_at) > now() - interval '70 minutes'
       AND (s.not_after IS NULL OR s.not_after > now())
  );
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_enfermeria_presente(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_enfermeria_presente(integer) TO authenticated, service_role;

DO $$
DECLARE def text; nuevo text;
BEGIN
    -- Partir de la definición VIVA; si un ancla no está, abortar.
    SELECT pg_get_functiondef('public.inyeccion_aplicar'::regproc) INTO def;
    IF def NOT LIKE '%inyeccion_enfermeria_presente%' THEN
        nuevo := regexp_replace(def, '(\n  -- Una mezcla se canjea)',
            E'\n  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = v_emp AND role_id = 23)\n     AND EXISTS (SELECT 1 FROM public.inyeccion_aplicaciones a\n                  WHERE a.id = ANY (p_ids)\n                    AND public.inyeccion_enfermeria_presente(coalesce(v_sala, a.branch_id))) THEN\n    RAISE EXCEPTION ''Hay enfermería conectada en la sala: la aplicación la marca ella.'' USING ERRCODE = ''P0001'';\n  END IF;' || '\1');
        IF nuevo = def THEN RAISE EXCEPTION 'Sin ancla en inyeccion_aplicar'; END IF;
        EXECUTE nuevo;
    END IF;

    SELECT pg_get_functiondef('public.inyeccion_registrar(bigint,text,jsonb,integer,text,integer,uuid,text)'::regprocedure) INTO def;
    IF def NOT LIKE '%inyeccion_enfermeria_presente%' THEN
        nuevo := regexp_replace(def, '(\n  i        integer;\nBEGIN)',
            E'\n  i        integer;\n  v_para_enf boolean := false;\nBEGIN');
        nuevo := regexp_replace(nuevo, '(\n  IF p_origen = ''COMPRADA'' THEN\n    -- Candado)',
            E'\n  IF v_ahora > 0\n     AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_por AND role_id = 23)\n     AND public.inyeccion_enfermeria_presente(v_cobro.branch_id) THEN\n    v_ahora := 0;\n    v_para_enf := true;\n  END IF;\n' || '\1');
        nuevo := regexp_replace(nuevo, '''aplicadas_ahora'', least\(v_ahora, v_hechas\),',
            '''aplicadas_ahora'', least(v_ahora, v_hechas), ''para_enfermeria'', v_para_enf,');
        IF nuevo NOT LIKE '%v_para_enf boolean%' OR nuevo NOT LIKE '%v_para_enf := true%' OR nuevo NOT LIKE '%''para_enfermeria''%' THEN
            RAISE EXCEPTION 'Sin ancla en inyeccion_registrar';
        END IF;
        EXECUTE nuevo;
    END IF;
END $$;
