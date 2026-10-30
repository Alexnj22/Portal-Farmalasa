SET lock_timeout = '5s';

-- La llave con que el diccionario de compras recuerda un renglón: el código del
-- proveedor, o si no trae, `#` + su nombre limpio normalizado. Es la MISMA que
-- arma `registrar_renglones_pendientes` (Por confirmar) y que busca
-- `emparejar_producto_dte`; acá se expone para que la carga pueda aprender un
-- renglón sin código igual que esa lista.
CREATE OR REPLACE FUNCTION public.compra_llave_de_renglon(p_codigo text, p_texto text)
RETURNS text LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT coalesce(nullif(btrim(coalesce(p_codigo, '')), ''), '#' || public.norm_search(p_texto));
$$;
REVOKE EXECUTE ON FUNCTION public.compra_llave_de_renglon(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_llave_de_renglon(text, text) TO authenticated, service_role;
