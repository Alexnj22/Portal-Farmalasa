-- Lo que el ENTORNO DE PRUEBAS necesita, además de las semillas de
-- supabase/borradores/distribucion, para probar Distribución de punta a punta.
-- Se corre DESPUÉS de los borradores 0001…0008, cada vez que el branch se
-- rehace (el 28-sep se rehízo y se llevó todo):
--
--   supabase db query --linked --workdir <carpeta enlazada al branch> -f scripts/entorno-pruebas/distribucion_pruebas.sql
--
-- Guarda: la cuenta `pruebas` existe y la base es chica (producción tiene 48
-- fichas y ninguna cuenta `pruebas`).

DO $$
DECLARE
    v_emisor smallint;
    v_lote bigint;
    c record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE username = 'pruebas')
       OR (SELECT count(*) FROM public.employees) > 30 THEN
        RAISE NOTICE 'esto no es el entorno de pruebas: no se toca';
        RETURN;
    END IF;
    SELECT id INTO v_emisor FROM public.dist_emisores WHERE nit = '04070101261015' AND ambiente = '00';
    IF v_emisor IS NULL THEN RAISE EXCEPTION 'falta la semilla de 0002 (el emisor de prueba)'; END IF;

    -- 1 · Existencia: sin lote no se factura (0006). 5000 unidades de cada
    --     producto del catálogo, por la función de siempre.
    FOR c IN SELECT product_id FROM public.dist_catalogo WHERE emisor_id = v_emisor AND activo LOOP
        INSERT INTO public.dist_lotes (emisor_id, product_id, lote, vence, existencia)
        VALUES (v_emisor, c.product_id, 'PRUEBA-01', current_date + 400, 0)
        ON CONFLICT DO NOTHING RETURNING id INTO v_lote;
        IF v_lote IS NOT NULL THEN
            PERFORM public.dist_mover_lote(v_lote, 5000, 'entrada', NULL, NULL, 'existencia de prueba');
        END IF;
        v_lote := NULL;
    END LOOP;

    -- 2 · La cuenta de pruebas tiene TODO activo (regla del proyecto): también
    --     decidir descuentos de Distribución.
    INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
    SELECT e.role_id, 'requests_distribucion', true, true, true, 'ALL'
      FROM public.employees e WHERE e.username = 'pruebas'
    ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, can_approve = true;

    -- 3 · Un vendedor de ruta SIN permiso de descuentos, para probar el
    --     circuito de aprobación: quien pide no puede aprobarse, así que hacen
    --     falta dos personas. Es una ficha de muestra del branch.
    INSERT INTO public.roles (id, name) VALUES (990, 'Vendedor de ruta (pruebas)') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
    VALUES (990, 'distribucion', true, true, false, 'ALL') ON CONFLICT (role_id, module_key) DO NOTHING;
    UPDATE public.employees SET role_id = 990
     WHERE id = (SELECT id FROM public.employees WHERE username IS DISTINCT FROM 'pruebas' AND status = 'ACTIVO' ORDER BY name LIMIT 1)
       AND role_id IS NULL;
END $$;

-- 4 · Una venta de ese vendedor con 8% de descuento pedido, esperando en
--     Solicitudes. Se hace «como él» para que la base juzgue igual que en
--     la pantalla.
SELECT set_config('request.jwt.claims',
       json_build_object('sub', (SELECT id FROM public.employees WHERE role_id = 990 ORDER BY name LIMIT 1), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
WITH ped AS (
    INSERT INTO public.dist_pedidos (emisor_id, cliente_id, tipo_documento, condicion, forma_pago, client_uuid)
    SELECT c.emisor_id, c.id, '01', 1, '01', gen_random_uuid()
      FROM public.dist_clientes c WHERE c.tipo = 'farmacia' ORDER BY c.id LIMIT 1
    RETURNING id)
INSERT INTO public.dist_pedido_items (pedido_id, product_id, cantidad, precio_con_iva, descuento, descuento_pct, descripcion, presentacion)
SELECT ped.id, 6, 2, 0, 0, 8, '', 'PAQUETE' FROM ped;
SELECT public.dist_pedir_descuento((SELECT max(id) FROM public.dist_pedidos), 'Compra de volumen: 2 paquetes al mes') AS solicitud,
       (SELECT max(id) FROM public.dist_pedidos) AS pedido;
RESET ROLE;

-- 5 · Para probar el lote en la venta (0010, 2026-09-29):
--     · GLUCERNA LIQUIDO FRESA con un lote CORTO de 2 unidades que vence en
--       60 días: la venta lo elige primero y reparte el resto en PRUEBA-01.
--     · NEPRO AP sin existencia: la venta ofrece anotarlo como venta perdida.
INSERT INTO public.dist_lotes (emisor_id, product_id, lote, vence, existencia)
SELECT c.emisor_id, c.product_id, 'CORTO-01', current_date + 60, 2
  FROM public.dist_catalogo c JOIN public.products p ON p.id = c.product_id
 WHERE p.nombre = 'GLUCERNA LIQUIDO FRESA X 237ML'
ON CONFLICT DO NOTHING;
UPDATE public.dist_lotes l SET existencia = 0
  FROM public.products p
 WHERE p.id = l.product_id AND p.nombre = 'NEPRO AP VAINILLA 8ONZ LIQUIDO';

-- 6 · Para probar las reservas (0012, 2026-09-29): GLUCERNA TRIPLE CARE 850 g
--     con sólo 3 unidades. Una venta que pide 3 deja a la otra sin nada, y la
--     otra tiene que decir quién lo está vendiendo.
UPDATE public.dist_lotes l SET existencia = 3
  FROM public.products p
 WHERE p.id = l.product_id AND p.nombre = 'GLUCERNA TRIPLE CARE X 850GR';

-- 7 · Para ver el control de Facturación (0013, 2026-09-29): un documento
--     RECHAZADO por un dato del cliente (su pedido vuelve a «por facturar»)
--     y uno emitido SIN CONEXIÓN. Salen de los «sin firmar» que dejan las
--     pruebas (en este entorno no hay credenciales de Hacienda).
WITH r AS (
    SELECT d.id, d.pedido_id FROM public.dist_dte d JOIN public.dist_pedidos p ON p.id = d.pedido_id
     WHERE d.estado = 'sin_firmar' AND p.estado = 'facturado' AND p.dte_id = d.id
       AND NOT EXISTS (SELECT 1 FROM public.dist_dte x WHERE x.estado = 'rechazado')
     ORDER BY d.id DESC LIMIT 1),
u AS (UPDATE public.dist_dte d SET estado = 'rechazado', firmado = 'PRUEBA', intentos = 1,
            codigo_msg = '004', descripcion_msg = 'RECHAZADO',
            observaciones_mh = '["[receptor.nrc] El NRC del receptor no existe o no está activo"]'::jsonb
        FROM r WHERE d.id = r.id RETURNING d.pedido_id)
UPDATE public.dist_pedidos p SET estado = 'confirmado', dte_id = NULL FROM u WHERE p.id = u.pedido_id;
UPDATE public.dist_dte SET estado = 'contingencia', firmado = 'PRUEBA'
 WHERE id = (SELECT id FROM public.dist_dte WHERE estado = 'sin_firmar' ORDER BY id DESC LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM public.dist_dte WHERE estado = 'contingencia');

-- 8 · Para probar cuentas por cobrar (0014, 2026-09-30): cobros realistas
--     sobre el historial del tablero. Lo de hace más de 45 días se pagó casi
--     todo; entre 15 y 45 días, la mayoría; lo reciente queda debiendo. Dos
--     clientes quedan con atrasos y uno con un pago parcial. Directo en las
--     tablas (sin `dist_cobrar`, que pide una sesión): sólo en pruebas.
DO $$
DECLARE x record; v_rec bigint; v_monto numeric; v_cuando timestamptz;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE username = 'pruebas')
       OR (SELECT count(*) FROM public.employees) > 30
       OR EXISTS (SELECT 1 FROM public.dist_recibos WHERE nota = 'Semilla de cobros') THEN
        RETURN;
    END IF;
    FOR x IN
        SELECT c.*, cl.nombre FROM public.dist_cxc c JOIN public.dist_clientes cl ON cl.id = c.cliente_id
         WHERE c.estado = 'abierta' ORDER BY c.fecha
    LOOP
        -- Los morosos a propósito: nunca pagan lo de los últimos 70 días.
        CONTINUE WHEN x.nombre IN ('FARMACIA LA PALMA', 'TIENDA LA ROCA') AND x.fecha > current_date - 70;
        v_monto := CASE
            WHEN x.fecha < current_date - 45 THEN x.saldo
            WHEN x.fecha < current_date - 15 AND random() < 0.75 THEN x.saldo
            WHEN x.fecha < current_date - 15 AND random() < 0.3 THEN round(x.saldo * 0.5, 2)
            ELSE 0 END;
        CONTINUE WHEN v_monto <= 0;
        v_cuando := (least(x.vence, current_date - 1) - floor(random() * 10)::int + time '10:00')::timestamp AT TIME ZONE 'America/El_Salvador';
        INSERT INTO public.dist_recibos (emisor_id, cliente_id, client_uuid, monto, forma, referencia, nota, recibido_por, created_at)
        VALUES (x.emisor_id, x.cliente_id, gen_random_uuid(), v_monto,
                CASE WHEN random() < 0.6 THEN '01' ELSE '05' END, 'TRF-' || x.id, 'Semilla de cobros',
                coalesce(x.vendedor_id, (SELECT id FROM public.employees WHERE username = 'pruebas')), v_cuando)
        RETURNING id INTO v_rec;
        INSERT INTO public.dist_cxc_abonos (recibo_id, cxc_id, monto, created_at) VALUES (v_rec, x.id, v_monto, v_cuando);
        PERFORM public.dist_cxc_recalcular(x.id);
    END LOOP;
END $$;
