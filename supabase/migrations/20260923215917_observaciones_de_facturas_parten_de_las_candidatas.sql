-- Facturación › Observaciones revisaba la historia ENTERA de facturas en cada
-- apertura: `get_invoice_observations('2000-01-01','2099-12-31', …)` sobre
-- 374,743 filas, 3.4 s de promedio y 6.9 de máximo en producción, 693 MB
-- leídos por llamada (`gate:perf` sección F, «bloques sin declarar»). Una
-- lectura así ocupa una ranura del pool de PostgREST todo ese rato —ver
-- [[feedback_una_consulta_lenta_de_lectura_tumba_el_portal_entero]]—.
--
-- Para encontrar ~281 facturas: las que cumplen alguna regla FIJA (1 de
-- 374,743) más las que tienen intentos ante Hacienda (280). La corrección es
-- partir de ésas:
--   · índice parcial con el predicado de las reglas fijas (16 kB);
--   · la función arma `candidatas` con ese índice ∪ `dte_mh_intentos` y busca
--     cada factura por su llave (LATERAL + OFFSET 0: con un JOIN el
--     planificador hacía un hash de las 374,743 igual).
-- El predicado queda escrito DOS veces —acá y en el índice—: al cambiar una
-- regla de observación, cambiar las dos. Si divergen, el índice deja de servir
-- (la consulta sigue correcta, sólo vuelve a ser lenta) o, peor, una regla
-- nueva que el índice no cubre no encuentra filas: la regla nueva tiene que
-- sumarse a `candidatas`.
--
-- Medido como usuario, antes/después en una transacción deshecha: resultado
-- idéntico (md5) para QA, Supervisión, Jefe/a de Sala y Contador Externo, y
-- también con sala y rango de 30 días. QA 956 → 20 ms; una sala 262 → 20 ms.
--
-- En producción el índice se creó con CONCURRENTLY (tabla caliente) antes de
-- esta migración; acá va con IF NOT EXISTS para que un branch nuevo lo tenga.

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_sales_invoices_observables ON public.sales_invoices (id)
 WHERE (recibido_mh IS NOT NULL AND length(recibido_mh) <> 40)
    OR (codigo_generacion IS NULL AND recibido_mh IS NOT NULL AND estado = 'FINALIZADA')
    OR estado IS NULL OR estado NOT IN ('FINALIZADA', 'DTE INVALIDADO EN MH', 'NULA')
    OR tipo_documento IS NULL OR tipo_documento NOT IN ('CCF', 'COF')
    OR correlativo IS NULL OR btrim(correlativo) = ''
    OR total IS NULL OR total < 0
    OR abs(coalesce(subtotal, 0) + coalesce(iva, 0) - coalesce(retencion, 0) - coalesce(total, 0)) > 0.01;

DO $mig$
DECLARE
    v_fn constant regprocedure := 'public.get_invoice_observations(date,date,bigint,integer)'::regprocedure;
    v_src text; v_def text;
    a1 constant text := E'    )\n    SELECT si.id, si.branch_id';
    r1 constant text := E'    ),\n'
        || E'    -- Las ÚNICAS facturas que pueden tener una observación: las que cumplen\n'
        || E'    -- alguna regla fija (índice parcial `idx_sales_invoices_observables`,\n'
        || E'    -- con el MISMO predicado escrito dos veces: al cambiar una regla de abajo,\n'
        || E'    -- cambiar también el índice) más las que tienen intentos ante Hacienda.\n'
        || E'    -- Sin esto se revisaba la historia entera —374,743 facturas, 3.4 s de\n'
        || E'    -- promedio y 6.9 de máximo— para encontrar ~281. (2026-09-23)\n'
        || E'    candidatas AS (\n'
        || E'        SELECT s.id FROM public.sales_invoices s\n'
        || E'         WHERE (s.recibido_mh IS NOT NULL AND length(s.recibido_mh) <> 40)\n'
        || E'            OR (s.codigo_generacion IS NULL AND s.recibido_mh IS NOT NULL AND s.estado = ''FINALIZADA'')\n'
        || E'            OR s.estado IS NULL OR s.estado NOT IN (''FINALIZADA'', ''DTE INVALIDADO EN MH'', ''NULA'')\n'
        || E'            OR s.tipo_documento IS NULL OR s.tipo_documento NOT IN (''CCF'', ''COF'')\n'
        || E'            OR s.correlativo IS NULL OR btrim(s.correlativo) = ''''\n'
        || E'            OR s.total IS NULL OR s.total < 0\n'
        || E'            OR abs(coalesce(s.subtotal, 0) + coalesce(s.iva, 0) - coalesce(s.retencion, 0) - coalesce(s.total, 0)) > 0.01\n'
        || E'        UNION\n'
        || E'        SELECT i.invoice_id FROM public.dte_mh_intentos i\n'
        || E'    )\n    SELECT si.id, si.branch_id';
    a2 constant text := E'    FROM public.sales_invoices si\n    LEFT JOIN rechazo r';
    -- LATERAL con OFFSET 0 y no un JOIN: con el JOIN el planificador armaba un
    -- hash de las 374,743 facturas (222 ms, 10,547 bloques) aunque del otro lado
    -- hubiera 281; así las busca una por una por su llave (28 ms, 1,619).
    r2 constant text := E'    FROM candidatas k\n    CROSS JOIN LATERAL (SELECT s2.* FROM public.sales_invoices s2 WHERE s2.id = k.id OFFSET 0) si\n    LEFT JOIN rechazo r';
BEGIN
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_fn;
    IF (length(v_src) - length(replace(v_src, a1, ''))) / length(a1) <> 1
       OR (length(v_src) - length(replace(v_src, a2, ''))) / length(a2) <> 1 THEN
        RAISE EXCEPTION 'CUERPO_INESPERADO: get_invoice_observations';
    END IF;
    v_def := replace(replace(pg_get_functiondef(v_fn), a1, r1), a2, r2);
    EXECUTE v_def;
END
$mig$;
