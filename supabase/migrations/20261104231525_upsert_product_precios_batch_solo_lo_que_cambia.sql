-- upsert_product_precios_batch: sólo lo que cambió llega al ON CONFLICT
-- (2026-11-04).
--
-- `sync-products` manda las ~8,100 presentaciones en cada corrida y casi
-- ninguna cambia. Todas entraban al ON CONFLICT y al CTE `previo`, que las
-- buscaban por índice una por una: 40,933 bloques por llamada sobre una tabla
-- de 270. Ahora `actual` lee la tabla una vez, `cambian` aparta por hash join
-- lo nuevo o distinto, y `previo` y el INSERT trabajan sólo sobre eso.
-- `actual` va MATERIALIZED porque `jsonb_to_recordset` se estima en 100 filas
-- y con esa estimación el planificador volvía a elegir el índice por fila.
--
-- Medido en transacción revertida (payload real, 246 cambios de precio y de
-- activo; y sin cambios): mismo resultado y mismo md5 de product_precios,
-- product_precios_history, product_precios_changelog y cambios_de_factor.
-- Sin cambios: 40,933 → 311 bloques, 86 → 54 ms. Con cambios: 197 → 108 ms.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.upsert_product_precios_batch(p_rows jsonb)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
WITH incoming AS (
  SELECT * FROM jsonb_to_recordset(p_rows) AS r(
    product_id      integer,
    id_presentacion integer,
    descripcion     text,
    factor          integer,
    activo          boolean,
    costo           numeric,
    vineta          numeric,
    descuento_1     numeric,
    vip             numeric,
    clinica         numeric,
    mayoreo         numeric,
    premium         numeric,
    precio_7        numeric
  )
),
-- Sólo lo nuevo o lo que cambió llega al INSERT (2026-11-04). Antes las
-- ~6,900 filas de cada corrida entraban al ON CONFLICT, que busca cada una
-- por índice aunque casi ninguna cambie: 43,000 bloques por llamada contra una
-- tabla de 270. Un hash join contra la tabla las aparta en una pasada.
-- `actual` se lee entera (270 bloques) y MATERIALIZED a propósito:
-- `jsonb_to_recordset` se estima en 100 filas aunque traiga 8,000, y con esa
-- estimación el planificador elige una búsqueda por índice por fila —que es
-- justo el costo que esto quita—. Contra un CTE no hay índice: hash join.
actual AS MATERIALIZED (
  SELECT pp.product_id, pp.id_presentacion, pp.descripcion, pp.factor, pp.activo,
         pp.costo, pp.vineta, pp.descuento_1, pp.vip, pp.clinica, pp.mayoreo,
         pp.premium, pp.precio_7
    FROM public.product_precios pp
),
cambian AS (
  SELECT i.*
    FROM incoming i
    LEFT JOIN actual pp
      ON pp.product_id = i.product_id AND pp.id_presentacion = i.id_presentacion
   WHERE pp.product_id IS NULL
      OR (pp.descripcion, pp.factor, pp.activo, pp.costo, pp.vineta,
          pp.descuento_1, pp.vip, pp.clinica, pp.mayoreo, pp.premium, pp.precio_7)
         IS DISTINCT FROM
         (i.descripcion, i.factor, i.activo, i.costo, i.vineta,
          i.descuento_1, i.vip, i.clinica, i.mayoreo, i.premium, i.precio_7)
),
-- El estado ANTERIOR. Se puede leer acá aunque `upserted` esté por modificar la
-- tabla: todas las CTE de una misma sentencia comparten el snapshot, así que
-- esto ve lo de antes. Es lo que permite armar el «valor_anterior» sin un
-- trigger aparte.
previo AS (
  SELECT pp.product_id, pp.id_presentacion, pp.vineta, pp.descuento_1, pp.vip,
         pp.clinica, pp.mayoreo, pp.premium, pp.precio_7, pp.factor, pp.activo
    FROM public.product_precios pp
    -- Sólo las que cambian: `previo` lo leen el changelog y el cambio de
    -- factor, y los dos lo cruzan contra `upserted`, que sale de `cambian`.
    JOIN cambian i
      ON i.product_id = pp.product_id AND i.id_presentacion = pp.id_presentacion
),
upserted AS (
  INSERT INTO public.product_precios AS pp
    (product_id, id_presentacion, descripcion, factor, activo, costo, vineta,
     descuento_1, vip, clinica, mayoreo, premium, precio_7, updated_at)
  SELECT i.product_id, i.id_presentacion, i.descripcion, i.factor, i.activo,
         i.costo, i.vineta, i.descuento_1, i.vip, i.clinica, i.mayoreo,
         i.premium, i.precio_7, now()
  FROM cambian i
  ON CONFLICT (product_id, id_presentacion) DO UPDATE
    SET descripcion = EXCLUDED.descripcion,
        factor      = EXCLUDED.factor,
        activo      = EXCLUDED.activo,
        costo       = EXCLUDED.costo,
        vineta      = EXCLUDED.vineta,
        descuento_1 = EXCLUDED.descuento_1,
        vip         = EXCLUDED.vip,
        clinica     = EXCLUDED.clinica,
        mayoreo     = EXCLUDED.mayoreo,
        premium     = EXCLUDED.premium,
        precio_7    = EXCLUDED.precio_7,
        updated_at  = EXCLUDED.updated_at
    WHERE (pp.descripcion, pp.factor, pp.activo, pp.costo, pp.vineta,
           pp.descuento_1, pp.vip, pp.clinica, pp.mayoreo, pp.premium, pp.precio_7)
          IS DISTINCT FROM
          (EXCLUDED.descripcion, EXCLUDED.factor, EXCLUDED.activo, EXCLUDED.costo,
           EXCLUDED.vineta, EXCLUDED.descuento_1, EXCLUDED.vip, EXCLUDED.clinica,
           EXCLUDED.mayoreo, EXCLUDED.premium, EXCLUDED.precio_7)
  RETURNING pp.product_id, pp.id_presentacion, pp.costo, pp.vineta, pp.descuento_1,
            pp.vip, pp.clinica, pp.mayoreo, pp.premium, pp.precio_7,
            pp.factor, pp.activo
),
cerradas AS (
  UPDATE public.product_precios_history h
     SET valid_until = now()
    FROM upserted u
   WHERE h.product_id      = u.product_id
     AND h.id_presentacion = u.id_presentacion
     AND h.valid_until IS NULL
  RETURNING 1
),
nuevas AS (
  INSERT INTO public.product_precios_history
    (product_id, id_presentacion, costo, vineta, descuento_1, vip, clinica,
     mayoreo, premium, precio_7, valid_from, valid_until)
  SELECT u.product_id, u.id_presentacion, u.costo, u.vineta, u.descuento_1,
         u.vip, u.clinica, u.mayoreo, u.premium, u.precio_7, now(), NULL
  FROM upserted u
  RETURNING 1
),
-- Una fila POR CAMPO que cambió, que es la forma que ya tienen las 1,667
-- existentes. El JOIN contra `previo` deja fuera a los productos nuevos: dar de
-- alta no es cambiar un precio, y sin esto un alta escribiría siete filas de
-- «cambio» con `valor_anterior` vacío.
changelog AS (
  INSERT INTO public.product_precios_changelog
    (product_id, id_presentacion, campo, valor_anterior, valor_nuevo, detected_at)
  SELECT u.product_id, u.id_presentacion, v.campo, v.anterior, v.nuevo, now()
    FROM upserted u
    JOIN previo p
      ON p.product_id = u.product_id AND p.id_presentacion = u.id_presentacion
   CROSS JOIN LATERAL (VALUES
      ('vineta',      p.vineta::text,      u.vineta::text),
      ('descuento_1', p.descuento_1::text, u.descuento_1::text),
      ('vip',         p.vip::text,         u.vip::text),
      ('clinica',     p.clinica::text,     u.clinica::text),
      ('mayoreo',     p.mayoreo::text,     u.mayoreo::text),
      ('premium',     p.premium::text,     u.premium::text),
      ('precio_7',    p.precio_7::text,    u.precio_7::text)
   ) AS v(campo, anterior, nuevo)
   WHERE v.anterior IS DISTINCT FROM v.nuevo
  RETURNING 1
),
-- El factor de un producto cambió (2026-10-15). La caja no lo cambia en la
-- misma fila: desactiva la presentación vieja y activa otra, así que cuenta
-- tanto un factor distinto como una fila que se prende o se apaga. El trabajo
-- —reescribir el historial, convertir el MIN·MAX— lo hace
-- procesar_cambios_de_factor() fuera de esta sentencia: la carga de precios no
-- puede tardar lo que tarda recalcular seis salas.
--
-- `catalogo_antes` (2026-10-29): las presentaciones activas que el producto
-- tenía ANTES de esta carga. Es el de→a que usa la revisión de existencia
-- cuando no hay ventas con el tamaño viejo de donde sacarlo.
cambio_de_factor AS (
  INSERT INTO public.cambios_de_factor (erp_product_id, catalogo_antes)
  SELECT q.product_id,
         (SELECT jsonb_agg(jsonb_build_object('tipo', upper(trim(pr.tipo)), 'factor', pp.factor)
                           ORDER BY pr.tipo, pp.factor)
            FROM public.product_precios pp
            JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
           WHERE pp.product_id = q.product_id AND pp.activo AND pp.factor > 0)
    FROM (
      SELECT DISTINCT u.product_id
        FROM upserted u
        LEFT JOIN previo p
          ON p.product_id = u.product_id AND p.id_presentacion = u.id_presentacion
       WHERE ((p.product_id IS NULL AND u.activo)
              OR (p.product_id IS NOT NULL
                  AND (p.factor IS DISTINCT FROM u.factor OR p.activo IS DISTINCT FROM u.activo)))
         AND NOT EXISTS (SELECT 1 FROM public.cambios_de_factor c
                          WHERE c.erp_product_id = u.product_id AND c.procesado_at IS NULL)
    ) q
  RETURNING 1
)
SELECT count(*)::integer FROM upserted;
$function$
;
