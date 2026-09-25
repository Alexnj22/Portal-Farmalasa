-- Clientes busca con la regla del portal (docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md).
--
-- Antes había tres reglas para la misma tabla:
--   · /clientes (`get_customers_page`): tokens contra `search_name` —un
--     `translate` que quita tildes pero NO la puntuación— y contra los
--     identificadores con `lower`.
--   · el widget de anulación: un `.or()` con `ilike` sobre las mismas columnas.
--   · cotizaciones: `ilike` de la frase entera sobre `name`, sin quitar tildes.
--
-- `customers` no es tabla caliente, pero la escribe el sync de ventas. Las
-- columnas nuevas reescriben 28,400 filas. El nombre va con la regla completa
-- (norm_busqueda) y los identificadores sólo sin
-- tildes, en minúsculas y con la puntuación como espacio (así «102» es una
-- palabra en «0614-150385-102-3») y como nada (así «06141503851023» está
-- entero), con funciones nativas. Con la regla completa en
-- los identificadores el cálculo medía 2.5 s de tabla bloqueada; así, 1.1 s.
SET lock_timeout = '5s';

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS nombre_busq text GENERATED ALWAYS AS (public.norm_busqueda(name)) STORED,
  ADD COLUMN IF NOT EXISTS nombre_comp text GENERATED ALWAYS AS (public.compactar_busqueda(name)) STORED,
  ADD COLUMN IF NOT EXISTS ids_busq    text GENERATED ALWAYS AS (
    btrim(regexp_replace(lower(public.f_unaccent(coalesce(nit, '') || ' ' || coalesce(dui, '') || ' ' || coalesce(nrc, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(telefono2, '') || ' ' || coalesce(email, '') || ' ' || coalesce(erp_id, ''))), '[^a-z0-9]+', ' ', 'g'))) STORED,
  ADD COLUMN IF NOT EXISTS ids_comp    text GENERATED ALWAYS AS (
    btrim(regexp_replace(lower(public.f_unaccent(coalesce(nit, '') || ' ' || coalesce(dui, '') || ' ' || coalesce(nrc, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(telefono2, '') || ' ' || coalesce(email, '') || ' ' || coalesce(erp_id, ''))), '[^a-z0-9 ]', '', 'g'))) STORED;

-- El prefiltro: todas las formas juntas, con índice de trigramas.
CREATE INDEX IF NOT EXISTS idx_customers_busq_trgm
  ON public.customers USING gin ((nombre_busq || ' ' || nombre_comp || ' ' || ids_busq || ' ' || ids_comp) public.gin_trgm_ops);

-- La búsqueda de clientes, una sola: (id, puntaje, aproximado). El nombre va
-- primero (el «empieza con» cuenta sólo ahí) y después los identificadores.
-- Todo sobre columnas YA normalizadas: nada se normaliza por fila.
CREATE OR REPLACE FUNCTION public.busqueda_clientes(p_q text)
RETURNS TABLE(id bigint, puntaje numeric, aproximado boolean)
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
#variable_conflict use_column
DECLARE
  v_tok  jsonb := public.busqueda_palabras(p_q);
  v_pats text[];
  v_n    int;
BEGIN
  IF jsonb_array_length(v_tok) = 0 THEN RETURN; END IF;
  v_pats := public.busqueda_prefiltro(v_tok);

  RETURN QUERY
  SELECT x.id, x.s, false
  FROM (
    SELECT c.id,
           public.busqueda_puntaje(v_tok, ARRAY[c.nombre_busq, c.ids_busq],
                                          ARRAY[c.nombre_comp, c.ids_comp])::numeric AS s
    FROM public.customers c
    WHERE (c.nombre_busq || ' ' || c.nombre_comp || ' ' || c.ids_busq || ' ' || c.ids_comp) ~ ALL (v_pats)
  ) x
  WHERE x.s > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RETURN; END IF;

  -- Aproximada, sólo sobre el NOMBRE (un NIT o un teléfono no se «parecen»:
  -- son o no son). Los trigramas eligen a los 300 más cercanos; el parecido
  -- exacto —el mismo de JS— decide.
  RETURN QUERY
  SELECT x.id, x.s * 50, true
  FROM (
    SELECT c.id,
           public.busqueda_parecido(v_tok, ARRAY[c.nombre_busq], ARRAY[c.nombre_comp]) AS s
    FROM (
      SELECT c0.id, c0.nombre_busq, c0.nombre_comp
      FROM public.customers c0
      WHERE public.word_similarity(public.norm_busqueda(p_q), c0.nombre_busq) >= 0.3
      ORDER BY public.word_similarity(public.norm_busqueda(p_q), c0.nombre_busq) DESC
      LIMIT 300
    ) c
  ) x
  WHERE x.s >= 0.75;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.busqueda_clientes(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.busqueda_clientes(text) TO authenticated, service_role;

-- Para los selectores de cliente (anulación, cotizaciones): los ids ya
-- ordenados por relevancia. INVOKER: el RLS de `customers` sigue decidiendo.
CREATE OR REPLACE FUNCTION public.buscar_clientes_ids(p_q text, p_limite integer DEFAULT 30)
RETURNS json
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_ids json;
  v_ap  boolean;
BEGIN
  SELECT json_agg(x.id ORDER BY x.puntaje DESC, x.name), bool_or(x.aproximado) INTO v_ids, v_ap
  FROM (
    SELECT b.id, b.puntaje, b.aproximado, c.name
    FROM public.busqueda_clientes(p_q) b
    JOIN public.customers c ON c.id = b.id
    ORDER BY b.puntaje DESC, c.name
    LIMIT least(greatest(coalesce(p_limite, 30), 1), 200)
  ) x;
  RETURN json_build_object('ids', coalesce(v_ids, '[]'::json), 'aproximado', coalesce(v_ap, false));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_clientes_ids(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_clientes_ids(text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_customers_page(p_search text DEFAULT NULL::text, p_categoria text DEFAULT NULL::text, p_departamento text DEFAULT NULL::text, p_municipio text DEFAULT NULL::text, p_ficha text DEFAULT NULL::text, p_erp text DEFAULT NULL::text, p_actividad text DEFAULT NULL::text, p_revisar text DEFAULT NULL::text, p_mostrador text DEFAULT NULL::text, p_sort text DEFAULT 'nombre'::text, p_dir text DEFAULT 'asc'::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tokens   text[];
  v_ids      bigint[];
  v_puntajes numeric[];
  v_aprox    boolean := false;
  v_orden    text;
  v_dup_cte  text := '';
  v_dup_col  text := 'NULL::text';
  v_dup_join text := '';
  v_res      json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('clientes', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- La búsqueda con la regla del portal (docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md),
  -- resuelta UNA vez por `busqueda_clientes`: ids, su puntaje y si es
  -- aproximada. Antes eran tokens contra `search_name` (un `translate` que NO
  -- quitaba la puntuación: «S.A.» no encontraba «SA») y contra los
  -- identificadores con `lower`, cada uno con su propia regla.
  -- `v_tokens` queda como la marca de «hay búsqueda» ($1).
  v_tokens := CASE
    WHEN nullif(btrim(coalesce(p_search, '')), '') IS NULL THEN NULL
    ELSE ARRAY[btrim(p_search)]
  END;
  IF v_tokens IS NOT NULL THEN
    SELECT coalesce(array_agg(b.id), '{}'), coalesce(array_agg(b.puntaje), '{}'), coalesce(bool_or(b.aproximado), false)
      INTO v_ids, v_puntajes, v_aprox
      FROM public.busqueda_clientes(p_search) b;
  END IF;

  -- El bloque de duplicados se INYECTA en el texto del query, no se deja como
  -- un `WHERE $8 = 'duplicado'` que el plan tendría que descartar: con un plan
  -- genérico ese predicado no se pliega y las 24,506 se ordenarían igual en cada
  -- consulta (mismo motivo por el que este módulo materializa a mano, ver
  -- `feedback_sql_function_generic_plans`). Si el filtro no está activo, el SQL
  -- ni menciona la palabra.
  IF p_revisar = 'duplicado' THEN
    v_dup_cte := $c$
      claves AS MATERIALIZED (
        SELECT c2.id, c2.name,
               (SELECT string_agg(t, ' ' ORDER BY t)
                  FROM unnest(regexp_split_to_array(btrim(c2.search_name), '\s+')) t) AS clave
        FROM public.customers c2
        -- Los tres baldes de mostrador comparten tokens entre sí y con nadie
        -- más: incluirlos sería 3 falsos positivos garantizados.
        WHERE NOT public.es_cliente_mostrador(c2.name, c2.erp_id)
      ),
      dup AS MATERIALIZED (
        SELECT k.id,
               -- Con quién choca. Sin esto el operador ve 86 filas sueltas y
               -- tiene que buscar a mano cuál es el par de cuál.
               (SELECT string_agg(o.name || ' (#' || o.id || ')', ' · ' ORDER BY o.id)
                  FROM claves o WHERE o.clave = k.clave AND o.id <> k.id) AS dup_con
        FROM claves k
        WHERE EXISTS (SELECT 1 FROM claves e WHERE e.clave = k.clave AND e.id <> k.id)
      ),
    $c$;
    v_dup_col  := 'd.dup_con';
    v_dup_join := 'JOIN dup d ON d.id = c.id';
  END IF;

  -- Lista blanca: el orden se arma con `format`, así que la única forma de que
  -- no sea inyectable es que `p_sort`/`p_dir` no lleguen nunca crudos al SQL.
  -- Clientes es un CATÁLOGO: con búsqueda y el orden por defecto, lo más
  -- parecido primero (plan §8.1). Si el usuario eligió otra columna, manda ella.
  v_orden := CASE WHEN v_tokens IS NOT NULL AND coalesce(p_sort, 'nombre') = 'nombre'
                       AND upper(coalesce(p_dir, 'asc')) <> 'DESC'
                  THEN '_puntaje DESC NULLS LAST, name ASC'
                  ELSE NULL END;
  v_orden := coalesce(v_orden, CASE p_sort
        WHEN 'facturas' THEN 'facturas'
        WHEN 'total'    THEN 'total'
        WHEN 'ultima'   THEN 'ultima_fecha'
        WHEN 'ficha'    THEN 'ficha'
        ELSE 'name'
      END
      || CASE WHEN upper(coalesce(p_dir, 'asc')) = 'DESC'
              THEN ' DESC NULLS LAST' ELSE ' ASC NULLS LAST' END
      -- Desempate estable: sin él, dos fichas con la misma facturación bailan
      -- de lugar entre páginas y la paginación repite o se salta filas.
      || ', name ASC');

  EXECUTE format($q$
    WITH %s filtrados AS MATERIALIZED (
      SELECT
        c.id, c.name, c.erp_id, c.nit, c.dui, c.nrc, c.pasaporte,
        c.phone, c.telefono2, c.email, c.direccion,
        c.departamento, c.municipio, c.distrito, c.categoria, c.giro,
        c.retencion_pct, c.updated_at,
        public.customer_ficha_estado(c.categoria, c.nit, c.dui, c.nrc,
            c.pasaporte, c.phone, c.direccion, c.giro)                    AS ficha,
        public.es_cliente_mostrador(c.name, c.erp_id)                     AS mostrador,
        (c.dui IS NOT NULL
         AND (length(regexp_replace(c.dui, '\D', '', 'g')) <> 9
              OR NOT public.es_dui_valido(c.dui)))                        AS dui_sospechoso,
        (NOT public.es_telefono_sv_valido(c.phone))                       AS tel_sospechoso,
        -- Dos formas de que el nombre no sirva: importado con la codificación
        -- rota ("MUÃ±OZ" por "MUÑOZ", 15 fichas) o sin una sola letra ("....",
        -- "1111111111111", 3 fichas). El ojo no distingue ni una ni otra en una
        -- lista larga.
        (c.name ~ '[ÃÂÄÅ]'
         OR c.name !~ '[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]')                           AS nombre_corrupto,
        %s                                                                AS dup_con,
        coalesce(a.facturas, 0)                                           AS facturas,
        coalesce(a.facturas_ccf, 0)                                       AS facturas_ccf,
        coalesce(a.facturas_anuladas, 0)                                  AS facturas_anuladas,
        coalesce(a.total, 0)                                              AS total,
        a.primera_fecha, a.ultima_fecha,
        bq.puntaje                                                        AS _puntaje
      FROM public.customers c
      LEFT JOIN public.customer_activity a ON a.customer_id = c.id
      LEFT JOIN unnest($12::bigint[], $13::numeric[]) AS bq(id, puntaje) ON bq.id = c.id
      %s
      WHERE
        -- La búsqueda ya resuelta (`busqueda_clientes`): $12/$13.
        ($1 IS NULL OR bq.id IS NOT NULL)
        AND ($2 IS NULL OR CASE WHEN $2 = '__sin__'
                                THEN c.categoria IS NULL
                                ELSE c.categoria = $2 END)
        AND ($3 IS NULL OR c.departamento = $3)
        AND ($4 IS NULL OR c.municipio    = $4)
        AND ($5 IS NULL OR public.customer_ficha_estado(c.categoria, c.nit, c.dui,
                c.nrc, c.pasaporte, c.phone, c.direccion, c.giro) = $5)
        AND ($6 IS NULL OR CASE WHEN $6 = 'con' THEN c.erp_id IS NOT NULL
                                ELSE c.erp_id IS NULL END)
        AND ($7 IS NULL OR CASE WHEN $7 = 'con' THEN coalesce(a.facturas, 0) > 0
                                ELSE coalesce(a.facturas, 0) = 0 END)
        -- 'duplicado' cae en el ELSE a propósito: ahí filtra el JOIN, no esto.
        AND ($8 IS NULL OR CASE $8
               WHEN 'dui'      THEN c.dui IS NOT NULL
                                AND (length(regexp_replace(c.dui, '\D', '', 'g')) <> 9
                                     OR NOT public.es_dui_valido(c.dui))
               WHEN 'telefono' THEN NOT public.es_telefono_sv_valido(c.phone)
               WHEN 'nombre'   THEN c.name ~ '[ÃÂÄÅ]'
                                 OR c.name !~ '[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]'
               ELSE true END)
        AND ($9 IS DISTINCT FROM 'sin' OR NOT public.es_cliente_mostrador(c.name, c.erp_id))
    )
    SELECT json_build_object(
      'total', (SELECT count(*) FROM filtrados),
      'aproximado', $14,
      'rows',  coalesce((
                 SELECT json_agg(to_json(p))
                 FROM (SELECT * FROM filtrados ORDER BY %s LIMIT $10 OFFSET $11) p
               ), '[]'::json))
  $q$, v_dup_cte, v_dup_col, v_dup_join, v_orden)
  INTO v_res
  USING v_tokens, p_categoria, p_departamento, p_municipio, p_ficha,
        p_erp, p_actividad, p_revisar, nullif(p_mostrador, ''),
        greatest(coalesce(p_limit, 25), 1), greatest(coalesce(p_offset, 0), 0),
        v_ids, v_puntajes, v_aprox;

  RETURN v_res;
END;
$function$;
