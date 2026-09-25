-- Los últimos buscadores del servidor pasan a la regla del portal
-- (docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md). Los cuatro usaban `ilike` de la
-- frase entera, que no ignora tildes: «jose perez» no encontraba «JOSÉ PÉREZ».
--
-- · Solicitudes de datos (derecho ARCO): quién es la persona, por NOMBRE, en
--   clientes, practicantes, proveedores y recetas —`buscar_personas_por_nombre`—
--   y en personal —`buscar_empleado_para_solicitud`—. Además el practicante se
--   buscaba sólo en `last_names`: «José Pérez» no lo encontraba nunca. La
--   respuesta de esta pantalla es un documento con membrete: «no consta» sobre
--   alguien que sí consta es la falla que no se puede tener.
-- · Médicos de la bitácora: `buscar_medicos_ids`.
-- · Notificaciones: `notificaciones_que_coinciden`.
--
-- El prefiltro de todas es el mismo: las piezas de `busqueda_patrones_legados`
-- contra el texto sin tildes, en minúsculas y sin puntuación (superconjunto);
-- la regla exacta decide sobre lo que pasa. INVOKER salvo la de personal, que
-- ya era DEFINER por los permisos por columna de `employees`.
-- Sólo crea y reemplaza funciones: no toca ninguna tabla.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.buscar_personas_por_nombre(p_nombre text)
RETURNS json
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_tok  jsonb  := public.busqueda_palabras(p_nombre);
  v_pats text[] := public.busqueda_patrones_legados(public.busqueda_palabras(p_nombre));
  v_pre  text[] := public.busqueda_prefiltro(public.busqueda_palabras(p_nombre));
BEGIN
  IF v_pats IS NULL THEN
    RETURN json_build_object('clientes', '[]'::json, 'practicantes', '[]'::json,
                             'proveedores', '[]'::json, 'recetas', '[]'::json);
  END IF;
  RETURN json_build_object(
    'clientes', coalesce((
      SELECT json_agg(x.id) FROM (
        SELECT c.id FROM public.customers c
        WHERE (c.nombre_busq || ' ' || c.nombre_comp) ~ ALL (v_pre)
          AND public.busqueda_puntaje(v_tok, ARRAY[c.nombre_busq], ARRAY[c.nombre_comp]) > 0
        ORDER BY c.name LIMIT 20) x), '[]'::json),
    'practicantes', coalesce((
      SELECT json_agg(x.id) FROM (
        SELECT p.id FROM public.practicantes p
        WHERE regexp_replace(lower(public.f_unaccent(coalesce(p.first_names, '') || ' ' || coalesce(p.last_names, ''))), '[^a-z0-9 ]', '', 'g') LIKE ALL (v_pats)
          AND public.busqueda_coincide(v_tok, coalesce(p.first_names, '') || ' ' || coalesce(p.last_names, ''))
        ORDER BY p.last_names LIMIT 20) x), '[]'::json),
    'proveedores', coalesce((
      SELECT json_agg(x.nit) FROM (
        SELECT pm.nit FROM public.proveedores_maestro pm
        WHERE regexp_replace(lower(public.f_unaccent(coalesce(pm.nombre, ''))), '[^a-z0-9 ]', '', 'g') LIKE ALL (v_pats)
          AND public.busqueda_coincide(v_tok, pm.nombre)
        ORDER BY pm.nombre LIMIT 20) x), '[]'::json),
    'recetas', coalesce((
      SELECT json_agg(x.id) FROM (
        SELECT r.id FROM public.recetas r
        WHERE regexp_replace(lower(public.f_unaccent(coalesce(r.paciente_nombre, ''))), '[^a-z0-9 ]', '', 'g') LIKE ALL (v_pats)
          AND public.busqueda_coincide(v_tok, r.paciente_nombre)
        ORDER BY r.id DESC LIMIT 20) x), '[]'::json)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_personas_por_nombre(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_personas_por_nombre(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.buscar_empleado_para_solicitud(p_dui text DEFAULT NULL::text, p_telefono text DEFAULT NULL::text, p_nombre text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, name text, code text, dui text, phone text, email text, address text, birth_date date, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dui text := nullif(regexp_replace(coalesce(p_dui, ''), '\D', '', 'g'), '');
    v_tel text := nullif(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), '');
    v_nom text := nullif(btrim(coalesce(p_nombre, '')), '');
    -- La regla del portal para el nombre (antes: `ILIKE` de la frase, que no
    -- ignoraba tildes).
    v_tok jsonb := public.busqueda_palabras(p_nombre);
BEGIN
    -- El permiso del MÓDULO, no un cargo: el día que el delegado sea otra
    -- persona, se le da el módulo y esto sigue funcionando sin tocar la base.
    IF NOT (SELECT public.auth_has_module_permission('datos_personales', 'can_edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING errcode = '42501';
    END IF;

    -- Sin ningún criterio no devuelve el padrón entero. Una función que con
    -- argumentos vacíos lista a las 48 personas es un volcado disfrazado de
    -- búsqueda.
    IF v_dui IS NULL AND v_tel IS NULL AND v_nom IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT e.id, e.name, e.code, e.dui, e.phone, e.email, e.address, e.birth_date, e.status
    FROM public.employees e
    WHERE (v_dui IS NOT NULL AND regexp_replace(coalesce(e.dui, ''), '\D', '', 'g') = v_dui)
       OR (v_tel IS NOT NULL AND regexp_replace(coalesce(e.phone, ''), '\D', '', 'g') = v_tel)
       OR (v_nom IS NOT NULL AND public.busqueda_coincide(v_tok, e.name))
    ORDER BY e.name
    LIMIT 20;
END;
$function$;

CREATE OR REPLACE FUNCTION public.buscar_medicos_ids(p_q text, p_junta text DEFAULT 'P01', p_tope integer DEFAULT 15)
RETURNS json
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_tok  jsonb  := public.busqueda_palabras(p_q);
  v_pats text[] := public.busqueda_patrones_legados(public.busqueda_palabras(p_q));
BEGIN
  IF v_pats IS NULL THEN RETURN '[]'::json; END IF;
  RETURN coalesce((
    SELECT json_agg(x.id ORDER BY x.s DESC, x.nombre)
    FROM (
      SELECT m.id, m.nombre,
             public.busqueda_puntaje(v_tok, ARRAY[public.norm_busqueda(m.nombre)],
                                     ARRAY[public.compactar_busqueda(m.nombre)]) AS s
      FROM public.medicos m
      WHERE m.junta = p_junta
        AND regexp_replace(lower(public.f_unaccent(coalesce(m.nombre, ''))), '[^a-z0-9 ]', '', 'g') LIKE ALL (v_pats)
    ) x
    WHERE x.s > 0
    LIMIT least(greatest(coalesce(p_tope, 15), 1), 100)), '[]'::json);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_medicos_ids(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_medicos_ids(text, text, integer) TO authenticated, service_role;

-- Las notificaciones propias (RLS) que coinciden, desde `p_desde`. La pantalla
-- las pagina con `.in('id', …)`: el tope de 500 queda en la URL a la mitad de
-- lo que PostgREST acepta y es más de lo que la pantalla muestra.
CREATE OR REPLACE FUNCTION public.notificaciones_que_coinciden(p_q text, p_desde timestamptz)
RETURNS json
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_tok  jsonb  := public.busqueda_palabras(p_q);
  v_pats text[] := public.busqueda_patrones_legados(public.busqueda_palabras(p_q));
BEGIN
  IF v_pats IS NULL THEN RETURN '[]'::json; END IF;
  RETURN coalesce((
    SELECT json_agg(x.id)
    FROM (
      SELECT n.id
      FROM public.notifications n
      WHERE n.created_at >= p_desde
        AND regexp_replace(lower(public.f_unaccent(coalesce(n.title, '') || ' ' || coalesce(n.body, ''))), '[^a-z0-9 ]', '', 'g') LIKE ALL (v_pats)
        AND public.busqueda_coincide(v_tok, coalesce(n.title, '') || ' ' || coalesce(n.body, ''))
      ORDER BY n.created_at DESC
      LIMIT 500
    ) x), '[]'::json);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notificaciones_que_coinciden(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notificaciones_que_coinciden(text, timestamptz) TO authenticated, service_role;
