-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · datos de prueba para el TABLERO (2026-09-29)
-- ═══════════════════════════════════════════════════════════════════════════
-- SÓLO para el entorno de pruebas. Pedido del usuario: «un dashboard en la
-- distribuidora con datos de ventas, clientes, etc. […] con datos de prueba».
-- Con 4 clientes y 54 ventas sin sellar no hay tendencia que mirar.
--
-- Siembra:
--   · 24 clientes más en tres rutas (tiendas, supermercados, farmacias; unos
--     con NRC y crédito). Cuatro dejan de comprar hace más de un mes, para que
--     el tablero tenga «clientes que dejaron de comprar».
--   · ~120 días de ventas facturadas (documentos «sellados» de mentira: sello y
--     firma dicen PRUEBA), con más movimiento entre semana y un crecimiento
--     suave, y sus formas de pago.
--
-- Pasa por los triggers de verdad: el precio de cada renglón lo pone
-- `dist_validar_item` desde las listas, y a una tienda no se le siembra nada
-- que no sea de venta libre (el trigger lo rechazaría igual).
--
-- Guardas: sólo corre si existe la cuenta `pruebas` y la base tiene ≤30 fichas
-- de empleado (producción tiene 48), y no corre dos veces (busca su marca).

DO $$
DECLARE
    v_emisor   smallint;
    v_marca    text := 'Semilla del tablero';
    v_rutas    text[] := ARRAY['Ruta 1 — Chalatenango centro', 'Ruta 2 — Nueva Concepción', 'Ruta 3 — La Palma'];
    v_tipos    text[] := ARRAY['tienda','tienda','tienda','supermercado','farmacia','farmacia'];
    v_nombres  text[] := ARRAY['TIENDA DON CHEPE','TIENDA LA BENDICIÓN','MINISÚPER EL AHORRO','TIENDA MARY','TIENDA EL CARMEN',
                               'SÚPER SELECTOS DEL NORTE','FARMACIA SAN JOSÉ','FARMACIA LA FE','TIENDA LOS PINOS','TIENDA DOÑA TERE',
                               'MINISÚPER LA ECONÓMICA','FARMACIA VIDA','TIENDA EL MANGO','TIENDA LA ESPERANZA','SÚPER LA COLONIA',
                               'FARMACIA SANTA ROSA','TIENDA EL RINCÓN','TIENDA LAS FLORES','MINISÚPER CENTRAL','FARMACIA EL CALVARIO',
                               'TIENDA LA ROCA','TIENDA EL PROGRESO','SÚPER DESPENSA POPULAR','FARMACIA LA PALMA'];
    v_vend     uuid[];
    c          record;
    v_dia      date;
    v_n        integer;
    v_ped      bigint;
    v_dte      bigint;
    v_tot      numeric;
    v_corr     bigint := 900000000000000;
    v_hora     time;
    v_prod     record;
    v_forma    text;
    k          integer;
    v_clientes bigint[];
    v_cli      bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE username = 'pruebas')
       OR (SELECT count(*) FROM public.employees) > 30 THEN
        RAISE NOTICE 'No es el entorno de pruebas: no se siembra nada.';
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.dist_pedidos WHERE observaciones = v_marca) THEN
        RAISE NOTICE 'El tablero ya estaba sembrado.';
        RETURN;
    END IF;
    SELECT id INTO v_emisor FROM public.dist_emisores ORDER BY id LIMIT 1;

    -- ── Clientes ──
    FOR k IN 1 .. array_length(v_nombres, 1) LOOP
        INSERT INTO public.dist_clientes (emisor_id, tipo, nombre, tipo_documento, num_documento, nrc,
               cod_actividad, desc_actividad,
               departamento, municipio, distrito, complemento, telefono, licencia_srs, licencia_srs_vence,
               limite_credito, plazo_dias, ruta, activo)
        VALUES (v_emisor, v_tipos[1 + (k % 6)], v_nombres[k], '36', lpad((06140000000000 + k * 7919)::text, 14, '0'),
                CASE WHEN k % 3 = 0 THEN (1000000 + k)::text END,
                CASE WHEN k % 3 = 0 THEN '47111' END, CASE WHEN k % 3 = 0 THEN 'Venta al por menor en comercios no especializados' END,
                -- Chalatenango (códigos de Hacienda, como la ficha de muestra).
                '04', '36', '07', 'Barrio El Centro, casa ' || k, '2301' || lpad(k::text, 4, '0'),
                'SRS-PRUEBA-' || k, current_date + 365,
                CASE WHEN k % 4 = 0 THEN 1500 ELSE 0 END, CASE WHEN k % 4 = 0 THEN 30 ELSE 0 END,
                v_rutas[1 + (k % 3)], true);
    END LOOP;

    SELECT array_agg(id ORDER BY id) INTO v_vend FROM (
        SELECT id FROM public.employees WHERE status = 'ACTIVO' ORDER BY (username = 'pruebas') DESC, name LIMIT 4) e;
    -- Sólo a quien se le puede vender (la semilla del candado tiene una tienda sin licencia a propósito).
    SELECT array_agg(id ORDER BY id) INTO v_clientes FROM public.dist_clientes
     WHERE emisor_id = v_emisor AND activo AND licencia_srs IS NOT NULL
       AND (licencia_srs_vence IS NULL OR licencia_srs_vence >= current_date);

    -- ── Ventas: 120 días hacia atrás ──
    FOR v_dia IN SELECT d::date FROM generate_series(current_date - 120, current_date - 1, interval '1 day') d LOOP
        CONTINUE WHEN extract(isodow FROM v_dia) = 7;                -- domingo no hay ruta
        v_n := 3 + floor(random() * 5)::int                            -- 3–7 al día…
             + CASE WHEN extract(isodow FROM v_dia) IN (1, 5) THEN 3 ELSE 0 END   -- …más lunes y viernes
             + floor((120 - (current_date - v_dia)) / 30.0)::int;      -- y crece mes a mes
        FOR k IN 1 .. v_n LOOP
            v_cli := v_clientes[1 + floor(random() * array_length(v_clientes, 1))::int];
            SELECT * INTO c FROM public.dist_clientes WHERE id = v_cli;
            -- Cuatro clientes dejan de comprar hace 35+ días.
            CONTINUE WHEN c.nombre IN ('TIENDA EL MANGO','FARMACIA VIDA','TIENDA LAS FLORES','MINISÚPER CENTRAL')
                          AND v_dia > current_date - 35;
            v_hora := time '07:30' + (random() * interval '9 hours');
            INSERT INTO public.dist_pedidos (emisor_id, cliente_id, vendedor_id, estado, tipo_documento, condicion,
                   forma_pago, plazo_dias, observaciones, client_uuid, created_at)
            VALUES (v_emisor, c.id, v_vend[1 + floor(random() * array_length(v_vend, 1))::int], 'confirmado',
                    CASE WHEN c.nrc IS NOT NULL THEN '03' ELSE '01' END,
                    CASE WHEN c.plazo_dias > 0 AND random() < 0.5 THEN 2 ELSE 1 END,
                    CASE WHEN random() < 0.7 THEN '01' ELSE '05' END,
                    CASE WHEN c.plazo_dias > 0 THEN c.plazo_dias END,
                    v_marca, gen_random_uuid(), (v_dia + v_hora) AT TIME ZONE 'America/El_Salvador')
            RETURNING id INTO v_ped;
            -- 1–6 productos permitidos para ese cliente; los más vendidos salen más.
            FOR v_prod IN
                SELECT cat.product_id FROM public.dist_catalogo cat JOIN public.products p ON p.id = cat.product_id
                 WHERE cat.emisor_id = v_emisor AND cat.activo
                   AND (c.tipo = 'farmacia' OR (cat.venta_libre AND NOT coalesce(p.es_antibiotico, false)
                        AND NOT coalesce(p.regulado, false) AND NOT coalesce(p.requiere_receta, false)))
                 ORDER BY random() * (1 + (cat.product_id % 5)) LIMIT 1 + floor(random() * 6)::int
            LOOP
                INSERT INTO public.dist_pedido_items (pedido_id, product_id, cantidad, precio_con_iva, descuento, descripcion, presentacion)
                VALUES (v_ped, v_prod.product_id, 1 + floor(random() * 12)::int, 0, 0, '', 'UNIDAD')
                ON CONFLICT DO NOTHING;
            END LOOP;
            SELECT coalesce(sum(round(cantidad * precio_con_iva, 2) - descuento), 0) INTO v_tot
              FROM public.dist_pedido_items WHERE pedido_id = v_ped;
            IF v_tot = 0 THEN DELETE FROM public.dist_pedidos WHERE id = v_ped; CONTINUE; END IF;

            SELECT CASE WHEN condicion = 2 THEN '13' ELSE forma_pago END INTO v_forma FROM public.dist_pedidos WHERE id = v_ped;
            INSERT INTO public.dist_pagos (pedido_id, orden, forma, monto, registrado_por)
            VALUES (v_ped, 1, v_forma, v_tot, v_vend[1]);

            v_corr := v_corr + 1;
            INSERT INTO public.dist_dte (emisor_id, ambiente, tipo, codigo_generacion, numero_control, fec_emi, hor_emi,
                   cliente_id, pedido_id, total_pagar, json, firmado, estado, sello_recibido, observaciones_mh, intentos, created_at)
            VALUES (v_emisor, '00', CASE WHEN c.nrc IS NOT NULL THEN '03' ELSE '01' END, gen_random_uuid(),
                    'DTE-' || CASE WHEN c.nrc IS NOT NULL THEN '03' ELSE '01' END || '-PRUEBA01-' || v_corr,
                    v_dia, v_hora, c.id, v_ped, v_tot, '{}'::jsonb, 'PRUEBA',
                    'sellado', rpad('PRUEBA' || v_corr, 40, '0'), '[]'::jsonb, 1,
                    (v_dia + v_hora) AT TIME ZONE 'America/El_Salvador')
            RETURNING id INTO v_dte;
            UPDATE public.dist_pedidos SET estado = 'facturado', dte_id = v_dte WHERE id = v_ped;
        END LOOP;
    END LOOP;
END $$;
