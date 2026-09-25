-- Pedidos listos para armar una ruta en el entorno de pruebas.
--
-- «Crear ruta» necesita tres cosas y el branch no traía ninguna: el mapa de
-- salas del sistema de origen (`erp_sucursal_map`, copiado tal cual de
-- producción —son ubicaciones de farmacias, no datos de personas—), pedidos
-- confirmados y sus salas con las cajas finalizadas. Las coordenadas ya
-- viven en `branches.settings.location`.
--
-- Dos pedidos (#9001 y #9002) repartidos en salas cercanas y lejanas a la
-- bodega, para que el orden de la ruta importe. Se corre con `execute_sql`
-- sobre el branch de pruebas, NUNCA con `apply_migration`. Idempotente: vuelve
-- a dejar los dos pedidos listos y borra las rutas de prueba que los usaron.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.employees) > 2 THEN
    RAISE EXCEPTION 'semilla_pedidos_ruta: esta base no es la de pruebas (tiene % fichas)',
      (SELECT count(*) FROM public.employees);
  END IF;

  INSERT INTO public.erp_sucursal_map (erp_sucursal_id, branch_id, nombre, es_bodega, orden_despacho, codigo) VALUES
    (1, 4,  'Salud 1',    false, 2,    'S1'),
    (2, 25, 'Salud 2',    false, 3,    'S2'),
    (3, 27, 'Salud 3',    false, 4,    'S3'),
    (4, 28, 'Salud 4',    false, 5,    'S4'),
    (5, 2,  'La Popular', false, 1,    'PO'),
    (6, 30, 'Bodega',     true,  NULL, 'BO'),
    (7, 29, 'Salud 5',    false, 6,    'S5')
  ON CONFLICT (erp_sucursal_id) DO UPDATE
    SET branch_id = EXCLUDED.branch_id, nombre = EXCLUDED.nombre, es_bodega = EXCLUDED.es_bodega,
        orden_despacho = EXCLUDED.orden_despacho, codigo = EXCLUDED.codigo;

  -- Rutas de pruebas anteriores que tomaron estos pedidos: se borran para que
  -- los pedidos vuelvan a estar disponibles.
  DELETE FROM public.rutas r
   WHERE r.id IN (SELECT rp.ruta_id FROM public.ruta_pedidos rp
                    JOIN public.pedidos p ON p.id = rp.pedido_id
                   WHERE p.numero IN (9001, 9002));

  DELETE FROM public.pedidos WHERE numero IN (9001, 9002);
  INSERT INTO public.pedidos (numero, status, notes, sucursal_ids) VALUES
    (9001, 'confirmado', 'Pedido de prueba para rutas', ARRAY[1, 5, 7]),
    (9002, 'confirmado', 'Pedido de prueba para rutas', ARRAY[4, 2]);

  -- «Crear ruta» sólo aparece con `pedidos_tab_rutas.can_edit`. El script de
  -- permisos de la cuenta de pruebas deja `can_edit` apagado A PROPÓSITO (los
  -- barridos no deben poder escribir); esta semilla existe para una prueba que
  -- SÍ escribe —`tests/e2e/crear-ruta.spec.js`—, así que lo prende sólo para
  -- esa pestaña.
  UPDATE public.role_permissions rp SET can_edit = true
    FROM public.employees e
   WHERE e.username = 'pruebas' AND rp.role_id = e.role_id AND rp.module_key = 'pedidos_tab_rutas';

  INSERT INTO public.pedido_sucursal_status (pedido_id, erp_sucursal_id, iniciado_at, finalizado_at, total_cajas, cajas_electrolit, cajas_especiales)
  SELECT p.id, s.suc, now() - interval '2 hours', now() - interval '1 hour', s.cajas, 0, '[]'::jsonb
    FROM public.pedidos p
    JOIN (VALUES (9001, 1, 3), (9001, 5, 5), (9001, 7, 2), (9002, 4, 4), (9002, 2, 1)) AS s(num, suc, cajas)
      ON s.num = p.numero;
END $$;
