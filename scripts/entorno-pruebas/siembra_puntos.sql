-- El escenario de prueba del programa de puntos en el portal.
--
-- Siembra, SÓLO en el entorno de pruebas, un caso por cada regla que el corte
-- del 1-oct tiene que cumplir. Todo es inventado: DUI 9000000X-X, nombres
-- «PRUEBA PUNTOS …», montos redondos. Se puede correr las veces que haga falta:
-- empieza borrando lo que sembró la vez anterior.
--
-- ── La migración (archivo del sistema anterior) ─────────────────────────────
--   1001 A   cuadra: 300 + 150 (cortesía) − 200 = 250
--   1002 B   el historial da 40 y el saldo 50        → ajuste de entrada +10
--   1003 C   el historial da 50 y el saldo 20        → ajuste de salida −30
--   1004     DUI que no tiene ficha en el portal     → no se migra, se informa
--   1005/06  el mismo DUI en dos cuentas de allá     → no se migra, se informa
--   1007     DUI en dos fichas del portal            → no se migra, se informa
--   1008     sin DUI                                 → no se migra, se informa
--   1009 D   saldo 0 con historial (30 − 30)         → se migra, en cero
--
-- ── El motor, con `inicio` = hoy ────────────────────────────────────────────
--   A  hoy     elegible, $10.56                      → +10
--   A  ayer    elegible                              → NO: antes del inicio
--   A  hoy     canje de $2.00 (200 pts), tiene 260   → −200, sin aviso
--   A  ayer    canje                                 → NO: antes del inicio
--   B  hoy     canje de $1.00 (100 pts), tiene 50    → −50 y aviso
--   C  hoy     $0.80                                 → NO: menos de $1
--   D  hoy     precio bajo el 3                      → NO
--   E  hoy     sólo bebidas                          → NO
--   F  hoy     elegible, después se anula            → +10 y luego −10
--   MAPFRE hoy canje                                 → ninguna (convenio)
SET lock_timeout = '5s';

DO $guarda$
BEGIN
  IF (SELECT count(*) FROM public.sales_invoices) > 50000 THEN
    RAISE EXCEPTION 'Esta base parece PRODUCCIÓN. Abortado.';
  END IF;
END
$guarda$;

-- ── Limpieza de la corrida anterior ─────────────────────────────────────────
DELETE FROM public.puntos_salida_lote WHERE salida_id IN (
  SELECT s.id FROM public.puntos_salida s JOIN public.customers c ON c.id = s.customer_id WHERE c.name LIKE 'PRUEBA PUNTOS%');
DELETE FROM public.puntos_salida_lote WHERE lote_id IN (
  SELECT l.id FROM public.puntos_lote l JOIN public.customers c ON c.id = l.customer_id WHERE c.name LIKE 'PRUEBA PUNTOS%');
DELETE FROM public.puntos_salida WHERE customer_id IN (SELECT id FROM public.customers WHERE name LIKE 'PRUEBA PUNTOS%');
DELETE FROM public.puntos_lote   WHERE customer_id IN (SELECT id FROM public.customers WHERE name LIKE 'PRUEBA PUNTOS%');
DELETE FROM public.puntos_cuenta WHERE customer_id IN (SELECT id FROM public.customers WHERE name LIKE 'PRUEBA PUNTOS%');
DELETE FROM public.notifications WHERE metadata->>'check_key' LIKE 'puntos_sin_saldo:%';
DELETE FROM public.sales_invoice_items WHERE invoice_id IN (SELECT id FROM public.sales_invoices WHERE erp_invoice_id LIKE 'PP-%');
DELETE FROM public.sales_invoices WHERE erp_invoice_id LIKE 'PP-%';
DELETE FROM public.customers WHERE name LIKE 'PRUEBA PUNTOS%';
DELETE FROM public.puntos_archivo_carga;
UPDATE public.puntos_config SET acumulacion_activa = false, fuente = 'mysql', inicio = NULL;

-- ── Un producto de bebidas ──────────────────────────────────────────────────
UPDATE public.products SET laboratorio_id = 333
 WHERE id = (SELECT min(product_id) FROM public.product_precios WHERE activo AND product_id <> 2 AND vip > 0);

-- ── Las fichas ──────────────────────────────────────────────────────────────
INSERT INTO public.customers (name, dui, acumula_puntos) VALUES
  ('PRUEBA PUNTOS A', '90000001-1', true),
  ('PRUEBA PUNTOS B', '90000002-2', true),
  ('PRUEBA PUNTOS C', '90000003-3', true),
  ('PRUEBA PUNTOS D', '90000004-4', true),
  ('PRUEBA PUNTOS E', '90000006-6', true),
  ('PRUEBA PUNTOS F', '90000008-8', true),
  ('PRUEBA PUNTOS DOBLE 1', '90000007-7', true),
  ('PRUEBA PUNTOS DOBLE 2', '90000007-7', true),
  ('PRUEBA PUNTOS MAPFRE', '90000009-9', false);

-- ── El archivo del sistema anterior ─────────────────────────────────────────
INSERT INTO public.puntos_archivo_carga (id, mysql_clientes, mysql_ventas, mysql_canjes)
VALUES (1, 10, 7, 4);
INSERT INTO public.puntos_archivo_cliente (carga_id, id_cliente, dui, puntos, datos) VALUES
  (1, 1001, '90000001-1', 250, '{}'), (1, 1002, '900000022', 50, '{}'),
  (1, 1003, '90000003-3', 20, '{}'),  (1, 1004, '99999999-9', 70, '{}'),
  (1, 1005, '90000005-5', 15, '{}'),  (1, 1006, '90000005-5', 25, '{}'),
  (1, 1007, '90000007-7', 40, '{}'),  (1, 1008, '', 10, '{}'),
  (1, 1009, '90000004-4', 0, '{}'),   (1, 1010, '90000010-1', 0, '{}');
INSERT INTO public.puntos_archivo_venta (carga_id, id_venta, id_cliente, fecha, puntos, sucursal, ticket, datos) VALUES
  (1, 1, 1001, '2025-01-10 10:00', 300, 'FLS1', '12345', '{}'),
  (1, 2, 1001, '2026-05-02 09:00', 150, 'FLS2', 'Cortesía cumpleaños', '{}'),
  (1, 3, 1002, '2026-03-03 12:00', 40, 'FLS1', '222', '{}'),
  (1, 4, 1003, '2026-02-02 12:00', 100, 'FLS3', '333', '{}'),
  (1, 5, 1009, '2026-01-15 08:00', 30, 'FLP1', '444', '{}'),
  (1, 6, 1004, '2026-04-04 08:00', 70, 'FLS4', '555', '{}'),
  (1, 7, 1007, '2026-04-04 08:00', 40, 'FLS4', '666', '{}');
INSERT INTO public.puntos_archivo_canje (carga_id, id_canje, id_cliente, fecha, puntos, sucursal, ticket, datos) VALUES
  (1, 1, 1001, '2026-06-01 15:00', 200, 'FLS1', '9001', '{}'),
  (1, 2, 1003, '2026-06-06 15:00', 50, 'FLS3', '9002', '{}'),
  (1, 3, 1009, '2026-07-07 15:00', 30, 'FLP1', NULL, '{}'),
  (1, 4, 1005, '2026-07-07 15:00', 5, 'FLP1', NULL, '{}');
SELECT setval('public.puntos_archivo_carga_id_seq', 1);

-- ── Las ventas de ayer y de hoy ─────────────────────────────────────────────
-- Producto 2 · UNIDAD 1x1: precio 1 = 1.32, precio 3 = 1.15.
WITH c AS (SELECT name, id FROM public.customers WHERE name LIKE 'PRUEBA PUNTOS%'),
v(ref, quien, dia, estado, total, has_puntos) AS (VALUES
  ('PP-01', 'PRUEBA PUNTOS A', 0, 'FINALIZADA', 10.56, false),
  ('PP-02', 'PRUEBA PUNTOS A', -1, 'FINALIZADA', 10.56, false),
  ('PP-03', 'PRUEBA PUNTOS A', 0, 'FINALIZADA', 3.00, true),
  ('PP-04', 'PRUEBA PUNTOS A', -1, 'FINALIZADA', 3.00, true),
  ('PP-05', 'PRUEBA PUNTOS B', 0, 'FINALIZADA', 4.00, true),
  ('PP-06', 'PRUEBA PUNTOS C', 0, 'FINALIZADA', 0.80, false),
  ('PP-07', 'PRUEBA PUNTOS D', 0, 'FINALIZADA', 10.00, false),
  ('PP-08', 'PRUEBA PUNTOS E', 0, 'FINALIZADA', 10.00, false),
  ('PP-09', 'PRUEBA PUNTOS F', 0, 'FINALIZADA', 10.56, false),
  ('PP-10', 'PRUEBA PUNTOS MAPFRE', 0, 'FINALIZADA', 3.00, true))
INSERT INTO public.sales_invoices (branch_id, erp_invoice_id, correlativo, fecha, hora, cliente, cod_vendedor,
                                   estado, subtotal, total, customer_id, has_puntos, retencion)
SELECT 4, v.ref, v.ref, current_date + v.dia, '10:00', v.quien, '101', v.estado, v.total, v.total,
       c.id, v.has_puntos, 0
  FROM v JOIN c ON c.name = v.quien;

-- Renglones: (ref, producto, cantidad, precio). Los canjes suman MÁS que el
-- total: la diferencia es el descuento de puntos.
WITH r(ref, prod, cant, precio) AS (VALUES
  ('PP-01', 2, 8, 1.32), ('PP-02', 2, 8, 1.32),
  ('PP-03', 2, 4, 1.25), ('PP-04', 2, 4, 1.25),
  ('PP-05', 2, 4, 1.25),
  ('PP-06', 2, 1, 0.80),
  ('PP-07', 2, 10, 1.00),
  ('PP-08', -1, 10, 1.00),
  ('PP-09', 2, 8, 1.32),
  ('PP-10', 2, 4, 1.25))
INSERT INTO public.sales_invoice_items (invoice_id, erp_product_id, descripcion, cantidad, presentacion,
                                        precio_unitario, total_linea, linea_num, factor_unidades)
SELECT si.id,
       CASE WHEN r.prod = -1 THEN (SELECT min(product_id) FROM public.product_precios WHERE activo AND product_id <> 2 AND vip > 0) ELSE r.prod END,
       'PRUEBA', r.cant,
       CASE WHEN r.prod = -1 THEN (SELECT upper(coalesce(pr.tipo,'') || ' ' || coalesce(pp.descripcion,''))
                                     FROM public.product_precios pp LEFT JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
                                    WHERE pp.product_id = (SELECT min(product_id) FROM public.product_precios WHERE activo AND product_id <> 2 AND vip > 0)
                                      AND pp.activo LIMIT 1)
            ELSE 'UNIDAD 1x1' END,
       r.precio, round(r.cant * r.precio, 2), 1, 1
  FROM r JOIN public.sales_invoices si ON si.erp_invoice_id = r.ref;

SELECT 'sembrado' AS ok,
       (SELECT count(*) FROM public.customers WHERE name LIKE 'PRUEBA PUNTOS%') AS fichas,
       (SELECT count(*) FROM public.sales_invoices WHERE erp_invoice_id LIKE 'PP-%') AS ventas;
