-- El código de barras sólo se busca si el término PARECE un código.
--
-- Regresión propia, cazada por `npm run gate:perf` el 2026-08-23:
--
--   busqueda-del-tablero        134.98 ms  contra un techo de 32
--   busqueda-vista-inventario   127.65 ms  contra un techo de 43
--
-- Las dos son las que ganaron búsqueda por código el día anterior. La causa es
-- la misma en las dos: `norm_search(codigo_barras)` —que es `f_unaccent` más un
-- `regexp_replace`— se evaluaba **por cada una de las 4,400 filas de
-- `products`**, en TODA búsqueda. Escribir «amoxicilina» pagaba 4,400
-- normalizaciones de códigos de barras que no podían coincidir con nada.
--
-- La salida no es sacar la función: es no llamarla cuando no puede servir. Un
-- nombre de producto nunca empieza con un dígito, y un código siempre. El
-- filtro va sobre el TÉRMINO y no sobre la columna, y eso importa: 100 de los
-- 4,854 códigos tienen letras (`2024001Ks`, códigos internos), así que exigir
-- que la COLUMNA sea numérica dejaría a esos 100 sin poder buscarse.
--
-- El piso de 4 caracteres deja fuera «500», «10», «2x» — dosis y presentaciones
-- que la gente escribe todo el tiempo y que dispararían el barrido sin querer.
-- El código más corto que se puede escanear tiene 8 dígitos (EAN-8).
--
-- Medido después: busqueda-del-tablero 9.07 ms y busqueda-vista-inventario
-- 9.95 ms — o sea MEJOR que antes de agregar el código de barras. Los techos
-- del gate NO se tocaron; el gate hizo exactamente lo que tenía que hacer.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.es_busqueda_de_codigo(p_search text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'extensions'
AS $function$
  -- Empieza con dígito y mide 4 o más. Alcanza con el primer carácter: los
  -- códigos internos con letra la llevan al final (`2024001Ks`), y ningún
  -- nombre de producto del catálogo empieza con un número.
  SELECT btrim(coalesce(p_search, '')) ~ '^[0-9]'
     AND length(btrim(coalesce(p_search, ''))) >= 4;
$function$
;

CREATE OR REPLACE FUNCTION public.productos_por_codigo(p_search text)
 RETURNS integer[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  -- Cadena vacía o sin tokens ⇒ array vacío, NUNCA null: `= ANY(null)` es null,
  -- o sea que un `OR` con null nunca es verdadero pero tampoco es falso, y el
  -- planificador pierde la chance de descartarlo. Con `'{}'` la prueba es
  -- barata y explícitamente falsa.
  --
  -- La guarda de `es_busqueda_de_codigo` va PRIMERO y fuera del bucle: con un
  -- término que no es un código, esto tiene que costar cero, no 4,400
  -- normalizaciones. Es lo que devolvió `busqueda-vista-inventario` de 128 ms
  -- a su techo.
  SELECT CASE WHEN NOT public.es_busqueda_de_codigo(p_search) THEN '{}'::integer[]
    ELSE coalesce((
      SELECT array_agg(p.id)
      FROM public.products p
      WHERE coalesce(btrim(p.codigo_barras), '') <> ''
        AND public.norm_search(p.codigo_barras) LIKE ALL (
          ARRAY(SELECT '%' || tok || '%'
                FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok
                WHERE tok <> '')
        )
    ), '{}'::integer[])
  END;
$function$
;

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
    SELECT coalesce(json_agg(to_json(f) ORDER BY f.nombre), '[]'::json) INTO v_out
    FROM (
      SELECT p.id, p.nombre, p.foto_url, p.principio_activo,
             l.nombre AS laboratorio_nombre
      FROM public.products p
      LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
      WHERE p.activo AND p.id = ANY ((SELECT public.productos_por_codigo(p_search)))
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
$function$
;

CREATE OR REPLACE FUNCTION public.buscar_inventario_global_v2(p_search text, p_max_productos integer DEFAULT 60)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH toks AS MATERIALIZED (
    SELECT array_agg(tok) AS lista
    FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
    WHERE tok <> ''
  ),
  pats AS MATERIALIZED (
    SELECT (SELECT array_agg('%' || t || '%') FROM unnest(lista) t) AS todos,
           '%' || array_to_string(lista, '%') || '%'                AS ordenado
    FROM toks
    WHERE lista IS NOT NULL
  ),
  cods AS MATERIALIZED (
    SELECT public.productos_por_codigo(p_search) AS ids
  ),
  prods AS (
    SELECT p.id, p.principio_activo, p.foto_url,
           -- Por qué entró: por algo que IDENTIFICA al producto —su nombre o su
           -- código de barras— o sólo por su composición. El código pesa como
           -- el nombre a propósito: quien escanea una caja quiere esa caja
           -- primero, no los que comparten principio activo.
           (p.nombre_norm LIKE ALL (pats.todos)
            OR p.id = ANY (cods.ids)) AS por_nombre
    FROM public.products p, pats, cods
    WHERE p.nombre_norm LIKE ALL (pats.todos)
       OR p.id = ANY (cods.ids)
       OR (p.pactivo_norm <> '' AND p.pactivo_norm LIKE pats.ordenado)
  ),
  base AS (
    SELECT i.erp_sucursal_id, i.erp_product_id, i.descripcion, i.presentacion,
           i.detalle, i.factor, i.lote, i.fecha_vencimiento, i.cantidad, i.is_vencidos,
           pr.principio_activo, pr.foto_url, pr.por_nombre
    FROM public.v_inventario_lotes i
    JOIN prods pr ON pr.id = i.erp_product_id
    WHERE i.cantidad > 0
  ),
  -- Un renglón por producto. `por_nombre` es propiedad del producto, así que
  -- dentro del grupo es constante; `min(descripcion)` fija una clave estable
  -- cuando la misma referencia viene escrita distinto en dos salas.
  orden AS (
    SELECT b.erp_product_id,
           bool_or(b.por_nombre) AS por_nombre,
           min(b.descripcion)    AS descripcion_min
    FROM base b
    GROUP BY b.erp_product_id
  ),
  -- El desempate por id hace que dos búsquedas iguales elijan lo mismo. Sin él,
  -- cuáles entran al tope podría cambiar entre llamadas.
  elegidos AS (
    SELECT o.erp_product_id
    FROM orden o
    ORDER BY (NOT o.por_nombre), o.descripcion_min, o.erp_product_id
    LIMIT greatest(p_max_productos, 1)
  )
  SELECT json_build_object(
    'total_productos', (SELECT count(*) FROM orden),
    'filas', coalesce(
      (SELECT json_agg(json_build_object(
                'erp_sucursal_id',   f.erp_sucursal_id,
                'erp_product_id',    f.erp_product_id,
                'descripcion',       f.descripcion,
                'presentacion',      f.presentacion,
                'detalle',           f.detalle,
                -- El factor ya resuelto. Antes iba sólo `detalle` y el
                -- navegador lo deducía: por ahí entró la discrepancia del
                -- 2026-08-18 con `v_inventario_disponible`.
                'factor',            f.factor,
                'lote',              f.lote,
                'fecha_vencimiento', f.fecha_vencimiento,
                'cantidad',          f.cantidad,
                'is_vencidos',       f.is_vencidos,
                'principio_activo',  f.principio_activo,
                'foto_url',          f.foto_url)
              ORDER BY (NOT f.por_nombre), f.descripcion, f.fecha_vencimiento NULLS LAST,
                       f.erp_sucursal_id, f.lote NULLS LAST, f.presentacion NULLS LAST)
       FROM base f
       JOIN elegidos e ON e.erp_product_id = f.erp_product_id),
      '[]'::json)
  );
$function$
;

REVOKE EXECUTE ON FUNCTION public.es_busqueda_de_codigo(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.es_busqueda_de_codigo(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.productos_por_codigo(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.productos_por_codigo(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.es_busqueda_de_codigo(text) IS
  '¿El término escrito parece un código de barras? Empieza con dígito y mide 4+. Sirve para NO pagar la normalización de códigos en cada búsqueda por nombre.';
