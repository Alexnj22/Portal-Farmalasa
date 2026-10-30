SET lock_timeout = '5s';

-- La llave con que dos nombres son EL MISMO producto: sin tildes, sin signos,
-- sin espacios. «GALLETA OREO X 12» y «GALLETA OREO X12» dan lo mismo.
CREATE OR REPLACE FUNCTION public.producto_llave_nombre(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions AS $$
  SELECT replace(public.compactar_busqueda(p), ' ', '');
$$;
REVOKE EXECUTE ON FUNCTION public.producto_llave_nombre(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.producto_llave_nombre(text) TO authenticated, service_role;

-- El candado del alta usa la MISMA llave: dos altas de «X 12» y «X12» a la vez
-- ya no pasan las dos.
DROP INDEX IF EXISTS public.producto_alta_portal_nombre_vivo;
CREATE UNIQUE INDEX producto_alta_portal_nombre_vivo
  ON public.producto_alta_portal (public.producto_llave_nombre(nombre)) WHERE estado <> 'fallido';

-- Antes de dar de alta un producto: los que YA son él (frenan) y los que se le
-- parecen (sólo avisan). Mira el catálogo y también las altas del portal que
-- todavía no llegaron al catálogo (se copia cada 10 min).
CREATE OR REPLACE FUNCTION public.producto_alta_iguales(p_nombre text, p_barcode text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
DECLARE
  v_llave text := public.producto_llave_nombre(p_nombre);
  v_norm  text := public.norm_search(p_nombre);
  v_bar   text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_iguales json; v_parecidos json;
BEGIN
  IF length(v_llave) < 3 THEN RETURN json_build_object('iguales', '[]'::json, 'parecidos', '[]'::json); END IF;

  SELECT coalesce(json_agg(x ORDER BY x.por, x.id), '[]'::json) INTO v_iguales FROM (
    SELECT p.id, p.nombre, p.activo, CASE WHEN v_bar IS NOT NULL AND p.codigo_barras = v_bar THEN 'codigo' ELSE 'nombre' END AS por
      FROM products p
     WHERE public.producto_llave_nombre(p.nombre) = v_llave OR (v_bar IS NOT NULL AND p.codigo_barras = v_bar)
    UNION ALL
    SELECT a.erp_product_id, a.nombre, true, CASE WHEN v_bar IS NOT NULL AND a.barcode = v_bar THEN 'codigo' ELSE 'nombre' END
      FROM producto_alta_portal a
     WHERE a.estado <> 'fallido'
       AND (public.producto_llave_nombre(a.nombre) = v_llave OR (v_bar IS NOT NULL AND a.barcode = v_bar))
       AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = a.erp_product_id)
     LIMIT 5
  ) x;

  SELECT coalesce(json_agg(y ORDER BY y.parecido DESC), '[]'::json) INTO v_parecidos FROM (
    SELECT p.id, p.nombre, p.activo, round(similarity(p.nombre_norm, v_norm)::numeric, 2) AS parecido
      FROM products p
     WHERE p.nombre_norm % v_norm
       AND public.producto_llave_nombre(p.nombre) <> v_llave
       AND similarity(p.nombre_norm, v_norm) >= 0.6
     ORDER BY similarity(p.nombre_norm, v_norm) DESC
     LIMIT 5
  ) y;

  RETURN json_build_object('iguales', v_iguales, 'parecidos', v_parecidos);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.producto_alta_iguales(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.producto_alta_iguales(text, text) TO authenticated, service_role;
