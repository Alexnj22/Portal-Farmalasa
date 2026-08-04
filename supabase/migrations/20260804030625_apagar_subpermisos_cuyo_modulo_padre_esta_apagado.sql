SET lock_timeout = '5s';

-- Auditoría de la vista de Permisos (2026-08-03), hallazgo P0.
--
-- Apagar un módulo en la pantalla no apagaba sus sub-permisos: la tarjeta deja
-- de dibujarlos cuando el módulo está apagado, así que quedaban encendidos en la
-- base y sin forma de verlos desde la UI. Quedaron 38 filas así, en 16 cargos.
--
-- Hoy todas son `productos_tab_*` y ahí no conceden nada, porque la ruta exige
-- `productos` para entrar a la vista. Pero el mecanismo no distingue por clave:
-- `purchase_receipts_select` consulta `minmax_ver_costos` SIN mirar al módulo
-- padre, así que la misma situación con esa clave habría dejado el costo de
-- compra visible para un cargo al que se le quitó Min/Max.
--
-- El arreglo de la vista (apagado en cascada) evita que vuelva a pasar; esto
-- limpia lo que ya estaba. Se apaga, no se borra: la fila con todo en false es
-- el estado normal de un permiso no concedido, y borrarla haría ruido en el
-- histórico de `updated_at`.
UPDATE role_permissions h
   SET can_view = false, can_edit = false, can_approve = false, updated_at = now()
  FROM (VALUES
    ('minmax','minmax_ver_costos'),('minmax','minmax_descargar'),
    ('minmax','minmax_tab_sucursal'),('minmax','minmax_tab_red'),('minmax','minmax_tab_solicitudes'),
    ('productos','productos_ver_costos'),('productos','productos_tab_catalogo'),
    ('productos','productos_tab_inventario'),('productos','productos_tab_sinventa'),
    ('libros_iva','libros_iva_descargar'),('libros_iva','libros_iva_ver_montos'),
    ('libros_iva','libros_iva_tab_consumidor'),('libros_iva','libros_iva_tab_contribuyente'),
    ('libros_iva','libros_iva_tab_compras'),('libros_iva','libros_iva_tab_anulados'),
    ('libros_iva','libros_iva_tab_percepcion'),('libros_iva','libros_iva_tab_retencion'),
    ('libros_iva','libros_iva_tab_renta'),
    ('payroll','payroll_descargar'),('staff_list','staff_list_descargar'),
    ('time_audit','time_audit_descargar'),('cotizaciones','cotizaciones_descargar'),
    ('clientes','clientes_ver_montos'),('branches','branches_descargar'),
    ('ventas_perdidas','ventas_perdidas_descargar'),
    ('corte_z','corte_z_descargar'),('corte_z','corte_z_ver_montos'),
    ('libro_compras_completo','libro_compras_completo_descargar'),
    ('libro_compras_completo','libro_compras_completo_ver_montos'),
    ('compras','compras_ver_montos'),('compras','compras_tab_facturas'),('compras','compras_tab_productos'),
    ('conteo_inventario','conteo_ver_sistema'),
    ('conteo_inventario','conteo_inventario_descargar'),('conteo_inventario','conteo_inventario_ver_montos'),
    ('facturacion','facturacion_ver_montos'),
    ('facturacion','facturacion_tab_anuladas'),('facturacion','facturacion_tab_pendiente_mh'),
    ('facturacion','facturacion_tab_saltos'),('facturacion','facturacion_tab_no_efectivo'),
    ('facturacion','facturacion_tab_observaciones'),
    ('facturas_compra','facturas_compra_abrir'),('facturas_compra','facturas_compra_descargar'),
    ('facturas_compra','facturas_compra_ver_montos'),
    ('ventas','ventas_tab_ventas'),('ventas','ventas_tab_vendedores'),('ventas','ventas_tab_productos'),
    ('pedidos','pedidos_descargar'),
    ('pedidos','pedidos_tab_generar'),('pedidos','pedidos_tab_historial'),('pedidos','pedidos_tab_rutas'),
    ('pedidos','pedidos_tab_metricas'),('pedidos','pedidos_tab_reglas'),
    ('schedules','schedules_tab_calendar'),('schedules','schedules_tab_shifts'),('schedules','schedules_tab_holidays')
  ) AS p(padre, hijo)
  LEFT JOIN role_permissions pad ON pad.module_key = p.padre
 WHERE h.module_key = p.hijo
   AND h.can_view
   AND pad.role_id = h.role_id
   AND coalesce(pad.can_view, false) = false;

-- Y el caso sin fila de padre en absoluto (nunca se le otorgó el módulo).
UPDATE role_permissions h
   SET can_view = false, can_edit = false, can_approve = false, updated_at = now()
  FROM (VALUES
    ('productos','productos_tab_catalogo'),('productos','productos_tab_inventario'),
    ('productos','productos_tab_sinventa'),('productos','productos_ver_costos'),
    ('minmax','minmax_tab_sucursal'),('minmax','minmax_tab_red'),('minmax','minmax_ver_costos')
  ) AS p(padre, hijo)
 WHERE h.module_key = p.hijo
   AND h.can_view
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions pad
      WHERE pad.role_id = h.role_id AND pad.module_key = p.padre AND pad.can_view
   );
