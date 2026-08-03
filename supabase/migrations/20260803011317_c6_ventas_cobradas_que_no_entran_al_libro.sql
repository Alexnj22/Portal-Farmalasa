SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- C6 (H3) — el libro dice cuánta plata se queda afuera.
--
-- El libro solo incluye ventas con sello de Hacienda, y eso está BIEN — el
-- filtro es correcto y lo confirmó la Parte 0 por el camino largo. Lo que está
-- mal es que las que no lo tienen **desaparecen sin dejar rastro en el libro**.
--
-- Facturación ya las muestra, y hay que decirlo para no vender esto como más de
-- lo que es: las de sello vacío salen en «Pendiente MH» y las de sello inválido
-- en «Observaciones» con la clase SELLO_INVALIDO. Lo que NO existe en ninguna de
-- las dos es **el monto agregado del período, donde se presenta el libro**.
--
-- Dicho corto: Facturación pregunta "¿a qué factura le falta el sello?"; esto
-- pregunta "¿qué se cobró y no se va a declarar este mes?". Se parecen, pero la
-- segunda es la que mira quien arma la declaración.
--
-- Devuelve UNA fila: el aviso necesita un número, no una lista. Quien quiera la
-- lista tiene el módulo de Facturación, que es donde se resuelven.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_ventas_fuera_del_libro(
  p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL
)
 RETURNS TABLE(documentos bigint, monto numeric, sin_sello bigint, sello_invalido bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT count(*),
           round(coalesce(sum(si.total), 0)::numeric, 2),
           -- Los dos motivos van separados porque se resuelven en pantallas
           -- distintas: el sello vacío está en la cola de Hacienda, el inválido
           -- es una anomalía del documento.
           count(*) FILTER (WHERE si.recibido_mh IS NULL),
           count(*) FILTER (WHERE si.recibido_mh IS NOT NULL)
    FROM public.sales_invoices si
    WHERE (SELECT auth_has_module_permission('libros_iva', 'can_view'))
      AND ((SELECT auth_module_scope('libros_iva')) = 'ALL'
           OR si.branch_id = (SELECT auth_employee_branch_id()))
      AND si.tipo_documento IN ('COF', 'CCF')
      AND si.estado = 'FINALIZADA'
      AND length(coalesce(si.recibido_mh, '')) <> 40
      AND si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id);
$function$;

COMMENT ON FUNCTION public.get_ventas_fuera_del_libro(date, date, bigint) IS
  'C6/H3: cuantas ventas cobradas y FINALIZADAS quedan fuera del libro por no tener sello de 40, y cuanto suman. El filtro del sello es correcto; lo que faltaba era que el monto se viera DONDE SE PRESENTA EL LIBRO. Facturacion ya las lista una por una (Pendiente MH las de sello vacio, Observaciones las de sello invalido), pero en ningun lado estaba el total del periodo.';

REVOKE EXECUTE ON FUNCTION public.get_ventas_fuera_del_libro(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ventas_fuera_del_libro(date, date, bigint) TO authenticated, service_role;
