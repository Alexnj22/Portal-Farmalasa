SET lock_timeout = '5s';

-- Las dos son funciones de TRIGGER y SECURITY DEFINER: nadie las llama desde el
-- navegador y no tienen por qué estar a su alcance. El REVOKE de la migración
-- anterior sólo nombró a PUBLIC y anon, y con eso `authenticated` se queda con
-- el EXECUTE que Supabase concede por defecto — el mismo hueco que dejó a
-- `update_proveedor_manual` con una sobrecarga abierta.
REVOKE EXECUTE ON FUNCTION public.cortes_caja_sella_quien_corto()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.caja_cortes_del_portal_sella_el_corte()
  FROM PUBLIC, anon, authenticated;
