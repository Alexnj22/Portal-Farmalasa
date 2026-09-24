SET lock_timeout = '5s';

-- La liga por nombre ignora los espacios repetidos.
--
-- Medido en la primera corrida (2026-09-24): 29 de 609 renglones sin producto,
-- y los 29 por lo mismo — el catálogo guarda «ELECTROLIT HORCHATA  X 625 ML»
-- con DOS espacios y la página del traslado los colapsa en uno. `norm_search`
-- no los colapsa, así que la igualdad exacta fallaba sobre el mismo producto.
--
-- El catálogo se arma UNA vez por llamada y se cruza con un hash join: comparar
-- con una expresión sobre la columna, renglón por renglón, barrería los 5,238
-- productos por cada uno.
CREATE OR REPLACE FUNCTION public.registrar_traslados_erp(p_lineas jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    n integer;
BEGIN
    WITH catalogo AS MATERIALIZED (
        SELECT DISTINCT ON (clave) clave, id
          FROM (SELECT regexp_replace(p.nombre_norm, '\s+', ' ', 'g') AS clave, p.id
                  FROM public.products p) c
         ORDER BY clave, id
    ),
    entrada AS (
        SELECT l, regexp_replace(public.norm_search(l->>'descripcion'), '\s+', ' ', 'g') AS clave
          FROM jsonb_array_elements(p_lineas) l
    )
    INSERT INTO public.traslados_erp_linea
        (id_traslado, posicion, fecha, erp_sucursal_destino, descripcion,
         presentacion, unidad, cantidad, erp_product_id, fuente)
    SELECT (e.l->>'id_traslado')::int,
           (e.l->>'posicion')::smallint,
           (e.l->>'fecha')::date,
           nullif(e.l->>'destino', '')::smallint,
           e.l->>'descripcion',
           nullif(e.l->>'presentacion', ''),
           nullif(e.l->>'unidad', '')::numeric,
           nullif(e.l->>'cantidad', '')::numeric,
           c.id,
           e.l->>'fuente'
      FROM entrada e
      LEFT JOIN catalogo c ON c.clave = e.clave
    ON CONFLICT (id_traslado, posicion) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_traslados_erp(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_traslados_erp(jsonb) TO service_role;

-- Los que ya entraron sin producto por esa causa.
UPDATE public.traslados_erp_linea t
   SET erp_product_id = c.id
  FROM (SELECT DISTINCT ON (clave) clave, id
          FROM (SELECT regexp_replace(p.nombre_norm, '\s+', ' ', 'g') AS clave, p.id FROM public.products p) x
         ORDER BY clave, id) c
 WHERE t.erp_product_id IS NULL
   AND c.clave = regexp_replace(public.norm_search(t.descripcion), '\s+', ' ', 'g');
