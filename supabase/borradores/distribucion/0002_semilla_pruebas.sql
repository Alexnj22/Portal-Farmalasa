-- Semilla del ENTORNO DE PRUEBAS para la venta en ruta: un emisor ficticio,
-- cuatro clientes (una tienda, un supermercado que retiene, una farmacia a
-- crédito y un cliente SIN licencia para ver el candado) y un catálogo armado
-- con los productos de muestra del branch.
--
-- Guarda: sólo corre si la base tiene ≤2 fichas de empleado — la misma que usa
-- la semilla del branch. En producción (48 fichas) no hace nada.
--
-- Todo es ficticio: NIT, NRC y licencias inventados con forma válida.

DO $$
DECLARE
    v_emisor smallint;
    v_yo uuid;
BEGIN
    IF (SELECT count(*) FROM public.employees) > 2 THEN
        RAISE NOTICE 'semilla de distribución: esto no es el entorno de pruebas, no se siembra';
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.dist_emisores) THEN
        RAISE NOTICE 'semilla de distribución: ya sembrada';
        RETURN;
    END IF;
    SELECT id INTO v_yo FROM public.employees ORDER BY created_at LIMIT 1;

    INSERT INTO public.dist_emisores (nombre, nombre_comercial, nit, nrc, cod_actividad, desc_actividad,
        departamento, municipio, distrito, complemento, telefono, correo,
        establecimiento, punto_venta, tipo_establecimiento, cod_estable_mh, cod_punto_venta_mh, ambiente)
    VALUES ('DISTRIBUIDORA DE PRUEBA, S.A.S.', 'DISTRIBUIDORA PRUEBA', '04070101261015', '3456789',
        '46491', 'Venta al por mayor de productos farmacéuticos y medicinales',
        '04', '36', '07', 'Barrio El Centro, bodega de distribución', '23010013', 'facturas@ejemplo.com',
        'B001', 'P001', '04', 'B001', 'P001', '00')
    RETURNING id INTO v_emisor;

    INSERT INTO public.dist_clientes (emisor_id, tipo, nombre, tipo_documento, num_documento, nrc, cod_actividad, desc_actividad,
        gran_contribuyente, departamento, municipio, distrito, complemento, telefono, correo,
        licencia_srs, licencia_srs_vence, limite_credito, plazo_dias, ruta, creado_por)
    VALUES
      (v_emisor, 'tienda', 'TIENDA LA ESQUINA', '13', '01234567-8', NULL, NULL, NULL, false,
       '04', '36', '07', 'Barrio San Antonio, frente al parque', '77778888', NULL,
       'DVL-2026-00123', '2027-03-31', 0, 0, 'Ruta 1 — Chalatenango centro', v_yo),
      (v_emisor, 'supermercado', 'SUPER EL AHORRO, S.A. DE C.V.', '36', '06141203901011', '1122334',
       '47111', 'Venta en supermercados', true,
       '04', '36', '07', 'Carretera Troncal del Norte km 72', '23334444', 'compras@superahorro.com',
       'DVL-2026-00456', '2027-03-31', 2500, 30, 'Ruta 1 — Chalatenango centro', v_yo),
      (v_emisor, 'farmacia', 'FARMACIA DEL PUEBLO, S.A. DE C.V.', '36', '04071503901023', '1234567',
       '47721', 'Venta al por menor de productos farmacéuticos', false,
       '04', '36', '07', '2a Calle Oriente #5', '24445555', 'compras@farmaciadelpueblo.com',
       'F-2025-0789', '2027-03-31', 1500, 30, 'Ruta 2 — Nueva Concepción', v_yo),
      (v_emisor, 'tienda', 'TIENDA SIN LICENCIA (prueba del candado)', NULL, NULL, NULL, NULL, NULL, false,
       '04', '36', '07', 'Caserío El Pino', '70001111', NULL,
       NULL, NULL, 0, 0, 'Ruta 2 — Nueva Concepción', v_yo);

    -- Catálogo: los 60 primeros productos activos. En el branch no existe el
    -- listado de la SRS, así que «venta libre» = ni antibiótico, ni regulado, ni
    -- con receta. En producción esa casilla la marca una persona contra el listado.
    INSERT INTO public.dist_catalogo (emisor_id, product_id, precio_sin_iva, venta_libre)
    SELECT v_emisor, p.id,
           round((0.50 + (p.id % 97) * 0.35)::numeric, 2),
           NOT (coalesce(p.es_antibiotico, false) OR coalesce(p.regulado, false) OR coalesce(p.requiere_receta, false))
      FROM public.products p
     WHERE coalesce(p.activo, true)
     ORDER BY p.id
     LIMIT 60;
END $$;
