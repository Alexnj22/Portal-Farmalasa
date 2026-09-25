-- F4 de docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md: las búsquedas de producto
-- que vivían adentro de otras funciones pasan a la regla del portal.
--
-- `busqueda_productos` es la búsqueda UNA vez, como conjunto (id, puntaje,
-- aproximado), para poder unirla a lo que cada función necesite. Antes había
-- tres reglas en tres funciones:
--   · buscar_productos_minmax: `LIKE ALL` + código aparte + `word_similarity` ≥ 0.65
--     (no encontraba «amoxisilina»: 0.60).
--   · get_productos_para_promocion: la frase ENTERA («amox 500» no encontraba
--     «AMOXICILINA 500»).
--   · buscar_inventario_global_v2: nombre en cualquier orden pero principio
--     activo en orden, y sin búsqueda aproximada.
-- Sólo reemplaza funciones: no toca ninguna tabla.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.busqueda_productos(
  p_q text,
  p_con_pactivo boolean DEFAULT false,
  p_con_laboratorio boolean DEFAULT false,
  p_solo_activos boolean DEFAULT true
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
      AND (p.busq_todo || coalesce(' ' || lb.lb || ' ' || lb.lc, '')) ~ ALL (v_pats)
  )
  SELECT c.pid, c.s, false FROM cand c WHERE c.s > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RETURN; END IF;

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
  cand AS (
    SELECT p.id AS pid,
           public.busqueda_parecido(v_tok,
             ARRAY[p.nombre_busq, CASE WHEN p_con_pactivo THEN p.pactivo_busq END, lb.lb, p.codigo_barras],
             ARRAY[p.nombre_comp, CASE WHEN p_con_pactivo THEN p.pactivo_comp END, lb.lc, p.codigo_barras]) AS s
    FROM public.products p
    LEFT JOIN labs lb ON lb.lab_id = p.laboratorio_id
    WHERE (NOT p_solo_activos OR p.activo)
      AND public.word_similarity(public.norm_busqueda(p_q), p.busq_todo) >= 0.3
  )
  SELECT c.pid, c.s * 50, true FROM cand c WHERE c.s >= 0.75;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.busqueda_productos(text, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.busqueda_productos(text, boolean, boolean, boolean) TO authenticated, service_role;

-- La función de la pantalla, ahora sobre la base común: una sola copia de la regla.
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
  v_lim int := least(greatest(coalesce(p_limite, 60), 1), 1000);
  v_ids json;
  v_ap  boolean;
BEGIN
  SELECT json_agg(x.id ORDER BY x.puntaje DESC, x.nombre), bool_or(x.aproximado)
    INTO v_ids, v_ap
  FROM (
    SELECT b.id, b.puntaje, b.aproximado, p.nombre
    FROM public.busqueda_productos(p_q, p_con_pactivo, p_con_laboratorio, p_solo_activos) b
    JOIN public.products p ON p.id = b.id
    ORDER BY b.puntaje DESC, p.nombre
    LIMIT v_lim
  ) x;
  RETURN json_build_object('ids', coalesce(v_ids, '[]'::json), 'aproximado', coalesce(v_ap, false));
END;
$$;

-- Mín·Máx y los otros tres que usan `BuscadorDeProducto` (abono, descuento,
-- promoción). El buscador muestra el principio activo y el laboratorio: se
-- buscan. Cada fila lleva `aproximado` para que el buscador lo avise.
CREATE OR REPLACE FUNCTION public.buscar_productos_minmax(p_search text, p_limit integer DEFAULT 20)
RETURNS json
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
BEGIN
  RETURN (
    SELECT coalesce(json_agg(json_build_object(
             'id',                 f.id,
             'nombre',             f.nombre,
             'foto_url',           f.foto_url,
             'principio_activo',   f.principio_activo,
             'laboratorio_nombre', f.laboratorio_nombre,
             'aproximado',         f.aproximado)
           ORDER BY f.puntaje DESC, f.nombre), '[]'::json)
    FROM (
      SELECT p.id, p.nombre, p.foto_url, p.principio_activo, l.nombre AS laboratorio_nombre,
             b.puntaje, b.aproximado
      FROM public.busqueda_productos(p_search, true, true, true) b
      JOIN public.products p ON p.id = b.id
      LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
      ORDER BY b.puntaje DESC, p.nombre
      LIMIT greatest(coalesce(p_limit, 20), 1)
    ) f
  );
END;
$$;

-- Promociones: palabras en cualquier orden (antes, la frase entera). La lista
-- muestra el laboratorio: se busca. `total` sigue sin el tope.
CREATE OR REPLACE FUNCTION public.get_productos_para_promocion(p_search text DEFAULT NULL::text, p_laboratorio_id integer DEFAULT NULL::integer, p_limit integer DEFAULT 400)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
    v_q      text := btrim(coalesce(p_search, ''));
    v_lim    integer := least(greatest(coalesce(p_limit, 400), 1), 400);
    v_total  integer;
    v_filas  json;
    v_ap     boolean := false;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RETURN NULL;
    END IF;

    -- Sin ninguno de los dos no se devuelve el catálogo entero: una lista de
    -- 4,376 para elegir a mano no es una lista, es un volcado.
    IF v_lim IS NULL OR (v_q = '' AND p_laboratorio_id IS NULL) THEN
        RETURN json_build_object('total', 0, 'productos', '[]'::json, 'aproximado', false);
    END IF;

    WITH hits AS (
        SELECT p.id, p.nombre, p.es_antibiotico, p.laboratorio_id, l.nombre AS laboratorio_nombre,
               coalesce(b.puntaje, 0) AS puntaje, coalesce(b.aproximado, false) AS aproximado
          FROM public.products p
          LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
          LEFT JOIN public.busqueda_productos(nullif(v_q, ''), false, true, true) b ON b.id = p.id
         WHERE p.activo
           AND (p_laboratorio_id IS NULL OR p.laboratorio_id = p_laboratorio_id)
           AND (v_q = '' OR b.id IS NOT NULL)
    )
    SELECT (SELECT count(*) FROM hits),
           (SELECT bool_or(aproximado) FROM hits),
           (SELECT coalesce(json_agg(json_build_object(
                       'id', x.id, 'nombre', x.nombre, 'es_antibiotico', x.es_antibiotico,
                       'laboratorio_nombre', x.laboratorio_nombre, 'laboratorio_id', x.laboratorio_id)
                     ORDER BY x.puntaje DESC, x.nombre), '[]'::json)
              FROM (SELECT * FROM hits ORDER BY puntaje DESC, nombre LIMIT v_lim) x)
      INTO v_total, v_ap, v_filas;

    RETURN json_build_object('total', v_total, 'productos', v_filas, 'aproximado', coalesce(v_ap, false));
END;
$$;

-- Existencias en todas las salas. Pasa de `LANGUAGE sql` + `SET` —la trampa 4
-- de CLAUDE.md: nace con plan genérico— a plpgsql. Muestra el principio
-- activo: se busca. Lo más parecido primero; `total_productos` sin el tope.
CREATE OR REPLACE FUNCTION public.buscar_inventario_global_v2(p_search text, p_max_productos integer DEFAULT 60)
RETURNS json
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
BEGIN
  RETURN (
  WITH prods AS MATERIALIZED (
    SELECT b.id, b.puntaje, b.aproximado, p.principio_activo, p.foto_url
    FROM public.busqueda_productos(p_search, true, false, false) b
    JOIN public.products p ON p.id = b.id
  ),
  base AS (
    SELECT i.erp_sucursal_id, i.erp_product_id, i.descripcion, i.presentacion,
           i.detalle, i.factor, i.lote, i.fecha_vencimiento, i.cantidad, i.is_vencidos,
           pr.principio_activo, pr.foto_url, pr.puntaje, pr.aproximado
    FROM public.v_inventario_lotes i
    JOIN prods pr ON pr.id = i.erp_product_id
    WHERE i.cantidad > 0
  ),
  -- Un renglón por producto; `min(descripcion)` fija una clave estable cuando
  -- la misma referencia viene escrita distinto en dos salas.
  orden AS (
    SELECT b.erp_product_id, max(b.puntaje) AS puntaje, min(b.descripcion) AS descripcion_min
    FROM base b
    GROUP BY b.erp_product_id
  ),
  -- El desempate por id hace que dos búsquedas iguales elijan lo mismo.
  elegidos AS (
    SELECT o.erp_product_id
    FROM orden o
    ORDER BY o.puntaje DESC, o.descripcion_min, o.erp_product_id
    LIMIT greatest(p_max_productos, 1)
  )
  SELECT json_build_object(
    'total_productos', (SELECT count(*) FROM orden),
    'aproximado', coalesce((SELECT bool_or(aproximado) FROM prods), false),
    'filas', coalesce(
      (SELECT json_agg(json_build_object(
                'erp_sucursal_id',   f.erp_sucursal_id,
                'erp_product_id',    f.erp_product_id,
                'descripcion',       f.descripcion,
                'presentacion',      f.presentacion,
                'detalle',           f.detalle,
                'factor',            f.factor,
                'lote',              f.lote,
                'fecha_vencimiento', f.fecha_vencimiento,
                'cantidad',          f.cantidad,
                'is_vencidos',       f.is_vencidos,
                'principio_activo',  f.principio_activo,
                'foto_url',          f.foto_url)
              -- `is_vencidos` cierra el orden: sin él, el mismo producto y el
              -- mismo lote en las dos áreas empatan en todas las claves.
              ORDER BY f.puntaje DESC, f.descripcion, f.fecha_vencimiento NULLS LAST,
                       f.erp_sucursal_id, f.lote NULLS LAST, f.presentacion NULLS LAST,
                       f.is_vencidos)
       FROM base f
       JOIN elegidos e ON e.erp_product_id = f.erp_product_id),
      '[]'::json)
  ));
END;
$$;
