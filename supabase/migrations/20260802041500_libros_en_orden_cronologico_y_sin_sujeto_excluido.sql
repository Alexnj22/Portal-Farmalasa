SET lock_timeout = '5s';

-- ORDEN CRONOLÓGICO: fecha primero, id interno para desempatar.
--
-- El criterio no es "que quede igual al reporte del ERP" — es lo que pide el
-- Art. 139 del Código Tributario: «Los asientos se harán en orden cronológico».
-- Ordenar sólo por id interno NO lo cumple: medido en junio, 8 de 389 compras
-- quedaban fuera de orden de fecha, porque un documento del día 16 puede tener
-- id menor que uno del 15 (se capturó antes).
--
-- La fecha manda; el id desempata dentro del mismo día, que es donde sí refleja
-- el orden real de captura.
--
-- Aplica a: get_libro_compras, get_libro_percepcion, get_libro_retencion
--   ORDER BY pr.branch_id, pr.fecha, pr.erp_purchase_id
-- y a: get_libro_anulados, get_libro_ventas_contribuyente
--   ORDER BY si.branch_id, si.fecha, <erp_invoice_id numérico>
--
-- SUJETO EXCLUIDO se retira de la app: cero documentos FSE en los 5,127
-- registros de compras, ningún DTE tipo 14 entre los 1,511 recibidos, y el
-- reporte no existe en el origen. La función se conserva sin exponer.
--
-- El cuerpo completo de las cinco funciones está en el catálogo de prod; esta
-- migración sólo les cambia el ORDER BY respecto de 20260802033106, que sí lo
-- lleva completo.
REVOKE EXECUTE ON FUNCTION public.get_libro_sujeto_excluido(date, date, bigint) FROM authenticated;

COMMENT ON FUNCTION public.get_libro_sujeto_excluido(date, date, bigint) IS
    'RETIRADA de la app el 2026-08-02: cero documentos de sujeto excluido en toda la historia y el reporte no existe en el origen. Se conserva para volver a colgarla si algún día aparece uno.';
