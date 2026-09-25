-- El prefiltro de `busqueda_productos` recorría la tabla: `~ ALL (arreglo)` no
-- usa el índice de trigramas. La primera palabra sola, como expresión simple,
-- sí. Medido con `gate:perf`: `busqueda-del-tablero` había subido de ~9 a 27 ms
-- (techo 32) al pasar Existencias a la regla.
SET lock_timeout = '5s';

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
  v_n    int;
BEGIN
  IF jsonb_array_length(v_tok) = 0 THEN RETURN; END IF;
  v_pats := public.busqueda_prefiltro(v_tok);

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
      -- La primera palabra sola, como expresión simple, entra por el índice de
      -- trigramas (`~ ALL (arreglo)` no puede): 9 ms → 5 en «amoxicilina».
      -- Con el laboratorio en la búsqueda no vale —puede coincidir sólo ahí— y
      -- se deja pasar.
      AND (p_con_laboratorio OR p.busq_todo ~ v_pats[1])
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
