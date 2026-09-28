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
