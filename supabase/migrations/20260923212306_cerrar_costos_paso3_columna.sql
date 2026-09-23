-- Regla 5 de la Fase 2 (docs/PLAN-CERRAR-AUTORIZACION-2026-08-09.md), paso 3
-- de 3: la columna `costo` deja de ser legible desde el navegador.
--
-- El RLS es por fila y no puede esconder una columna, así que se hace con
-- privilegios: se quita el SELECT de la tabla y se devuelve columna por
-- columna, todas menos `costo`. El costo sólo sale por funciones DEFINER que
-- miran el permiso (`get_precios_con_costo`, y las tres de pantalla del paso 1,
-- 20260923211841). El frontend dejó de leerlo directo en v2.1035.6.
--
-- `product_precios_history` guarda el mismo costo en cada versión de precio, así
-- que se cierra igual.
--
-- ⚠️ Una columna nueva en cualquiera de las dos tablas nace SIN permiso de
-- lectura para `authenticated`: hay que agregarla a su GRANT. Ver
-- [[feedback_con_permiso_por_columna_una_columna_nueva_nace_sin_permiso]].
--
-- Probado en producción dentro de una transacción deshecha, como QA: los
-- selects del navegador responden (6,911 presentaciones activas), leer `costo`
-- directo da «permission denied», y la función y las pantallas devuelven costo.

SET lock_timeout = '2s';

REVOKE SELECT ON public.product_precios, public.product_precios_history FROM anon, authenticated;

GRANT SELECT (id, product_id, id_presentacion, activo, vineta, descuento_1, vip, clinica,
              mayoreo, premium, precio_7, updated_at, descripcion, factor)
    ON public.product_precios TO authenticated;

GRANT SELECT (id, product_id, id_presentacion, vineta, descuento_1, vip, clinica,
              mayoreo, premium, precio_7, valid_from, valid_until)
    ON public.product_precios_history TO authenticated;
