-- Semilla del ENTORNO DE PRUEBAS: listas de precio y presentaciones de la
-- venta en ruta, armadas desde los precios de muestra del branch
-- (`product_precios`, que vienen CON IVA → se dividen entre 1.13).
--
-- Cuatro listas, en el orden en que una distribuidora las usa: Mayoreo es la
-- base (la que manda cuando falta un precio), Premium y VIP para clientes con
-- volumen, Viñeta = el precio sugerido al público.
--
-- Guarda: sólo sobre el emisor FICTICIO de 0002 (su NIT inventado). El conteo
-- de fichas de 0002 no sirve acá: el branch ya tiene 13 (cuentas de QA).

DO $$
DECLARE
    v_emisor smallint;
BEGIN
    SELECT id INTO v_emisor FROM public.dist_emisores WHERE nit = '04070101261015' AND ambiente = '00';
    IF v_emisor IS NULL OR EXISTS (SELECT 1 FROM public.dist_listas) THEN
        RAISE NOTICE 'semilla de listas: sin emisor o ya sembrada';
        RETURN;
    END IF;

    INSERT INTO public.dist_listas (emisor_id, nombre, orden) VALUES
        (v_emisor, 'Mayoreo', 1), (v_emisor, 'Premium', 2), (v_emisor, 'VIP', 3), (v_emisor, 'Viñeta', 4);

    WITH base AS (
        SELECT DISTINCT ON (pp.product_id, pr.tipo)
               pp.product_id, pr.tipo AS presentacion, greatest(pp.factor, 1) AS unidades,
               pp.mayoreo, pp.premium, pp.vip, pp.vineta
          FROM public.product_precios pp
          JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
          JOIN public.dist_catalogo c ON c.product_id = pp.product_id AND c.emisor_id = v_emisor
         WHERE pp.activo AND pr.tipo IS NOT NULL
         ORDER BY pp.product_id, pr.tipo, pp.id
    ), precios AS (
        SELECT b.product_id, b.presentacion, b.unidades, l.id AS lista_id,
               CASE l.nombre WHEN 'Mayoreo' THEN b.mayoreo WHEN 'Premium' THEN b.premium
                             WHEN 'VIP' THEN b.vip ELSE b.vineta END AS con_iva
          FROM base b CROSS JOIN public.dist_listas l
         WHERE l.emisor_id = v_emisor
    )
    INSERT INTO public.dist_precios (emisor_id, product_id, presentacion, unidades, lista_id, precio_sin_iva)
    SELECT v_emisor, product_id, presentacion, unidades, lista_id, round(con_iva / 1.13, 6)
      FROM precios WHERE con_iva > 0.05;

    -- La farmacia a crédito compra en Premium; los demás, en la base.
    UPDATE public.dist_clientes c SET lista_id = l.id
      FROM public.dist_listas l
     WHERE l.emisor_id = v_emisor AND l.nombre = CASE WHEN c.tipo = 'farmacia' THEN 'Premium' ELSE 'Mayoreo' END;
END $$;
