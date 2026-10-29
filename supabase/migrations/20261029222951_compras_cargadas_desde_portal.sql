SET lock_timeout = '5s';

-- Qué compras de Bodega entraron desde el portal, quién las cargó y cuándo.
-- DEFINER porque `compra_carga` sólo la ve quien tiene `cargar_compra`, y la
-- marca tiene que verse en Compras (Bodega) para quien tenga `compras`.
-- Devuelve el ÚLTIMO envío exitoso o sin comprobar por compra.
CREATE OR REPLACE FUNCTION public.compras_cargadas_desde_portal(p_erp_ids integer[])
RETURNS TABLE (erp_compra_id integer, estado text, cargada_el timestamptz,
               employee_id uuid, empleado text, document_id bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT DISTINCT ON (c.erp_compra_id)
         c.erp_compra_id, c.estado, c.updated_at, c.creado_por, e.name, c.document_id
    FROM public.compra_carga c
    LEFT JOIN public.employees e ON e.id = c.creado_por
   WHERE c.erp_compra_id = ANY (p_erp_ids)
     AND c.estado IN ('verificada', 'sin_verificar')
     AND (SELECT public.auth_has_module_permission('compras', 'can_view'))
   ORDER BY c.erp_compra_id, c.updated_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_cargadas_desde_portal(integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compras_cargadas_desde_portal(integer[]) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS compra_carga_erp_compra_id_idx
  ON public.compra_carga (erp_compra_id) WHERE erp_compra_id IS NOT NULL;
