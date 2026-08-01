SET lock_timeout = '5s';

-- El libro de contribuyentes salía con menos columnas que el del ERP, y no
-- porque faltara el dato: **estaba guardado y no se devolvía.**
--
-- Mapeo completo de la fila del ERP (Salud 1, 11-07-2026, LORENA NOHEMY
-- CARRILLO NAVARRETE, $6.99), columna por columna:
--
--   [ 3] DTE03S003P001000000000000055  numero de control   ← NO existe en la base
--   [ 4] 202675D33CDC...V76U           sello de recepcion  ← si: recibido_mh
--   [ 5] 1B78D7DBC4A1...BD09           codigo de generacion ← si (con guiones)
--   [ 6] 327545                        id del ERP          ← si: erp_invoice_id
--   [ 7] 3095074                       el NRC sin guion    ← si: customers.nrc
--   [17] (vacio)                       NIT/DUI             ← nosotros SI lo tenemos
--
-- O sea: de las seis columnas que "faltaban", cinco ya estaban guardadas y la
-- funcion no las devolvia. Se devuelven todas.
--
-- **La que falta de verdad es el numero de control**, y no se puede derivar: el
-- ERP llama `...000000000000055` al documento que en su correlativo interno es
-- `0000000155` — son dos secuencias distintas. Tampoco viene en
-- `descarga_dte_emitidos_json.php`, que es lo que sincronizamos (verificado: solo
-- id_factura, codigo_generacion, recibido_mh, correlativo, fecha, hora, cliente,
-- cod_vendedor, tipo_pago, estado, totales y productos).
--
-- Se puede traer de dos lados, los dos verificados hoy:
--   a) el CSV del libro del ERP, cruzando por el sello (exacto en ambos lados);
--   b) `downloads/dteqr_json.php?codigoGeneracion=...`, que daria el DTE completo
--      — pero HOY ESTA ROTO en el servidor del proveedor: intenta cachear en
--      `../jsondte/`, directorio que no existe, y falla con file_put_contents.
--      Probado sin cookie, con cookie, con Referer y con cabeceras de navegador:
--      los cuatro dan el mismo error. El PDF (`dteqr_pdf.php`) si funciona.
--
-- Requiere columna nueva en `sales_invoices`, que es tabla CALIENTE: ese DDL va
-- en la ventana 06:00-11:59 UTC, no con los crons de sync corriendo.
--
-- Como se colo: la verificacion del 2026-07-31 midio conteo y monto, no el juego
-- de columnas. Misma leccion que ya costo dos correcciones hoy — ver la regla de
-- CLAUDE.md sobre replicar un reporte.

DROP FUNCTION IF EXISTS public.get_libro_ventas_contribuyente(date, date, bigint);

CREATE FUNCTION public.get_libro_ventas_contribuyente(
    p_desde     date,
    p_hasta     date,
    p_branch_id bigint DEFAULT NULL
)
RETURNS TABLE (
    branch_id         bigint,
    fecha             date,
    correlativo       text,
    codigo_generacion uuid,
    sello_recepcion   text,
    erp_invoice_id    text,
    cliente           text,
    nrc               text,
    nit               text,
    dui               text,
    ventas_exentas    numeric,
    ventas_gravadas   numeric,
    debito_fiscal     numeric,
    total             numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT si.branch_id,
           si.fecha,
           si.correlativo,
           si.codigo_generacion,
           si.recibido_mh,
           si.erp_invoice_id,
           si.cliente,
           nullif(btrim(coalesce(c.nrc, '')), ''),
           nullif(btrim(coalesce(c.nit, '')), ''),
           nullif(btrim(coalesce(c.dui, '')), ''),
           CASE WHEN coalesce(si.iva, 0) = 0 THEN coalesce(si.total, 0)    ELSE 0 END,
           CASE WHEN coalesce(si.iva, 0) > 0 THEN coalesce(si.subtotal, 0) ELSE 0 END,
           coalesce(si.iva, 0),
           coalesce(si.total, 0)
    FROM public.sales_invoices si
    LEFT JOIN public.customers c ON c.id = si.customer_id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.tipo_documento = 'CCF'
      AND si.estado = 'FINALIZADA'
      AND length(si.recibido_mh) = 40
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ORDER BY si.branch_id, si.fecha, si.correlativo;
$$;

REVOKE EXECUTE ON FUNCTION public.get_libro_ventas_contribuyente(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_ventas_contribuyente(date, date, bigint) TO authenticated, service_role;
