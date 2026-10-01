-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0009 — borrar una preventa cierra su solicitud de descuento
-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido del usuario (2026-09-29): «borrar la referencia», como el F6 de la
-- caja. En el portal una preventa no se borra: se ANULA (queda el rastro de
-- quién y por qué), y deja de salir en Pendientes.
--
-- El hueco que esto cierra: una preventa con un descuento por aprobar tiene
-- una solicitud PENDING en la bandeja de quien aprueba. Anulada la venta, esa
-- solicitud se quedaba viva para siempre —aprobarla falla con
-- DIST_PEDIDO_CERRADO— y el contador del menú la seguía contando. Ahora, al
-- anular, la solicitud pasa a CANCELLED en la misma transacción.
--
-- DEFINER porque quien vende no puede escribir `approval_requests` (y no debe:
-- lo único que se le permite es cerrar la de SU venta, por este camino).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.dist_anular_cancela_solicitud()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NEW.estado = 'anulado' AND OLD.estado IS DISTINCT FROM 'anulado'
       AND OLD.descuento_solicitud_id IS NOT NULL THEN
        UPDATE public.approval_requests
           SET status = 'CANCELLED', approver_note = 'La venta se anuló antes de decidir.', updated_at = now()
         WHERE id = OLD.descuento_solicitud_id AND status = 'PENDING';
        NEW.descuento_solicitud_id := NULL;
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_anular_cancela_solicitud() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS dist_pedidos_anular_solicitud ON public.dist_pedidos;
CREATE TRIGGER dist_pedidos_anular_solicitud
    BEFORE UPDATE OF estado ON public.dist_pedidos
    FOR EACH ROW EXECUTE FUNCTION public.dist_anular_cancela_solicitud();
