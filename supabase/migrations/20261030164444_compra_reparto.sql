SET lock_timeout = '5s';
-- Reparto de una compra cargada desde el portal: al cargar, Bodega dice cuánto
-- de cada renglón va a cada sala. Una fila por (carga, sala) = un traslado del
-- estante de Bodega a esa sala. La sala lo recibe desde Traslados, y si el
-- producto no trae vencimiento en la factura lo pone ahí.
-- Lo escribe sólo `cargar-compra-erp` (service_role).
CREATE TABLE public.compra_reparto (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  compra_carga_id bigint NOT NULL REFERENCES public.compra_carga(id),
  branch_id integer NOT NULL REFERENCES public.branches(id),
  erp_sucursal_id integer NOT NULL,
  erp_compra_id bigint,
  emisor_nombre text,
  -- [{renglon, descripcion, erp_product_id, id_presentacion, unidad, paquetes, compra, venta, vence, vence_pendiente, numero_lote}]
  lineas jsonb NOT NULL,
  estado text NOT NULL DEFAULT 'por_enviar'
    CHECK (estado IN ('por_enviar','enviando','enviado','recibiendo','recibido','fallido')),
  erp_traslado_id text,
  nota text,
  enviado_por uuid REFERENCES public.employees(id),
  enviado_at timestamptz,
  recibido_por uuid REFERENCES public.employees(id),
  recibido_at timestamptz,
  -- Lo que la sala puso al recibir: {renglon: 'YYYY-MM-DD'}.
  vences jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (compra_carga_id, branch_id)
);
CREATE INDEX compra_reparto_branch_estado_idx ON public.compra_reparto (branch_id, estado);
ALTER TABLE public.compra_reparto ENABLE ROW LEVEL SECURITY;
CREATE POLICY compra_reparto_select ON public.compra_reparto FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('cargar_compra','can_view'))
      OR ((SELECT auth_has_module_permission('traslados','can_view'))
          AND ((SELECT auth_module_scope('traslados')) = 'ALL' OR branch_id = (SELECT auth_employee_branch_id()))));

-- Lo que una sala tiene por recibir de las compras (y lo recibido en 30 días).
-- INVOKER: el RLS de arriba decide qué salas ve cada quien. json: sin techo.
CREATE OR REPLACE FUNCTION public.get_compra_repartos()
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.recibido, t.creado DESC), '[]'::json) FROM (
    SELECT r.id, r.compra_carga_id, r.branch_id, b.name AS sala, r.erp_compra_id, r.emisor_nombre,
           r.lineas, r.estado, r.erp_traslado_id, r.nota, r.enviado_at, r.recibido_at, r.vences,
           r.enviado_por, ee.name AS enviado_nombre, r.recibido_por, er.name AS recibido_nombre,
           r.estado = 'recibido' AS recibido, r.created_at AS creado
      FROM public.compra_reparto r
      JOIN public.branches b ON b.id = r.branch_id
      LEFT JOIN public.employees ee ON ee.id = r.enviado_por
      LEFT JOIN public.employees er ON er.id = r.recibido_por
     WHERE r.estado <> 'recibido' OR r.recibido_at > now() - interval '30 days'
  ) t;
$$;
REVOKE EXECUTE ON FUNCTION public.get_compra_repartos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_compra_repartos() TO authenticated, service_role;
