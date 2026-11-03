-- La lista de precio que le toca a un cliente, según el reglamento
-- (procedimiento de clientes §1, 2026-11-03). Devuelve la CLAVE de la columna
-- de `product_precios`, no el rótulo:
--   'mayoreo'     (Mayoreo Plus) · Cliente Mayorista aprobado con Plus, o personal
--   'clinica'     (Mayoreo)      · Cliente Mayorista aprobado
--   'vip'         (Preferente)   · tiene cuenta activa en Puntos Salud
--   'descuento_1' (Público)      · todos los demás
-- La regla de mayorista/personal es la misma de `condicionDePrecio` en
-- `app-clientes` (personal que además es mayorista: el mejor de los dos).
-- Que el mayoreo aplique sólo a la presentación completa lo decide quien
-- elige la presentación (`listaQueLeToca`, src/utils/apartar.js).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.lista_de_precio_del_cliente(p_customer bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_m json := public.mayorista_de(p_customer);
  v_emp boolean := public.cliente_es_empleado(p_customer);
BEGIN
  IF p_customer IS NULL THEN RETURN NULL; END IF;
  IF v_m->>'estado' = 'aprobado' THEN
    RETURN CASE WHEN v_m->>'precio' = 'mayoreo_plus' OR v_emp THEN 'mayoreo' ELSE 'clinica' END;
  END IF;
  IF v_emp THEN RETURN 'mayoreo'; END IF;
  IF EXISTS (SELECT 1 FROM public.puntos_cuenta pc
              WHERE pc.customer_id = p_customer AND pc.activa AND pc.fusionada_en IS NULL) THEN
    RETURN 'vip';
  END IF;
  RETURN 'descuento_1';
END $$;
REVOKE EXECUTE ON FUNCTION public.lista_de_precio_del_cliente(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lista_de_precio_del_cliente(bigint) TO authenticated, service_role;
