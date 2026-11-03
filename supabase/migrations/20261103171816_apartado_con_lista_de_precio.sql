-- Apartar en sala con la lista de precio que corresponde (2026-11-03).
--
-- R-000151 quedó a viñeta ($13.25) cuando al cliente le tocaba VIP ($8.00):
-- el diálogo sólo ofrecía la viñeta y `apartado_cotizar` rechazaba cualquier
-- otro precio. Decisión del usuario: se puede elegir cualquier lista de la
-- venta hasta Mayoreo Plus —viñeta, descuento 1, VIP, clínica (Mayoreo) y
-- mayoreo (Mayoreo Plus)—; Premium y Precio 7 no. Sin motivo: rige el
-- reglamento.
--
-- La regla «¿este precio es uno de la venta?» vive en UNA función, que lee
-- la cotización. Se cambia una sola condición de la función viva y se
-- comprueba que el reemplazo entró: si la definición cambió, la migración
-- falla en vez de dejarla como estaba.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.precio_de_apartado_valido(p_producto bigint, p_factor integer, p_precio numeric)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
BEGIN
  -- plpgsql y no sql: con `SET search_path` una sql nace con plan genérico.
  RETURN p_precio IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.product_precios pp
     WHERE pp.product_id = p_producto AND pp.activo AND pp.factor = p_factor
       AND round(p_precio, 2) IN (
         round(nullif(pp.vineta, 0), 2), round(nullif(pp.descuento_1, 0), 2), round(nullif(pp.vip, 0), 2),
         round(nullif(pp.clinica, 0), 2), round(nullif(pp.mayoreo, 0), 2)));
END $$;
REVOKE EXECUTE ON FUNCTION public.precio_de_apartado_valido(bigint, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.precio_de_apartado_valido(bigint, integer, numeric) TO authenticated, service_role;

DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.apartado_cotizar(bigint,jsonb)'::regprocedure);
  v_viejo text := $v$    -- El precio queda fijo sólo si es el del catálogo para esa presentación.
    IF v_precio IS NULL OR NOT EXISTS (SELECT 1 FROM public.product_precios pp
        WHERE pp.product_id = (p_apartado->>'producto_id')::bigint AND pp.activo AND pp.factor = v_factor
          AND round(pp.vineta, 2) = v_precio) THEN
      RAISE EXCEPTION 'Ese precio no es el del catálogo para esa presentación.';$v$;
  v_nuevo text := $v$    -- El precio queda fijo sólo si es uno de la venta para esa presentación
    -- (viñeta a Mayoreo Plus, 2026-11-03): `precio_de_apartado_valido`.
    IF NOT public.precio_de_apartado_valido((p_apartado->>'producto_id')::bigint, v_factor, v_precio) THEN
      RAISE EXCEPTION 'Ese precio no es uno de la venta para esa presentación.';$v$;
BEGIN
  IF position(v_viejo IN v_def) = 0 THEN
    RAISE EXCEPTION 'apartado_cotizar cambió: no se encontró la condición del precio.';
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END
$do$;
