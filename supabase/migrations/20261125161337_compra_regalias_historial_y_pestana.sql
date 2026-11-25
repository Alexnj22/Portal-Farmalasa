SET lock_timeout = '5s';

-- Historial de las regalías (2026-11-25). Cada alta, cambio o baja de
-- `compra_regalia` queda con el nivel de antes y el de después, quién y
-- cuándo. Historial de negocio: NO se purga (como precios y Mín/Máx).
-- Lo escribe un disparador, así que también queda lo que se toque por SQL.
CREATE TABLE IF NOT EXISTS public.compra_regalia_historial (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  proveedor_nit text NOT NULL,
  codigo_proveedor text NOT NULL,
  descripcion text,
  accion text NOT NULL CHECK (accion IN ('alta', 'cambio', 'baja')),
  compra_antes integer, regalo_antes integer,
  compra_despues integer, regalo_despues integer,
  cambiado_por uuid REFERENCES public.employees(id)
);
CREATE INDEX IF NOT EXISTS compra_regalia_historial_prov_idx
  ON public.compra_regalia_historial (proveedor_nit, codigo_proveedor, created_at DESC);
ALTER TABLE public.compra_regalia_historial ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compra_regalia_historial_select ON public.compra_regalia_historial;
CREATE POLICY compra_regalia_historial_select ON public.compra_regalia_historial FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('compras', 'can_view'))
      OR (SELECT public.auth_has_module_permission('facturas_compra', 'can_view'))
      OR (SELECT public.auth_has_module_permission('cargar_compra', 'can_view')));
REVOKE ALL ON public.compra_regalia_historial FROM anon;
GRANT SELECT ON public.compra_regalia_historial TO authenticated;

CREATE OR REPLACE FUNCTION public.compra_regalia_al_historial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.compra_regalia_historial (proveedor_nit, codigo_proveedor, descripcion, accion, compra_despues, regalo_despues, cambiado_por)
    VALUES (NEW.proveedor_nit, NEW.codigo_proveedor, NEW.descripcion, 'alta', NEW.compra, NEW.regalo, NEW.actualizado_por);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (OLD.compra, OLD.regalo) IS DISTINCT FROM (NEW.compra, NEW.regalo) THEN
      INSERT INTO public.compra_regalia_historial (proveedor_nit, codigo_proveedor, descripcion, accion, compra_antes, regalo_antes, compra_despues, regalo_despues, cambiado_por)
      VALUES (NEW.proveedor_nit, NEW.codigo_proveedor, NEW.descripcion, 'cambio', OLD.compra, OLD.regalo, NEW.compra, NEW.regalo, NEW.actualizado_por);
    END IF;
    RETURN NEW;
  ELSE
    INSERT INTO public.compra_regalia_historial (proveedor_nit, codigo_proveedor, descripcion, accion, compra_antes, regalo_antes, cambiado_por)
    VALUES (OLD.proveedor_nit, OLD.codigo_proveedor, OLD.descripcion, 'baja', OLD.compra, OLD.regalo, public.auth_employee_id());
    RETURN OLD;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.compra_regalia_al_historial() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS compra_regalia_historial ON public.compra_regalia;
CREATE TRIGGER compra_regalia_historial AFTER INSERT OR UPDATE OR DELETE ON public.compra_regalia
  FOR EACH ROW EXECUTE FUNCTION public.compra_regalia_al_historial();

-- Lo que ya estaba (los 5 niveles de Vijosa, escritos antes del historial).
INSERT INTO public.compra_regalia_historial (created_at, proveedor_nit, codigo_proveedor, descripcion, accion, compra_despues, regalo_despues, cambiado_por)
SELECT r.created_at, r.proveedor_nit, r.codigo_proveedor, r.descripcion, 'alta', r.compra, r.regalo, r.actualizado_por
  FROM public.compra_regalia r
 WHERE NOT EXISTS (SELECT 1 FROM public.compra_regalia_historial h
                    WHERE h.proveedor_nit = r.proveedor_nit AND h.codigo_proveedor = r.codigo_proveedor);

-- Los proveedores que tienen productos emparejados o regalías, para elegir en
-- la pestaña «Regalías». INVOKER: el RLS de cada tabla decide.
CREATE OR REPLACE FUNCTION public.compra_proveedores_para_regalias()
RETURNS json LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
BEGIN
  RETURN (
    SELECT coalesce(json_agg(to_json(t) ORDER BY t.regalias DESC, t.nombre), '[]'::json)
      FROM (
        SELECT n.nit, coalesce(m.nombre, n.nit) AS nombre,
               (SELECT count(*) FROM public.compra_regalia r WHERE r.proveedor_nit = n.nit)::int AS regalias,
               (SELECT count(*) FROM public.compra_producto_alias a WHERE a.emisor_nit = n.nit AND a.codigo_proveedor NOT LIKE '#%')::int AS productos
          FROM (SELECT emisor_nit AS nit FROM public.compra_producto_alias WHERE codigo_proveedor NOT LIKE '#%'
                UNION SELECT proveedor_nit FROM public.compra_regalia) n
          LEFT JOIN public.proveedores_maestro m ON m.nit = n.nit
      ) t
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.compra_proveedores_para_regalias() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_proveedores_para_regalias() TO authenticated, service_role;

-- Los productos de un proveedor (por su código en la factura) con su regalía,
-- y el historial de ese proveedor. JSON: no cae bajo el techo de 1000 filas.
CREATE OR REPLACE FUNCTION public.compra_regalias_de_proveedor(p_nit text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
BEGIN
  RETURN json_build_object(
    'productos', (
      SELECT coalesce(json_agg(to_json(t) ORDER BY t.compra IS NULL, t.producto NULLS LAST, t.codigo), '[]'::json)
        FROM (
          SELECT c.codigo,
                 coalesce(p.nombre, r.descripcion) AS producto, a.product_id,
                 r.compra, r.regalo, r.actualizado_por, r.updated_at
            FROM (SELECT upper(btrim(codigo_proveedor)) AS codigo FROM public.compra_producto_alias
                   WHERE emisor_nit = p_nit AND codigo_proveedor NOT LIKE '#%'
                  UNION SELECT codigo_proveedor FROM public.compra_regalia WHERE proveedor_nit = p_nit) c
            LEFT JOIN LATERAL (SELECT x.product_id FROM public.compra_producto_alias x
                                WHERE x.emisor_nit = p_nit AND upper(btrim(x.codigo_proveedor)) = c.codigo
                                ORDER BY x.veces_usado DESC NULLS LAST LIMIT 1) a ON true
            LEFT JOIN public.products p ON p.id = a.product_id
            LEFT JOIN public.compra_regalia r ON r.proveedor_nit = p_nit AND r.codigo_proveedor = c.codigo
        ) t),
    'historial', (
      SELECT coalesce(json_agg(to_json(h) ORDER BY h.created_at DESC), '[]'::json)
        FROM (SELECT id, created_at, codigo_proveedor, descripcion, accion,
                     compra_antes, regalo_antes, compra_despues, regalo_despues, cambiado_por
                FROM public.compra_regalia_historial WHERE proveedor_nit = p_nit
               ORDER BY created_at DESC LIMIT 300) h)
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.compra_regalias_de_proveedor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_regalias_de_proveedor(text) TO authenticated, service_role;
