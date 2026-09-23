-- Regla 5 extendida: el costo de cada línea de venta (`sales_invoice_items.
-- costo_unitario`, y su procedencia `costo_origen`/`costo_ambiguo`) deja de ser
-- legible desde el navegador. Las salas leen sus propias líneas de venta, y con
-- ellas se llevaban el costo.
--
-- Nada del navegador lo pedía: las tres consultas directas enumeran columnas
-- sin el costo (ventas.js, facturacion.js), y la única función que lo lee,
-- `reconstruir_costo_de_venta`, no es ejecutable por `authenticated`. La vista
-- materializada `mv_primera_venta_producto` se refresca como su dueño.
--
-- Probado en producción en una transacción deshecha, como QA: el select de
-- Ventas, `credito_detalle`, `get_product_trend`, `ventas_elegibles_puntos`,
-- `get_product_sales_total` y `get_product_sales_agg` responden; leer
-- `costo_unitario` directo da «permission denied».
--
-- ⚠️ Una columna nueva en `sales_invoice_items` nace SIN permiso de lectura:
-- agregarla a este GRANT. Ver
-- [[feedback_con_permiso_por_columna_una_columna_nueva_nace_sin_permiso]].
--
-- Tabla caliente (sync-dte-sales cada minuto): lock_timeout corto.

SET lock_timeout = '2s';

REVOKE SELECT ON public.sales_invoice_items FROM anon, authenticated;

GRANT SELECT (id, invoice_id, erp_product_id, descripcion, cantidad, presentacion,
              precio_unitario, total_linea, id_presentacion, linea_num, lote,
              fecha_vencimiento, factor_unidades)
    ON public.sales_invoice_items TO authenticated;
