-- El evaluador de la regla, sin consultas internas (misma regla, medida igual
-- contra los 77 casos). La primera versión hacía un `SELECT` por campo y por
-- fila: «tab» evaluaba 990 productos en 256 ms y «5» 1,487 en 324 ms.
--
-- Y el prefiltro deja de ser `LIKE` para números y palabras cortas: «5» como
-- `LIKE '%5%'` traía 1,487 candidatos para 294 aciertos. Con la frontera de
-- palabra escrita en la expresión regular, el índice de trigramas descarta el
-- resto antes de evaluar (pg_trgm también indexa `~`).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.busqueda_prefiltro(p_palabras jsonb)
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
DECLARE
  e     jsonb;
  t     text;
  pats  text[] := '{}';
  pieza text;
  i     int;
BEGIN
  FOR i IN 0 .. coalesce(jsonb_array_length(p_palabras), 0) - 1 LOOP
    e := p_palabras -> i;
    t := e->>'t';
    IF e->>'tipo' = 'numero' AND length(t) < 4 THEN
      -- El número completo, o su parte entera («138» → «138.97»).
      pats := pats || ('(^| )' || replace(t, '.', '\.') || '( |\.[0-9]|$)');
    ELSIF e->>'tipo' = 'numero' THEN
      pats := pats || replace(t, '.', '\.');
    ELSIF e->>'tipo' = 'corta' THEN
      pats := pats || ('(^| )' || t);
    ELSIF e->>'tipo' = 'mixto' THEN
      -- La parte más larga está tanto en «b 12» como en «b12».
      SELECT x INTO pieza FROM unnest(string_to_array(t, ' ')) x ORDER BY length(x) DESC LIMIT 1;
      pats := pats || pieza;
    ELSE
      pats := pats || t;
    END IF;
  END LOOP;
  RETURN pats;
END;
$$;

CREATE OR REPLACE FUNCTION public.busqueda_puntaje(p_palabras jsonb, p_campos text[], p_compactas text[])
RETURNS integer
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
DECLARE
  campos text[] := array_remove(array_remove(p_campos, NULL), '');
  texto  text;
  b      text;
  comp   text := array_to_string(array_remove(array_remove(p_compactas, NULL), ''), ' ');
  e      jsonb;
  t      text;
  tipo   text;
  nivel  int;
  todas2 boolean := true;
  n      int := coalesce(jsonb_array_length(p_palabras), 0);
  q      text := '';
  pre    text;
  c      text;
  i      int;
BEGIN
  IF n = 0 THEN RETURN 0; END IF;
  texto := array_to_string(campos, ' ');
  b     := ' ' || texto || ' ';

  FOR i IN 0 .. n - 1 LOOP
    e := p_palabras -> i;
    t := e->>'t'; tipo := e->>'tipo'; nivel := 0;
    q := CASE WHEN i = 0 THEN t ELSE q || ' ' || t END;
    IF tipo = 'numero' THEN
      IF strpos(b, ' ' || t || ' ') > 0 THEN nivel := 2;
      ELSIF strpos(t, '.') = 0 AND strpos(b, ' ' || t || '.') > 0 THEN nivel := 1;
      ELSIF length(t) >= 4 AND strpos(t, '.') = 0
            AND b ~ (' (?=[0-9]{6,} )[0-9]*' || t || '[0-9]* ') THEN nivel := 1;
      END IF;
    ELSIF tipo = 'mixto' THEN
      IF strpos(b, ' ' || t || ' ') > 0 THEN nivel := 2;
      ELSIF strpos(' ' || comp, ' ' || (e->>'junto')) > 0 THEN nivel := 1;
      END IF;
    ELSE
      IF strpos(b, ' ' || t) > 0 THEN nivel := 2;
      ELSIF tipo = 'palabra' AND (strpos(texto, t) > 0 OR strpos(comp, t) > 0) THEN nivel := 1;
      END IF;
    END IF;
    IF nivel = 0 THEN RETURN 0; END IF;
    IF nivel < 2 THEN todas2 := false; END IF;
  END LOOP;

  IF q = ANY (campos) THEN RETURN 100; END IF;
  pre := CASE WHEN q ~ '[0-9]$' THEN q || ' ' ELSE q END;
  FOREACH c IN ARRAY campos LOOP
    IF starts_with(c, pre) THEN RETURN 90; END IF;
  END LOOP;
  IF todas2 THEN RETURN 80; END IF;
  IF n > 1 AND strpos(texto, q) > 0 THEN RETURN 70; END IF;
  RETURN 60;
END;
$$;

CREATE OR REPLACE FUNCTION public.busqueda_parecido(p_palabras jsonb, p_campos text[], p_compactas text[])
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
DECLARE
  e      jsonb;
  t      text;
  ft     text;
  w      text;
  palabras text[] := string_to_array(array_to_string(array_remove(array_remove(p_campos, NULL), ''), ' '), ' ');
  largas int := 0;
  peor   numeric := 1;
  mejor  numeric;
  s      numeric;
  largo  int;
  i      int;
  n      int := coalesce(jsonb_array_length(p_palabras), 0);
BEGIN
  FOR i IN 0 .. n - 1 LOOP
    e := p_palabras -> i;
    IF e->>'tipo' = 'palabra' AND length(e->>'t') >= 4 THEN largas := largas + 1; END IF;
  END LOOP;
  IF largas = 0 THEN RETURN 0; END IF;
  palabras := array_remove(palabras, '');

  FOR i IN 0 .. n - 1 LOOP
    e := p_palabras -> i;
    t := e->>'t';
    IF public.busqueda_puntaje(jsonb_build_array(e), p_campos, p_compactas) > 0 THEN
      CONTINUE;   -- exacta: vale 1
    END IF;
    IF e->>'tipo' <> 'palabra' OR length(t) < 4 THEN RETURN 0; END IF;
    ft := public.busqueda_fonetica(t);
    mejor := 0;
    FOREACH w IN ARRAY coalesce(palabras, '{}') LOOP
      CONTINUE WHEN w ~ '^[0-9]+(\.[0-9]+)?$';
      IF starts_with(public.busqueda_fonetica(w), ft) THEN mejor := 0.95; EXIT; END IF;
      FOR largo IN (length(t) - 1)..(length(t) + 1) LOOP
        CONTINUE WHEN largo < 1 OR largo > length(w);
        s := 1 - public.busqueda_distancia(t, left(w, largo))::numeric / length(t);
        IF s > mejor THEN mejor := s; END IF;
      END LOOP;
    END LOOP;
    IF mejor < peor THEN peor := mejor; END IF;
  END LOOP;
  RETURN peor;
END;
$$;

-- El prefiltro ahora son expresiones regulares: `~ ALL` en vez de `LIKE ALL`.
-- Y el umbral de la aproximada deja de ser un `SET` de la función (ver abajo).
CREATE OR REPLACE FUNCTION public.buscar_productos_ids(
  p_q text,
  p_limite integer DEFAULT 60,
  p_con_pactivo boolean DEFAULT false,
  p_con_laboratorio boolean DEFAULT false,
  p_solo_activos boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_tok  jsonb := public.busqueda_palabras(p_q);
  v_pats text[];
  v_lim  int := least(greatest(coalesce(p_limite, 60), 1), 1000);
  v_ids  json;
BEGIN
  IF jsonb_array_length(v_tok) = 0 THEN
    RETURN json_build_object('ids', '[]'::json, 'aproximado', false);
  END IF;
  v_pats := public.busqueda_prefiltro(v_tok);

  -- Exacta
  WITH labs AS (
    SELECT l.id, public.norm_busqueda(l.nombre) lb, public.compactar_busqueda(l.nombre) lc
    FROM public.laboratorios l
    WHERE p_con_laboratorio
  ),
  cand AS (
    SELECT p.id, p.nombre,
           public.busqueda_puntaje(v_tok,
             ARRAY[p.nombre_busq,
                   CASE WHEN p_con_pactivo THEN p.pactivo_busq END,
                   lb.lb,
                   p.codigo_barras],
             ARRAY[p.nombre_comp,
                   CASE WHEN p_con_pactivo THEN p.pactivo_comp END,
                   lb.lc,
                   p.codigo_barras]) AS s
    FROM public.products p
    LEFT JOIN labs lb ON lb.id = p.laboratorio_id
    WHERE (NOT p_solo_activos OR p.activo)
      AND (p.busq_todo || coalesce(' ' || lb.lb || ' ' || lb.lc, '')) ~ ALL (v_pats)
  )
  SELECT json_agg(id ORDER BY s DESC, nombre) INTO v_ids
  FROM (SELECT id, nombre, s FROM cand WHERE s > 0 ORDER BY s DESC, nombre LIMIT v_lim) x;

  IF v_ids IS NOT NULL THEN
    RETURN json_build_object('ids', v_ids, 'aproximado', false);
  END IF;

  -- Aproximada: sólo si lo exacto no trajo nada. Los trigramas ELIGEN
  -- candidatos (entran por el índice); el parecido exacto —el mismo de JS— decide.
  WITH labs AS (
    SELECT l.id, public.norm_busqueda(l.nombre) lb, public.compactar_busqueda(l.nombre) lc
    FROM public.laboratorios l
    WHERE p_con_laboratorio
  ),
  cand AS (
    SELECT p.id, p.nombre,
           public.busqueda_parecido(v_tok,
             ARRAY[p.nombre_busq, CASE WHEN p_con_pactivo THEN p.pactivo_busq END, lb.lb, p.codigo_barras],
             ARRAY[p.nombre_comp, CASE WHEN p_con_pactivo THEN p.pactivo_comp END, lb.lc, p.codigo_barras]) AS s
    FROM public.products p
    LEFT JOIN labs lb ON lb.id = p.laboratorio_id
    WHERE (NOT p_solo_activos OR p.activo)
      -- Umbral BAJO a propósito: los trigramas sólo eligen candidatos.
      -- «dicloefnac» contra DICLOFENAC da 0.47; con el 0.6 del operador `%>`
      -- ni llegaría a que el parecido exacto lo mire. Va escrito y no como
      -- `SET pg_trgm.word_similarity_threshold` en la función: la base no
      -- deja fijar ese parámetro ahí («permission denied to set parameter»).
      AND public.word_similarity(public.norm_busqueda(p_q), p.busq_todo) >= 0.3
  )
  SELECT json_agg(id ORDER BY s DESC, nombre) INTO v_ids
  FROM (SELECT id, nombre, s FROM cand WHERE s >= 0.75 ORDER BY s DESC, nombre LIMIT v_lim) x;

  RETURN json_build_object('ids', coalesce(v_ids, '[]'::json), 'aproximado', v_ids IS NOT NULL);
END;
$$;

