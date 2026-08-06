-- Resumen Fiscal — el movimiento del mes, en un solo número por concepto.
--
-- Consolida lo que ya está repartido en las pestañas de Libros IVA (débito,
-- crédito, percepción, retención, notas) y le agrega el pago a cuenta, que hoy
-- no vive en ninguna pantalla.
--
-- **Es un indicador, no una declaración.** Le falta a propósito una línea que
-- el portal no puede saber: el remanente de crédito fiscal del mes anterior.
-- La declaración de IVA es encadenada y ese saldo sólo existe en lo que se
-- declaró — que hoy no se guarda en ningún lado (Bloque D). Por eso esto da el
-- MOVIMIENTO del mes y nunca el SALDO a pagar.
--
-- Las dos tasas salen de la ley y están citadas en el código, no inventadas:
--
--   · **1.75%** de pago a cuenta sobre ingresos brutos — Art. 151 del Código
--     Tributario, verificado en `docs/legal/codigo_tributario.pdf`: «LOS ENTEROS
--     SE DETERMINARÁN POR PERÍODOS MENSUALES Y EN UNA CUANTÍA DEL 1.75% DE LOS
--     INGRESOS BRUTOS». El mismo artículo tiene una tasa reducida del 0.3%, que
--     **no aplica acá**: es para PERSONAS NATURALES titulares de empresas
--     distribuidoras de bebidas, comestibles o higiene personal con precios
--     sugeridos por el proveedor, y para transporte público de pasajeros.
--   · **2%** de anticipo sobre cobros con tarjeta — Art. 162-A del mismo
--     Código: lo retiene el emisor de la tarjeta, no la farmacia. Va aparte y
--     marcado como estimado justamente por eso: el portal sabe qué se cobró con
--     tarjeta, pero no puede ver la liquidación del procesador. Confirmarlo es
--     mirar el estado de cuenta, no la base.
--
-- El plazo de las dos declaraciones es el mismo: **los primeros diez días
-- hábiles del mes siguiente** (Ley de IVA Art. 94 y CT Art. 151).
--
-- Devuelve `json` y no `SETOF`: es un objeto único, así que el cap de 1000
-- filas de PostgREST no aplica (Patrón C de CLAUDE.md).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_resumen_fiscal(
    p_desde     date,
    p_hasta     date,
    p_branch_id bigint DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_ok       boolean;
    v_scope    text;
    v_mi_suc   bigint;
    v_branch   bigint;
    r          record;
BEGIN
    SELECT (SELECT auth_has_module_permission('resumen_fiscal', 'can_view')),
           (SELECT auth_module_scope('resumen_fiscal')),
           (SELECT auth_employee_branch_id())
      INTO v_ok, v_scope, v_mi_suc;

    IF NOT coalesce(v_ok, false) THEN
        RETURN json_build_object('error', 'FORBIDDEN');
    END IF;

    -- Alcance por sucursal: quien está limitado a la suya no puede pedir otra.
    v_branch := CASE WHEN v_scope = 'ALL' THEN p_branch_id ELSE v_mi_suc END;

    WITH ventas AS (
        SELECT count(*)                       AS docs,
               sum(coalesce(subtotal, 0))     AS ingresos_brutos,
               sum(coalesce(iva, 0))          AS debito_fiscal,
               sum(coalesce(retencion, 0))    AS retencion_recibida,
               sum(coalesce(total, 0)) FILTER (WHERE lower(coalesce(tipo_pago, '')) = 'tarjeta')
                                              AS cobrado_con_tarjeta
          FROM public.sales_invoices
         WHERE fecha BETWEEN p_desde AND p_hasta
           AND estado = 'FINALIZADA'
           -- El sello de 40 caracteres es el filtro del libro: sin él el
           -- documento no está confirmado por Hacienda.
           AND length(recibido_mh) = 40
           AND (v_branch IS NULL OR branch_id = v_branch)
    ),
    compras_norm AS (
        SELECT pr.total, pr.fecha, pr.sello_recibido,
               upper(replace(replace(replace(btrim(pr.documento_numero), ' ', ''), '.', ''), 'O', '0')) AS doc
          FROM public.purchase_receipts pr
         WHERE (length(btrim(coalesce(pr.documento_numero, ''))) >= 8 OR pr.sello_recibido IS NOT NULL)
           AND pr.fecha BETWEEN p_desde - 5 AND p_hasta + 5
    ),
    registradas AS (
        SELECT count(*)                                AS docs,
               sum(coalesce(pr.iva, 0))                AS credito_fiscal,
               sum(coalesce(pr.percepcion_iva, 0))     AS percepcion_pagada
          FROM public.purchase_receipts pr
         WHERE pr.fecha BETWEEN p_desde AND p_hasta
           AND pr.estado IS DISTINCT FROM 'anulada'
           AND (v_branch IS NULL OR pr.branch_id = v_branch)
    ),
    -- Los documentos que llegaron por correo y nunca se registraron como
    -- compra. Mismo cruce de tres caminos que usa `get_libro_compras_completo`;
    -- si cambia allá, cambia acá.
    sin_registrar AS (
        SELECT count(*)                       AS docs,
               sum(coalesce(d.total_iva, 0))  AS credito_fiscal
          FROM public.purchase_dte_documents d
         WHERE d.tipo_dte IN ('01', '03')
           AND coalesce(d.invalidado, false) = false
           AND d.fecha_emision BETWEEN p_desde AND p_hasta
           AND v_branch IS NULL          -- no tienen sucursal: sólo en la vista global
           AND NOT EXISTS (SELECT 1 FROM compras_norm c
                            WHERE d.sello_recibido IS NOT NULL AND c.sello_recibido = d.sello_recibido)
           AND NOT EXISTS (SELECT 1 FROM compras_norm c
                            WHERE c.doc IN (left(upper(d.codigo_generacion::text), 20),
                                            left(replace(upper(d.codigo_generacion::text), '-', ''), 20),
                                            upper(d.codigo_generacion::text)))
           AND NOT EXISTS (SELECT 1 FROM public.purchase_receipts pr
                             JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
                            WHERE pm.nit = d.emisor_nit
                              AND abs(pr.total - coalesce(d.monto_total, 0)) < 0.01
                              AND pr.fecha BETWEEN d.fecha_emision - 3 AND d.fecha_emision + 3)
    ),
    notas AS (
        SELECT count(*) FILTER (WHERE d.tipo_dte = '05')                       AS nc_docs,
               coalesce(sum(coalesce(d.total_iva, 0)) FILTER (WHERE d.tipo_dte = '05'), 0) AS nc_iva,
               count(*) FILTER (WHERE d.tipo_dte = '06')                       AS nd_docs,
               coalesce(sum(coalesce(d.total_iva, 0)) FILTER (WHERE d.tipo_dte = '06'), 0) AS nd_iva
          FROM public.purchase_dte_documents d
         WHERE d.tipo_dte IN ('05', '06')
           AND coalesce(d.invalidado, false) = false
           AND d.fecha_emision BETWEEN p_desde AND p_hasta
           AND v_branch IS NULL
    )
    SELECT v.docs AS v_docs, coalesce(v.ingresos_brutos,0) AS ingresos_brutos,
           coalesce(v.debito_fiscal,0) AS debito, coalesce(v.retencion_recibida,0) AS retencion,
           coalesce(v.cobrado_con_tarjeta,0) AS tarjeta,
           r_.docs AS c_docs, coalesce(r_.credito_fiscal,0) AS credito_reg,
           coalesce(r_.percepcion_pagada,0) AS percepcion,
           s.docs AS s_docs, coalesce(s.credito_fiscal,0) AS credito_sin,
           n.nc_docs, n.nc_iva, n.nd_docs, n.nd_iva
      INTO r
      FROM ventas v, registradas r_, sin_registrar s, notas n;

    RETURN json_build_object(
        'desde', p_desde, 'hasta', p_hasta, 'branch_id', v_branch,
        'ventas', json_build_object(
            'documentos', r.v_docs,
            'ingresos_brutos', round(r.ingresos_brutos, 2),
            'debito_fiscal', round(r.debito, 2),
            'retencion_recibida', round(r.retencion, 2),
            'cobrado_con_tarjeta', round(r.tarjeta, 2)),
        'compras', json_build_object(
            'documentos_registrados', r.c_docs,
            'credito_registrado', round(r.credito_reg, 2),
            'documentos_sin_registrar', r.s_docs,
            'credito_sin_registrar', round(r.credito_sin, 2),
            'percepcion_pagada', round(r.percepcion, 2),
            'notas_credito_docs', r.nc_docs,
            'notas_credito_iva', round(r.nc_iva, 2),
            'notas_debito_docs', r.nd_docs,
            'notas_debito_iva', round(r.nd_iva, 2)),
        'credito_fiscal_total', round(r.credito_reg + r.credito_sin + r.nd_iva - r.nc_iva, 2),
        -- Positivo = a pagar. Negativo = a favor.
        'movimiento_iva', round(
            r.debito - (r.credito_reg + r.credito_sin + r.nd_iva - r.nc_iva)
            - r.percepcion - r.retencion, 2),
        'pago_a_cuenta', json_build_object(
            'base', round(r.ingresos_brutos, 2),
            'tasa', 0.0175,
            'monto', round(r.ingresos_brutos * 0.0175, 2),
            'fundamento', 'Art. 151 Código Tributario'),
        'anticipo_tarjeta', json_build_object(
            'base', round(r.tarjeta, 2),
            'tasa', 0.02,
            'monto', round(r.tarjeta * 0.02, 2),
            'estimado', true,
            'fundamento', 'Art. 162-A Código Tributario'));
END;
$$;

COMMENT ON FUNCTION public.get_resumen_fiscal(date, date, bigint) IS
    'Movimiento fiscal del período: débito, crédito, percepción, retención, pago a cuenta (1.75%, Art. 151 CT) y anticipo por tarjeta (2%, Art. 162-A, estimado). NO incluye el remanente del mes anterior — es indicador, no declaración.';

REVOKE ALL ON FUNCTION public.get_resumen_fiscal(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_resumen_fiscal(date, date, bigint) TO authenticated, service_role;

-- Permiso: mismos roles que ya ven Libros IVA, con su mismo alcance.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, scope)
SELECT rp.role_id, 'resumen_fiscal', rp.can_view, false, rp.scope
  FROM public.role_permissions rp
 WHERE rp.module_key = 'libros_iva'
ON CONFLICT (role_id, module_key) DO NOTHING;
