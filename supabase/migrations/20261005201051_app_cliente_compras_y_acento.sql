-- Las compras de UN cliente para la app (2026-10-05).
--
-- Una venta cuenta con `venta_valida(estado)` —el canónico de U2—, nunca con
-- una lista de estados escrita a mano. Cada compra trae sus productos, si
-- alguno es inyectable (`es_inyectable`, el mismo juez de Inyecciones), los
-- puntos que dio (`puntos_lote.invoice_id`, uno por venta) y lo canjeado en
-- ella (`puntos_salida`). Sin vendedor ni cajero: el cliente ve QUÉ compró,
-- DÓNDE y CUÁNDO, no quién lo atendió.
--
-- Sólo `service_role`: la llama `app-clientes` con el customer_id que resolvió
-- la sesión. Las 5 más recientes (decisión del usuario, 2026-10-05); entra por
-- `idx_sales_invoices_cliente_fecha` y los renglones por `idx_sii_invoice_covering`.
SET lock_timeout = '5s';

-- Sin este índice, el cliente con más facturas de producción (51,521, una ficha
-- genérica) obligaba a leerlas TODAS para ordenarlas: 3.1 s y 12,680 bloques
-- (medido el 2026-10-05). Con él, el plan recorre el índice en orden y para en
-- 5. Una lectura de 3 s ocupa una ranura del pool de PostgREST y dos personas
-- la llenan — ver [[feedback_una_consulta_lenta_de_lectura_tumba_el_portal_entero]].
-- En producción se crea con CONCURRENTLY ANTES de esta migración (tabla caliente).
CREATE INDEX IF NOT EXISTS idx_sales_invoices_cliente_fecha
    ON public.sales_invoices (customer_id, fecha DESC, hora DESC) WHERE customer_id IS NOT NULL;

CREATE FUNCTION public.app_cliente_compras(p_customer_id bigint)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
BEGIN
    RETURN coalesce((
      SELECT json_agg(x ORDER BY x.fecha DESC, x.hora DESC) FROM (
        SELECT si.id, si.fecha, si.hora, si.tipo_documento, si.correlativo, si.total,
               b.name AS sala,
               (SELECT pl.puntos FROM puntos_lote pl WHERE pl.invoice_id = si.id) AS puntos,
               (SELECT sum(ps.puntos) FROM puntos_salida ps
                 WHERE ps.invoice_id = si.id AND ps.tipo = 'canje' AND ps.revertida_at IS NULL) AS canjeados,
               (SELECT json_agg(json_build_object(
                         'descripcion', it.descripcion,
                         'cantidad', it.cantidad,
                         'total', it.total_linea,
                         'inyectable', public.es_inyectable(it.descripcion))
                       ORDER BY it.linea_num)
                  FROM sales_invoice_items it WHERE it.invoice_id = si.id) AS productos
          FROM sales_invoices si
          JOIN branches b ON b.id = si.branch_id
         WHERE si.customer_id = p_customer_id
           AND public.venta_valida(si.estado)
         ORDER BY si.fecha DESC, si.hora DESC
         LIMIT 5
      ) x), '[]'::json);
END;
$$;
ALTER FUNCTION public.app_cliente_compras(bigint) SET plan_cache_mode = 'force_custom_plan';
REVOKE EXECUTE ON FUNCTION public.app_cliente_compras(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_cliente_compras(bigint) TO service_role;

-- ── El acento de color de una oferta ────────────────────────────────────────
-- Resalta la etiqueta y el velo de la foto en la app. Los valores son los
-- acentos del tema de la app (`apps/clientes/tema/tema.js`) y del portal
-- (`ACENTOS_DE_OFERTA`): cambiar uno exige cambiar los tres.
ALTER TABLE public.ofertas_clientes ADD COLUMN acento text NOT NULL DEFAULT 'magenta'
    CHECK (acento IN ('magenta', 'verde', 'azul', 'naranja', 'rojo', 'violeta'));
