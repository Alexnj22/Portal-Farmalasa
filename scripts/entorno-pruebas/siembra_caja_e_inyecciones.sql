-- Siembra del ENTORNO DE PRUEBAS para probar Efectivo y el cobro de aplicaciones.
-- NUNCA en producción. Se corre con `execute_sql` contra el branch, y se puede
-- correr dos veces: no duplica.
--
-- Por qué hace falta: la lista de salas de Efectivo sale de
-- `cortes_caja_aperturas`, que en producción llena el sync con la caja real y
-- en pruebas no llena nadie (no hay caja real). Sin una apertura, la pantalla
-- dice «Sin salas con caja» y no hay por dónde entrar.
--
-- La apertura usa `erp_apertura_id = 0`: es el número que contesta la caja
-- simulada de `operar-caja` en pruebas, así que las dos cuentan el mismo día.

-- Guarda: si esto es producción, no hace nada (prod tiene decenas de fichas).
DO $$
BEGIN
  IF (SELECT count(*) FROM public.employees) > 20 THEN
    RAISE EXCEPTION 'Esto parece producción: la siembra de pruebas no se corre acá.';
  END IF;
END $$;

-- 1. Una caja abierta hoy en cada sala que vende.
INSERT INTO public.cortes_caja_aperturas
  (id, branch_id, erp_apertura_id, caja_erp, turno, empleado_texto, abierta_el, abierta_a,
   monto_apertura, monto_registrado, turno_corriendo)
OVERRIDING SYSTEM VALUE
SELECT 900000 + b.id, b.id, 0, 1, 1, 'CAJA DE PRUEBAS',
       (now() AT TIME ZONE 'America/El_Salvador')::date, '07:00', 50, 50, true
FROM public.branches b
WHERE EXISTS (SELECT 1 FROM public.sales_invoices si WHERE si.branch_id = b.id)
ON CONFLICT (id) DO UPDATE
  SET abierta_el = EXCLUDED.abierta_el, cerrada_at = NULL, turno_corriendo = true, updated_at = now();

-- 2. Dos cobros de aplicación "de los de antes" en Salud 4 (28): texto libre,
--    sin amarrar, para probar «Amarrar» en la pestaña Inyecciones.
INSERT INTO public.caja_movimientos_portal
  (branch_id, tipo, monto, concepto, fecha, registrado_por, tipo_codigo, clave_envio, erp_apertura_id)
SELECT 28, 'ENTRADA', x.monto, x.concepto, (now() AT TIME ZONE 'America/El_Salvador')::date,
       (SELECT id FROM public.employees WHERE username = 'pruebas'), 'APLICACION', x.clave, 0
FROM (VALUES (1.00, 'Aplicacion de inyeccion · NEUROBION', 'siembra-aplicacion-suelta-1'),
             (1.00, 'Aplicacion de inyeccion · depoprovera', 'siembra-aplicacion-suelta-2')) x(monto, concepto, clave)
WHERE NOT EXISTS (SELECT 1 FROM public.caja_movimientos_portal m WHERE m.clave_envio = x.clave);

SELECT (SELECT count(*) FROM public.cortes_caja_aperturas WHERE cerrada_at IS NULL) AS cajas_abiertas,
       (SELECT count(*) FROM public.caja_movimientos_portal WHERE clave_envio LIKE 'siembra-%') AS cobros_sueltos;
