SET lock_timeout = '5s';
-- puntos_anotar_aplicado cruza por (sucursal, erp_invoice_id) y no había índice
-- sobre ese par: cada llamada barría las ~380 mil filas (Seq Scan medido el
-- 2026-09-14, llamadas de hasta 97 s el día de la caída). Corre cada minuto y,
-- cada 10, cinco veces con 5,000 filas. Ver docs/INCIDENTE-CAIDA-2026-09-14.md.
CREATE INDEX IF NOT EXISTS idx_puntos_enviados_sucursal_factura
  ON public.puntos_enviados (sucursal, erp_invoice_id);
