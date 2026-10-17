SET lock_timeout = '5s';

-- «Tiene muestras» y «es la cuenta de prueba» se separan (2026-10-17). La
-- cuenta del revisor de las tiendas lleva muestras para que la app no se vea
-- vacía, pero NO el panel «Modo de prueba», que Apple lee como depuración.
-- La cuenta de prueba se marca con una fila `tipo = 'modo_prueba'`
-- (ver `esDePrueba` en app-clientes).
ALTER TABLE public.app_cliente_muestras DROP CONSTRAINT app_cliente_muestras_tipo_check;
ALTER TABLE public.app_cliente_muestras ADD CONSTRAINT app_cliente_muestras_tipo_check
  CHECK (tipo = ANY (ARRAY['oferta','inyeccion','vencimiento','cumpleanos','historia','factura','modo_prueba']));

-- La cuenta de prueba de hoy es la que ya tenía muestras: conserva su panel.
-- Sólo donde existe (en el entorno de pruebas no hay muestras y no inserta nada).
INSERT INTO public.app_cliente_muestras (customer_id, tipo, datos)
SELECT DISTINCT m.customer_id, 'modo_prueba', '{"motivo":"cuenta de prueba: panel Modo de prueba"}'::jsonb
  FROM public.app_cliente_muestras m
 WHERE NOT EXISTS (SELECT 1 FROM public.app_cliente_muestras x WHERE x.customer_id = m.customer_id AND x.tipo = 'modo_prueba');
