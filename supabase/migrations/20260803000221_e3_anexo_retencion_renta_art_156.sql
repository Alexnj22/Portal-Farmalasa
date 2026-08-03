SET lock_timeout = '5s';

-- ===========================================================================
-- E3 — Retencion de Renta, Art. 156 del Codigo Tributario.
--
-- POR QUE ES DISTINTO DE TODO LO DEMAS DEL PLAN. Los otros hallazgos son
-- credito fiscal que se pierde o que se declara de mas. Este no: si se le paga
-- a una persona natural por un servicio y no se retiene el 10%, la empresa
-- RESPONDE SOLIDARIAMENTE por el impuesto que no retuvo, mas la multa. No es
-- plata que se deja de ganar — es una deuda que aparece.
--
-- Y es el unico articulo del plan que el portal no tocaba de ninguna forma:
-- `proveedores_maestro.retiene_renta` existe desde siempre, esta en `false` para
-- los 161 proveedores, y no se leia ni se escribia en ningun lado de `src/`.
--
-- OJO — ESTO NO ES LA RETENCION DE IVA. `get_libro_retencion` (Art. 162) ya
-- existe, es de IVA, y tiene cero filas en toda la historia. Son dos impuestos
-- distintos y confundirlos seria declarar uno por el otro.
--
-- LO QUE EL PORTAL PUEDE Y NO PUEDE SABER. La retencion se practica AL PAGAR, y
-- el portal registra lo que se FACTURA. En una farmacia chica las dos cosas
-- suelen coincidir, pero no siempre: por eso el anexo se llama "lo que
-- corresponderia retener" y no "lo retenido". Quien declara tiene que cruzarlo
-- con los pagos.
--
-- (El setter `set_proveedor_retiene_renta` que traia esta migracion se elimino
-- en 20260803000716: la ficha tiene un solo camino de escritura.)
-- ===========================================================================

-- ── Quien es candidato ─────────────────────────────────────────────────────
--
-- El portal NO puede decidir esto solo: distinguir un servicio de una compra de
-- mercaderia es una lectura del documento, no un dato. ANA FRANCISCA CEDILLOS es
-- persona natural y le compran mercaderia para reventa — ahi no aplica.
--
-- Lo que si puede hacer es ACORTAR LA LISTA: quien es persona natural (NIT de 9
-- digitos, o DUI, o un nombre que no lleva forma societaria) y en que categoria
-- de gasto cae. El contador marca; el portal propone y calcula.
CREATE OR REPLACE FUNCTION public.get_candidatos_retencion_renta(p_desde date, p_hasta date)
 RETURNS TABLE(
   proveedor_id bigint, nombre text, identificacion text, es_persona_natural boolean,
   categoria text, documentos bigint, monto numeric, retiene_renta boolean
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT pm.id, pm.nombre,
           coalesce(nullif(btrim(pm.nit), ''), nullif(btrim(pm.dui), '')),
           (length(regexp_replace(coalesce(pm.nit, ''), '\D', '', 'g')) = 9
            OR nullif(btrim(coalesce(pm.dui, '')), '') IS NOT NULL
            OR (pm.nombre !~* '(S\.?\s?A\.?|LTDA|C\.?\s?V\.?|SOCIEDAD|BANCO|DROGUER|LABORATORIO|CORPORACION|COMPA|DISTRIBUIDORA|R\.?L\.?)'
                AND array_length(regexp_split_to_array(btrim(pm.nombre), '\s+'), 1) >= 3)),
           coalesce(c.nombre, 'Sin categoría'),
           count(d.id),
           round(coalesce(sum(d.monto_total), 0)::numeric, 2),
           coalesce(pm.retiene_renta, false)
    FROM public.proveedores_maestro pm
    LEFT JOIN public.proveedores_categorias c ON c.id = pm.categoria_id
    LEFT JOIN public.purchase_dte_documents d
           ON d.proveedor_id = pm.id
          AND d.tipo_dte IN ('01', '03', '14')
          AND coalesce(d.invalidado, false) = false
          AND d.fecha_emision BETWEEN p_desde AND p_hasta
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
    GROUP BY pm.id, pm.nombre, pm.nit, pm.dui, c.nombre, pm.retiene_renta
    HAVING count(d.id) > 0
    ORDER BY coalesce(pm.retiene_renta, false) DESC, sum(d.monto_total) DESC NULLS LAST;
$function$;

COMMENT ON FUNCTION public.get_candidatos_retencion_renta(date, date) IS
  'Acorta la lista de posibles sujetos de retencion del Art. 156: quien es persona natural y en que categoria de gasto cae. El portal NO decide — distinguir un servicio de una compra de mercaderia es una lectura del documento, no un dato. El contador marca `retiene_renta`; el portal propone y calcula.';

-- ── El anexo ───────────────────────────────────────────────────────────────
--
-- La base es el monto SIN IVA. Si la persona natural esta inscrita emite CCF y
-- la base es el gravado; si no lo esta, el documento no lleva IVA y la base es
-- el total. `monto_total - total_iva` cubre los dos casos sin ramas.
CREATE OR REPLACE FUNCTION public.get_anexo_retencion_renta(p_desde date, p_hasta date)
 RETURNS TABLE(
   fecha date, proveedor text, nit text, nrc text,
   tipo_documento text, numero_control text, codigo_generacion text,
   monto_total numeric, base_sin_iva numeric, retencion_10 numeric
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT d.fecha_emision, d.emisor_nombre,
           nullif(btrim(coalesce(d.emisor_nit, '')), ''),
           nullif(btrim(coalesce(d.emisor_nrc, '')), ''),
           CASE d.tipo_dte WHEN '03' THEN 'CCF' WHEN '14' THEN 'SUJETO EXCLUIDO' ELSE 'FACTURA' END,
           d.numero_control, d.codigo_generacion,
           coalesce(d.monto_total, 0),
           coalesce(d.monto_total, 0) - coalesce(d.total_iva, 0),
           round((coalesce(d.monto_total, 0) - coalesce(d.total_iva, 0)) * 0.10, 2)
    FROM public.purchase_dte_documents d
    JOIN public.proveedores_maestro pm ON pm.id = d.proveedor_id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND pm.retiene_renta = true
      AND d.tipo_dte IN ('01', '03', '14')
      AND coalesce(d.invalidado, false) = false
      AND d.fecha_emision BETWEEN p_desde AND p_hasta
    ORDER BY d.fecha_emision, d.emisor_nombre, d.numero_control;
$function$;

COMMENT ON FUNCTION public.get_anexo_retencion_renta(date, date) IS
  'Lo que CORRESPONDERIA retener por el Art. 156 (10% sobre servicios de personas naturales), no lo retenido: la retencion se practica al PAGAR y el portal registra lo que se FACTURA. Quien declara tiene que cruzarlo con los pagos. La base es el monto sin IVA, que cubre por igual al inscrito (CCF, base = gravado) y al no inscrito (sin IVA, base = total). NO confundir con get_libro_retencion, que es la retencion de IVA del Art. 162.';

REVOKE EXECUTE ON FUNCTION public.get_candidatos_retencion_renta(date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_anexo_retencion_renta(date, date)      FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_candidatos_retencion_renta(date, date) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_anexo_retencion_renta(date, date)      TO authenticated, service_role;
