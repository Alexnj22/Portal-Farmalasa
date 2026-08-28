SET lock_timeout = '5s';

-- ── Qué ventas ganan puntos ──────────────────────────────────────────────────
--
-- Tres condiciones, y las tres se decidieron mirando datos reales del 27-ago
-- (730 facturas):
--
--   1. estado = 'FINALIZADA'. Son TRES los estados y DOS son anulación:
--      «NULA» (9 en toda la historia, nunca llegaron a Hacienda) y «DTE
--      INVALIDADO EN MH» (1,024, y las 1,024 TIENEN sello de Hacienda: se
--      enviaron y después se anularon ante Hacienda). El circuito viejo
--      descartaba sólo por la palabra NULA, así que las 1,024 ganaron puntos
--      estando anuladas — 52 nada más en agosto.
--
--   2. total > 1.
--
--   3. ningún renglón vendido POR DEBAJO del precio 3.
--      No es «coincide exacto con el precio 1, 2 o 3»: eso se midió y castiga
--      las ventas a precio lleno. STORVAS 20MG se vendió a $31.10 contra un
--      precio 3 de $31.05 y quedaba afuera por cinco centavos; SKAR 10MG se
--      vendió a $34.05 con un precio 1 de $30.00 — arriba de todo — y también.
--      El piso deja pasar esas dos y sigue descartando las que importan:
--      MELATONINA a $6.40 con precio 3 de $6.75, MICROPORE a $1.15 con $2.10.
--      Medido: 601 facturas contra 591, y no pierde ninguna de las 591.
--
-- El precio con el que se compara es el VIGENTE A LA FECHA DE LA VENTA, no el
-- de hoy: `product_precios_history` manda si cubre ese día. Ésa es la respuesta
-- de fondo a «los precios cambian» — el margen es sólo para el redondeo, y
-- medido no cambia el resultado (1% y 2% dan las mismas 601 facturas). Se deja
-- configurable porque el día que cambie, va a cambiar por una razón, y el
-- número tiene que poder moverse sin reescribir la función.
--
-- ⚠️ El margen NO puede crecer sin mirar esto: la distancia entre el precio 3 y
-- el precio 4 tiene mediana 2.91%, y 989 de 6,745 filas de precios los tienen a
-- menos de 1% (956 de ellas iguales). Con 5% el filtro deja pasar el precio de
-- clínica en dos tercios del catálogo, o sea deja de filtrar.
--
-- Un renglón cuyo producto no tiene fila de precios NO se puede probar, así que
-- descarta la factura entera. Son 2 de 1,234 renglones en el día medido.
--
-- RETURNS json (Patrón C de CLAUDE.md): el techo de 1000 filas de PostgREST no
-- aplica a un objeto JSON, y así el tope se aplica DESPUÉS del filtro y dentro
-- de la base, que es donde tiene que estar.
CREATE OR REPLACE FUNCTION public.ventas_para_puntos(
  p_desde  date,
  p_hasta  date,
  p_margen numeric DEFAULT 0.02,
  p_tope   integer DEFAULT 2000
) RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $fn$
DECLARE
  v json;
BEGIN
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    WITH inv AS (
      SELECT si.id, b.codigo_puntos AS sucursal, si.erp_invoice_id, si.correlativo,
             si.cliente, si.cod_vendedor::int AS cod_vendedor, si.total, si.fecha
      FROM public.sales_invoices si
      JOIN public.branches b
        ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
      LEFT JOIN public.puntos_enviados pe ON pe.invoice_id = si.id
      WHERE si.fecha BETWEEN p_desde AND p_hasta
        AND si.estado = 'FINALIZADA'
        AND si.total > 1
        -- El código del vendedor viaja como INT al otro sistema. Uno que no sea
        -- número no se manda: el circuito viejo lo saltaba en silencio, acá al
        -- menos queda del lado del portal y se puede contar.
        AND si.cod_vendedor ~ '^[0-9]+$'
        AND pe.invoice_id IS NULL
    ),
    pv AS (
      SELECT p.product_id, p.id_presentacion,
             upper(regexp_replace(coalesce(pr.tipo,'') || ' ' || coalesce(p.descripcion,''),
                                  '\s+', ' ', 'g')) AS pkey,
             p.vineta, p.descuento_1, p.vip
      FROM public.product_precios p
      LEFT JOIN public.presentaciones pr ON pr.id = p.id_presentacion
      WHERE p.activo
    ),
    lin AS (
      SELECT ii.invoice_id, ii.precio_unitario, ii.erp_product_id, inv.fecha,
             upper(regexp_replace(coalesce(ii.presentacion,''), '\s+', ' ', 'g')) AS pkey
      FROM public.sales_invoice_items ii
      JOIN inv ON inv.id = ii.invoice_id
    ),
    ok AS (
      SELECT lin.invoice_id,
             EXISTS (
               SELECT 1
               FROM pv
               CROSS JOIN LATERAL (
                 SELECT coalesce(h.vineta,      pv.vineta)      AS p1,
                        coalesce(h.descuento_1, pv.descuento_1) AS p2,
                        coalesce(h.vip,         pv.vip)         AS p3
                 FROM (SELECT 1) z
                 LEFT JOIN LATERAL (
                   SELECT h2.vineta, h2.descuento_1, h2.vip
                   FROM public.product_precios_history h2
                   WHERE h2.product_id      = pv.product_id
                     AND h2.id_presentacion = pv.id_presentacion
                     AND h2.valid_from  <  (lin.fecha + 1)::timestamptz
                     AND (h2.valid_until IS NULL OR h2.valid_until >= lin.fecha::timestamptz)
                   ORDER BY h2.valid_from DESC
                   LIMIT 1
                 ) h ON true
               ) e
               WHERE pv.product_id = lin.erp_product_id
                 AND pv.pkey       = lin.pkey
                 -- El piso es el precio 3; si viene en cero, el último de los
                 -- tres primeros que tenga valor. Un cero no es un precio.
                 AND coalesce(nullif(e.p3,0), nullif(e.p2,0), nullif(e.p1,0)) IS NOT NULL
                 AND lin.precio_unitario >=
                     coalesce(nullif(e.p3,0), nullif(e.p2,0), nullif(e.p1,0)) * (1 - p_margen)
             ) AS ok
      FROM lin
    ),
    agg AS (
      SELECT invoice_id, bool_and(ok) AS todas FROM ok GROUP BY 1
    )
    SELECT inv.id AS invoice_id, inv.sucursal, inv.erp_invoice_id, inv.correlativo,
           inv.cliente, inv.cod_vendedor, inv.total, inv.fecha
    FROM inv
    JOIN agg ON agg.invoice_id = inv.id
    WHERE agg.todas
    ORDER BY inv.fecha, inv.id
    LIMIT p_tope
  ) t;

  RETURN v;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.ventas_para_puntos(date, date, numeric, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ventas_para_puntos(date, date, numeric, integer) TO service_role;

COMMENT ON FUNCTION public.ventas_para_puntos(date, date, numeric, integer) IS
  'Ventas que todavía no se mandaron a la base de puntos y cumplen las tres condiciones (FINALIZADA, total > $1, ningún renglón bajo el precio 3 vigente ese día).';


-- ── Lo que se mandó y después se anuló ───────────────────────────────────────
-- El circuito viejo mandaba un mensaje a Telegram con un botón «Puntos
-- anulados» que sólo editaba el propio mensaje: no tocaba la base de puntos ni
-- dejaba rastro consultable. Acá la cola vive en el portal y se puede contar.
CREATE OR REPLACE FUNCTION public.puntos_ventas_anuladas(p_tope integer DEFAULT 500)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
DECLARE
  v json;
BEGIN
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    SELECT pe.invoice_id, pe.sucursal, pe.erp_invoice_id, pe.correlativo,
           pe.cliente, pe.cod_vendedor, pe.total, pe.fecha, pe.enviado_at,
           si.estado AS estado_actual, si.branch_id
    FROM public.puntos_enviados pe
    JOIN public.sales_invoices si ON si.id = pe.invoice_id
    WHERE pe.anulada_at IS NULL
      AND si.estado <> 'FINALIZADA'
    ORDER BY pe.fecha DESC
    LIMIT p_tope
  ) t;
  RETURN v;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_ventas_anuladas(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_ventas_anuladas(integer) TO service_role;

COMMENT ON FUNCTION public.puntos_ventas_anuladas(integer) IS
  'Ventas ya enviadas a puntos que dejaron de estar FINALIZADA y todavía no se marcaron como anuladas.';


-- ── Anotar lo enviado ────────────────────────────────────────────────────────
-- Recibe SÓLO los ids y arma la fila leyendo `sales_invoices`. Es a propósito:
-- si el llamador mandara los datos, la bitácora diría lo que el llamador CREE
-- que mandó y no lo que la venta es. Misma razón por la que `registrar_egreso`
-- resuelve la firma adentro.
CREATE OR REPLACE FUNCTION public.puntos_marcar_enviadas(p_invoice_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
DECLARE
  n integer;
BEGIN
  INSERT INTO public.puntos_enviados
    (invoice_id, sucursal, erp_invoice_id, correlativo, cliente, cod_vendedor, total, fecha)
  SELECT si.id, b.codigo_puntos, si.erp_invoice_id, si.correlativo, si.cliente,
         nullif(regexp_replace(si.cod_vendedor, '\D', '', 'g'), '')::int, si.total, si.fecha
  FROM public.sales_invoices si
  JOIN public.branches b ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
  WHERE si.id = ANY(p_invoice_ids)
  ON CONFLICT (invoice_id) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_marcar_enviadas(bigint[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_marcar_enviadas(bigint[]) TO service_role;


-- ── Anotar la anulación ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_marcar_anuladas(p_invoice_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
DECLARE
  n integer;
BEGIN
  UPDATE public.puntos_enviados pe
     SET anulada_at     = now(),
         estado_anulada = si.estado
    FROM public.sales_invoices si
   WHERE si.id = pe.invoice_id
     AND pe.invoice_id = ANY(p_invoice_ids)
     AND pe.anulada_at IS NULL
     AND si.estado <> 'FINALIZADA';

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_marcar_anuladas(bigint[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_marcar_anuladas(bigint[]) TO service_role;
