-- Encargar un producto que NO tenemos (2026-10-21, pedido del usuario).
--
-- Hasta hoy un encargo nacía de un producto del catálogo (`product_id NOT
-- NULL`): si el cliente pedía algo que no manejamos, la sala no tenía cómo
-- registrarlo. Ahora la sala escribe el nombre, lo busca en el SRS (si aparece,
-- se guarda la ficha del registro; si no, va como consulta), y puede agregar una
-- foto. Bodega responde como cualquier encargo —precio y fecha, o no se puede
-- con motivo— y, como es nuevo, lo crea en el sistema; cuando ya está en el
-- catálogo del portal lo VINCULA al encargo. Sin vincular no se marca «Llegó»:
-- lo que se entrega y se factura tiene que ser un producto que existe.
SET lock_timeout = '5s';

ALTER TABLE public.app_encargos
  ALTER COLUMN product_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS producto_nuevo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS srs jsonb,
  ADD COLUMN IF NOT EXISTS foto_url text,
  ADD COLUMN IF NOT EXISTS vinculado_por uuid,
  ADD COLUMN IF NOT EXISTS vinculado_at timestamptz;

ALTER TABLE public.app_encargos
  ADD CONSTRAINT app_encargos_producto_o_nuevo CHECK (product_id IS NOT NULL OR producto_nuevo);

CREATE INDEX IF NOT EXISTS app_encargos_product_id ON public.app_encargos (product_id) WHERE product_id IS NOT NULL;

-- ── La foto: bucket privado, por sala ─────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('encargos-fotos', 'encargos-fotos', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO NOTHING;

-- La ruta es `<branch_id>/<archivo>`: sube y mira quien maneja los encargos de esa sala.
-- CASE y no AND: SQL no garantiza el orden de un AND, y el cast fallaría sobre otra ruta.
DROP POLICY IF EXISTS encargos_fotos_insert ON storage.objects;
CREATE POLICY encargos_fotos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'encargos-fotos' AND CASE WHEN (storage.foldername(name))[1] ~ '^[0-9]{1,9}$'
              THEN public.encargo_puede_manejar(((storage.foldername(name))[1])::bigint) ELSE false END);
DROP POLICY IF EXISTS encargos_fotos_select ON storage.objects;
CREATE POLICY encargos_fotos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'encargos-fotos' AND CASE WHEN (storage.foldername(name))[1] ~ '^[0-9]{1,9}$'
         THEN public.encargo_puede_manejar(((storage.foldername(name))[1])::bigint) ELSE false END);

-- ── Alta desde la sala ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.encargo_nuevo_en_sucursal_crear(p_branch_id bigint, p_customer_id bigint, p_nombre text,
  p_cantidad integer, p_nota text DEFAULT NULL, p_srs jsonb DEFAULT NULL, p_foto_url text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_id bigint;
BEGIN
  IF NOT (p_branch_id = (SELECT public.auth_employee_branch_id()) OR (SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes']))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN RAISE EXCEPTION 'Elige el cliente.'; END IF;
  IF length(coalesce(btrim(p_nombre), '')) < 3 THEN RAISE EXCEPTION 'Escribe el nombre del producto.'; END IF;
  IF p_cantidad IS NULL OR p_cantidad < 1 OR p_cantidad > 20 THEN RAISE EXCEPTION 'Un encargo va de 1 a 20 unidades.'; END IF;
  IF p_srs IS NOT NULL AND jsonb_typeof(p_srs) <> 'object' THEN RAISE EXCEPTION 'El registro del SRS no es válido.'; END IF;
  -- La foto sólo puede ser de este bucket y de esta sala.
  IF p_foto_url IS NOT NULL AND p_foto_url !~ ('/encargos-fotos/' || p_branch_id || '/') THEN
    RAISE EXCEPTION 'La foto no es de esta sala.';
  END IF;
  INSERT INTO public.app_encargos (customer_id, branch_id, product_id, producto_nuevo, producto_nombre, factor, cantidad,
                                   nota_cliente, srs, foto_url, estado, pago_estado)
  VALUES (p_customer_id, p_branch_id, NULL, true, left(btrim(p_nombre), 200), 1, p_cantidad,
          left(nullif(btrim(p_nota), ''), 300), p_srs, nullif(btrim(p_foto_url), ''), 'solicitado', 'pendiente')
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'ENCARGO_NUEVO_EN_SUCURSAL', v_id::text,
          jsonb_build_object('cliente', p_customer_id, 'producto', left(btrim(p_nombre), 200), 'cantidad', p_cantidad,
                             'srs', p_srs IS NOT NULL, 'foto', p_foto_url IS NOT NULL), p_branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('id', v_id, 'codigo', 'E-' || lpad(v_id::text, 6, '0'));
END $$;
REVOKE ALL ON FUNCTION public.encargo_nuevo_en_sucursal_crear(bigint, bigint, text, integer, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargo_nuevo_en_sucursal_crear(bigint, bigint, text, integer, text, jsonb, text) TO authenticated, service_role;

-- ── Bodega lo amarra al producto ya creado ───────────────────────────────
CREATE OR REPLACE FUNCTION public.encargo_vincular_producto(p_id bigint, p_product_id bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE e public.app_encargos; v_nombre text;
BEGIN
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT ((SELECT public.auth_employee_branch_id()) IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
          OR (SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes']))) THEN
    RAISE EXCEPTION 'El producto de un encargo lo vincula Compras o administración.' USING ERRCODE = '42501';
  END IF;
  IF NOT e.producto_nuevo THEN RAISE EXCEPTION 'Ese encargo ya es de un producto del catálogo.'; END IF;
  IF e.estado IN ('entregado', 'rechazado', 'cancelado') THEN RAISE EXCEPTION 'Ese encargo ya está cerrado.'; END IF;
  SELECT nombre INTO v_nombre FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese producto no existe en el catálogo.'; END IF;
  UPDATE public.app_encargos SET product_id = p_product_id, vinculado_por = public.auth_employee_id(), vinculado_at = now(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'ENCARGO_VINCULAR', p_id::text,
          jsonb_build_object('antes', e.product_id, 'producto', p_product_id, 'nombre', v_nombre), e.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'id', p_id, 'product_id', p_product_id, 'producto', v_nombre);
END $$;
REVOKE ALL ON FUNCTION public.encargo_vincular_producto(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargo_vincular_producto(bigint, bigint) TO authenticated, service_role;

-- ── «Llegó» exige el producto vinculado ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.encargo_responder(p_id bigint, p_accion text, p_precio numeric DEFAULT NULL::numeric, p_fecha date DEFAULT NULL::date, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  e public.app_encargos;
  v_emp uuid := public.auth_employee_id();
BEGIN
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.encargo_puede_manejar(e.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  -- Precio y fecha (o el rechazo) los decide Compras o administración, no la sala.
  IF p_accion IN ('confirmar', 'rechazar')
     AND NOT ((SELECT public.auth_employee_branch_id()) IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
              OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'El precio de un encargo lo confirma Compras o administración.' USING ERRCODE = '42501';
  END IF;
  IF p_accion = 'confirmar' AND e.estado = 'solicitado' THEN
    IF p_precio IS NULL OR p_precio <= 0 OR p_fecha IS NULL OR p_fecha < (now() AT TIME ZONE 'America/El_Salvador')::date THEN
      RAISE EXCEPTION 'Falta el precio o una fecha estimada válida.';
    END IF;
    UPDATE public.app_encargos SET estado = 'confirmado', precio_unitario = round(p_precio, 2),
           anticipo = round(p_precio * cantidad, 2), fecha_estimada = p_fecha, nota_sucursal = nullif(trim(p_nota), ''),
           respondido_por = v_emp, respondido_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_accion = 'rechazar' AND e.estado IN ('solicitado', 'confirmado') THEN
    -- Un producto que no tenemos se rechaza con motivo escrito: es lo que se le dice al cliente.
    IF e.producto_nuevo AND coalesce(trim(p_nota), '') = '' THEN
      RAISE EXCEPTION 'Escribe el motivo: es lo que se le dice al cliente.';
    END IF;
    UPDATE public.app_encargos SET estado = 'rechazado', nota_sucursal = coalesce(nullif(trim(p_nota), ''), 'No lo podemos conseguir por ahora.'),
           respondido_por = v_emp, respondido_at = now(), cerrado_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_accion = 'pedido' AND e.estado = 'aceptado' THEN
    UPDATE public.app_encargos SET estado = 'pedido', updated_at = now() WHERE id = p_id;
  ELSIF p_accion = 'listo' AND e.estado IN ('aceptado', 'pedido') THEN
    IF e.product_id IS NULL THEN
      RAISE EXCEPTION 'Es un producto nuevo: primero vincúlalo al producto ya creado en el catálogo.';
    END IF;
    UPDATE public.app_encargos SET estado = 'listo', updated_at = now() WHERE id = p_id;
  ELSIF p_accion = 'entregado' AND e.estado = 'listo' THEN
    IF e.pago_estado = 'pagado' AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.encargo_id = e.id) THEN
      RAISE EXCEPTION 'Este encargo está pagado: usa «Retirar» para aplicar el pago a la factura.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.app_encargos SET estado = 'entregado', cerrado_at = now(), updated_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', e.estado, p_accion;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'ENCARGO_' || upper(p_accion), p_id::text,
          jsonb_build_object('antes', e.estado, 'precio', p_precio, 'fecha', p_fecha, 'nota', p_nota), e.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'id', p_id);
END $function$;

-- ── La lista: LEFT JOIN, y lo que Bodega necesita para consultar ─────────
CREATE OR REPLACE FUNCTION public.encargos_de_sucursal(p_branch_id bigint, p_abiertos boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_branch_id IS NOT NULL AND NOT (p_branch_id = public.auth_employee_branch_id()
       OR public.auth_employee_branch_id() IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
       OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL AND NOT (public.auth_employee_branch_id() IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
       OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', e.id, 'codigo', 'E-' || lpad(e.id::text, 6, '0'), 'estado', e.estado, 'pago_estado', e.pago_estado,
      'branch_id', e.branch_id, 'sala', b.name, 'cliente', c.name, 'telefono', c.phone,
      'product_id', e.product_id, 'producto', e.producto_nombre, 'cantidad', e.cantidad, 'nota_cliente', e.nota_cliente,
      'precio_unitario', e.precio_unitario, 'anticipo', e.anticipo, 'fecha_estimada', e.fecha_estimada, 'nota_sucursal', e.nota_sucursal,
      'devolutivo', p.devolutivo,
      'vendido_antes', e.product_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sales_invoice_items ii WHERE ii.erp_product_id = e.product_id LIMIT 1),
      'producto_nuevo', e.producto_nuevo, 'srs', e.srs, 'foto_url', e.foto_url,
      'producto_catalogo', p.nombre, 'vinculado_at', e.vinculado_at,
      'creado', e.created_at)
      ORDER BY (e.estado = 'solicitado') DESC, (e.estado = 'aceptado') DESC, e.created_at DESC)
      FROM public.app_encargos e
      JOIN public.branches b ON b.id = e.branch_id
      JOIN public.customers c ON c.id = e.customer_id
      LEFT JOIN public.products p ON p.id = e.product_id
     WHERE (p_branch_id IS NULL OR e.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertos THEN e.estado IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo')
                 ELSE e.created_at > now() - interval '30 days' END)), '[]'::json);
END $function$;

-- ── El aviso a Bodega dice que es una consulta de producto nuevo ─────────
CREATE OR REPLACE FUNCTION public.app_encargos_avisar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_dest uuid[]; v_cliente text;
BEGIN
  SELECT array_agg(e.id) INTO v_dest FROM public.employees e
   WHERE e.status = 'ACTIVO' AND (e.branch_id = NEW.branch_id OR e.branch_id IN (SELECT id FROM public.branches WHERE type = 'BODEGA'));
  SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = NEW.customer_id;
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'ENCARGO_APP',
      CASE WHEN NEW.producto_nuevo THEN 'Producto que no tenemos · E-' ELSE 'Encargo de la app · E-' END || lpad(NEW.id::text, 6, '0'),
      CASE WHEN NEW.producto_nuevo
        THEN format('%s pide %s × %s, que no está en el catálogo%s. Consulten si se puede conseguir, el precio y para cuándo.',
                    coalesce(v_cliente, 'Un cliente'), NEW.cantidad, NEW.producto_nombre,
                    CASE WHEN NEW.srs IS NULL THEN ' ni en el SRS' ELSE '' END)
        ELSE format('%s pide %s × %s. Confirmen si se puede conseguir, el precio y para cuándo.', coalesce(v_cliente, 'Un cliente'), NEW.cantidad, NEW.producto_nombre)
      END,
      '/', jsonb_build_object('encargo', NEW.id, 'check_key', 'encargo_app:' || NEW.id), true, NEW.branch_id::integer);
  END IF;
  RETURN NULL;
END $function$;
