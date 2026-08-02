SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Bloque B del PLAN-CONTABILIDAD-2026-08-02, parte SQL.
--
-- Los dos arreglos son el mismo error escrito dos veces: un instrumento que
-- mide sobre un conjunto distinto del que mide el libro. Es el patron de
-- `feedback_snapshot_and_live_read_need_same_key` — si la foto y la lectura en
-- vivo no usan la misma clave, la comparacion no prueba nada.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── B4 (H12) · La cola del numero de control ────────────────────────────────
--
--   get_libro_ventas_consumidor : COF + FINALIZADA + sello de 40
--   _docs_sin_numero_control    : COF + FINALIZADA           <-- sin el sello
--
-- El libro toma el PRIMERO y el ULTIMO documento del dia entre los SELLADOS; la
-- cola los calculaba entre todos. Cuando el primero del dia no tiene sello, la
-- cola pide el numero de control de un documento que el libro no usa, y no pide
-- el del que si. Medido antes de aplicar sobre toda la historia desde 2025-05:
-- **3 documentos que el libro necesita y la cola nunca pedia**, y 3 que pedia de
-- mas. Que no haya roto todavia es suerte, no diseño.
--
-- El CCF va igual, porque `get_libro_ventas_contribuyente` tambien filtra por
-- sello. Los ANULADOS no llevan el filtro a proposito: `get_libro_anulados`
-- tampoco lo lleva — un documento invalidado entra al libro de anulados tenga o
-- no sello, asi que pedir su numero de control siempre es correcto. Verificado
-- funcion por funcion antes de escribir esto, no asumido.
CREATE OR REPLACE FUNCTION public._docs_sin_numero_control()
 RETURNS TABLE(id bigint, codigo_generacion uuid, fecha date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH universo AS (
        SELECT si.id, si.codigo_generacion, si.branch_id, si.fecha,
               si.tipo_documento, si.estado, si.numero_control, si.recibido_mh,
               nullif(regexp_replace(si.erp_invoice_id, '\D', '', 'g'), '')::bigint AS erp_id_num
        FROM public.sales_invoices si
        WHERE si.codigo_generacion IS NOT NULL
          AND si.fecha >= '2025-05-01'
    ),
    ccf AS (
        SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control FROM universo u
        WHERE u.tipo_documento = 'CCF' AND u.estado = 'FINALIZADA'
          AND length(u.recibido_mh) = 40
    ),
    anul AS (
        -- Sin filtro de sello: get_libro_anulados tampoco lo tiene.
        SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control FROM universo u
        WHERE u.estado = 'DTE INVALIDADO EN MH'
    ),
    extremos AS (
        SELECT x.id, x.codigo_generacion, x.fecha, x.numero_control FROM (
            SELECT u.id, u.codigo_generacion, u.fecha, u.numero_control,
                   row_number() OVER (PARTITION BY u.branch_id, u.fecha ORDER BY u.erp_id_num ASC)  AS r_asc,
                   row_number() OVER (PARTITION BY u.branch_id, u.fecha ORDER BY u.erp_id_num DESC) AS r_desc
            FROM universo u
            WHERE u.tipo_documento = 'COF' AND u.estado = 'FINALIZADA'
              AND length(u.recibido_mh) = 40
        ) x
        WHERE x.r_asc = 1 OR x.r_desc = 1
    ),
    todos AS (
        SELECT * FROM ccf UNION SELECT * FROM anul UNION SELECT * FROM extremos
    )
    SELECT t.id, t.codigo_generacion, t.fecha
    FROM todos t
    WHERE t.numero_control IS NULL;
$function$;

COMMENT ON FUNCTION public._docs_sin_numero_control() IS
  'B4/H12: cada rama usa EXACTAMENTE el filtro del libro que la consume — CCF y los extremos del dia exigen sello de 40, los anulados no (get_libro_anulados tampoco). Si se cambia el filtro de un libro, hay que cambiarlo aca el mismo dia: si divergen, la cola pide el numero de control de un documento que el libro no usa y no pide el del que si.';

-- ── B3 (H16) · La verificacion ordenaba distinto que el archivo verificado ──
--
-- `generar_csv_libro` produce las lineas que el verificador compara contra el
-- ERP. Los RPC producen las que descarga la contadora. Ordenaban distinto en
-- CUATRO de los cinco reportes:
--
--   reporte        RPC (lo que se presenta)          generar_csv_libro (lo verificado)
--   consumidor     branch_id, fecha                  branch_id, fecha              = igual
--   contribuyente  branch_id, fecha, erp_id          branch_id, erp_id             falta fecha
--   anulados       branch_id, fecha, erp_id          branch_id, erp_id             falta fecha
--   compras        branch_id, fecha, erp_purchase_id branch_id, erp_purchase_id    falta fecha
--   percepcion     branch_id, fecha, erp_purchase_id erp_purchase_id               falta todo
--
-- Medido sobre junio: 148 de 389 lineas de compras (38%) y 95 de 226 de
-- percepcion (42%) caian en otra posicion. Asi que el "226/389 identicas linea
-- por linea" nunca se midio sobre el archivo que se presenta. Y explica el
-- "orden residual en 3 sucursales, sin resolver" que quedo abierto: no era un
-- criterio desconocido del ERP, eran dos implementaciones del portal que no
-- coincidian entre si.
--
-- En percepcion importa el doble: la primera columna es un CORRELATIVO
-- (`row_number()`), asi que un orden distinto no mueve las filas de lugar —
-- **les cambia el numero**. El frontend lo numera recorriendo el resultado del
-- RPC, o sea en el orden del RPC.
--
-- Verificado despues de aplicar, Bodega junio 2026: compras 335/335 y percepcion
-- 211/211 en la misma posicion, correlativo incluido.
CREATE OR REPLACE FUNCTION public.generar_csv_libro(p_reporte text, p_desde date, p_hasta date, p_branch_id bigint)
 RETURNS SETOF text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    fmt2 constant text := 'FM999999990.00';
    fmt4 constant text := 'FM999999990.0000';
BEGIN
    IF p_reporte = 'consumidor' THEN
        RETURN QUERY
        SELECT concat_ws(';',
            to_char(si.fecha, 'DD/MM/YYYY'), '4', '01',
            replace(coalesce((array_agg(si.numero_control ORDER BY si.erp_id_num))[1], ''), '-', ''),
            coalesce((array_agg(si.recibido_mh ORDER BY si.erp_id_num))[1], ''),
            coalesce((array_agg(si.erp_invoice_id ORDER BY si.erp_id_num))[1], ''),
            coalesce((array_agg(si.erp_invoice_id ORDER BY si.erp_id_num DESC))[1], ''),
            replace(upper(coalesce((array_agg(si.codigo_generacion ORDER BY si.erp_id_num))[1]::text, '')), '-', ' '),
            replace(upper(coalesce((array_agg(si.codigo_generacion ORDER BY si.erp_id_num DESC))[1]::text, '')), '-', ' '),
            '',
            to_char(coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva,0) = 0), 0), fmt2),
            '0.00', '0.00', '0.0000',
            to_char(coalesce(sum(si.total) FILTER (WHERE coalesce(si.iva,0) > 0), 0), fmt2),
            '0.00', '0.00', '0.00', '0.00', '0.00',
            to_char(coalesce(sum(si.total), 0), fmt2), '2')
        FROM (SELECT s.*, nullif(regexp_replace(s.erp_invoice_id,'\D','','g'),'')::bigint AS erp_id_num
              FROM public.sales_invoices s) si
        WHERE si.tipo_documento = 'COF' AND si.estado = 'FINALIZADA'
          AND length(si.recibido_mh) = 40
          AND si.fecha BETWEEN p_desde AND p_hasta AND si.branch_id = p_branch_id
        GROUP BY si.branch_id, si.fecha
        ORDER BY si.branch_id, si.fecha;

    ELSIF p_reporte = 'contribuyente' THEN
        RETURN QUERY
        SELECT concat_ws(';',
            to_char(si.fecha, 'DD/MM/YYYY'), '4', '03',
            replace(coalesce(si.numero_control, ''), '-', ''),
            coalesce(si.recibido_mh, ''),
            replace(upper(coalesce(si.codigo_generacion::text, '')), '-', ''),
            coalesce(si.erp_invoice_id, ''),
            replace(coalesce(nullif(btrim(coalesce(c.nrc, '')), ''), ''), '-', ''),
            btrim(coalesce(si.cliente, '')),
            to_char(CASE WHEN coalesce(si.iva,0) = 0 THEN coalesce(si.total,0) ELSE 0 END, fmt2),
            '0.00', '0',
            to_char(CASE WHEN coalesce(si.iva,0) > 0 THEN coalesce(si.subtotal,0) ELSE 0 END, fmt2),
            to_char(coalesce(si.iva, 0), fmt2), '0.00', '0.00',
            to_char(coalesce(si.total, 0), fmt2),
            replace(coalesce(nullif(btrim(coalesce(c.nit, '')), ''), ''), '-', ''), '1')
        FROM public.sales_invoices si
        LEFT JOIN public.customers c ON c.id = si.customer_id
        WHERE si.tipo_documento = 'CCF' AND si.estado = 'FINALIZADA'
          AND length(si.recibido_mh) = 40
          AND si.fecha BETWEEN p_desde AND p_hasta AND si.branch_id = p_branch_id
        ORDER BY si.branch_id, si.fecha,
                 nullif(regexp_replace(si.erp_invoice_id,'\D','','g'),'')::bigint;

    ELSIF p_reporte = 'anulados' THEN
        RETURN QUERY
        SELECT concat_ws(';',
            replace(coalesce(si.numero_control, ''), '-', ''), '4', '0', '0',
            CASE WHEN si.tipo_documento = 'CCF' THEN '03' ELSE '01' END, 'D',
            coalesce(si.recibido_mh, ''), '0', '0',
            replace(upper(coalesce(si.codigo_generacion::text, '')), '-', ''))
        FROM public.sales_invoices si
        WHERE si.estado = 'DTE INVALIDADO EN MH'
          AND si.fecha BETWEEN p_desde AND p_hasta AND si.branch_id = p_branch_id
        ORDER BY si.branch_id, si.fecha,
                 nullif(regexp_replace(si.erp_invoice_id,'\D','','g'),'')::bigint;

    ELSIF p_reporte = 'compras' THEN
        RETURN QUERY
        SELECT concat_ws(';',
            to_char(pr.fecha, 'DD/MM/YYYY'), '4', '',
            coalesce(pr.documento_numero, ''),
            replace(coalesce(nullif(btrim(coalesce(pm.nit, '')), ''), ''), '-', ''),
            btrim(coalesce(pr.proveedor, '')),
            '0.00', '0.00', '0.00',
            to_char(coalesce(pr.subtotal, 0) - coalesce(pr.percepcion_iva, 0), fmt2),
            '0.00', '0.00', '0.00',
            to_char(coalesce(pr.iva, 0), fmt2),
            to_char(coalesce(pr.total, 0), fmt2),
            '', '1', '1', '2', '5', '3',
            CASE WHEN pr.percepcion_iva IS NULL THEN '' ELSE to_char(pr.percepcion_iva, fmt4) END, '')
        FROM public.purchase_receipts pr
        LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
        WHERE pr.fecha BETWEEN p_desde AND p_hasta AND pr.branch_id = p_branch_id
        ORDER BY pr.branch_id, pr.fecha, pr.erp_purchase_id;

    ELSIF p_reporte = 'percepcion' THEN
        RETURN QUERY
        SELECT concat_ws(';',
            row_number() OVER (ORDER BY pr.branch_id, pr.fecha, pr.erp_purchase_id)::text,
            to_char(pr.fecha, 'DD/MM/YYYY'),
            btrim(coalesce(pr.proveedor, '')),
            replace(coalesce(nullif(btrim(coalesce(pm.nit, '')), ''), ''), '-', ''),
            CASE WHEN pr.documento_tipo = 'CCF' THEN '03' ELSE '01' END,
            coalesce(pr.documento_numero, ''), '',
            to_char(coalesce(pr.subtotal, 0) - coalesce(pr.percepcion_iva, 0), fmt4),
            to_char(coalesce(pr.percepcion_iva, 0), fmt4))
        FROM public.purchase_receipts pr
        LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
        WHERE pr.fecha BETWEEN p_desde AND p_hasta AND pr.branch_id = p_branch_id
          AND coalesce(pr.percepcion_iva, 0) > 0
        ORDER BY pr.branch_id, pr.fecha, pr.erp_purchase_id;
    END IF;
END;
$function$;

-- ── Detector de fichas duplicadas (nacido de E4) ────────────────────────────
--
-- Las 54 fichas que creo el barrido llevan el NIT del ERP, no el de un DTE
-- firmado. Si mañana llega un DTE de uno de esos proveedores con un NIT distinto
-- —que es exactamente lo que pasa con los 6 de la Parte 4—,
-- `upsert_proveedor_from_dte` busca por NIT, no lo encuentra y crea una SEGUNDA
-- ficha. La primera se queda con el vinculo al ERP, asi que el libro usaria el
-- NIT del ERP y no el firmado, en silencio.
--
-- El indice unico de A1 no lo atrapa: los `supplier_id` serian distintos (uno
-- NULL). Lo que delata el caso es el NRC repetido. Hoy hay 0, asi que este
-- detector arranca en cero y cualquier aparicion es real.
-- Lo consume `check-purchases-reconciliation`, el cron que ya alerta.
CREATE OR REPLACE FUNCTION public.detectar_proveedores_duplicados()
 RETURNS TABLE(motivo text, clave text, fichas jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT 'nrc repetido'::text,
           regexp_replace(coalesce(pm.nrc,''), '[^0-9]', '', 'g'),
           jsonb_agg(jsonb_build_object('id', pm.id, 'nombre', pm.nombre,
                                        'nit', pm.nit, 'source', pm.source,
                                        'supplier_id', pm.supplier_id) ORDER BY pm.id)
    FROM public.proveedores_maestro pm
    WHERE coalesce(pm.nrc, '') <> ''
    GROUP BY 2 HAVING count(*) > 1
  UNION ALL
    SELECT 'nit repetido'::text, pm.nit,
           jsonb_agg(jsonb_build_object('id', pm.id, 'nombre', pm.nombre,
                                        'nrc', pm.nrc, 'source', pm.source,
                                        'supplier_id', pm.supplier_id) ORDER BY pm.id)
    FROM public.proveedores_maestro pm
    WHERE pm.nit IS NOT NULL
    GROUP BY 2 HAVING count(*) > 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.detectar_proveedores_duplicados() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.detectar_proveedores_duplicados() TO authenticated, service_role;
