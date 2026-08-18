SET lock_timeout = '5s';

-- `sales_invoices` es la tabla más grande de la base (340 MB, 350,783 filas) y
-- la única de las calientes que no tenía mantenimiento programado.
--
-- Qué pasaba, medido el 2026-08-18. La vista `branch_hourly_sales` agrupa por
-- sucursal y hora, y el índice `idx_si_branch_fecha_full` ya trae DENTRO todas
-- las columnas que necesita, así que debería resolverse sin tocar la tabla. No
-- lo hacía: **8,879 de 11,299 filas iban al montón** (`Heap Fetches`), porque el
-- mapa de visibilidad estaba frío. Un «Index Only Scan» que va al montón en el
-- 79% de las filas es un index scan común con pasos de más.
--
-- El sync escribe en esta tabla cada minuto y cada escritura apaga ese bit en su
-- página. Sin un VACUUM que los vuelva a encender, el mapa nunca se recupera —y
-- el rango que consulta el tablero son 90 días, de los cuales 89 son datos
-- viejos que no tenían por qué pagar ese precio.
--
-- Medido después de un `VACUUM (ANALYZE)` a mano:
--
--   heap fetches   8,879 → 5
--   bloques        7,739 → 225
--   90 días        219.7 ms → 8.8 ms
--   365 días       625.7 ms → 128.7 ms
--   histórico      510.1 ms → 74.8 ms
--
-- Y no es sólo el widget de venta por hora: acelera TODA consulta sobre ventas
-- —Ventas, Facturación, los libros, las metas—, porque el problema era de la
-- tabla, no de la consulta.
--
-- Va en la misma ventana y con el mismo patrón que sus dos hermanas ya
-- programadas (`inventory` en el minuto 50, `products` en el 40): la ventana
-- `12-23,0-5` es la del sync. Los VACUUM siguientes son baratos —saltan las
-- páginas que ya están marcadas visibles—, así que cada hora no es caro: es lo
-- que impide que el mapa se vuelva a enfriar.
--
-- `sales_invoice_items` NO entra: se midió y ya está sano (0 heap fetches).
SELECT cron.schedule(
  'vacuum-sales-invoices',
  '30 12-23,0-5 * * *',
  'VACUUM ANALYZE sales_invoices'
);
