-- Reservas también muestra «Se cobró distinto» (2026-11-17): la lista lleva
-- `cobro_distinto` de su preventa. Sobre la definición VIVA (md5 7ada3f8e…),
-- sólo se agrega esa clave junto a 'factura'.
SET lock_timeout = '5s';
DO $$
DECLARE d text := pg_get_functiondef('public.reservas_de_sucursal(bigint,boolean)'::regprocedure);
BEGIN
  IF position($w$'factura', si.correlativo,$w$ IN d) = 0 OR position('cobro_distinto' IN d) > 0 THEN
    RAISE NOTICE 'reservas_de_sucursal ya cambió: no se toca';
    RETURN;
  END IF;
  d := replace(d, $w$'factura', si.correlativo,$w$, $w$'factura', si.correlativo, 'cobro_distinto', pv.cobro_distinto,$w$);
  EXECUTE d;
END $$;
