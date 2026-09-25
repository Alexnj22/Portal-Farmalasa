-- La regla de búsqueda del portal, gemelo SQL de src/utils/busqueda.js.
-- Plan: docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md. Casos: tests/casos-busqueda.json
-- (los corre scripts/busqueda/comparar_gemelos.mjs contra ESTAS funciones:
-- cambiar un gemelo exige cambiar el otro y volver a compararlos).
--
-- Sólo crea funciones: no toca ninguna tabla.

SET lock_timeout = '5s';

-- ── Normalizar ──────────────────────────────────────────────────────────────
-- p_partir = true  → `normalizar` de JS (separa número de letras: «500mg» → «500 mg»)
-- p_partir = false → los grupos de la consulta (`compactarGrupos` de JS)
CREATE OR REPLACE FUNCTION public.busqueda_base(p text, p_partir boolean)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
DECLARE
  s   text;
  m   text;
  pos int;
  sep text;
  mk  constant text := chr(57344);   -- marca del decimal, igual que  en JS
  -- Separador de miles: el MISMO en todos los grupos, con un decimal opcional
  -- de 1–2 cifras con el otro separador (`$1,234.50`).
  pat_miles constant text :=
    '(?<![0-9.,])[1-9][0-9]{0,2}([.,])[0-9]{3}(?:\1[0-9]{3})*(?=[.,][0-9]{1,2}(?![0-9])|(?![.,]?[0-9]))';
  pat_sigla constant text := '(^|[^a-z0-9])((?:[a-z]\.){2,})';
BEGIN
  s := lower(public.f_unaccent(coalesce(p, '')));

  LOOP
    pos := regexp_instr(s, pat_miles);
    EXIT WHEN pos = 0;
    m   := regexp_substr(s, pat_miles);
    sep := substr(regexp_substr(m, '[.,]'), 1, 1);
    s   := overlay(s placing replace(m, sep, '') from pos for length(m));
  END LOOP;

  s := regexp_replace(s, '([0-9])[.,](?=[0-9])', '\1' || mk, 'g');

  LOOP
    pos := regexp_instr(s, pat_sigla, 1, 1, 0, '', 2);
    EXIT WHEN pos = 0;
    m   := regexp_substr(s, pat_sigla, 1, 1, '', 2);
    s   := overlay(s placing replace(m, '.', '') from pos for length(m));
  END LOOP;

  s := regexp_replace(s, '[^a-z0-9' || mk || ']+', ' ', 'g');
  IF p_partir THEN
    s := regexp_replace(s, '([0-9])(?=[a-z])', '\1 ', 'g');
    s := regexp_replace(s, '([a-z])(?=[0-9])', '\1 ', 'g');
  END IF;
  s := replace(s, mk, '.');
  RETURN btrim(regexp_replace(s, '\s+', ' ', 'g'));
END;
$$;

CREATE OR REPLACE FUNCTION public.norm_busqueda(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$ BEGIN RETURN public.busqueda_base(p, true); END; $$;

-- La forma de rescate: la puntuación se BORRA y los espacios se conservan.
CREATE OR REPLACE FUNCTION public.compactar_busqueda(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
BEGIN
  RETURN btrim(regexp_replace(
    regexp_replace(lower(public.f_unaccent(coalesce(p, ''))), '[^a-z0-9\s]+', '', 'g'),
    '\s+', ' ', 'g'));
END;
$$;

CREATE OR REPLACE FUNCTION public.busqueda_fonetica(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
DECLARE s text := coalesce(p, '');
BEGIN
  s := replace(s, 'ch', chr(57345));
  s := replace(s, 'h', '');
  s := replace(s, chr(57345), 'ch');
  s := regexp_replace(s, 'qu(?=[ei])', 'k', 'g');
  s := regexp_replace(s, 'c(?=[ei])', 's', 'g');
  s := regexp_replace(s, 'g(?=[ei])', 'j', 'g');
  s := replace(s, 'z', 's');
  s := replace(s, 'c', 'k');
  s := replace(s, 'v', 'b');
  s := replace(s, 'll', 'y');
  s := regexp_replace(s, 'y$', 'i');
  RETURN regexp_replace(s, '(.)\1+', '\1', 'g');
END;
$$;

-- ── La consulta ─────────────────────────────────────────────────────────────
-- [{t, tipo, junto?}] — tipo: numero | mixto | corta | palabra
CREATE OR REPLACE FUNCTION public.busqueda_palabras(p_q text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
DECLARE
  g   text;
  t   text;
  out jsonb := '[]'::jsonb;
BEGIN
  FOREACH g IN ARRAY string_to_array(public.busqueda_base(p_q, false), ' ') LOOP
    CONTINUE WHEN g IS NULL OR g = '';
    IF g ~ '^[0-9]+(\.[0-9]+)?$' THEN
      out := out || jsonb_build_object('t', g, 'tipo', 'numero');
    ELSE
      t := public.norm_busqueda(g);
      CONTINUE WHEN t = '';
      IF g ~ '[0-9]' AND g ~ '[a-z]' THEN
        out := out || jsonb_build_object('t', t, 'tipo', 'mixto', 'junto', replace(t, ' ', ''));
      ELSIF length(t) <= 2 THEN
        out := out || jsonb_build_object('t', t, 'tipo', 'corta');
      ELSE
        out := out || jsonb_build_object('t', t, 'tipo', 'palabra');
      END IF;
    END IF;
  END LOOP;
  RETURN out;
END;
$$;

-- Patrones para `LIKE ALL` sobre una columna que junte las formas normal y
-- compacta: un SUPERCONJUNTO de lo que coincide, para entrar por el índice.
-- La regla exacta se aplica después con `busqueda_puntaje`.
CREATE OR REPLACE FUNCTION public.busqueda_prefiltro(p_palabras jsonb)
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
DECLARE
  e    jsonb;
  pats text[] := '{}';
  pieza text;
BEGIN
  FOR e IN SELECT * FROM jsonb_array_elements(p_palabras) LOOP
    IF e->>'tipo' = 'mixto' THEN
      -- La parte más larga está tanto en «b 12» como en «b12».
      SELECT x INTO pieza FROM unnest(string_to_array(e->>'t', ' ')) x
      ORDER BY length(x) DESC LIMIT 1;
      pats := pats || ('%' || pieza || '%');
    ELSE
      pats := pats || ('%' || (e->>'t') || '%');
    END IF;
  END LOOP;
  RETURN pats;
END;
$$;

-- ── Coincidir y puntuar ─────────────────────────────────────────────────────
-- p_campos: cada campo YA normalizado (norm_busqueda). p_compactas: compactar_busqueda.
-- 0 = no coincide. 100 exacto · 90 empieza · 80 todas al inicio de palabra ·
-- 70 seguidas y en orden · 60 en cualquier parte.
CREATE OR REPLACE FUNCTION public.busqueda_puntaje(p_palabras jsonb, p_campos text[], p_compactas text[])
RETURNS integer
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
DECLARE
  campos text[];
  texto  text;
  b      text;
  comp   text;
  e      jsonb;
  t      text;
  tipo   text;
  nivel  int;
  todas2 boolean := true;
  n      int := 0;
  q      text := '';
BEGIN
  IF p_palabras IS NULL OR jsonb_array_length(p_palabras) = 0 THEN RETURN 0; END IF;
  SELECT coalesce(array_agg(c), '{}') INTO campos FROM unnest(p_campos) c WHERE c IS NOT NULL AND c <> '';
  texto := array_to_string(campos, ' ');
  b     := ' ' || texto || ' ';
  SELECT coalesce(string_agg(c, ' '), '') INTO comp FROM unnest(p_compactas) c WHERE c IS NOT NULL AND c <> '';

  FOR e IN SELECT * FROM jsonb_array_elements(p_palabras) LOOP
    t := e->>'t'; tipo := e->>'tipo'; nivel := 0; n := n + 1;
    q := CASE WHEN q = '' THEN t ELSE q || ' ' || t END;
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
  IF EXISTS (SELECT 1 FROM unnest(campos) c
             WHERE starts_with(c, CASE WHEN q ~ '[0-9]$' THEN q || ' ' ELSE q END)) THEN RETURN 90; END IF;
  IF todas2 THEN RETURN 80; END IF;
  IF n > 1 AND strpos(texto, q) > 0 THEN RETURN 70; END IF;
  RETURN 60;
END;
$$;

-- ── Aproximada ──────────────────────────────────────────────────────────────
-- Distancia con transposición (optimal string alignment).
CREATE OR REPLACE FUNCTION public.busqueda_distancia(a text, b text)
RETURNS integer
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions
AS $$
DECLARE
  m int := length(a); n int := length(b);
  prev2 int[]; prev int[]; cur int[];
  i int; j int; costo int; v int;
BEGIN
  IF m = 0 THEN RETURN n; END IF;
  IF n = 0 THEN RETURN m; END IF;
  prev := array(SELECT generate_series(0, n));
  FOR i IN 1..m LOOP
    cur := ARRAY[i];
    FOR j IN 1..n LOOP
      costo := CASE WHEN substr(a, i, 1) = substr(b, j, 1) THEN 0 ELSE 1 END;
      v := least(prev[j + 1] + 1, cur[j] + 1, prev[j] + costo);
      IF i > 1 AND j > 1 AND substr(a, i, 1) = substr(b, j - 1, 1) AND substr(a, i - 1, 1) = substr(b, j, 1) THEN
        v := least(v, prev2[j - 1] + 1);
      END IF;
      cur := cur || v;
    END LOOP;
    prev2 := prev;
    prev := cur;
  END LOOP;
  RETURN prev[n + 1];
END;
$$;

-- Parecido 0–1 (umbral 0.75). Cada número y cada palabra de < 4 letras tiene
-- que coincidir tal cual; el parecido es el de la PEOR palabra.
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
  palabras text[];
  largas int := 0;
  peor   numeric := 1;
  mejor  numeric;
  s      numeric;
  largo  int;
BEGIN
  SELECT count(*) INTO largas FROM jsonb_array_elements(p_palabras) x
  WHERE x->>'tipo' = 'palabra' AND length(x->>'t') >= 4;
  IF largas = 0 THEN RETURN 0; END IF;
  SELECT coalesce(array_agg(x), '{}') INTO palabras
  FROM unnest(p_campos) c, unnest(string_to_array(c, ' ')) x
  WHERE c IS NOT NULL AND c <> '' AND x <> '';

  FOR e IN SELECT * FROM jsonb_array_elements(p_palabras) LOOP
    t := e->>'t';
    IF public.busqueda_puntaje(jsonb_build_array(e), p_campos, p_compactas) > 0 THEN
      CONTINUE;   -- exacta: vale 1
    END IF;
    IF e->>'tipo' <> 'palabra' OR length(t) < 4 THEN RETURN 0; END IF;
    ft := public.busqueda_fonetica(t);
    mejor := 0;
    FOREACH w IN ARRAY palabras LOOP
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

-- Toda función, sólo para quien tiene sesión (regla 4 de CLAUDE.md).
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.busqueda_base(text, boolean)', 'public.norm_busqueda(text)',
    'public.compactar_busqueda(text)', 'public.busqueda_fonetica(text)',
    'public.busqueda_palabras(text)', 'public.busqueda_prefiltro(jsonb)',
    'public.busqueda_puntaje(jsonb, text[], text[])', 'public.busqueda_distancia(text, text)',
    'public.busqueda_parecido(jsonb, text[], text[])'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;
