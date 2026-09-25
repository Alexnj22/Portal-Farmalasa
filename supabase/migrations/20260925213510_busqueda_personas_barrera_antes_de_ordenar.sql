-- Personas (solicitudes de datos) seguía leyendo 225 MB como USUARIO aunque
-- como postgres ya eran 9: con el RLS de `customers`, el ORDER BY name LIMIT 20
-- recorría las fichas en orden de nombre. Una barrera (OFFSET 0) junta primero
-- las que coinciden. Ensayado con reversión: 7 casos, resultados idénticos.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.buscar_personas_por_nombre(p_nombre text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_tok  jsonb  := public.busqueda_palabras(p_nombre);
  v_pats text[] := public.busqueda_patrones_legados(public.busqueda_palabras(p_nombre));
  v_pre  text[] := public.busqueda_prefiltro(public.busqueda_palabras(p_nombre));
  v_idx  text   := public.busqueda_la_mas_larga(public.busqueda_prefiltro(public.busqueda_palabras(p_nombre)));
BEGIN
  IF v_pats IS NULL THEN
    RETURN json_build_object('clientes', '[]'::json, 'practicantes', '[]'::json,
                             'proveedores', '[]'::json, 'recetas', '[]'::json);
  END IF;
  RETURN json_build_object(
    'clientes', coalesce((
      SELECT json_agg(x.id) FROM (
        SELECT y.id FROM (
          SELECT c.id, c.name FROM public.customers c
          WHERE (c.nombre_busq || ' ' || c.nombre_comp || ' ' || c.ids_busq || ' ' || c.ids_comp) ~ v_idx
            AND (c.nombre_busq || ' ' || c.nombre_comp) ~ ALL (v_pre)
            AND public.busqueda_puntaje(v_tok, ARRAY[c.nombre_busq], ARRAY[c.nombre_comp]) > 0
          -- La barrera es lo que importa. Sin ella, con el RLS de `customers`
          -- el planificador recorría las fichas en orden de nombre hasta
          -- juntar 20 —o sea TODAS cuando no hay ninguna—: 225 MB por llamada
          -- como usuario (medido con `medir:como-usuario`; como `postgres`
          -- eran 9). Con ella se juntan las que coinciden y recién después se
          -- ordenan: ~16 MB en el peor caso.
          OFFSET 0) y
        ORDER BY y.name LIMIT 20) x), '[]'::json),
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
$function$;
