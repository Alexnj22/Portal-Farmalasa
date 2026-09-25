-- Medido como usuario (npm run medir:como-usuario, 47 búsquedas × 3 identidades):
-- dos búsquedas recorrían tablas enteras sin índice.
--
-- 1. Ventas: el `LIKE` que entra por el índice de trigramas era la PRIMERA
--    pieza de la búsqueda, no la más larga. «jo perez» entraba por «%jo%» —dos
--    caracteres, el índice necesita tres— y recorría las 180,000 facturas del
--    año: 9,715 ms. Y «2.5» queda en «%25%» sin ninguna pieza que alcance:
--    10,022 ms para no encontrar nada en el texto de las facturas. Ahora entra
--    la más larga, y si ninguna llega a 3 caracteres sólo se busca por
--    producto: 284 ms y 36 ms, mismos resultados.
-- 2. Personas (solicitudes de datos) y clientes: `~ ALL (arreglo)` no entra al
--    índice de trigramas de `customers`; se agrega un patrón solo sobre la
--    MISMA expresión del índice. Personas sin coincidencia: 225 MB → 13
--    bloques.
--
-- Ensayado en producción dentro de una transacción revertida: 28 casos,
-- resultados idénticos (huella md5) antes y después.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.busqueda_la_mas_larga(p_pats text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'extensions'
AS $function$
  -- El patrón con más caracteres literales: el que más recorta por el índice
  -- de trigramas. Las clases `[...]` y los signos de la expresión no cuentan.
  SELECT x
    FROM unnest(p_pats) WITH ORDINALITY u(x, i)
   ORDER BY length(regexp_replace(regexp_replace(x, '\[[^]]*\]', '', 'g'), '[^a-z0-9]', '', 'g')) DESC, i
   LIMIT 1;
$function$;
REVOKE EXECUTE ON FUNCTION public.busqueda_la_mas_larga(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.busqueda_la_mas_larga(text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.busqueda_productos(
  p_q text,
  p_con_pactivo boolean DEFAULT false,
  p_con_laboratorio boolean DEFAULT false,
  p_solo_activos boolean DEFAULT true,
  -- false = sólo la exacta. Para quien la necesita sola (Ventas) y no puede
  -- pagar la aproximada: sin coincidencia exacta, ésta recorría el catálogo.
  p_con_aproximada boolean DEFAULT true
)
RETURNS TABLE(id integer, puntaje numeric, aproximado boolean)
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
#variable_conflict use_column
DECLARE
  v_tok  jsonb := public.busqueda_palabras(p_q);
  v_pats text[];
  v_idx  text;
  v_n    int;
BEGIN
  IF jsonb_array_length(v_tok) = 0 THEN RETURN; END IF;
  v_pats := public.busqueda_prefiltro(v_tok);
  v_idx  := public.busqueda_la_mas_larga(v_pats);

  -- Exacta
  RETURN QUERY
  WITH labs AS (
    SELECT l.id AS lab_id, public.norm_busqueda(l.nombre) lb, public.compactar_busqueda(l.nombre) lc
    FROM public.laboratorios l
    WHERE p_con_laboratorio
  ),
  cand AS (
    SELECT p.id AS pid,
           public.busqueda_puntaje(v_tok,
             ARRAY[p.nombre_busq, CASE WHEN p_con_pactivo THEN p.pactivo_busq END, lb.lb, p.codigo_barras],
             ARRAY[p.nombre_comp, CASE WHEN p_con_pactivo THEN p.pactivo_comp END, lb.lc, p.codigo_barras])::numeric AS s
    FROM public.products p
    LEFT JOIN labs lb ON lb.lab_id = p.laboratorio_id
    WHERE (NOT p_solo_activos OR p.activo)
      -- La palabra más larga sola, como expresión simple, entra por el índice de
      -- trigramas (`~ ALL (arreglo)` no puede): 9 ms → 5 en «amoxicilina».
      -- Con el laboratorio en la búsqueda no vale —puede coincidir sólo ahí— y
      -- se deja pasar.
      AND (p_con_laboratorio OR p.busq_todo ~ v_idx)
      AND (p.busq_todo || coalesce(' ' || lb.lb || ' ' || lb.lc, '')) ~ ALL (v_pats)
  )
  SELECT c.pid, c.s, false FROM cand c WHERE c.s > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 OR NOT p_con_aproximada THEN RETURN; END IF;

  -- Aproximada: sólo si lo exacto no trajo nada. Los trigramas ELIGEN
  -- candidatos con un umbral bajo a propósito («dicloefnac» contra DICLOFENAC
  -- da 0.47); el parecido exacto —el mismo de JS— decide. Puntaje 0–47.5 para
  -- que nunca empate con una exacta (≥ 60).
  RETURN QUERY
  WITH labs AS (
    SELECT l.id AS lab_id, public.norm_busqueda(l.nombre) lb, public.compactar_busqueda(l.nombre) lc
    FROM public.laboratorios l
    WHERE p_con_laboratorio
  ),
  -- Los 300 más cercanos por trigramas, y sobre ésos el parecido exacto:
  -- con un umbral de 0.3 pasaban cientos, y el parecido es caro por fila.
  cerca AS (
    SELECT p.id, p.nombre_busq, p.pactivo_busq, p.nombre_comp, p.pactivo_comp,
           p.codigo_barras, p.laboratorio_id
    FROM public.products p
    WHERE (NOT p_solo_activos OR p.activo)
      AND public.word_similarity(public.norm_busqueda(p_q), p.busq_todo) >= 0.3
    ORDER BY public.word_similarity(public.norm_busqueda(p_q), p.busq_todo) DESC
    LIMIT 300
  ),
  cand AS (
    SELECT p.id AS pid,
           public.busqueda_parecido(v_tok,
             ARRAY[p.nombre_busq, CASE WHEN p_con_pactivo THEN p.pactivo_busq END, lb.lb, p.codigo_barras],
             ARRAY[p.nombre_comp, CASE WHEN p_con_pactivo THEN p.pactivo_comp END, lb.lc, p.codigo_barras]) AS s
    FROM cerca p
    LEFT JOIN labs lb ON lb.lab_id = p.laboratorio_id
  )
  SELECT c.pid, c.s * 50, true FROM cand c WHERE c.s >= 0.75;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_ventas_ids(p_search text, p_fini date DEFAULT NULL::date, p_ffin date DEFAULT NULL::date)
 RETURNS TABLE(id bigint, aproximado boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
DECLARE
  v_tok   jsonb  := public.busqueda_palabras(p_search);
  v_pats  text[] := public.busqueda_patrones_legados(public.busqueda_palabras(p_search));
  -- Con sólo palabras de 3+ letras, el `LIKE` sobre `norm_search` ya da lo
  -- mismo que la regla (una palabra coincide dentro de otra, y `norm_search`
  -- es la forma compacta): la regla exacta sobra. Hace falta con números
  -- (completos), palabras cortas (al inicio) o mixtas (seguidas).
  v_basta_like boolean := NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.busqueda_palabras(p_search)) x
    WHERE x->>'tipo' <> 'palabra');
  v_first text;
  v_puede boolean;
  v_sala  integer;
  v_n     int;
  v_prods int[];
  v_texto boolean;
BEGIN
  -- DEFINER para que el `LIKE` entre al índice de trigramas; el alcance del
  -- RLS lo pone `alcance_de_ventas()`.
  SELECT a.puede, a.sala INTO v_puede, v_sala FROM public.alcance_de_ventas() a;
  IF NOT coalesce(v_puede, false) THEN RETURN; END IF;

  IF v_pats IS NULL THEN
    RETURN QUERY
    SELECT si.id, false
      FROM public.sales_invoices si
     WHERE (p_fini IS NULL OR si.fecha >= p_fini)
       AND (p_ffin IS NULL OR si.fecha <= p_ffin)
       AND (v_sala IS NULL OR si.branch_id = v_sala);
    RETURN;
  END IF;

  -- La pieza MÁS LARGA entra por el índice de trigramas (la primera podía ser
  -- una corta: «jo perez» recorría la tabla). Y si ninguna llega a 3
  -- caracteres —«2.5» queda en «%25%»— no hay índice que sirva: recorría las
  -- 180,000 facturas del año (15 s) para no encontrar nada, porque un pedazo
  -- de dos caracteres no identifica a un cliente ni a una factura. Ahí sólo se
  -- busca por producto, que es lo que quiere decir «2.5».
  v_first := public.busqueda_la_mas_larga(v_pats);
  v_texto := length(v_first) >= 5;
  -- Los productos, resueltos ANTES y como arreglo. Llamar a
  -- `busqueda_productos` dentro de la consulta la dejaba sin workers en
  -- paralelo (la función no es PARALLEL SAFE): 1,304 ms contra 702 de la vieja.
  v_prods := ARRAY(SELECT b.id FROM public.busqueda_productos(p_search, false, false, false, false) b);

  RETURN QUERY
  SELECT si.id, false
    FROM public.sales_invoices si
   WHERE (p_fini IS NULL OR si.fecha >= p_fini)
     AND (p_ffin IS NULL OR si.fecha <= p_ffin)
     AND (v_sala IS NULL OR si.branch_id = v_sala)
     AND v_texto
     AND (
          (public.norm_search(si.erp_invoice_id) LIKE v_first
           AND public.norm_search(si.erp_invoice_id) LIKE ALL (v_pats)
           AND (v_basta_like OR public.busqueda_coincide(v_tok, si.erp_invoice_id)))
       OR (public.norm_search(si.correlativo)    LIKE v_first
           AND public.norm_search(si.correlativo)    LIKE ALL (v_pats)
           AND (v_basta_like OR public.busqueda_coincide(v_tok, si.correlativo)))
       OR (public.norm_search(si.cliente)        LIKE v_first
           AND public.norm_search(si.cliente)        LIKE ALL (v_pats)
           AND (v_basta_like OR public.busqueda_coincide(v_tok, si.cliente)))
     )
  UNION
  -- Las facturas que llevan un producto que coincide tal cual.
  SELECT si.id, false
    FROM public.sales_invoices si
   WHERE (p_fini IS NULL OR si.fecha >= p_fini)
     AND (p_ffin IS NULL OR si.fecha <= p_ffin)
     AND (v_sala IS NULL OR si.branch_id = v_sala)
     AND si.id IN (
           SELECT ii.invoice_id
             FROM public.sales_invoice_items ii
            WHERE ii.erp_product_id = ANY (v_prods));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RETURN; END IF;

  -- Nada tal cual: las facturas con productos PARECIDOS.
  v_prods := ARRAY(SELECT b.id FROM public.busqueda_productos(p_search, false, false, false) b WHERE b.aproximado);
  RETURN QUERY
  SELECT si.id, true
    FROM public.sales_invoices si
   WHERE (p_fini IS NULL OR si.fecha >= p_fini)
     AND (p_ffin IS NULL OR si.fecha <= p_ffin)
     AND (v_sala IS NULL OR si.branch_id = v_sala)
     AND si.id IN (
           SELECT ii.invoice_id
             FROM public.sales_invoice_items ii
            WHERE ii.erp_product_id = ANY (v_prods));
END;
$function$;

CREATE OR REPLACE FUNCTION public.ventas_busqueda_aproximada(p_search text, p_fini date DEFAULT NULL::date, p_ffin date DEFAULT NULL::date)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_tok   jsonb  := public.busqueda_palabras(p_search);
  v_pats  text[] := public.busqueda_patrones_legados(public.busqueda_palabras(p_search));
  v_basta_like boolean := NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(public.busqueda_palabras(p_search)) x
    WHERE x->>'tipo' <> 'palabra');
  v_first text;
  v_puede boolean;
  v_sala  integer;
BEGIN
  IF v_pats IS NULL THEN RETURN false; END IF;
  SELECT a.puede, a.sala INTO v_puede, v_sala FROM public.alcance_de_ventas() a;
  IF NOT coalesce(v_puede, false) THEN RETURN false; END IF;

  IF EXISTS (SELECT 1 FROM public.busqueda_productos(p_search, false, false, false, false)) THEN
    RETURN false;
  END IF;

  -- La misma decisión que `search_ventas_ids`: la pieza más larga, y sin
  -- ninguna de 3 caracteres el texto de las facturas no se mira.
  v_first := public.busqueda_la_mas_larga(v_pats);
  IF length(v_first) < 5 THEN RETURN true; END IF;
  RETURN NOT EXISTS (
    SELECT 1
      FROM public.sales_invoices si
     WHERE (p_fini IS NULL OR si.fecha >= p_fini)
       AND (p_ffin IS NULL OR si.fecha <= p_ffin)
       AND (v_sala IS NULL OR si.branch_id = v_sala)
       AND (
            (public.norm_search(si.erp_invoice_id) LIKE v_first
             AND public.norm_search(si.erp_invoice_id) LIKE ALL (v_pats)
             AND (v_basta_like OR public.busqueda_coincide(v_tok, si.erp_invoice_id)))
         OR (public.norm_search(si.correlativo)    LIKE v_first
             AND public.norm_search(si.correlativo)    LIKE ALL (v_pats)
             AND (v_basta_like OR public.busqueda_coincide(v_tok, si.correlativo)))
         OR (public.norm_search(si.cliente)        LIKE v_first
             AND public.norm_search(si.cliente)        LIKE ALL (v_pats)
             AND (v_basta_like OR public.busqueda_coincide(v_tok, si.cliente)))
       )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.busqueda_clientes(p_q text)
 RETURNS TABLE(id bigint, puntaje numeric, aproximado boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_column
DECLARE
  v_tok  jsonb := public.busqueda_palabras(p_q);
  v_pats text[];
  v_idx  text;
  v_n    int;
BEGIN
  IF jsonb_array_length(v_tok) = 0 THEN RETURN; END IF;
  v_pats := public.busqueda_prefiltro(v_tok);
  v_idx  := public.busqueda_la_mas_larga(v_pats);

  RETURN QUERY
  SELECT x.id, x.s, false
  FROM (
    SELECT c.id,
           public.busqueda_puntaje(v_tok, ARRAY[c.nombre_busq, c.ids_busq],
                                          ARRAY[c.nombre_comp, c.ids_comp])::numeric AS s
    FROM public.customers c
    -- Un patrón solo, sobre la MISMA expresión del índice de trigramas, es lo
    -- que lo deja entrar: `~ ALL (arreglo)` no puede, y recorría las 28,000
    -- fichas en cada búsqueda.
    WHERE (c.nombre_busq || ' ' || c.nombre_comp || ' ' || c.ids_busq || ' ' || c.ids_comp) ~ v_idx
      AND (c.nombre_busq || ' ' || c.nombre_comp || ' ' || c.ids_busq || ' ' || c.ids_comp) ~ ALL (v_pats)
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
$function$;

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
        SELECT c.id FROM public.customers c
        -- La expresión del índice de trigramas, con un solo patrón: sin esto
        -- recorría las fichas por orden de nombre hasta juntar 20, o sea
        -- TODAS cuando no hay ninguna (225 MB por llamada).
        WHERE (c.nombre_busq || ' ' || c.nombre_comp || ' ' || c.ids_busq || ' ' || c.ids_comp) ~ v_idx
          AND (c.nombre_busq || ' ' || c.nombre_comp) ~ ALL (v_pre)
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
$function$;
