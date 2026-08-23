-- Mín·Máx: buscar un código de barras lanzaba un error.
--
-- Bug propio de v2.714.1, vivo desde ayer y encontrado al verificar el trabajo:
--
--   ERROR: operator does not exist: integer = integer[]
--
-- La línea era `p.id = ANY ((SELECT public.productos_por_codigo(p_search)))`.
-- Ese paréntesis de más NO hace lo que parece: `ANY` tiene dos formas —contra un
-- ARRAY y contra una SUBCONSULTA— y con `(SELECT …)` adentro Postgres elige la
-- de subconsulta, o sea que compara `integer` contra las FILAS que devuelve, y
-- cada fila es un `integer[]`. El paréntesis se había puesto justamente para
-- forzar la evaluación única (el initplan de la regla de las policies), y
-- terminó eligiendo la otra gramática.
--
-- Sólo se disparaba al buscar algo que PARECE un código y que además no dio
-- resultados por nombre —las dos condiciones de esa rama—, así que buscar
-- «amoxicilina» siempre anduvo bien y el error esperaba a que alguien escaneara.
--
-- La forma correcta en plpgsql es una VARIABLE: se evalúa una vez por llamada
-- (que era el objetivo del paréntesis), es `integer[]` sin ambigüedad, y se lee.
-- Es lo que ya hacía `inventory_grouped` con su `v_cods`; acá quedó a mitad de
-- camino. Las otras dos que resuelven códigos estaban bien:
-- `buscar_inventario_global_v2` lo pasa por un CTE con columna de tipo array, y
-- `get_product_sales_agg` usa `IN (SELECT …)`, que no tiene esta ambigüedad.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.buscar_productos_minmax(p_search text, p_limit integer DEFAULT 20)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_q    text := public.norm_search(p_search);
  v_pats text[];
  v_out  json;
  -- Una variable, no un `(SELECT …)` incrustado: se evalúa una vez por llamada
  -- y su tipo es inequívocamente `integer[]`. Ver el encabezado de la migración.
  v_cods int[];
BEGIN
  SELECT array_agg('%' || tok || '%') INTO v_pats
  FROM unnest(string_to_array(v_q, ' ')) AS tok
  WHERE tok <> '';

  IF v_pats IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT coalesce(json_agg(to_json(f) ORDER BY f.nombre), '[]'::json) INTO v_out
  FROM (
    SELECT p.id, p.nombre, p.foto_url, p.principio_activo,
           l.nombre AS laboratorio_nombre
    FROM public.products p
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    WHERE p.activo
      AND (coalesce(p.nombre_norm, '') || ' ' || coalesce(p.pactivo_norm, '') || ' '
           || coalesce(public.norm_search(l.nombre), '')) LIKE ALL (v_pats)
    ORDER BY p.nombre
    LIMIT p_limit
  ) f;

  -- Por código: sólo si el término lo parece, y sólo si por nombre no salió
  -- nada. Un código no compite con un nombre — o es uno o es el otro.
  IF json_array_length(v_out) = 0 AND public.es_busqueda_de_codigo(p_search) THEN
    v_cods := public.productos_por_codigo(p_search);
    SELECT coalesce(json_agg(to_json(f) ORDER BY f.nombre), '[]'::json) INTO v_out
    FROM (
      SELECT p.id, p.nombre, p.foto_url, p.principio_activo,
             l.nombre AS laboratorio_nombre
      FROM public.products p
      LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
      WHERE p.activo AND p.id = ANY (v_cods)
      ORDER BY p.nombre
      LIMIT p_limit
    ) f;
  END IF;

  IF json_array_length(v_out) > 0 OR length(v_q) < 4 THEN
    RETURN v_out;
  END IF;

  -- `json_build_object` y no `to_json(f)`: el parecido se necesita para
  -- ordenar y no tiene por qué viajar al navegador.
  SELECT coalesce(json_agg(json_build_object(
             'id',                 f.id,
             'nombre',             f.nombre,
             'foto_url',           f.foto_url,
             'principio_activo',   f.principio_activo,
             'laboratorio_nombre', f.laboratorio_nombre)
           ORDER BY f.sim DESC, f.nombre), '[]'::json) INTO v_out
  FROM (
    SELECT p.id, p.nombre, p.foto_url, p.principio_activo,
           l.nombre AS laboratorio_nombre,
           public.word_similarity(v_q, p.nombre_norm) AS sim
    FROM public.products p
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    WHERE p.activo
      AND public.word_similarity(v_q, p.nombre_norm) >= 0.65
    ORDER BY sim DESC, p.nombre
    LIMIT p_limit
  ) f;

  RETURN v_out;
END;
$function$;
