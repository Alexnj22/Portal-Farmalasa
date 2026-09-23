-- El valorizado del conteo sólo con «Ver el valorizado» (paso 2 de 2): se
-- cierran las columnas originales. El paso 1 (20260923214627) movió las
-- lecturas a `conteo_inventario_costos` y `get_conteos_valor`, y v2.1036.2 dejó
-- de pedir la ficha del conteo con `*`.
--
-- Probado junto con el paso 1 en una transacción deshecha en producción: las
-- cuatro lecturas del conteo responden con las columnas cerradas, QA idéntico.
--
-- ⚠️ Una columna nueva en `conteo_inventario_items` o `conteos_inventario` nace
-- SIN permiso de lectura: agregarla a su GRANT (y, en `conteos_inventario`, a
-- `CONTEO_COLS` de src/data/conteoInventario.js). Ver
-- [[feedback_con_permiso_por_columna_una_columna_nueva_nace_sin_permiso]].

SET lock_timeout = '5s';
REVOKE SELECT ON public.conteo_inventario_items FROM anon, authenticated;
GRANT SELECT (id, conteo_id, erp_product_id, source_inventory_id, presentacion, detalle, lote,
              fecha_vencimiento, is_vencidos, sistema_cantidad, fisico_cantidad, diferencia,
              estado_item, nota, contado_por, contado_at, es_agregado_manual, source_sync_key,
              sistema_inicial, fisico_primer_conteo, recontado_por, recontado_at, grupo_key)
    ON public.conteo_inventario_items TO authenticated;
REVOKE SELECT ON public.conteos_inventario FROM anon, authenticated;
GRANT SELECT (id, created_at, branch_id, created_by, scope_type, scope_filter, incluye_vencidos,
              status, finalizado_por, finalizado_at, aprobado_por, aprobado_at, nota_aprobacion,
              total_items, total_contados, total_diferencias, notas, total_pendientes,
              pendientes_como_cero, ajuste_erp_aplicado, ajuste_erp_por, ajuste_erp_at,
              ajuste_erp_nota, total_recontados, modo, fuente_sistema)
    ON public.conteos_inventario TO authenticated;
