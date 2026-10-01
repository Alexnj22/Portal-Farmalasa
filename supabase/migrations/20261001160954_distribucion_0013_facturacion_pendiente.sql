-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0013 — qué falta con Hacienda (el número del menú)
-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido del usuario (2026-09-29): «que en la facturación me avise si todo está
-- bien con Hacienda (código de generación y recibido) o falta algo […] y una
-- parte de facturación para ver, como en el portal, si hay algo pendiente».
--
-- Cuenta lo que pide una acción, en las mismas cuatro cubetas que la pantalla:
--   por_enviar     — sin firmar o firmado, todavía sin sello (se reenvía)
--   contingencia   — emitido sin conexión (va en el aviso de contingencia)
--   rechazados     — rechazado Y su pedido sigue por facturar: un rechazo ya
--                    refacturado o anulado es constancia, no pendiente
--   invalidaciones — invalidación firmada sin enviar, o que Hacienda rechazó
--
-- «Sin sello» es sin sello VÁLIDO (40 caracteres): la regla del sello del
-- portal (CLAUDE.md, «recibido_mh es text»), dicha acá desde el día uno.
-- INVOKER: el RLS de `dist_*` decide qué ve cada quien.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.dist_facturacion_pendiente()
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
    SELECT json_build_object(
        'por_enviar', count(*) FILTER (WHERE d.estado IN ('sin_firmar', 'firmado')
                                        OR (d.estado = 'sellado' AND length(coalesce(d.sello_recibido, '')) <> 40)),
        'contingencia', count(*) FILTER (WHERE d.estado = 'contingencia'),
        'rechazados', count(*) FILTER (WHERE d.estado = 'rechazado' AND EXISTS (
                          SELECT 1 FROM public.dist_pedidos p
                           WHERE p.id = d.pedido_id AND p.estado = 'confirmado' AND p.dte_id IS NULL)),
        'invalidaciones', count(*) FILTER (WHERE d.invalidacion_estado IN ('pendiente', 'rechazada')))
      FROM public.dist_dte d
     WHERE d.estado <> 'descartado';
$$;
REVOKE EXECUTE ON FUNCTION public.dist_facturacion_pendiente() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_facturacion_pendiente() TO authenticated, service_role;
