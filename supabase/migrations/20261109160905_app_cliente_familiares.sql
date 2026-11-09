SET lock_timeout = '5s';
-- «Mi familia»: personas a cargo del titular, sin DUI. Al quitar a una se borra
-- la fila; sus tratamientos vuelven al titular. Sin retención por plazo: vive
-- mientras el titular la mantenga y se borra con la cuenta. El personal no la
-- lee: sólo la edge function con service_role.
CREATE TABLE IF NOT EXISTS public.app_cliente_familiares (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 40),
  parentesco text NOT NULL CHECK (parentesco IN ('hijo','padre_madre','abuelo','conyuge','otro')),
  autorizado_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_cliente_familiares_customer_idx ON public.app_cliente_familiares (customer_id);
ALTER TABLE public.app_cliente_familiares ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_cliente_familiares_nadie ON public.app_cliente_familiares FOR SELECT TO authenticated USING (false);
ALTER TABLE public.app_tratamientos ADD COLUMN IF NOT EXISTS familiar_id bigint REFERENCES public.app_cliente_familiares(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS app_tratamientos_familiar_idx ON public.app_tratamientos (familiar_id) WHERE familiar_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.app_tratamientos_de(p_customer bigint)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(json_build_object('id', a.id, 'product_id', a.product_id, 'nombre', a.nombre,
           'intervalo', a.intervalo_dias, 'ultima', a.ultima_compra, 'se_acaba', a.se_acaba,
           'estado', a.estado, 'motivo', a.motivo,
           'dosis', a.dosis_dia, 'ajusta_dosis', coalesce(public.tratamiento_ajusta_dosis(a.product_id), false),
           'origen', a.origen, 'dura_cliente', a.dura_cliente, 'familiar_id', a.familiar_id)
           ORDER BY a.estado, a.se_acaba), '[]'::json)
    FROM public.app_tratamientos a WHERE a.customer_id = p_customer;
$function$;
