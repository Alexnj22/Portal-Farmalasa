SET lock_timeout = '5s';
-- Recordatorio de tratamiento (2026-10-07). Un producto que el cliente compra
-- con regularidad (3+ compras en 240 días, cada 14–60 días, sin saltos de más
-- del doble) se toma como tratamiento: unos días antes de que se le acabe, la
-- app le avisa. «Ya no lo tomo» lo apaga con un motivo; si vuelve a comprarlo
-- después, se reactiva solo.
CREATE TABLE IF NOT EXISTS public.app_tratamientos (
  id bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  product_id integer NOT NULL,
  nombre text NOT NULL,
  intervalo_dias integer NOT NULL CHECK (intervalo_dias BETWEEN 7 AND 120),
  ultima_compra date NOT NULL,
  veces integer NOT NULL,
  estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','suspendido')),
  motivo text,
  suspendido_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, product_id)
);
ALTER TABLE public.app_tratamientos ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_tratamientos_ver ON public.app_tratamientos FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('clientes', 'can_view')));

CREATE OR REPLACE FUNCTION public.app_tratamientos_detectar(p_clientes bigint[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_n integer;
BEGIN
  WITH compras AS (
    SELECT si.customer_id, ii.erp_product_id AS product_id, si.fecha, max(ii.descripcion) AS descripcion
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
     WHERE si.customer_id = ANY (p_clientes) AND si.fecha >= current_date - 240
       AND public.venta_valida(si.estado) AND ii.erp_product_id IS NOT NULL
     GROUP BY 1, 2, 3),
  gaps AS (
    SELECT *, fecha - lag(fecha) OVER (PARTITION BY customer_id, product_id ORDER BY fecha) AS g FROM compras),
  t AS (
    SELECT customer_id, product_id, count(*)::int AS veces, max(fecha) AS ultima,
           (percentile_disc(0.5) WITHIN GROUP (ORDER BY g))::int AS mediana, max(g) AS maxg,
           (array_agg(descripcion ORDER BY fecha DESC))[1] AS descripcion
      FROM gaps GROUP BY 1, 2),
  buenos AS (
    SELECT t.*, coalesce(p.nombre, t.descripcion) AS nombre FROM t
      LEFT JOIN public.products p ON p.id = t.product_id
     WHERE t.veces >= 3 AND t.mediana BETWEEN 14 AND 60 AND t.maxg <= t.mediana * 2
       AND t.ultima >= current_date - t.mediana * 2)
  INSERT INTO public.app_tratamientos AS a (customer_id, product_id, nombre, intervalo_dias, ultima_compra, veces)
  SELECT customer_id, product_id, nombre, mediana, ultima, veces FROM buenos
  ON CONFLICT (customer_id, product_id) DO UPDATE
     SET intervalo_dias = EXCLUDED.intervalo_dias, ultima_compra = EXCLUDED.ultima_compra, veces = EXCLUDED.veces,
         nombre = EXCLUDED.nombre, updated_at = now(),
         -- Volvió a comprarlo después de decir «ya no lo tomo»: se reactiva.
         estado = CASE WHEN a.estado = 'suspendido' AND EXCLUDED.ultima_compra > (a.suspendido_at AT TIME ZONE 'America/El_Salvador')::date
                       THEN 'activo' ELSE a.estado END,
         motivo = CASE WHEN a.estado = 'suspendido' AND EXCLUDED.ultima_compra > (a.suspendido_at AT TIME ZONE 'America/El_Salvador')::date
                       THEN NULL ELSE a.motivo END
   WHERE (a.intervalo_dias, a.ultima_compra, a.veces, a.nombre) IS DISTINCT FROM
         (EXCLUDED.intervalo_dias, EXCLUDED.ultima_compra, EXCLUDED.veces, EXCLUDED.nombre);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Los que toca recordar hoy: 3 días antes de que se acabe, hasta 7 después.
CREATE OR REPLACE FUNCTION public.app_tratamientos_por_recordar(p_clientes bigint[])
RETURNS TABLE (id bigint, customer_id bigint, product_id integer, nombre text, ultima_compra date, se_acaba date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT a.id, a.customer_id, a.product_id, a.nombre, a.ultima_compra, a.ultima_compra + a.intervalo_dias
    FROM public.app_tratamientos a
   WHERE a.customer_id = ANY (p_clientes) AND a.estado = 'activo'
     AND (now() AT TIME ZONE 'America/El_Salvador')::date BETWEEN a.ultima_compra + a.intervalo_dias - 3 AND a.ultima_compra + a.intervalo_dias + 7;
$$;

CREATE OR REPLACE FUNCTION public.app_tratamientos_de(p_customer bigint)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT coalesce(json_agg(json_build_object('id', a.id, 'product_id', a.product_id, 'nombre', a.nombre,
           'intervalo', a.intervalo_dias, 'ultima', a.ultima_compra, 'se_acaba', a.ultima_compra + a.intervalo_dias,
           'estado', a.estado, 'motivo', a.motivo) ORDER BY a.estado, a.ultima_compra + a.intervalo_dias), '[]'::json)
    FROM public.app_tratamientos a WHERE a.customer_id = p_customer;
$$;

CREATE OR REPLACE FUNCTION public.app_tratamiento_cambiar(p_customer bigint, p_id bigint, p_activo boolean, p_motivo text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT p_activo AND nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN RAISE EXCEPTION 'Dinos el motivo'; END IF;
  UPDATE public.app_tratamientos
     SET estado = CASE WHEN p_activo THEN 'activo' ELSE 'suspendido' END,
         motivo = CASE WHEN p_activo THEN NULL ELSE left(btrim(p_motivo), 200) END,
         suspendido_at = CASE WHEN p_activo THEN NULL ELSE now() END, updated_at = now()
   WHERE id = p_id AND customer_id = p_customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'No encontramos ese recordatorio'; END IF;
  RETURN json_build_object('ok', true);
END $$;

REVOKE EXECUTE ON FUNCTION public.app_tratamientos_detectar(bigint[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_tratamientos_por_recordar(bigint[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_tratamientos_de(bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_tratamiento_cambiar(bigint, bigint, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_tratamientos_detectar(bigint[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_tratamientos_por_recordar(bigint[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_tratamientos_de(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_tratamiento_cambiar(bigint, bigint, boolean, text) TO service_role;
