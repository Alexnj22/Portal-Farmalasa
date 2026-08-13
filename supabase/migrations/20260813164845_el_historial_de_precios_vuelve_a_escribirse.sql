SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- `product_precios_history` estaba rota de tres formas distintas, y ninguna
-- fallaba. Descubierto el 2026-08-13 buscando el costo histórico para
-- reconstruir el costo de venta: la tabla PARECE la respuesta —es SCD2, tiene
-- `valid_from`/`valid_until` y una columna `costo`— y no lo es.
--
--   1. NADIE LA ESCRIBE. `upsert_product_precios_batch` —la única vía por la que
--      entran precios— no la menciona. La versión anterior insertaba una fila
--      POR CORRIDA del sync aunque nada cambiara (el write-churn que documenta
--      `src/data/productos.js`), y al corregir ese churn se llevó el historial
--      puesto. Última versión registrada: **2026-06-03**.
--
--   2. `costo` ESTÁ NULL EN LAS 26,739 FILAS. La columna existe desde el
--      baseline y jamás se escribió. Ese dato no se puede recuperar: el costo de
--      mayo/junio no está en ningún otro lado. Las filas viejas se quedan en
--      NULL, que es la verdad — de ahora en adelante sí se escribe.
--
--   3. LA TABLA CONTRADICE AL PRESENTE. De las 2,442 filas abiertas
--      (`valid_until IS NULL`), **210 declaran un precio que ya no es el vivo**,
--      y 5,571 de las 8,013 claves de `product_precios` no tienen NINGUNA fila
--      abierta. O sea que «el precio vigente según el historial» era falso para
--      210 y no existía para 5,571.
--
-- Un historial que nadie escribe y que además miente sobre el presente es peor
-- que no tenerlo: `src/data/productos.js`, `src/data/ventas.js` y
-- `TabCatalogo.jsx` lo leen y dibujan su serie con lo que haya.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · QUE EL SYNC VUELVA A ESCRIBIRLO ─────────────────────────────────────
-- Mismo INSERT ... ON CONFLICT ... WHERE IS DISTINCT FROM que ya estaba: el
-- churn NO vuelve. La clave es que ese `WHERE` **ya calcula** exactamente el
-- conjunto que interesa —las filas que cambiaron de verdad— y el `RETURNING` lo
-- entrega. El historial se cuelga de ahí: una versión nueva por cambio real, no
-- por corrida.
--
-- Las dos CTE de escritura se ejecutan aunque la consulta principal no las
-- referencie (Postgres garantiza que toda CTE que modifica datos corre una vez),
-- y comparten el snapshot: `cerradas` no puede ver las filas que inserta
-- `nuevas`, así que no existe el riesgo de cerrar la versión recién abierta.
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
)
SELECT count(*)::integer FROM upserted;
$function$;

COMMENT ON FUNCTION public.upsert_product_precios_batch(jsonb) IS
  'Sincroniza precios y COSTO sin churn: sólo escribe cuando algún valor cambió de verdad. Ese mismo conjunto abre una versión nueva en product_precios_history (SCD2) y cierra la anterior — una versión por cambio real, nunca una por corrida.';

-- ── 2 · QUE EL HISTORIAL DEJE DE CONTRADECIR AL PRESENTE ────────────────────
-- Se cierra toda fila abierta cuyos valores ya no son los vivos (210 medidas
-- hoy) y se abre una que sí lo sea, más las 5,571 claves que nunca tuvieron
-- ninguna. Es idempotente: corrido de nuevo no hace nada.
--
-- `valid_from = now()` y NO `product_precios.updated_at`, aunque tiente. Medido:
-- 7,715 de las 8,013 filas tienen `updated_at` de julio-2026 — eso es una
-- corrida masiva, no la fecha en que cada precio entró en vigencia. Fechar la
-- versión con ese dato sería afirmar algo que no se puede sostener. Esta línea
-- dice lo único cierto: «estos son los valores el día que se reparó el
-- historial».
WITH desfasadas AS (
  UPDATE public.product_precios_history h
     SET valid_until = now()
    FROM public.product_precios pp
   WHERE pp.product_id      = h.product_id
     AND pp.id_presentacion = h.id_presentacion
     AND h.valid_until IS NULL
     AND (h.vineta, h.descuento_1, h.vip, h.clinica, h.mayoreo, h.premium, h.precio_7)
         IS DISTINCT FROM
         (pp.vineta, pp.descuento_1, pp.vip, pp.clinica, pp.mayoreo, pp.premium, pp.precio_7)
  RETURNING h.product_id, h.id_presentacion
)
INSERT INTO public.product_precios_history
  (product_id, id_presentacion, costo, vineta, descuento_1, vip, clinica,
   mayoreo, premium, precio_7, valid_from, valid_until)
SELECT pp.product_id, pp.id_presentacion, pp.costo, pp.vineta, pp.descuento_1,
       pp.vip, pp.clinica, pp.mayoreo, pp.premium, pp.precio_7, now(), NULL
  FROM public.product_precios pp
 WHERE NOT EXISTS (
   SELECT 1 FROM public.product_precios_history h2
    WHERE h2.product_id = pp.product_id
      AND h2.id_presentacion = pp.id_presentacion
      AND h2.valid_until IS NULL
 )
 OR EXISTS (SELECT 1 FROM desfasadas d
             WHERE d.product_id = pp.product_id AND d.id_presentacion = pp.id_presentacion);

COMMENT ON COLUMN public.product_precios_history.costo IS
  'Costo vigente en esa versión. NULL en las 26,739 filas anteriores al 2026-08-13: la columna existía desde el baseline y nunca se escribió, y ese dato no está en ningún otro lado. Desde esa fecha lo escribe upsert_product_precios_batch.';
