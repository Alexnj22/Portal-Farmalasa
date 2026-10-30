SET lock_timeout = '5s';
-- Bodega le pide a una sala las fechas de vencimiento de una factura que no
-- las trae (Sarita: la mercadería llega a la sala, la factura a Bodega).
-- Usuario, 2026-10-30: «bodega pueda solicitar a la sucursal, son para estos
-- casos». La sala contesta mes y año por renglón; la carga los usa.
CREATE TABLE public.compra_pedido_vence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES public.purchase_dte_documents(id),
  branch_id integer NOT NULL REFERENCES public.branches(id),
  emisor_nombre text,
  fecha_emision date,
  -- [{renglon, descripcion, cantidad}]
  renglones jsonb NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','respondido','cancelado')),
  -- {renglon: 'YYYY-MM'}
  respuestas jsonb,
  pedido_por uuid NOT NULL REFERENCES public.employees(id),
  respondido_por uuid REFERENCES public.employees(id),
  respondido_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compra_pedido_vence_document_idx ON public.compra_pedido_vence (document_id);
CREATE INDEX compra_pedido_vence_branch_estado_idx ON public.compra_pedido_vence (branch_id, estado);
-- Un solo pedido vivo por factura: dos salas contestando lo mismo se pisarían.
CREATE UNIQUE INDEX compra_pedido_vence_uno_vivo ON public.compra_pedido_vence (document_id) WHERE estado = 'pendiente';
ALTER TABLE public.compra_pedido_vence ENABLE ROW LEVEL SECURITY;
CREATE POLICY compra_pedido_vence_select ON public.compra_pedido_vence FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('cargar_compra','can_view'))
      OR ((SELECT auth_has_module_permission('traslados','can_view'))
          AND ((SELECT auth_module_scope('traslados')) = 'ALL' OR branch_id = (SELECT auth_employee_branch_id()))));

-- Bodega pide. Escribe por DEFINER y avisa a la gente de la sala.
CREATE OR REPLACE FUNCTION public.compra_pedir_vence(p_document_id bigint, p_branch_id integer, p_renglones jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_id bigint; v_doc record; v_quien uuid := auth_employee_id(); v_gente uuid[];
BEGIN
  IF NOT (SELECT auth_has_module_permission('cargar_compra','can_edit')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF jsonb_typeof(p_renglones) <> 'array' OR jsonb_array_length(p_renglones) = 0 THEN RAISE EXCEPTION 'No hay productos que pedir.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_sucursal_map WHERE branch_id = p_branch_id AND NOT es_bodega) THEN RAISE EXCEPTION 'Esa sala no existe.'; END IF;
  SELECT emisor_nombre, fecha_emision INTO v_doc FROM purchase_dte_documents WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa factura no existe.'; END IF;
  INSERT INTO compra_pedido_vence (document_id, branch_id, emisor_nombre, fecha_emision, renglones, pedido_por)
  VALUES (p_document_id, p_branch_id, v_doc.emisor_nombre, v_doc.fecha_emision::date, p_renglones, v_quien)
  RETURNING id INTO v_id;
  SELECT array_agg(id) INTO v_gente FROM employees
   WHERE status = 'ACTIVO' AND branch_id = p_branch_id AND (tipo_ficha IS NULL OR tipo_ficha = 'empleado');
  IF v_gente IS NOT NULL THEN
    PERFORM notify_employees(v_gente, 'COMPRA_PEDIDO_VENCE',
      'Bodega te pide fechas de vencimiento',
      format('De la factura de %s: %s producto(s). Ponlas en Traslados → En camino.',
             coalesce(v_doc.emisor_nombre, 'un proveedor'), jsonb_array_length(p_renglones)),
      '/traslados?tab=recibir', jsonb_build_object('origen','cargar-compra','pedido', v_id), true, p_branch_id);
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Ya hay un pedido de fechas abierto para esta factura.';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compra_pedir_vence(bigint, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_pedir_vence(bigint, integer, jsonb) TO authenticated, service_role;

-- La sala contesta: un mes y año por renglón, ninguno vencido.
CREATE OR REPLACE FUNCTION public.compra_responder_vence(p_id bigint, p_respuestas jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v record; r jsonb; v_val text;
BEGIN
  SELECT * INTO v FROM compra_pedido_vence WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese pedido no existe.'; END IF;
  IF NOT ((SELECT auth_has_module_permission('traslados','can_view'))
          AND ((SELECT auth_module_scope('traslados')) = 'ALL' OR v.branch_id = (SELECT auth_employee_branch_id())))
     AND NOT (SELECT auth_has_module_permission('cargar_compra','can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF v.estado <> 'pendiente' THEN RAISE EXCEPTION 'Ese pedido ya se contestó.'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(v.renglones) LOOP
    v_val := p_respuestas ->> (r ->> 'renglon');
    IF v_val IS NULL OR v_val !~ '^\d{4}-\d{2}$' THEN
      RAISE EXCEPTION 'Falta la fecha de «%».', r ->> 'descripcion';
    END IF;
    IF to_date(v_val || '-01', 'YYYY-MM-DD') < date_trunc('month', now() AT TIME ZONE 'America/El_Salvador')::date THEN
      RAISE EXCEPTION '«%»: esa fecha ya pasó.', r ->> 'descripcion';
    END IF;
  END LOOP;
  UPDATE compra_pedido_vence
     SET estado = 'respondido', respuestas = p_respuestas, respondido_por = auth_employee_id(),
         respondido_at = now(), updated_at = now()
   WHERE id = p_id;
  PERFORM notify_employees(ARRAY[v.pedido_por], 'COMPRA_PEDIDO_VENCE',
    'La sala contestó las fechas de vencimiento',
    format('Factura de %s: ya puedes cargarla.', coalesce(v.emisor_nombre, 'un proveedor')),
    '/cargar-compra', jsonb_build_object('origen','cargar-compra','pedido', p_id), true, v.branch_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compra_responder_vence(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_responder_vence(bigint, jsonb) TO authenticated, service_role;

-- Bodega cancela un pedido (para pedirlo a otra sala).
CREATE OR REPLACE FUNCTION public.compra_cancelar_pedido_vence(p_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF NOT (SELECT auth_has_module_permission('cargar_compra','can_edit')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE compra_pedido_vence SET estado = 'cancelado', updated_at = now() WHERE id = p_id AND estado = 'pendiente';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compra_cancelar_pedido_vence(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_cancelar_pedido_vence(bigint) TO authenticated, service_role;

-- Los pedidos vivos y los de 30 días, con nombres. INVOKER: el RLS decide.
CREATE OR REPLACE FUNCTION public.get_compra_pedidos_vence()
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.creado DESC), '[]'::json) FROM (
    SELECT p.id, p.document_id, p.branch_id, b.name AS sala, p.emisor_nombre, p.fecha_emision,
           p.renglones, p.estado, p.respuestas, p.pedido_por, ep.name AS pedido_nombre,
           p.respondido_por, er.name AS respondido_nombre, p.respondido_at, p.created_at AS creado
      FROM public.compra_pedido_vence p
      JOIN public.branches b ON b.id = p.branch_id
      LEFT JOIN public.employees ep ON ep.id = p.pedido_por
      LEFT JOIN public.employees er ON er.id = p.respondido_por
     WHERE p.estado = 'pendiente' OR p.updated_at > now() - interval '30 days'
  ) t;
$$;
REVOKE EXECUTE ON FUNCTION public.get_compra_pedidos_vence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_compra_pedidos_vence() TO authenticated, service_role;
