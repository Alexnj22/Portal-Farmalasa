-- Ligar la factura a su cliente POR NÚMERO, no por cómo se escribió el nombre.
--
-- `upsert_customers(names)` hace `INSERT INTO customers (name)` para todo
-- nombre que no reconoce, y el nombre viene de cómo se escribió la factura.
-- Cualquier diferencia —una letra, un espacio, un acento mal guardado— abre
-- ficha nueva. Medido el 2026-08-06: 68 clientes partidos en dos, 1,127
-- facturas colgando de la mitad equivocada, y ~22 nuevos por día.
--
-- Y no se arregla normalizando el texto. Probado contra esos mismos 68:
--   nombre exacto (hoy) ....... 0 evitados
--   + sin acentos ni ñ ........ 0
--   + espacios colapsados ..... 1
--   + solo alfanumérico ....... 3
-- El 96% son nombres genuinamente distintos (VAQUEZ/VASQUEZ,
-- ALVARNEGA/ALVARENGA, MARTINEZ DE HERNANDEZ/MARTINEZ MEJIA).
--
-- ⚠️ ESTA VERSIÓN TIENE UN BUG y la reemplaza 20260807004328: usaba
-- `CREATE TEMP TABLE ... ON COMMIT DROP`, que falla a la SEGUNDA llamada
-- dentro de la misma transacción ("relation _entrada already exists"). Se
-- conserva el archivo porque la migración se aplicó y el registro no se
-- reescribe hacia atrás.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.upsert_customers_v2(p_rows json)
RETURNS TABLE(customer_name text, customer_id bigint)
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  CREATE TEMP TABLE _entrada ON COMMIT DROP AS
  SELECT DISTINCT
         upper(btrim(x.nombre)) AS nombre,
         nullif(btrim(coalesce(x.erp_id, '')), '') AS erp_id
  FROM json_to_recordset(p_rows) AS x(nombre text, erp_id text)
  WHERE upper(btrim(coalesce(x.nombre, ''))) <> '';

  CREATE TEMP TABLE _resuelto ON COMMIT DROP AS
  SELECT e.nombre, c.id
  FROM _entrada e
  JOIN public.customers c ON c.erp_id = e.erp_id
  WHERE e.erp_id IS NOT NULL;

  INSERT INTO _resuelto (nombre, id)
  SELECT e.nombre, c.id
  FROM _entrada e
  JOIN public.customers c ON c.name = e.nombre
  WHERE NOT EXISTS (SELECT 1 FROM _resuelto r WHERE r.nombre = e.nombre);

  INSERT INTO public.customers (name, erp_id)
  SELECT e.nombre, e.erp_id
  FROM _entrada e
  WHERE NOT EXISTS (SELECT 1 FROM _resuelto r WHERE r.nombre = e.nombre)
  ON CONFLICT DO NOTHING;

  RETURN QUERY
  SELECT e.nombre, c.id
  FROM _entrada e
  JOIN public.customers c
    ON c.id = coalesce(
         (SELECT r.id FROM _resuelto r WHERE r.nombre = e.nombre LIMIT 1),
         (SELECT c2.id FROM public.customers c2 WHERE c2.name = e.nombre LIMIT 1));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.upsert_customers_v2(json) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.upsert_customers_v2(json) TO authenticated, service_role;
