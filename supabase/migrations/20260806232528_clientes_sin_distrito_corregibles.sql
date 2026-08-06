-- La lista de fichas que el bucle de corrección puede tocar.
--
-- Existe para que `scripts/migracion-clientes/resolver_observaciones.py` NO
-- duplique el criterio. PostgREST no puede llamar a `es_cliente_mostrador` en
-- un filtro (toma dos text, no la fila), así que la alternativa era repetir sus
-- cuatro nombres y dos ids en Python — y una lista duplicada que nadie verifica
-- se desincroniza en silencio. Acá el criterio canónico se aplica una sola vez,
-- del lado del servidor.
--
-- Reglas del alcance, decididas el 2026-08-06:
--   · Solo Consumidor, o sin categoría. Las sin categoría son las huérfanas que
--     `upsert_customers` crea desde el nombre que trae la factura (sin erp_id,
--     sin nada): son consumidores de hecho, 11,612 facturas COF.
--   · Contribuyente / Gran Contribuyente / Extranjero se SALTAN: sus datos se
--     declaran a Hacienda y no los decide una corrida automática. Misma regla
--     que ya aplica `bloque.py`.
--   · Nunca la ficha del mostrador — en este catálogo tiene 10,395 facturas, y
--     escribirle un distrito sería ponerle domicilio fiscal al genérico.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.clientes_sin_distrito_corregibles()
RETURNS TABLE (id bigint, name text, erp_id text, categoria text,
               direccion text, departamento text, municipio text)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $fn$
  SELECT c.id, c.name, c.erp_id, c.categoria,
         c.direccion, c.departamento, c.municipio
  FROM public.customers c
  WHERE c.distrito IS NULL
    AND (c.categoria = 'Consumidor' OR c.categoria IS NULL)
    AND NOT public.es_cliente_mostrador(c.name, c.erp_id)
  ORDER BY c.id;
$fn$;

REVOKE EXECUTE ON FUNCTION public.clientes_sin_distrito_corregibles() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.clientes_sin_distrito_corregibles() TO authenticated, service_role;
