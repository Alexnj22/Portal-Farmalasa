SET lock_timeout = '5s';

-- Al buscar, los laboratorios cuyo nombre coincide (con su logo) viajan con la
-- primera tanda. Coincide desde el inicio de una palabra. Parte de la definición viva.
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.app_catalogo(text,integer,integer)'::regprocedure);
  v_a text := $t$FROM json_array_elements_text((public.buscar_productos_ids(v_q, 200, true, true, true))->'ids') x;$t$;
  v_b text := $t$'laboratorios', coalesce(v_labs, '[]'::json));$t$;
BEGIN
  IF position(v_a IN v_def) = 0 OR position(v_b IN v_def) = 0 OR position('v_labs json;' IN v_def) = 0 THEN
    RAISE EXCEPTION 'app_catalogo cambió: no se encontraron los puntos esperados';
  END IF;
  v_def := replace(v_def, 'v_labs json;', E'v_labs json;\n  v_encontrados json;');
  v_def := replace(v_def, v_a, v_a || $t$
    IF coalesce(p_desde, 0) = 0 THEN
      SELECT json_agg(json_build_object('id', z.id, 'nombre', z.nombre, 'foto', z.foto) ORDER BY z.n DESC, z.nombre) INTO v_encontrados FROM (
        SELECT l.id, trim(regexp_replace(l.nombre, '^[0-9]+\s*-\s*', '')) AS nombre, l.foto, count(*) AS n
          FROM public.laboratorios l
          JOIN public.products p ON p.laboratorio_id = l.id
         WHERE position(' ' || upper(public.f_unaccent(v_q)) IN ' ' || upper(public.f_unaccent(trim(regexp_replace(l.nombre, '^[0-9]+\s*-\s*', ''))))) > 0
           AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
           AND NOT EXISTS (SELECT 1 FROM public.app_catalogo_ocultos o WHERE o.product_id = p.id)
         GROUP BY 1, 2, 3
         ORDER BY n DESC, 2
         LIMIT 6) z;
    END IF;$t$);
  v_def := replace(v_def, v_b, $t$'laboratorios', coalesce(v_labs, '[]'::json),
    'labs_encontrados', coalesce(v_encontrados, '[]'::json));$t$);
  EXECUTE v_def;
END $do$;
