SET lock_timeout = '5s';
-- «Avísame cuando haya»: quién espera qué producto. Una solicitud abierta por
-- cliente y producto; se cierra al avisar o a los 60 días. La purga va en la
-- corrida diaria de avisos-clientes.
CREATE TABLE IF NOT EXISTS public.app_cliente_avisame (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  vence_el timestamptz NOT NULL DEFAULT now() + interval '60 days',
  avisado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS app_cliente_avisame_abierto_uq ON public.app_cliente_avisame (customer_id, product_id) WHERE avisado_at IS NULL;
CREATE INDEX IF NOT EXISTS app_cliente_avisame_product_idx ON public.app_cliente_avisame (product_id);
ALTER TABLE public.app_cliente_avisame ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_cliente_avisame_select ON public.app_cliente_avisame FOR SELECT TO authenticated USING ((SELECT auth_can_edit_any(ARRAY['ofertas_clientes'::text])));
CREATE OR REPLACE FUNCTION public.app_avisame_por_avisar(p_clientes bigint[])
RETURNS json LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) FROM (
    SELECT a.id, a.customer_id, a.product_id, p.nombre
      FROM public.app_cliente_avisame a
      JOIN public.products p ON p.id = a.product_id
     WHERE a.avisado_at IS NULL AND a.vence_el > now() AND a.customer_id = ANY (p_clientes)
       AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
       AND NOT EXISTS (SELECT 1 FROM public.app_catalogo_ocultos o WHERE o.product_id = p.id)
       AND EXISTS (SELECT 1 FROM public.inventory i
                     JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND NOT m.es_bodega
                    WHERE i.erp_product_id = p.id AND i.cantidad > 0 AND NOT coalesce(i.is_vencidos, false))
     ORDER BY a.id LIMIT 500) t;
$$;
REVOKE EXECUTE ON FUNCTION public.app_avisame_por_avisar(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_avisame_por_avisar(bigint[]) TO service_role;
