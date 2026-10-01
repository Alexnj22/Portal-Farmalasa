SET lock_timeout = '5s';

-- Con todos los clientes en la lista (migración anterior), ordenar por «última
-- acumulación» buscaba en `puntos_lote` por cada uno de los 28,488: 88 mil
-- bloques y 235 ms. Quien no tiene `puntos_cuenta` no tiene lotes (medido: 0
-- clientes con lote y sin cuenta), así que la búsqueda se salta esas filas y
-- vuelve al costo de antes (~10,700 búsquedas).
DO $mig$
DECLARE
  d text := pg_get_functiondef('public.puntos_panel_clientes'::regproc);
  n text;
BEGIN
  n := replace(d,
    $a$v_en_base := ', ' || format(c_ultima, 'c.id') || ' AS ultima_acumulacion';$a$,
    $a$v_en_base := ', CASE WHEN pc.customer_id IS NOT NULL THEN ' || format(c_ultima, 'c.id') || ' END AS ultima_acumulacion';$a$);
  IF n = d THEN
    RAISE EXCEPTION 'puntos_panel_clientes: no encontré la última acumulación en la base';
  END IF;
  EXECUTE n;
END
$mig$;
