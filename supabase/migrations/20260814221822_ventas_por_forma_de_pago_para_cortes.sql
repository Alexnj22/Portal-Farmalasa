-- La venta del día abierta por forma de pago, documento por documento.
--
-- ── POR QUÉ HACE FALTA: el tiquete del cierre MIENTE POR OMISIÓN ───────────
-- El tiquete Z lista al pie los pagos con tarjeta y las ventas al crédito, y
-- nada más. Así que derivar el efectivo como `total − tarjeta − crédito`
-- funciona… hasta que aparece una forma de pago que el tiquete no imprime.
--
-- Y aparece: Salud 2 del 13-ago tiene una **transferencia de $2.20**. El
-- desglose derivado del tiquete decía $1,411.25 de efectivo cuando entraron
-- $1,409.05. Peor: yo había mirado esos mismos $2.20 antes, los vi como
-- «descuadre contra el último corte» y los expliqué como ventas posteriores al
-- conteo. No lo eran. Un residuo sin explicar no se atribuye a la hipótesis más
-- cómoda — ver `feedback_el_residuo_sin_explicar_delata_el_diagnostico`.
--
-- `sales_invoices.tipo_pago` sí las trae, y es una fuente INDEPENDIENTE del
-- tiquete. Verificado sobre el 13-ago en las 6 salas: la suma de `efectivo`
-- coincide al centavo con el `VENTA` del último corte de caja de cada sala, y el
-- total de todas las formas coincide al centavo con el total del Z.
--
-- Sin filtro de sello de Hacienda a propósito: esto NO es el libro de ventas. Lo
-- que importa acá es qué se vendió y cómo se cobró, no si Hacienda ya lo selló.
-- `FINALIZADA` sola reproduce el total del Z exacto (138 documentos, $1,774.15).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_ventas_por_forma_de_pago(p_desde date, p_hasta date)
RETURNS TABLE(branch_id bigint, fecha date, tipo_pago text, documentos bigint, total numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT si.branch_id, si.fecha,
           coalesce(nullif(btrim(si.tipo_pago), ''), 'sin forma') AS tipo_pago,
           count(*), round(sum(si.total), 2)
      FROM public.sales_invoices si
     WHERE (SELECT auth_has_module_permission('cortes_caja', 'can_view'))
       AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
            OR si.branch_id = (SELECT auth_employee_branch_id()))
       AND si.estado = 'FINALIZADA'
       AND si.fecha BETWEEN p_desde AND p_hasta
     GROUP BY 1, 2, 3
     ORDER BY 1, 2, 3;
$$;

REVOKE EXECUTE ON FUNCTION public.get_ventas_por_forma_de_pago(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ventas_por_forma_de_pago(date, date) TO authenticated, service_role;
