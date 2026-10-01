-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0021 — los libros de IVA de ventas
-- ═══════════════════════════════════════════════════════════════════════════
-- Contribuyentes (Art. 85 RCT), consumidor final (Art. 83) y el anexo de
-- documentos anulados, del período. El ARCHIVO lo arma la pantalla con el
-- mismo generador que los libros de las farmacias (`utils/libroIva.js`): acá
-- sólo se entregan las filas.
--
-- ── Qué entra ────────────────────────────────────────────────────────────
-- Lo que Hacienda SELLÓ con un sello válido (40 caracteres), y nada más: un
-- documento sin sello no existe fiscalmente todavía — la regla del sello del
-- portal (CLAUDE.md, «el tipo manda»). Lo invalidado sale de su libro y va al
-- anexo de anulados, por la fecha de la invalidación.
--
-- ── De dónde salen los montos ────────────────────────────────────────────
-- Del JSON del documento, que es lo que Hacienda recibió: gravado, exento,
-- IVA, percepción y retención de su `resumen`. Recalcularlos desde los
-- renglones del pedido daría un número parecido y no el declarado. Si un
-- documento no trae su archivo (sólo pasa con datos de muestra sembrados a
-- mano) se deriva del total y la fila lo dice (`sin_archivo`).
--
-- Contribuyentes lleva Créditos Fiscales (03) y Notas de Crédito (05). La nota
-- va en positivo con su tipo: el anexo del F-07 las distingue por la columna
-- de tipo, no por el signo.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.dist_libros_iva(p_desde date, p_hasta date)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE v_res json;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: los libros los ve quien administra la distribuidora';
    END IF;
    WITH docs AS (
        SELECT d.id, d.tipo, d.fec_emi, d.hor_emi, d.numero_control, d.codigo_generacion, d.sello_recibido, d.total_pagar,
               c.nombre AS cliente, c.nrc, c.tipo_documento AS doc_tipo, c.num_documento,
               d.json ? 'resumen' AS con_archivo, d.json->'resumen' AS res
          FROM public.dist_dte d JOIN public.dist_clientes c ON c.id = d.cliente_id
         WHERE d.estado = 'sellado' AND length(coalesce(d.sello_recibido, '')) = 40
           AND d.fec_emi BETWEEN p_desde AND p_hasta
    ),
    montos AS (
        SELECT docs.*,
               CASE WHEN con_archivo THEN coalesce((res->>'totalExenta')::numeric, 0) ELSE 0 END AS exentas,
               CASE WHEN con_archivo THEN coalesce((res->>'totalGravada')::numeric, 0)
                    WHEN tipo = '01' THEN total_pagar ELSE round(total_pagar / 1.13, 2) END AS gravadas,
               CASE WHEN con_archivo THEN coalesce(
                        (SELECT sum((t->>'valor')::numeric) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(res->'tributos') = 'array' THEN res->'tributos' ELSE '[]'::jsonb END) t WHERE t->>'codigo' = '20'),
                        (res->>'totalIva')::numeric, 0)
                    WHEN tipo = '01' THEN 0 ELSE total_pagar - round(total_pagar / 1.13, 2) END AS debito,
               coalesce((res->>'ivaPerci1')::numeric, (res->>'ivaPerci')::numeric, 0) AS percibido,
               coalesce((res->>'ivaRete1')::numeric, (res->>'ivaRete')::numeric, 0) AS retenido
          FROM docs
    ),
    consumidor AS (
        -- Un renglón por día: el primero y el último por NÚMERO DE CONTROL (el
        -- correlativo), no por el texto del código de generación — ése es el
        -- error que trae el libro del ERP de las farmacias (libroIva.js).
        SELECT fec_emi,
               (array_agg(numero_control ORDER BY numero_control))[1] AS nc_del,
               (array_agg(numero_control ORDER BY numero_control DESC))[1] AS nc_al,
               (array_agg(sello_recibido ORDER BY numero_control))[1] AS sello_del,
               (array_agg(codigo_generacion ORDER BY numero_control))[1] AS cg_del,
               (array_agg(codigo_generacion ORDER BY numero_control DESC))[1] AS cg_al,
               count(*) AS documentos, sum(exentas) AS exentas, sum(gravadas) AS gravadas,
               bool_or(NOT con_archivo) AS sin_archivo
          FROM montos WHERE tipo = '01' GROUP BY fec_emi
    )
    SELECT json_build_object(
        'contribuyente', (SELECT coalesce(json_agg(json_build_object(
                'id', id, 'tipo_dte', tipo, 'fecha', fec_emi, 'numero_control', numero_control, 'sello_recepcion', sello_recibido,
                'codigo_generacion', codigo_generacion, 'nrc', nrc,
                'nit', CASE WHEN doc_tipo = '36' THEN num_documento END, 'dui', CASE WHEN doc_tipo = '13' THEN num_documento END,
                'cliente', cliente, 'ventas_exentas', exentas, 'ventas_gravadas', gravadas, 'debito_fiscal', debito,
                'percibido', percibido, 'retenido', retenido, 'total', total_pagar, 'sin_archivo', NOT con_archivo)
              ORDER BY fec_emi, numero_control), '[]'::json) FROM montos WHERE tipo IN ('03', '05', '06')),
        'consumidor', (SELECT coalesce(json_agg(json_build_object(
                'fecha', fec_emi, 'numero_control_del', nc_del, 'numero_control_al', nc_al, 'sello_del', sello_del,
                'codigo_gen_del', cg_del, 'codigo_gen_al', cg_al, 'documentos', documentos,
                'ventas_exentas', exentas, 'ventas_gravadas', gravadas, 'total_diario', exentas + gravadas, 'sin_archivo', sin_archivo)
              ORDER BY fec_emi), '[]'::json) FROM consumidor),
        'anulados', (SELECT coalesce(json_agg(json_build_object(
                'id', d.id, 'tipo_dte', d.tipo, 'numero_control', d.numero_control, 'sello_recepcion', d.sello_recibido,
                'codigo_generacion', d.codigo_generacion, 'fecha', d.fec_emi, 'anulado_el', (d.invalidado_at AT TIME ZONE 'America/El_Salvador')::date,
                'cliente', c.nombre, 'total', d.total_pagar, 'motivo', d.invalidacion_motivo)
              ORDER BY d.invalidado_at), '[]'::json)
              FROM public.dist_dte d JOIN public.dist_clientes c ON c.id = d.cliente_id
             WHERE d.estado = 'invalidado' AND d.invalidado_at IS NOT NULL
               AND (d.invalidado_at AT TIME ZONE 'America/El_Salvador')::date BETWEEN p_desde AND p_hasta),
        -- Lo que quedó fuera por no tener sello: se dice cuánto, para que nadie
        -- crea que el libro está completo cuando falta enviar algo a Hacienda.
        'sin_sello', (SELECT json_build_object('documentos', count(*), 'total', coalesce(sum(total_pagar), 0))
              FROM public.dist_dte WHERE tipo IN ('01', '03', '05', '06') AND fec_emi BETWEEN p_desde AND p_hasta
               AND estado IN ('sin_firmar', 'firmado', 'contingencia', 'rechazado'))
    ) INTO v_res;
    RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_libros_iva(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_libros_iva(date, date) TO authenticated, service_role;
