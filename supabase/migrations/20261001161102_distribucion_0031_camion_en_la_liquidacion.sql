-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0031 — el camión en la liquidación del vendedor
-- ═══════════════════════════════════════════════════════════════════════════
-- La liquidación ya cuenta el EFECTIVO de las ventas del camión (son ventas
-- como cualquiera). Lo que no decía es la MERCADERÍA: cuánto se cargó, cuánto
-- volvió y cuánto falta. Un faltante en el camión es plata que no está ni en
-- el cajón ni en bodega, y sin esto sólo se veía en el kardex.
--
-- Por carga que se abrió o se cerró ese día (hora de El Salvador). El faltante
-- se valoriza con el `costo_unitario` que `dist_costo_al_mover` estampó en el
-- movimiento, no con el costo de hoy: el promedio se mueve con cada compra.
-- INVOKER: el RLS de dist_cargas decide quién lo ve.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.dist_camion_del_dia(p_vendedor uuid, p_fecha date)
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
    SELECT json_agg(json_build_object(
        'carga_id', g.id,
        'estado', g.estado,
        'abierta_at', g.created_at,
        'cerrada_at', g.cerrada_at,
        'nota_cierre', g.nota_cierre,
        'nota_remision', (SELECT d.numero_control FROM public.dist_dte d WHERE d.id = g.dte_id),
        'cargado', coalesce(t.cargado, 0),
        'devuelto', coalesce(t.devuelto, 0),
        'faltante', coalesce(t.faltante, 0),
        'queda', coalesce(q.queda, 0),
        'vendido', greatest(coalesce(t.cargado, 0) - coalesce(t.devuelto, 0) - coalesce(t.faltante, 0) - coalesce(q.queda, 0), 0),
        'faltante_costo', coalesce((
            SELECT round(sum(-m.cantidad * coalesce(m.costo_unitario, 0)), 2)
              FROM public.dist_lote_movimientos m
              JOIN public.dist_carga_items ci ON ci.lote_camion_id = m.lote_id AND ci.carga_id = g.id
             WHERE m.tipo = 'faltante' AND m.created_at >= g.created_at
               AND (g.cerrada_at IS NULL OR m.created_at <= g.cerrada_at + interval '1 minute')), 0)
    ) ORDER BY g.created_at)
      FROM public.dist_cargas g
      LEFT JOIN LATERAL (
          SELECT sum(cargado) AS cargado, sum(devuelto) AS devuelto, sum(faltante) AS faltante
            FROM public.dist_carga_items WHERE carga_id = g.id) t ON true
      -- Lo que sigue en el camión sólo cuenta mientras la carga está abierta.
      LEFT JOIN LATERAL (
          SELECT sum(l.existencia) AS queda FROM public.dist_lotes l
           WHERE g.estado = 'abierta' AND l.en_camion_de = g.vendedor_id) q ON true
     WHERE g.vendedor_id = p_vendedor
       AND ((g.created_at AT TIME ZONE 'America/El_Salvador')::date = p_fecha
            OR (g.cerrada_at AT TIME ZONE 'America/El_Salvador')::date = p_fecha
            OR (g.estado = 'abierta' AND (g.created_at AT TIME ZONE 'America/El_Salvador')::date <= p_fecha));
$$;
REVOKE EXECUTE ON FUNCTION public.dist_camion_del_dia(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_camion_del_dia(uuid, date) TO authenticated, service_role;
