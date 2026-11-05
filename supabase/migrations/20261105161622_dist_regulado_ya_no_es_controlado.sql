-- «Regulado» deja de significar «controlado» en la distribuidora (2026-11-05).
--
-- Desde hoy la casilla «regulado» del sistema marca a TODO medicamento que
-- lleva lote, por trazabilidad (pedido del usuario: «todos los productos deben
-- llevar lote, a no ser que sea insumo»). Con ~1,550 medicamentos pasando a
-- regulado, este freno los habría dejado sin poder venderse a tiendas y
-- supermercados aunque sean de venta libre. Lo controlado lo siguen diciendo
-- `es_antibiotico`, `requiere_receta` y la casilla `venta_libre` del catálogo.
--
-- Se reescribe desde la definición VIVA (pg_get_functiondef) con un único
-- cambio, y se verifica que el reemplazo ocurrió: si la función cambió y el
-- texto no está, la migración falla en vez de no hacer nada.
-- Gemelos de pantalla: src/data/distribucion.js (`controlado`),
-- src/views/distribucion/TabCatalogo.jsx y apps/mobile/app/torogoz/precio/[id].js.

SET lock_timeout = '5s';

DO $$
DECLARE
    v_def text := pg_get_functiondef('public.dist_validar_item()'::regprocedure);
    v_old text := E'NOT v_cat.venta_libre OR coalesce(v_prod.es_antibiotico, false)\n        OR coalesce(v_prod.regulado, false) OR coalesce(v_prod.requiere_receta, false)) THEN';
    v_new text := E'NOT v_cat.venta_libre OR coalesce(v_prod.es_antibiotico, false)\n        OR coalesce(v_prod.requiere_receta, false)) THEN';
BEGIN
    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'dist_validar_item ya no tiene el freno por regulado: revisar a mano';
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
END $$;
