-- El libro de inyectables (2026-11-11, auditoría de sucursales).
--
-- La bitácora de aplicaciones ya lleva quién cobró, quién aplicó, cuándo, el
-- medicamento, el lote y el vencimiento. Al libro que pide la norma le
-- faltaban: el documento del paciente, el médico que la recetó (con su número
-- de la Junta), la vía, el sitio de aplicación y las observaciones (reacción
-- inmediata, si la hubo). Van en una tabla aparte, una fila por aplicación,
-- para no tocar `inyeccion_aplicaciones` (la escriben la caja y la conciliación de ventas).
-- La firma de quien aplicó va en el papel, como en el resto de los libros.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.inyeccion_libro (
    inyeccion_id    bigint PRIMARY KEY REFERENCES public.inyeccion_aplicaciones(id) ON DELETE CASCADE,
    documento       text,
    medico          text,
    junta_medico    text,
    via             text CHECK (via IS NULL OR via IN ('IM', 'IV', 'SC', 'ID')),
    sitio           text,
    observaciones   text,
    registrado_por  uuid REFERENCES public.employees(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inyeccion_libro ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bloqueo_global ON public.inyeccion_libro;
CREATE POLICY bloqueo_global ON public.inyeccion_libro AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.auth_no_bloqueado()));
-- Lectura directa: nadie (se lee por `inyeccion_libro_de`, que aplica el alcance).
DROP POLICY IF EXISTS inyeccion_libro_select ON public.inyeccion_libro;
CREATE POLICY inyeccion_libro_select ON public.inyeccion_libro FOR SELECT TO authenticated
    USING ((SELECT public.auth_module_scope('inyecciones')) = 'ALL'
           AND (SELECT public.auth_has_module_permission('inyecciones', 'can_view')));
REVOKE ALL ON public.inyeccion_libro FROM anon;
GRANT SELECT ON public.inyeccion_libro TO authenticated;

-- ¿Esta aplicación está al alcance de quien llama? Toda la red, o su sala
-- (la del cobro o la de la aplicación).
CREATE OR REPLACE FUNCTION public.inyeccion_al_alcance(p_branch_id bigint, p_aplicada_branch_id bigint)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
  SELECT public.auth_module_scope('inyecciones') = 'ALL'
      OR p_branch_id = public.auth_employee_branch_id()::bigint
      OR p_aplicada_branch_id = public.auth_employee_branch_id()::bigint;
$function$;

CREATE OR REPLACE FUNCTION public.inyeccion_libro_guardar(p_inyeccion_id bigint, p_datos jsonb)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_yo uuid := public.auth_employee_id();
  v    public.inyeccion_aplicaciones;
  v_via text := nullif(btrim(p_datos->>'via'), '');
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  IF NOT (public.auth_has_module_permission('inyecciones', 'can_edit')
          OR public.auth_has_module_permission('inyecciones_confirmar', 'can_edit')) THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'No puedes completar el libro de inyectables.';
  END IF;
  SELECT * INTO v FROM public.inyeccion_aplicaciones WHERE id = p_inyeccion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.inyeccion_al_alcance(v.branch_id, v.aplicada_branch_id) THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'Esa aplicación no es de tu sala.';
  END IF;
  IF v.aplicada_at IS NULL THEN
    RAISE EXCEPTION 'NO_APLICADA' USING HINT = 'El libro se completa cuando la inyección ya se aplicó.';
  END IF;
  IF v_via IS NOT NULL AND v_via NOT IN ('IM', 'IV', 'SC', 'ID') THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'La vía no es válida.';
  END IF;

  INSERT INTO public.inyeccion_libro AS l (inyeccion_id, documento, medico, junta_medico, via, sitio, observaciones, registrado_por)
  VALUES (p_inyeccion_id, nullif(btrim(p_datos->>'documento'), ''), nullif(btrim(p_datos->>'medico'), ''),
          nullif(btrim(p_datos->>'junta_medico'), ''), v_via, nullif(btrim(p_datos->>'sitio'), ''),
          nullif(btrim(p_datos->>'observaciones'), ''), v_yo)
  ON CONFLICT (inyeccion_id) DO UPDATE
     SET documento = EXCLUDED.documento, medico = EXCLUDED.medico, junta_medico = EXCLUDED.junta_medico,
         via = EXCLUDED.via, sitio = EXCLUDED.sitio, observaciones = EXCLUDED.observaciones,
         registrado_por = EXCLUDED.registrado_por, updated_at = now()
   WHERE (l.documento, l.medico, l.junta_medico, l.via, l.sitio, l.observaciones)
         IS DISTINCT FROM (EXCLUDED.documento, EXCLUDED.medico, EXCLUDED.junta_medico, EXCLUDED.via, EXCLUDED.sitio, EXCLUDED.observaciones);

  INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, branch_id, details)
  VALUES (v_yo, (SELECT e.name FROM public.employees e WHERE e.id = v_yo), 'INYECCION_LIBRO', p_inyeccion_id::text,
          'ADMIN_PANEL', 'INFO', coalesce(v.aplicada_branch_id, v.branch_id), jsonb_build_object('via', v_via));
  RETURN json_build_object('id', p_inyeccion_id);
END;
$function$;

-- Los datos del libro de varias aplicaciones a la vez (las de una página).
CREATE OR REPLACE FUNCTION public.inyeccion_libro_de(p_ids bigint[])
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
BEGIN
  IF NOT public.auth_has_module_permission('inyecciones', 'can_view') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  IF coalesce(array_length(p_ids, 1), 0) > 1000 THEN RAISE EXCEPTION 'DEMASIADOS'; END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object('inyeccion_id', l.inyeccion_id, 'documento', l.documento, 'medico', l.medico,
                                      'junta_medico', l.junta_medico, 'via', l.via, 'sitio', l.sitio,
                                      'observaciones', l.observaciones))
      FROM public.inyeccion_libro l JOIN public.inyeccion_aplicaciones i ON i.id = l.inyeccion_id
     WHERE l.inyeccion_id = ANY (p_ids)
       AND public.inyeccion_al_alcance(i.branch_id, i.aplicada_branch_id)), '[]'::json);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.inyeccion_al_alcance(bigint, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.inyeccion_libro_guardar(bigint, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.inyeccion_libro_de(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_al_alcance(bigint, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inyeccion_libro_guardar(bigint, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inyeccion_libro_de(bigint[]) TO authenticated, service_role;
