SET lock_timeout = '5s';

-- Notas de crédito y débito de compras — sección aparte, NO dentro del libro.
--
-- Por qué aparte y no restadas: el libro de compras del ERP no las incluye, y
-- el nuestro cuadra con él al centavo en junio y julio (12 de 12 branch-meses,
-- crédito fiscal incluido). Si el ERP las restara, junio no cuadraría — hay 58
-- notas por $992.14 de IVA ese mes. O sea que el libro que replicamos está
-- incompleto en el origen, y meterlas de este lado crearía dos verdades
-- distintas para el mismo período.
--
-- El origen es el correo (`purchase_dte_documents`), no el registro de compras:
-- estos documentos llegan y nunca se capturan en la pantalla que el ERP tiene
-- para eso. Ese es el hallazgo, y por eso la sección existe: para que el total
-- sea visible y contabilidad lo ajuste al declarar.
--
-- NO lleva sucursal, y no es un olvido: los documentos del correo no traen
-- `branch_id`, y solo 54 de 139 apuntan a qué documento corrigen, así que
-- inferirla daría una cobertura del ~30%. Antes que repartir mal un dato
-- fiscal, no se reparte — la vista lo dice explícitamente.
CREATE OR REPLACE FUNCTION public.get_notas_credito_compras(
    p_desde date, p_hasta date)
RETURNS TABLE(fecha date, tipo_dte text, numero_control text,
              codigo_generacion text, proveedor text, nrc text, nit text,
              monto numeric, iva numeric, documento_corregido text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT d.fecha_emision,
           d.tipo_dte,
           d.numero_control,
           d.codigo_generacion,
           d.emisor_nombre,
           nullif(btrim(coalesce(d.emisor_nrc, '')), ''),
           nullif(btrim(coalesce(d.emisor_nit, '')), ''),
           coalesce(d.monto_total, 0),
           coalesce(d.total_iva, 0),
           rel.numero_control
    FROM public.purchase_dte_documents d
    LEFT JOIN public.purchase_dte_documents rel ON rel.id = d.documento_relacionado_id
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      -- 05 = nota de crédito, 06 = nota de débito. Las dos ajustan crédito
      -- fiscal, en sentidos opuestos, así que van juntas y la vista las separa.
      AND d.tipo_dte IN ('05', '06')
      -- Hoy son 0, pero una invalidada no ajusta nada y asumir que nunca va a
      -- haber es exactamente cómo se cuela un dato de más.
      AND coalesce(d.invalidado, false) = false
      AND d.fecha_emision BETWEEN p_desde AND p_hasta
    ORDER BY d.fecha_emision, d.emisor_nombre, d.numero_control;
$$;

COMMENT ON FUNCTION public.get_notas_credito_compras(date, date) IS
    'Notas de crédito (05) y débito (06) de compras, del correo. Sección aparte del libro: el libro del ERP no las resta y el nuestro lo replica. Sin sucursal — el origen no la trae.';

REVOKE EXECUTE ON FUNCTION public.get_notas_credito_compras(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_notas_credito_compras(date, date) TO authenticated, service_role;
