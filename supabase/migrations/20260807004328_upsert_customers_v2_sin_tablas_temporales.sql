-- Sin tablas temporales.
--
-- La versión de 20260807004230 usaba `CREATE TEMP TABLE ... ON COMMIT DROP`, y
-- eso se rompe a la SEGUNDA llamada dentro de la misma transacción:
--   ERROR: relation "_entrada" already exists
-- El sync la llama una vez por sucursal, así que habría fallado en la segunda
-- — y en la función que registra las ventas eso no es un reporte roto, es el
-- registro del día. Detectado probando con BEGIN…ROLLBACK antes de tocar el
-- sync; el test hacía dos llamadas seguidas justamente por eso.
--
-- Qué hace, para no tener que ir al archivo anterior:
--   erp_id conocido y YA existe esa ficha  → se liga a ella. No crea nada.
--   erp_id conocido y no existe            → crea la ficha CON su erp_id,
--                                            emparejada desde el día uno.
--   erp_id NULL (el ERP no contestó)       → exactamente lo de antes: liga por
--                                            nombre o crea. Nunca se pierde la
--                                            factura por esto.
--   erp_id nuevo pero el NOMBRE ya existe  → liga al del nombre. Son dos
--     personas homónimas y `customers_name_norm_idx` sólo admite una; forzar
--     la segunda abortaría el lote entero del sync. Se prefiere el
--     comportamiento de hoy antes que romper el registro de ventas.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.upsert_customers_v2(p_rows json)
RETURNS TABLE(customer_name text, customer_id bigint)
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  -- 1 · Crear solo lo que no existe ni por número ni por nombre.
  INSERT INTO public.customers (name, erp_id)
  SELECT e.nombre, e.erp_id
  FROM (
    SELECT DISTINCT upper(btrim(x.nombre)) AS nombre,
           nullif(btrim(coalesce(x.erp_id, '')), '') AS erp_id
    FROM json_to_recordset(p_rows) AS x(nombre text, erp_id text)
    WHERE upper(btrim(coalesce(x.nombre, ''))) <> ''
  ) e
  WHERE NOT EXISTS (SELECT 1 FROM public.customers c
                     WHERE e.erp_id IS NOT NULL AND c.erp_id = e.erp_id)
    AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.name = e.nombre)
  ON CONFLICT DO NOTHING;

  -- 2 · Devolver el mapa ya resuelto. Se relee `customers` en vez de usar el
  -- RETURNING del insert: así una fila que perdió una carrera con otra
  -- invocación igual sale con su id, en lugar de dejar la factura sin cliente.
  RETURN QUERY
  SELECT e.nombre,
         coalesce(por_erp.id, por_nombre.id) AS id
  FROM (
    SELECT DISTINCT upper(btrim(x.nombre)) AS nombre,
           nullif(btrim(coalesce(x.erp_id, '')), '') AS erp_id
    FROM json_to_recordset(p_rows) AS x(nombre text, erp_id text)
    WHERE upper(btrim(coalesce(x.nombre, ''))) <> ''
  ) e
  -- El número manda; el nombre es el respaldo.
  LEFT JOIN public.customers por_erp    ON e.erp_id IS NOT NULL
                                       AND por_erp.erp_id = e.erp_id
  LEFT JOIN public.customers por_nombre ON por_nombre.name = e.nombre
  WHERE coalesce(por_erp.id, por_nombre.id) IS NOT NULL;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.upsert_customers_v2(json) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.upsert_customers_v2(json) TO authenticated, service_role;
