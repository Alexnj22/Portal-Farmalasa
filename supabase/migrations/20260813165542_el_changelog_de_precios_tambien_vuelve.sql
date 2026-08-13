SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- La OTRA mitad del mismo bug: `product_precios_changelog`.
--
-- La migración 20260813164845 devolvió la escritura a `product_precios_history`,
-- pero el barrido que la encontró tenía un segundo resultado con **la misma
-- fecha exacta de muerte, 2026-06-03**: este changelog campo-a-campo. Misma
-- causa —vivía del write-churn del sync y se fue con él— y mismo síntoma: nada
-- falla, la tabla simplemente deja de crecer.
--
-- Y también se lee. `src/data/productos.js` lo consulta dos veces (la lista de
-- productos con cambios, y el detalle campo-a-campo de uno) y
-- `TabCatalogo.jsx` lo pagina en su pestaña de cambios. O sea que desde el
-- 2026-06-03 esas tres pantallas muestran una lista congelada, sin decirlo.
--
-- POR QUÉ NO SE AGREGA `costo` AL VOCABULARIO. Las 1,667 filas existentes usan
-- sólo los siete campos de precio (vineta, descuento_1, vip, clinica, mayoreo,
-- premium, precio_7). El costo NO está, y no se suma: la consulta de
-- `productos.js` que lee este changelog **no filtra por permiso de ver costos**
-- —a diferencia de la de `purchase_receipt_items`, que sí está detrás de
-- `canSeeCosts`— así que agregarlo mostraría el historial de costos a quien sólo
-- puede ver precios. El costo ya queda versionado en `product_precios_history`,
-- que es donde corresponde.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upsert_product_precios_batch(p_rows jsonb)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
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
-- El estado ANTERIOR. Se puede leer acá aunque `upserted` esté por modificar la
-- tabla: todas las CTE de una misma sentencia comparten el snapshot, así que
-- esto ve lo de antes. Es lo que permite armar el «valor_anterior» sin un
-- trigger aparte.
previo AS (
  SELECT pp.product_id, pp.id_presentacion, pp.vineta, pp.descuento_1, pp.vip,
         pp.clinica, pp.mayoreo, pp.premium, pp.precio_7
    FROM public.product_precios pp
    JOIN incoming i
      ON i.product_id = pp.product_id AND i.id_presentacion = pp.id_presentacion
),
upserted AS (
  INSERT INTO public.product_precios AS pp
    (product_id, id_presentacion, descripcion, factor, activo, costo, vineta,
     descuento_1, vip, clinica, mayoreo, premium, precio_7, updated_at)
  SELECT i.product_id, i.id_presentacion, i.descripcion, i.factor, i.activo,
         i.costo, i.vineta, i.descuento_1, i.vip, i.clinica, i.mayoreo,
         i.premium, i.precio_7, now()
  FROM incoming i
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
            pp.vip, pp.clinica, pp.mayoreo, pp.premium, pp.precio_7
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
)
SELECT count(*)::integer FROM upserted;
$function$;

COMMENT ON FUNCTION public.upsert_product_precios_batch(jsonb) IS
  'Sincroniza precios y costo sin churn: sólo escribe cuando algún valor cambió de verdad. Ese mismo conjunto alimenta las dos bitácoras que dependían del churn y murieron con él el 2026-06-03: product_precios_history (una versión SCD2 por cambio, con costo) y product_precios_changelog (una fila por CAMPO de precio que cambió, sin costo — la pantalla que lo lee no filtra por permiso de ver costos).';
