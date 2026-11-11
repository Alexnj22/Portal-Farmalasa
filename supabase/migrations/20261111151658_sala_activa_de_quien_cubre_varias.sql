-- La sala con la que trabaja hoy quien cubre varias (2026-11-11).
--
-- El regente y el referente de farmacovigilancia tienen su sede en
-- Administración y cubren varias salas («Áreas que cubre» = employee_branches).
-- Con alcance «de su sala», las 103 policies comparan contra
-- `auth_employee_branch_id()`, que era la sede: el regente no veía ninguna de
-- las salas que regenta. En vez de reescribir las 103, la persona ELIGE con qué
-- sala trabaja y `auth_yo` (de donde sale `auth_employee_branch_id`) la toma.
--
-- Precedencia: apoyo temporal vigente > sala elegida > sede de la ficha.
-- La sala elegida vale sólo si sigue entre las que cubre (EXISTS contra
-- employee_branches, índice único): quitarle un área a alguien le quita el
-- acceso en la próxima consulta, sin tocar esta tabla.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.sala_activa (
    employee_id  uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
    branch_id    bigint NOT NULL REFERENCES public.branches(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sala_activa_branch ON public.sala_activa (branch_id);
ALTER TABLE public.sala_activa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bloqueo_global ON public.sala_activa;
CREATE POLICY bloqueo_global ON public.sala_activa AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.auth_no_bloqueado()));
DROP POLICY IF EXISTS sala_activa_select ON public.sala_activa;
CREATE POLICY sala_activa_select ON public.sala_activa FOR SELECT TO authenticated
    USING (employee_id = (SELECT public.auth_employee_id()));
REVOKE ALL ON public.sala_activa FROM anon;
GRANT SELECT ON public.sala_activa TO authenticated;

-- La sala elegida, si todavía la cubre. Null si no eligió o ya no la cubre.
CREATE OR REPLACE FUNCTION public.sala_activa_vigente(p_employee_id uuid)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
  SELECT sa.branch_id::integer
    FROM public.sala_activa sa
   WHERE sa.employee_id = p_employee_id
     AND EXISTS (SELECT 1 FROM public.employee_branches eb
                  WHERE eb.employee_id = sa.employee_id AND eb.branch_id = sa.branch_id);
$function$;
REVOKE EXECUTE ON FUNCTION public.sala_activa_vigente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sala_activa_vigente(uuid) TO authenticated, service_role;

-- Elegir (o soltar, con null) la sala con la que se trabaja.
CREATE OR REPLACE FUNCTION public.elegir_sala_activa(p_branch_id bigint)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_yo    uuid := public.auth_employee_id();
  v_sede  bigint;
  v_antes bigint;
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  SELECT e.branch_id INTO v_sede FROM public.employees e WHERE e.id = v_yo;
  SELECT sa.branch_id INTO v_antes FROM public.sala_activa sa WHERE sa.employee_id = v_yo;

  IF p_branch_id IS NULL OR p_branch_id = v_sede THEN
    DELETE FROM public.sala_activa WHERE employee_id = v_yo;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.employee_branches eb
                    WHERE eb.employee_id = v_yo AND eb.branch_id = p_branch_id) THEN
      RAISE EXCEPTION 'SALA_NO_CUBIERTA' USING HINT = 'Esa sala no está entre las que cubres.';
    END IF;
    INSERT INTO public.sala_activa (employee_id, branch_id) VALUES (v_yo, p_branch_id)
    ON CONFLICT (employee_id) DO UPDATE SET branch_id = EXCLUDED.branch_id, updated_at = now();
  END IF;

  INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, branch_id, details)
  VALUES (v_yo, (SELECT e.name FROM public.employees e WHERE e.id = v_yo), 'ELEGIR_SALA_ACTIVA', v_yo::text,
          'ADMIN_PANEL', 'INFO', coalesce(p_branch_id, v_sede),
          jsonb_build_object('antes', v_antes, 'ahora', CASE WHEN p_branch_id = v_sede THEN NULL ELSE p_branch_id END));
  PERFORM set_config('farmalasa.auth_yo', '', true);
  RETURN json_build_object('branch_id', coalesce(public.sala_activa_vigente(v_yo), v_sede::integer));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.elegir_sala_activa(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.elegir_sala_activa(bigint) TO authenticated, service_role;

-- auth_yo: la sala elegida entra entre el apoyo y la sede. Se parte de la
-- definición VIVA (la reescribió otra sesión el 2026-11-10) y se cambian dos
-- fragmentos exactos; si alguno no aparece, la migración falla entera.
DO $$
DECLARE d text; a text; b text;
BEGIN
  d := pg_get_functiondef('public.auth_yo()'::regprocedure);
  a := $a$'b', coalesce((ap.a->>'targetBranchId')::integer, x.branch_id))$a$;
  b := $b$    LEFT JOIN LATERAL (SELECT public.apoyo_vigente(x.id) AS a) ap ON true$b$;
  IF position(a IN d) = 0 OR position(b IN d) = 0 THEN
    RAISE EXCEPTION 'auth_yo cambió: no se encontraron los fragmentos a reemplazar';
  END IF;
  d := replace(d, a, $n$'b', coalesce((ap.a->>'targetBranchId')::integer, sav.b, x.branch_id))$n$);
  d := replace(d, b, b || E'\n' || $n$    LEFT JOIN LATERAL (SELECT sa.branch_id::integer AS b FROM public.sala_activa sa
                        WHERE sa.employee_id = x.id
                          AND EXISTS (SELECT 1 FROM public.employee_branches eb
                                       WHERE eb.employee_id = sa.employee_id AND eb.branch_id = sa.branch_id)) sav ON true$n$);
  EXECUTE d;
END $$;
