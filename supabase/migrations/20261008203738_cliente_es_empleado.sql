SET lock_timeout = '5s';
-- ¿Esta ficha de cliente es de un empleado ACTIVO? (2026-10-08) Para la
-- tarjeta de Equipo de la app: por política, el personal compra a precio
-- Mayoreo Plus. Se cruza por el DUI (sólo dígitos, 9). Hoy 8 de 48 empleados
-- activos tienen ficha de cliente con su DUI.
CREATE OR REPLACE FUNCTION public.cliente_es_empleado(p_customer bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.customers c
      JOIN public.employees e ON e.status = 'ACTIVO'
       AND length(regexp_replace(coalesce(e.dui, ''), '\D', '', 'g')) = 9
       AND regexp_replace(coalesce(e.dui, ''), '\D', '', 'g') = regexp_replace(coalesce(c.dui, ''), '\D', '', 'g')
     WHERE c.id = p_customer);
$$;
REVOKE EXECUTE ON FUNCTION public.cliente_es_empleado(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_es_empleado(bigint) TO service_role;
