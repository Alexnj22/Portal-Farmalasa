-- Las ubicaciones de inventario de las siete salas, en el mapa.
--
-- `erp_sucursal_map.inv_ubicaciones` solo tenía las dos de Bodega; las otras
-- seis estaban en NULL y el dato viajaba desde el navegador. Para una carga o un
-- descarte eso alcanzaba porque el widget conoce SU sala. Un traslado necesita
-- la ubicación de la sala **de origen**, que es la de otro — y pedírsela al
-- cliente sería dejar que el navegador elija de dónde sale el producto.
--
-- Los siete valores están leídos del <select id="origen"> de la pantalla de
-- traslado, recorriendo las siete sesiones el 2026-08-06:
--
--   1 Salud 1 → 3 · 2 Salud 2 → 4 · 3 Salud 3 → 5 · 4 Salud 4 → 6
--   5 La Popular → 7 · 6 Bodega → 1 (y 2, la de vencidos) · 7 Salud 5 → 8
--
-- Se respeta la forma que ya tenía Bodega —`[{id, isVencidos}]`— para que el
-- consumidor sea uno solo: la ubicación de trabajo es la que trae
-- `isVencidos = false`, y la de vencidos existe únicamente en Bodega.

SET lock_timeout = '5s';

UPDATE public.erp_sucursal_map m
   SET inv_ubicaciones = v.ubic
  FROM (VALUES
          (1, '[{"id": 3, "isVencidos": false}]'::jsonb),
          (2, '[{"id": 4, "isVencidos": false}]'::jsonb),
          (3, '[{"id": 5, "isVencidos": false}]'::jsonb),
          (4, '[{"id": 6, "isVencidos": false}]'::jsonb),
          (5, '[{"id": 7, "isVencidos": false}]'::jsonb),
          (7, '[{"id": 8, "isVencidos": false}]'::jsonb)
       ) AS v(suc, ubic)
 WHERE m.erp_sucursal_id = v.suc
   AND m.inv_ubicaciones IS NULL;   -- no pisa lo que ya esté cargado
