SET lock_timeout = '5s';

-- Conteo TOTAL de Bodega abierto el 2026-07-10: 4,782 líneas y CERO contadas en
-- 19 días. No es un registro de trabajo, es ruido — y con la regla nueva de un
-- solo conteo abierto por sucursal (C4) bloqueaba crear el cíclico en Bodega.
--
-- Borrado autorizado explícitamente por el usuario el 2026-07-29. El módulo no
-- tiene ruta de borrado a propósito (append-only), por eso va como migración.
--
-- La guarda del WHERE es la que hace esto seguro: si alguien alcanzó a contar
-- aunque sea un renglón entre que se decidió y que corre esto, no borra nada.
-- Las dos FK son ON DELETE CASCADE, así que se llevan ítems e historial.
DELETE FROM public.conteos_inventario c
WHERE c.id = '2b5a7dd7-edeb-48f3-abe6-df52db1ac5d3'
  AND c.status = 'EN_PROGRESO'
  AND NOT EXISTS (
    SELECT 1 FROM public.conteo_inventario_items i
    WHERE i.conteo_id = c.id AND i.fisico_cantidad IS NOT NULL
  );
