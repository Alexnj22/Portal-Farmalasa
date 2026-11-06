SET lock_timeout = '5s';

-- El total de un producto en la lista del conteo se sumaba en DOS unidades a
-- la vez (2026-11-06). Prueba de Salud 4, Alerkem 10 mg x 10: «Sin lote» tiene
-- CAJA (F10) y UNIDAD (F1) → ese grupo es mixto y suma en unidades (5 cajas =
-- 50 u), pero los lotes nuevos 260412 / 260533 son grupos de una sola
-- presentación y sumaban en cajas (3 + 2 = 5). Resultado: Sistema 50 u,
-- Físico 5 u, Dif. −45 u, cuando era 50 contra 50.
--
-- La regla: si CUALQUIER grupo del producto es mixto, TODOS sus renglones se
-- suman en unidades (`factor` de `conteo_lineas_netas`); si ninguno lo es,
-- queda como estaba (en la presentación). Se reescribe sobre la definición
-- viva con reemplazos verificados: si alguno no encuentra su texto, falla.
DO $mig$
DECLARE
  v text := pg_get_functiondef('public.get_conteo_products_page(uuid,text,text,integer,integer,integer,text,text,text)'::regprocedure);
  a text; b text;
BEGIN
  a := 'nt.mult, nt.grupo_mixto, nt.neto_grupo';
  b := 'nt.mult, nt.grupo_mixto, nt.neto_grupo, nt.factor AS nt_factor';
  IF position(a IN v) = 0 THEN RAISE EXCEPTION 'no encontré: %', a; END IF;
  v := replace(v, a, b);

  a := '           END AS sistema_now
    FROM base b';
  b := '           END AS sistema_now,
           CASE WHEN bool_or(coalesce(b.grupo_mixto, false)) OVER (PARTITION BY b.erp_product_id)
                THEN coalesce(b.nt_factor, 1) ELSE 1 END AS mult_prod
    FROM base b';
  IF position(a IN v) = 0 THEN RAISE EXCEPTION 'no encontré: sistema_now/FROM base'; END IF;
  v := replace(v, a, b);

  a := 'sum(w.sistema_now * coalesce(w.mult, 1))::int AS sistema_total,
      sum(w.fisico_cantidad * coalesce(w.mult, 1))::int AS fisico_total,
      sum(w.diferencia * coalesce(w.mult, 1))::int AS diferencia_total,';
  b := 'sum(w.sistema_now * w.mult_prod)::int AS sistema_total,
      sum(w.fisico_cantidad * w.mult_prod)::int AS fisico_total,
      sum(w.diferencia * w.mult_prod)::int AS diferencia_total,';
  IF position(a IN v) = 0 THEN RAISE EXCEPTION 'no encontré: las tres sumas'; END IF;
  v := replace(v, a, b);

  EXECUTE v;
END
$mig$;
