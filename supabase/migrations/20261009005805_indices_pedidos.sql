-- 15 · Índices de Pedidos: cuatro FK sin índice y dos índices que sobran
--      (2026-10-08; versión acotada al aplicar el 2026-10-09).
--
-- FK SIN ÍNDICE (regla 2 de CLAUDE.md; el advisor las lista):
--   · pedido_recepcion_extras.erp_product_id → products   (ON DELETE CASCADE)
--   · pedido_recepcion_firmas.employee_id    → employees  (ON DELETE CASCADE)
--   · pedido_apoyo.employee_id               → employees  (397 filas)
--   · pedido_traslado_linea.erp_sucursal_id  → erp_sucursal_map (20,317 filas)
--
-- QUE SOBRAN, medido en producción (pg_stat_user_indexes, sin reset):
--   · idx_ruta_pedidos_ruta (ruta_id) ..... 0 scans; lo cubre el único
--     (ruta_id, pedido_id, erp_sucursal_id). Se quita.
--   · idx_pedido_items_pedido (pedido_id) . 69 scans; lo cubre
--     idx_pedido_items_pedido_status (pedido_id, status), 118,277 scans. Se quita.
--
-- NO se quitan, aunque el borrador los listaba: idx_pedido_suc_status_pedido
-- (155,119 scans) e idx_dispatch_rules_product (2,020,356 scans). Otro índice
-- los cubre, pero el ahorro es nulo y quitar un índice tan usado arriesga que
-- una consulta cambie de plan. No vale el riesgo.
--
-- Tablas chicas: el bloqueo dura milisegundos; aun así, lock_timeout.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_pedido_recepcion_extras_product ON public.pedido_recepcion_extras (erp_product_id);
CREATE INDEX IF NOT EXISTS idx_pedido_recepcion_firmas_employee ON public.pedido_recepcion_firmas (employee_id);
CREATE INDEX IF NOT EXISTS idx_pedido_apoyo_employee ON public.pedido_apoyo (employee_id);
CREATE INDEX IF NOT EXISTS idx_pedido_traslado_linea_sucursal ON public.pedido_traslado_linea (erp_sucursal_id);

DROP INDEX IF EXISTS public.idx_ruta_pedidos_ruta;
DROP INDEX IF EXISTS public.idx_pedido_items_pedido;
