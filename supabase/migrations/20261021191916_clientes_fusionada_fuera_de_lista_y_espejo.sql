-- La ficha fusionada (deshabilitada) no se lista en Clientes ni recibe el
-- espejo del sistema de origen. Parten de su definición VIVA del 2026-10-21.
SET lock_timeout = '5s';

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
          AND c2.deshabilitada_at IS NULL
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
        -- Una ficha fusionada no se lista: vive en la principal.
        c.deshabilitada_at IS NULL AND
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

CREATE OR REPLACE FUNCTION public.aplicar_espejo_erp(p_filas json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_resultado json;
BEGIN
  WITH filas AS (
    SELECT lower(translate(x.match_name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun')) AS match_name,
           -- 'portal:123' o '123'. Nulo cuando el llamador no sabe el id.
           nullif(regexp_replace(coalesce(x.id, ''), '^portal:', ''), '')::bigint AS customer_id,
           x.erp_id, x.nit, x.dui, x.nrc, x.phone, x.telefono2, x.email,
           x.direccion, x.pasaporte, x.departamento, x.municipio, x.distrito,
           x.categoria, x.giro, x.retencion_pct
    FROM json_to_recordset(p_filas) AS x(
        id            text,
        match_name    text, erp_id text, nit text, dui text, nrc text,
        phone         text, telefono2 text, email text, direccion text,
        pasaporte     text, departamento text, municipio text, distrito text,
        categoria     text, giro text, retencion_pct smallint)
  -- El control de ambigüedad sigue siendo por nombre, pero SOLO para las que
  -- se van a resolver por nombre: dos filas con el mismo nombre y distinto
  -- customer_id no son ambiguas, son dos clientes distintos ya identificados.
  ), conteo AS (
    SELECT match_name, count(*) AS n FROM filas WHERE customer_id IS NULL GROUP BY 1
  ), unicas AS (
    SELECT f.* FROM filas f
    LEFT JOIN conteo c USING (match_name)
    WHERE f.customer_id IS NOT NULL OR c.n = 1
  ), pendientes AS (
    SELECT customer_id, campo,
           (array_agg(valor_anterior ORDER BY changed_at,      id     ))[1] AS valor_base,
           (array_agg(valor_nuevo    ORDER BY changed_at DESC, id DESC))[1] AS valor_portal,
           (array_agg(id             ORDER BY changed_at DESC, id DESC))[1] AS changelog_id
    FROM public.customers_changelog
    WHERE erp_synced_at IS NULL AND descartado_at IS NULL
    GROUP BY customer_id, campo
  ), prot AS (
    SELECT customer_id,
           jsonb_object_agg(campo, jsonb_build_object(
               'base', valor_base, 'portal', valor_portal)) AS campos
    FROM pendientes GROUP BY customer_id
  ), objetivo AS (
    SELECT c.id AS customer_id, e.match_name, e.erp_id, e.nit, e.dui, e.nrc,
           e.phone, e.telefono2, e.email, e.direccion, e.pasaporte,
           e.departamento, e.municipio, e.distrito, e.categoria, e.giro,
           e.retencion_pct,
           coalesce(p.campos, '{}'::jsonb) AS prot
    FROM unicas e
    -- El id manda si vino; si no, el nombre normalizado, como siempre.
    JOIN public.customers c
      ON ((e.customer_id IS NOT NULL AND c.id = e.customer_id)
      OR (e.customer_id IS NULL AND c.search_name = e.match_name))
      -- Una ficha fusionada no recibe el espejo: le daría un número que ya
      -- tiene la principal.
     AND c.deshabilitada_at IS NULL
    LEFT JOIN prot p ON p.customer_id = c.id
  ), entrantes AS (
    SELECT o.customer_id, v.campo, v.valor
    FROM objetivo o
    CROSS JOIN LATERAL (VALUES
        ('nit', o.nit), ('dui', o.dui), ('nrc', o.nrc), ('phone', o.phone),
        ('telefono2', o.telefono2), ('email', o.email),
        ('direccion', o.direccion), ('pasaporte', o.pasaporte),
        ('departamento', o.departamento), ('municipio', o.municipio),
        ('distrito', o.distrito), ('categoria', o.categoria),
        ('giro', o.giro), ('retencion_pct', o.retencion_pct::text)
    ) AS v(campo, valor)
  ), conflictos AS (
    SELECT en.customer_id, pe.changelog_id, en.campo,
           pe.valor_base, pe.valor_portal, en.valor AS valor_erp
    FROM entrantes en
    JOIN pendientes pe ON pe.customer_id = en.customer_id AND pe.campo = en.campo
    WHERE en.valor IS NOT NULL
      AND en.valor IS DISTINCT FROM pe.valor_base
  ), calculado AS (
    SELECT o.customer_id,
           coalesce(o.erp_id, c.erp_id) AS erp_id,
           public.espejo_valor(o.nit,          c.nit,          o.prot, 'nit')          AS nit,
           public.espejo_valor(o.dui,          c.dui,          o.prot, 'dui')          AS dui,
           public.espejo_valor(o.nrc,          c.nrc,          o.prot, 'nrc')          AS nrc,
           public.espejo_valor(o.phone,        c.phone,        o.prot, 'phone')        AS phone,
           public.espejo_valor(o.telefono2,    c.telefono2,    o.prot, 'telefono2')    AS telefono2,
           public.espejo_valor(o.email,        c.email,        o.prot, 'email')        AS email,
           public.espejo_valor(o.direccion,    c.direccion,    o.prot, 'direccion')    AS direccion,
           public.espejo_valor(o.pasaporte,    c.pasaporte,    o.prot, 'pasaporte')    AS pasaporte,
           public.espejo_valor(o.departamento, c.departamento, o.prot, 'departamento') AS departamento,
           public.espejo_valor(o.municipio,    c.municipio,    o.prot, 'municipio')    AS municipio,
           public.espejo_valor(o.distrito,     c.distrito,     o.prot, 'distrito')     AS distrito,
           public.espejo_valor(o.categoria,    c.categoria,    o.prot, 'categoria')    AS categoria,
           public.espejo_valor(o.giro,         c.giro,         o.prot, 'giro')         AS giro,
           public.espejo_valor(o.retencion_pct::text, c.retencion_pct::text,
                               o.prot, 'retencion_pct')::smallint                      AS retencion_pct
    FROM objetivo o
    JOIN public.customers c ON c.id = o.customer_id
  ), ins AS (
    INSERT INTO public.espejo_conflictos
        (customer_id, changelog_id, campo, valor_base, valor_portal, valor_erp)
    SELECT customer_id, changelog_id, campo, valor_base, valor_portal, valor_erp
    FROM conflictos
    RETURNING 1
  ), saldadas AS (
    UPDATE public.customers_changelog cl
       SET descartado_at = now()
      FROM conflictos k
     WHERE cl.customer_id = k.customer_id
       AND cl.campo = k.campo
       AND cl.erp_synced_at IS NULL
       AND cl.descartado_at IS NULL
    RETURNING 1
  ), upd AS (
    UPDATE public.customers c SET
        erp_id = k.erp_id, nit = k.nit, dui = k.dui, nrc = k.nrc,
        phone = k.phone, telefono2 = k.telefono2, email = k.email,
        direccion = k.direccion, pasaporte = k.pasaporte,
        departamento = k.departamento, municipio = k.municipio,
        distrito = k.distrito, categoria = k.categoria, giro = k.giro,
        retencion_pct = k.retencion_pct, updated_at = now()
    FROM calculado k
    WHERE c.id = k.customer_id
      AND (c.erp_id, c.nit, c.dui, c.nrc, c.phone, c.telefono2, c.email,
           c.direccion, c.pasaporte, c.departamento, c.municipio, c.distrito,
           c.categoria, c.giro, c.retencion_pct)
          IS DISTINCT FROM
          (k.erp_id, k.nit, k.dui, k.nrc, k.phone, k.telefono2, k.email,
           k.direccion, k.pasaporte, k.departamento, k.municipio, k.distrito,
           k.categoria, k.giro, k.retencion_pct)
    RETURNING 1
  )
  SELECT json_build_object(
    'recibidas',           (SELECT count(*) FROM filas),
    'duplicadas_omitidas', (SELECT coalesce(sum(n), 0) FROM conteo WHERE n > 1),
    'actualizadas',        (SELECT count(*) FROM upd),
    'sin_cambio',          (SELECT count(*) FROM objetivo) - (SELECT count(*) FROM upd),
    'por_id',              (SELECT count(*) FROM unicas WHERE customer_id IS NOT NULL),
    'campos_protegidos',   (SELECT count(*) FROM entrantes en
                            JOIN pendientes pe ON pe.customer_id = en.customer_id
                                              AND pe.campo = en.campo
                            WHERE en.valor IS NOT DISTINCT FROM pe.valor_base),
    'conflictos',          (SELECT count(*) FROM ins),
    'entradas_descartadas',(SELECT count(*) FROM saldadas),
    'sin_match',           (SELECT count(*) FROM unicas e
                            WHERE NOT EXISTS (
                              SELECT 1 FROM public.customers c
                              WHERE ((e.customer_id IS NOT NULL AND c.id = e.customer_id)
                                 OR (e.customer_id IS NULL AND c.search_name = e.match_name))
                                AND c.deshabilitada_at IS NULL))
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$function$;
