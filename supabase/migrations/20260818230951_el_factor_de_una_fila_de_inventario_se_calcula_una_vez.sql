SET lock_timeout = '5s';

-- ── Cuántas unidades trae una fila de inventario: UNA sola respuesta ────────
--
-- Lo reportó el usuario el 2026-08-18 sobre CLOPRIM X 3 AMPOLLAS: la Consulta
-- de Inventario decía «Bodega · 3 uds» y el formulario de pedirlo, abierto
-- desde esa misma fila, decía «Bodega — 1 unidad». Y no era cosmético: la
-- guarda del formulario y el trigger `validar_solicitud_traslado` leen ese 1,
-- así que la caja de Bodega **no se podía pedir**.
--
-- La causa es que el mismo número se calculaba de dos maneras:
--
--   · el navegador lo sacaba de `detalle` (`1X3` → 3);
--   · `v_inventario_disponible` lo sacaba del catálogo, cruzando
--     `upper(pr.tipo) = upper(i.presentacion)`.
--
-- Ese cruce falla cuando la presentación trae un espacio al final —el sistema
-- de origen manda `'CAJA '` y el catálogo dice `'CAJA'`—, y entonces caía al
-- `coalesce(factor, 1)`: la caja de 3 contada como 1. Sin error y sin log.
-- Medido: 436 filas con existencia traen ese espacio (`CAJA `, `BOTE `,
-- `SOBRE X 2 `, `CAJA X 10 SOBRES `, `FRASCO X 20 ML `, `CAJA X 25 `,
-- `PAQUETE `), y eran 78 pares producto·sala mal contados sobre 23 productos y
-- 4,988 unidades invisibles. Ninguna corrección baja una existencia.
--
-- ── La regla, y por qué es ésta ─────────────────────────────────────────────
-- Ninguna de las dos fuentes alcanza sola, y eso está MEDIDO, no supuesto:
--
--   · El catálogo se equivoca cuando la misma etiqueta existe dos veces con
--     factores distintos. CETRADOL X 10 tiene dos `CAJA` —de 1 y de 10— y en
--     inventario conviven las dos: sólo `detalle` dice cuál es cuál.
--   · `detalle` se equivoca cuando el sistema de origen lo manda flojo.
--     ELEQUINE 750 X 20 llega como `CAJA X 20` con `detalle = '1'`; PAXIL CR 25
--     X 30 y ENALAM 25MG X 10 llegan con `1X1` dentro de una caja de 30 y de
--     10. Ahí el catálogo es el único que sabe.
--
-- Entonces: **el catálogo dice qué factores son posibles y `detalle` elige
-- entre ellos.** Si `detalle` propone un factor que el catálogo no reconoce, no
-- se le hace caso. En orden: el de `detalle` si el catálogo lo tiene; si no, el
-- del catálogo (el mayor, cuando hay varios); si no hay catálogo para esa
-- etiqueta, el de `detalle`; y 1 al final.
--
-- El catálogo entra corregido en las tres cosas que estaban mal —recortando el
-- espacio, descartando el factor 0 y quedándose con el mayor—, que es lo que ya
-- hacía `mv_product_factor` y esta vista no. El factor 0 no es hipotético: hay
-- tres productos con factor 0 activo (las recargas de saldo), y el
-- `ORDER BY pp.factor LIMIT 1` viejo hacía ganar al 0 — la vista reportaba
-- **0 unidades** sobre 453 recargas Tigo, 134 Movistar y 114 Digicel.
--
-- Un 0 nunca sale de acá: borraría la existencia en silencio, que es peor que
-- contarla mal.
--
-- ── Por qué un lateral y no una función por fila ────────────────────────────
-- La primera forma de esto era una función `factor_de_inventario(detalle,
-- presentacion, product_id)` llamada dentro del `sum()`. Tiene CTEs, así que el
-- planificador no la inlinea y quedaba un SubPlan por cada una de las 24,000
-- filas: `get_faltantes_con_stock_en_otra_sala(6,40)` —lo que el tablero llama
-- al entrar— pasó de 122 ms a **692 ms**. Una vista intermedia que agregaba el
-- catálogo entero por consulta tampoco sirvió (244 ms). El lateral con `FILTER`
-- da 148 ms, que es el precio de contar bien: la forma vieja era más barata
-- porque hacía menos.
--
-- Es la misma trampa de CLAUDE.md §«una función con parámetros se mide SEIS
-- veces»: el SQL se lee bien y el plan es otra cosa.

-- ── `v_inventario_lotes` es EL lugar donde se resuelve el factor ────────────
-- `v_inventario_disponible` y `buscar_inventario_global_v2` lo leen de acá en
-- vez de repetir la regla, y el navegador lo recibe ya resuelto. Que dos
-- fuentes coincidan es cuestión de suerte; que haya una sola, no.
--
-- `security_invoker`: se apoya en la policy de lectura de `inventory`, no la
-- rodea.
CREATE OR REPLACE VIEW public.v_inventario_lotes
WITH (security_invoker = true) AS
    SELECT i.id,
           i.erp_sucursal_id,
           i.erp_product_id,
           i.descripcion,
           i.presentacion,
           i.detalle,
           i.lote,
           i.fecha_vencimiento,
           i.cantidad,
           i.is_vencidos,
           (coalesce(c.confirmado, c.mayor, d.f, 1))::integer AS factor
    FROM public.inventory i
    CROSS JOIN LATERAL (
        -- Se normalizan los espacios antes de leer: vienen `1x30`, `1 X 1` y
        -- `1X 16`. Medido sobre las 24,181 filas del inventario: 24,031 en
        -- formato limpio, 48 con un `1` pelado y 102 con variantes.
        SELECT nullif(
                   (substring(upper(regexp_replace(btrim(coalesce(i.detalle, '')), '\s+', ' ', 'g'))
                              from 'X\s*([0-9]+)$'))::integer,
                   0) AS f
    ) d
    LEFT JOIN LATERAL (
        SELECT max(pp.factor) FILTER (WHERE pp.factor = d.f) AS confirmado,
               max(pp.factor)                                AS mayor
        FROM public.product_precios pp
        JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
        WHERE pp.product_id = i.erp_product_id
          AND upper(btrim(pr.tipo)) = upper(btrim(i.presentacion))
          AND pp.activo
          AND pp.factor > 0
    ) c ON true;

REVOKE ALL ON public.v_inventario_lotes FROM PUBLIC, anon;
GRANT SELECT ON public.v_inventario_lotes TO authenticated, service_role;

COMMENT ON VIEW public.v_inventario_lotes IS
    'Las filas de inventory con su factor ya resuelto. Única definición de '
    'cuántas unidades base trae una fila: el catálogo dice qué factores son '
    'posibles para la etiqueta y `detalle` elige entre ellos.';


-- ── La existencia disponible, sumando ese factor ────────────────────────────
-- Mismo cuerpo que antes; lo único que cambia es de dónde sale el factor.
CREATE OR REPLACE VIEW public.v_inventario_disponible
WITH (security_invoker = true) AS
    WITH crudo AS (
        SELECT l.erp_product_id,
               l.erp_sucursal_id,
               sum(l.cantidad * l.factor)::numeric AS unidades
        FROM public.v_inventario_lotes l
        WHERE l.is_vencidos = false AND l.cantidad > 0
        GROUP BY 1, 2
    )
    SELECT c.erp_product_id,
           c.erp_sucursal_id,
           c.unidades                              AS unidades_sistema,
           coalesce(v.unidades, 0)                 AS en_vuelo,
           greatest(c.unidades - coalesce(v.unidades, 0), 0) AS unidades
    FROM crudo c
    LEFT JOIN public.traslados_en_vuelo() v
           ON v.erp_product_id = c.erp_product_id
          AND v.erp_sucursal_id = c.erp_sucursal_id;

GRANT SELECT ON public.v_inventario_disponible TO authenticated, service_role;


-- ── El buscador manda el factor, no el texto del que se deduce ──────────────
-- `detalle` sigue viajando porque la pantalla lo muestra; lo que cambia es que
-- el número ya no se deduce dos veces.
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
  prods AS (
    SELECT p.id, p.principio_activo, p.foto_url,
           -- Por qué entró: por su nombre, o sólo por su composición.
           (p.nombre_norm LIKE ALL (pats.todos)) AS por_nombre
    FROM public.products p, pats
    WHERE p.nombre_norm LIKE ALL (pats.todos)
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
$function$;
