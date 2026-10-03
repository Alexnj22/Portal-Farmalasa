-- ════════════════════════════════════════════════════════════════════════════
-- Encender el cobro de aplicaciones asignado a la venta (paso 2 de 2)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Se aplica DESPUÉS de que `operar-caja` y la pantalla nuevas estén publicadas.
-- Con la bandera encendida, Mi caja abre el diálogo nuevo al elegir «Aplicación
-- de inyección» y `operar-caja` exige la venta (o la traída). Con la bandera
-- apagada, todo sigue como antes: es la marcha atrás, y es una fila, no DDL.
--
--   Marcha atrás:  UPDATE caja_tipos_movimiento SET lleva_comprobante = false
--                   WHERE codigo = 'APLICACION';
SET lock_timeout = '5s';

UPDATE public.caja_tipos_movimiento
   SET lleva_comprobante = true,
       leyenda = 'Se elige la venta, o se marca que el cliente trajo la inyección.'
 WHERE codigo = 'APLICACION';

-- La pestaña vieja de Ventas ya no existe en la pantalla: sus permisos se
-- copiaron a `inyecciones*` en el paso 1.
DELETE FROM public.role_permissions WHERE module_key = 'ventas_tab_inyecciones';
