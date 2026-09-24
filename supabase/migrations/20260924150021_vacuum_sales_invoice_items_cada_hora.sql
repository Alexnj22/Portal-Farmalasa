-- `sales_invoice_items` no se vacuumaba NUNCA (medido el 2026-09-24: 0 vacuum y
-- 0 autovacuum desde el reinicio, y ni un ANALYZE). Recibe ~1,200 renglones al
-- día, y el autovacuum por inserciones espera al 20% de la tabla (~120,000): no
-- llega a dispararse en meses.
--
-- La consecuencia no da error, cuesta: las páginas nuevas —justo las del período
-- que mira cualquier pantalla de ventas— no quedan marcadas como visibles, así
-- que todo escaneo del índice cubridor `idx_sii_invoice_covering` tiene que ir
-- además al heap. En `get_inyecciones_aplicadas` con 92 días eran 73,668
-- lecturas de heap de más; un VACUUM a mano las bajó de 109,521 a 72,742 bloques
-- por llamada, y el período por defecto de 31,205 a 18,397. Y sin ANALYZE, la
-- estimación de filas iba 48,000 atrás (lo que obligó a `gate:perf` a contar
-- exacto el 2026-09-22).
--
-- Mismo patrón y misma ventana que `vacuum-sales-invoices` (`:30`), a los `:20`
-- para no coincidir. VACUUM toma SHARE UPDATE EXCLUSIVE: no frena lecturas ni
-- las inserciones del sync.
SELECT cron.schedule(
  'vacuum-sales-invoice-items',
  '20 12-23,0-5 * * *',
  'VACUUM ANALYZE sales_invoice_items'
);
