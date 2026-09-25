-- Búsqueda de producto con la regla del portal (F3 de
-- docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md).
--
-- `products` es tabla caliente (sync cada 10 min). Agregar columnas STORED
-- reescribe la tabla: 5,238 filas y ~0.9 s de cálculo (medido en prod con
-- EXPLAIN ANALYZE antes de aplicar), probado antes en el branch.
-- `lock_timeout` para que, si choca con un sync, falle y se reintente en vez de
-- encolar lecturas detrás (incidente 2026-07-08).
SET lock_timeout = '5s';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS nombre_busq  text GENERATED ALWAYS AS (public.norm_busqueda(nombre)) STORED,
  ADD COLUMN IF NOT EXISTS nombre_comp  text GENERATED ALWAYS AS (public.compactar_busqueda(nombre)) STORED,
  ADD COLUMN IF NOT EXISTS pactivo_busq text GENERATED ALWAYS AS (public.norm_busqueda(principio_activo)) STORED,
  ADD COLUMN IF NOT EXISTS pactivo_comp text GENERATED ALWAYS AS (public.compactar_busqueda(principio_activo)) STORED,
  -- Superconjunto para el prefiltro por índice: todas las formas juntas. La
  -- regla exacta decide después, campo por campo.
  ADD COLUMN IF NOT EXISTS busq_todo    text GENERATED ALWAYS AS (
    public.norm_busqueda(nombre) || ' ' || public.compactar_busqueda(nombre) || ' ' ||
    public.norm_busqueda(principio_activo) || ' ' || public.compactar_busqueda(principio_activo) || ' ' ||
    coalesce(codigo_barras, '')) STORED;

CREATE INDEX IF NOT EXISTS idx_products_busq_todo_trgm
  ON public.products USING gin (busq_todo public.gin_trgm_ops);

-- ── La búsqueda de producto, una sola ───────────────────────────────────────
-- Devuelve {ids, aproximado}: los ids ya ordenados por relevancia. Cada pantalla
-- trae con ellos sus propias columnas y filtros (`.in('id', ids)`: `id` es
-- única, así que acotar la entrada acota la salida).
--
-- «Se busca lo que se ve» (decisión del usuario, 2026-09-25): el principio
-- activo y el laboratorio sólo entran si la pantalla los muestra.
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
-- Umbral BAJO a propósito: los trigramas sólo eligen candidatos para la
-- aproximada. «dicloefnac» contra DICLOFENAC da 0.47; con el 0.6 por defecto
-- ni siquiera llegaría a que el parecido exacto lo mire.
SET pg_trgm.word_similarity_threshold = '0.3'
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
      AND (p.busq_todo || coalesce(' ' || lb.lb || ' ' || lb.lc, '')) LIKE ALL (v_pats)
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
      AND p.busq_todo %> public.norm_busqueda(p_q)
  )
  SELECT json_agg(id ORDER BY s DESC, nombre) INTO v_ids
  FROM (SELECT id, nombre, s FROM cand WHERE s >= 0.75 ORDER BY s DESC, nombre LIMIT v_lim) x;

  RETURN json_build_object('ids', coalesce(v_ids, '[]'::json), 'aproximado', v_ids IS NOT NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_productos_ids(text, integer, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_productos_ids(text, integer, boolean, boolean, boolean) TO authenticated, service_role;
