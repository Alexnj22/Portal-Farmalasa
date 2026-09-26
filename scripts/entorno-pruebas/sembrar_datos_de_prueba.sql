-- ─────────────────────────────────────────────────────────────────────────────
-- Datos de prueba INVENTADOS para el branch de pruebas: ventas, clientes y
-- vendedores. Cero datos reales.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ── Por qué existe (2026-09-26) ─────────────────────────────────────────────
-- El usuario: «¿por qué al de pruebas no le hemos agregado datos? todo está
-- vacío siempre. No hay ventas, clientes ni datos para probar». En agosto se
-- sembraron a mano ~5,100 facturas y 26 empleados, pero con `execute_sql`, sin
-- guardar el script: cada vez que el branch se rehace —cinco veces ya— se
-- pierden. Este archivo lo corre `mantener_al_dia.mjs` TODOS LOS DÍAS; sólo
-- siembra si la base está vacía, y `correr_fechas.sql` después mantiene lo
-- sembrado pegado a hoy.
--
-- ── Qué siembra ──────────────────────────────────────────────────────────────
--   · el mapa sala ↔ número de la caja (`erp_sucursal_map`), copia de la
--     configuración de producción (no son datos de personas)
--   · 12 vendedores (2 por sala), nombres inventados
--   · 400 clientes inventados con DUI de formato válido (dígito verificador
--     correcto) y 60 de ellos contribuyentes con NRC
--   · ~19,000 facturas de los últimos 90 días en las 6 salas de venta, con sus
--     renglones sobre los productos sembrados. Proporciones de producción:
--     efectivo 94% · tarjeta 4% · crédito 1% · transferencia; CCF ~1%; y unas
--     pocas anuladas, invalidadas y sin sello, para que Facturación y los libros
--     tengan qué mostrar.
--   · los resúmenes derivados los recalcula `recalcular_resumenes.sql`, DESPUÉS
--     de correr las fechas: calculados antes quedarían corridos un día.
--
-- Determinista (`setseed`): dos branches sembrados dan los mismos datos, así
-- una medición en uno se puede repetir en otro.

-- ── La guarda ────────────────────────────────────────────────────────────────
-- La cuenta `pruebas` sólo existe en el branch (la semilla la crea sólo con la
-- base vacía de empleados). Y producción tiene cientos de miles de facturas.
DO $guarda$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE username = 'pruebas') THEN
    RAISE EXCEPTION 'Sólo en el branch de pruebas: no se encontró la cuenta `pruebas`.';
  END IF;
  IF (SELECT count(*) FROM public.sales_invoices) > 50000 THEN
    RAISE EXCEPTION 'Esta base parece PRODUCCIÓN. Abortado.';
  END IF;
END
$guarda$;

-- ── 1. El mapa de salas (configuración, igual a producción) ─────────────────
INSERT INTO public.erp_sucursal_map (erp_sucursal_id, branch_id, nombre, es_bodega, orden_despacho, inv_ubicaciones, codigo)
VALUES
  (1,  4, 'Salud 1',    false, 2,    '[{"id":3,"isVencidos":false}]', 'S1'),
  (2, 25, 'Salud 2',    false, 3,    '[{"id":4,"isVencidos":false}]', 'S2'),
  (3, 27, 'Salud 3',    false, 4,    '[{"id":5,"isVencidos":false}]', 'S3'),
  (4, 28, 'Salud 4',    false, 5,    '[{"id":6,"isVencidos":false}]', 'S4'),
  (5,  2, 'La Popular', false, 1,    '[{"id":7,"isVencidos":false}]', 'PO'),
  (6, 30, 'Bodega',     true,  NULL, '[{"id":1,"isVencidos":false},{"id":2,"isVencidos":true}]', 'BO'),
  (7, 29, 'Salud 5',    false, 6,    '[{"id":8,"isVencidos":false}]', 'S5')
ON CONFLICT (erp_sucursal_id) DO NOTHING;

-- Las ventas sólo se siembran una vez: si ya hay, lo demás tampoco hace falta.
DO $siembra$
DECLARE
  v_hoy     date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_nombres text[] := ARRAY['Ana','Carlos','María','José','Lucía','Jorge','Sofía','Luis','Carmen','Miguel',
                            'Rosa','Pedro','Elena','Juan','Patricia','Ricardo','Gabriela','Óscar','Claudia','Mario'];
  v_apell   text[] := ARRAY['Pérez','López','Martínez','Hernández','García','Rivas','Flores','Ramírez','Cruz','Mejía',
                            'Castillo','Romero','Alvarado','Guzmán','Portillo','Orellana','Méndez','Aguilar','Menjívar','Serrano'];
  v_n       integer;
BEGIN
  IF (SELECT count(*) FROM public.sales_invoices) >= 1000 THEN
    RAISE NOTICE 'Ya hay ventas sembradas: nada que hacer.';
    RETURN;
  END IF;
  PERFORM setseed(0.26);

  -- ── 2. Vendedores: 2 por sala ─────────────────────────────────────────────
  INSERT INTO public.employees (code, first_names, last_names, branch_id, status)
  SELECT (9200 + row_number() OVER ())::text,
         v_nombres[1 + (row_number() OVER () * 7) % 20],
         v_apell[1 + (row_number() OVER () * 11) % 20] || ' ' || v_apell[1 + (row_number() OVER () * 3) % 20],
         s.branch_id, 'ACTIVO'
    FROM (SELECT b.branch_id FROM (VALUES (2),(4),(25),(27),(28),(29)) b(branch_id), generate_series(1, 2)) s
   -- `code` no tiene índice único: la guarda es a mano.
   WHERE NOT EXISTS (SELECT 1 FROM public.employees WHERE code BETWEEN '9201' AND '9299');

  -- ── 3. Clientes con DUI válido; 60 contribuyentes ─────────────────────────
  WITH base AS (
    SELECT i,
           lpad((10000000 + (random() * 89999999)::int)::text, 8, '0') AS d8
      FROM generate_series(1, 400) i
  ), dui AS (
    SELECT i, d8,
           (10 - ((SELECT sum(substr(d8, g, 1)::int * (10 - g)) FROM generate_series(1, 8) g) % 10)) % 10 AS dv
      FROM base
  )
  INSERT INTO public.customers (name, dui, phone, direccion, departamento, municipio, categoria, nrc, nit,
                                acumula_puntos, acepta_programa_puntos, erp_id)
  -- `customers` tiene el nombre ÚNICO: (i % 20, i / 20) es un par distinto para
  -- cada uno de los 400, así que el primer nombre + primer apellido no se repite.
  SELECT upper(v_nombres[1 + i % 20] || ' ' || v_nombres[1 + (i * 7 / 3) % 20] || ' '
               || v_apell[1 + (i / 20) % 20] || ' ' || v_apell[1 + (i * 11) % 20]),
         d8 || '-' || dv,
         (6 + i % 2)::text || lpad(((i * 7919) % 10000000)::text, 7, '0'),
         'COLONIA DE PRUEBA, CASA ' || i,
         'CHALATENANGO', 'CHALATENANGO CENTRO',
         CASE WHEN i <= 60 THEN 'Contribuyente' ELSE 'Consumidor' END,
         CASE WHEN i <= 60 THEN (100000 + i)::text || '-' || (i % 10) END,
         CASE WHEN i <= 60 THEN '0407-' || lpad(i::text, 6, '0') || '-101-' || (i % 10) END,
         true, true, 'PRUEBA-' || i
    FROM dui
   -- `id` es identidad: el cliente sembrado se reconoce por su `erp_id`.
   WHERE NOT EXISTS (SELECT 1 FROM public.customers WHERE erp_id LIKE 'PRUEBA-%');

  -- ── 4. Facturas: 90 días × 6 salas × ~35 por día ──────────────────────────
  CREATE TEMP TABLE _fac ON COMMIT DROP AS
  WITH dias AS (
    SELECT (v_hoy - d) AS fecha, extract(isodow FROM v_hoy - d)::int AS dow
      FROM generate_series(0, 89) d
  ), salas AS (
    SELECT * FROM (VALUES (2, 1.4), (4, 1.0), (25, 0.9), (27, 0.8), (28, 0.8), (29, 0.7)) s(branch_id, peso)
  ), cuantas AS (
    SELECT d.fecha, s.branch_id,
           greatest(5, round(35 * s.peso * CASE WHEN d.dow = 7 THEN 0.6 ELSE 1 END
                              * (0.8 + random() * 0.4)))::int AS n
      FROM dias d CROSS JOIN salas s
  )
  SELECT row_number() OVER (ORDER BY c.fecha, c.branch_id, g) AS k,
         c.fecha, c.branch_id,
         (time '07:30' + (random() * interval '13 hours'))::time(0) AS hora,
         random() AS r_doc, random() AS r_pago, random() AS r_estado, random() AS r_cli,
         1 + (random() * 2.4)::int AS renglones
    FROM cuantas c, generate_series(1, c.n) g;

  INSERT INTO public.sales_invoices
    (branch_id, erp_invoice_id, codigo_generacion, correlativo, tipo_documento, fecha, hora, cliente,
     cod_vendedor, tipo_pago, estado, subtotal, iva, total, customer_id, recibido_mh, has_puntos,
     numero_control, retencion)
  SELECT f.branch_id,
         'PRUEBA-' || f.k,
         gen_random_uuid(),
         (1000 + row_number() OVER (PARTITION BY f.branch_id, (f.r_doc < 0.015) ORDER BY f.fecha, f.hora))::text,
         CASE WHEN f.r_doc < 0.015 THEN 'CCF' ELSE 'COF' END,
         f.fecha, f.hora,
         CASE WHEN f.r_doc < 0.015 OR f.r_cli < 0.3 THEN c.name ELSE 'CLIENTES VARIOS' END,
         (SELECT e.code FROM public.employees e
           WHERE e.branch_id = f.branch_id AND e.code::int BETWEEN 9201 AND 9299
           ORDER BY e.code OFFSET (f.k % 2) LIMIT 1),
         CASE WHEN f.r_pago < 0.94 THEN 'efectivo' WHEN f.r_pago < 0.98 THEN 'tarjeta'
              WHEN f.r_pago < 0.99 THEN 'credito' ELSE 'transferencia' END,
         CASE WHEN f.r_estado < 0.005 THEN 'NULA' WHEN f.r_estado < 0.013 THEN 'DTE INVALIDADO EN MH'
              ELSE 'FINALIZADA' END,
         0, 0, 0,
         CASE WHEN f.r_doc < 0.015 OR f.r_cli < 0.3 THEN c.id END,
         -- Sello de Hacienda de 40 caracteres; unas pocas quedan pendientes.
         CASE WHEN f.r_estado BETWEEN 0.013 AND 0.018 THEN NULL
              ELSE upper(substr(md5('sello' || f.k) || md5('mh' || f.k), 1, 40)) END,
         f.r_cli < 0.2,
         'DTE-' || CASE WHEN f.r_doc < 0.015 THEN '03' ELSE '01' END || '-PRUEBA' || f.branch_id || '-'
               || lpad(f.k::text, 15, '0'),
         0
    FROM _fac f
    LEFT JOIN public.customers c
      ON c.erp_id = 'PRUEBA-' || CASE WHEN f.r_doc < 0.015 THEN 1 + (f.k % 60) ELSE 61 + (f.k % 340) END;

  -- ── 5. Renglones sobre los productos sembrados, y los totales ─────────────
  CREATE TEMP TABLE _prod ON COMMIT DROP AS
  SELECT row_number() OVER (ORDER BY p.id) AS n, p.id AS erp_product_id, p.nombre,
         pp.id_presentacion, coalesce(pp.descripcion, 'UNIDAD') AS presentacion,
         greatest(coalesce(pp.vineta, 1), 0.25) AS precio
    FROM public.products p
    JOIN LATERAL (SELECT * FROM public.product_precios x
                   WHERE x.product_id = p.id AND coalesce(x.activo, true)
                   ORDER BY x.id_presentacion LIMIT 1) pp ON true;
  SELECT count(*) INTO v_n FROM _prod;
  IF v_n = 0 THEN RAISE EXCEPTION 'No hay productos con precio para sembrar renglones.'; END IF;

  INSERT INTO public.sales_invoice_items
    (invoice_id, erp_product_id, descripcion, cantidad, presentacion, precio_unitario, total_linea,
     id_presentacion, linea_num)
  SELECT si.id, p.erp_product_id, p.nombre, q.cant, p.presentacion, p.precio,
         round(p.precio * q.cant, 2), p.id_presentacion, r.linea
    FROM public.sales_invoices si
    JOIN _fac f ON 'PRUEBA-' || f.k = si.erp_invoice_id
    CROSS JOIN LATERAL generate_series(1, f.renglones) r(linea)
    CROSS JOIN LATERAL (SELECT 1 + ((f.k * 31 + r.linea * 97) % v_n) AS n,
                               1 + ((f.k + r.linea) % 3) AS cant) q
    JOIN _prod p ON p.n = q.n;

  UPDATE public.sales_invoices si
     SET total = t.total,
         subtotal = round(t.total / 1.13, 2),
         iva = t.total - round(t.total / 1.13, 2)
    FROM (SELECT invoice_id, sum(total_linea) AS total
            FROM public.sales_invoice_items GROUP BY 1) t
   WHERE t.invoice_id = si.id AND si.erp_invoice_id LIKE 'PRUEBA-%';

  RAISE NOTICE 'Sembradas % facturas.', (SELECT count(*) FROM public.sales_invoices WHERE erp_invoice_id LIKE 'PRUEBA-%');
END
$siembra$;

SELECT (SELECT count(*) FROM public.sales_invoices)       AS facturas,
       (SELECT count(*) FROM public.sales_invoice_items)  AS renglones,
       (SELECT count(*) FROM public.customers)            AS clientes,
       (SELECT count(*) FROM public.employees)            AS empleados,
       (SELECT count(*) FROM public.erp_sucursal_map)     AS salas_mapeadas;
