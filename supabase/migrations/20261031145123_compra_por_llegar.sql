SET lock_timeout = '5s';

-- ── «Llegaron menos» (2026-10-31) ──────────────────────────────────────────
-- La factura entra COMPLETA y lo que falta queda acá hasta que el proveedor lo
-- mande (lo normal, según el usuario) o se pida la nota de crédito.
ALTER TABLE public.compra_registro ADD COLUMN llegaron numeric;

CREATE TABLE public.compra_por_llegar (
  id               bigserial PRIMARY KEY,
  created_at       timestamptz NOT NULL DEFAULT now(),
  registro_id      bigint NOT NULL UNIQUE REFERENCES public.compra_registro(id),
  carga_id         bigint NOT NULL REFERENCES public.compra_carga(id),
  faltan           numeric NOT NULL CHECK (faltan > 0),
  estado           text NOT NULL DEFAULT 'por_llegar'
                   CHECK (estado IN ('por_llegar', 'llego', 'reclamar', 'nota_credito')),
  nota             text,
  cambiado_por     uuid REFERENCES public.employees(id),
  cambiado_at      timestamptz
);
CREATE INDEX compra_por_llegar_carga ON public.compra_por_llegar (carga_id);
CREATE INDEX compra_por_llegar_estado ON public.compra_por_llegar (estado) WHERE estado IN ('por_llegar', 'reclamar');
ALTER TABLE public.compra_por_llegar ENABLE ROW LEVEL SECURITY;
CREATE POLICY compra_por_llegar_select ON public.compra_por_llegar FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('cargar_compra', 'can_view'))
      OR (SELECT public.auth_has_module_permission('compras', 'can_view')));

-- Cada paso queda escrito: la fila guarda el último, y el historial completo.
CREATE TABLE public.compra_por_llegar_log (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  por_llegar_id bigint NOT NULL REFERENCES public.compra_por_llegar(id),
  estado      text NOT NULL,
  nota        text,
  por         uuid REFERENCES public.employees(id)
);
CREATE INDEX compra_por_llegar_log_fila ON public.compra_por_llegar_log (por_llegar_id);
ALTER TABLE public.compra_por_llegar_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY compra_por_llegar_log_select ON public.compra_por_llegar_log FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('cargar_compra', 'can_view'))
      OR (SELECT public.auth_has_module_permission('compras', 'can_view')));

-- El registro anota «llegaron» y abre el faltante en la misma pasada.
DO $$
DECLARE d text := pg_get_functiondef('public.compra_registro_anotar_carga(bigint)'::regprocedure);
BEGIN
  IF position('lote, vence, vence_pendiente, reparto, cargado_por, cargado_at)' IN d) = 0
     OR position('v_emp, c.updated_at' IN d) = 0
     OR position('GET DIAGNOSTICS n = ROW_COUNT;' IN d) = 0 THEN
    RAISE EXCEPTION 'la función cambió: revisar antes de reescribir';
  END IF;
  d := replace(d, 'lote, vence, vence_pendiente, reparto, cargado_por, cargado_at)',
                  'lote, vence, vence_pendiente, reparto, cargado_por, cargado_at, llegaron)');
  d := replace(d, 'v_emp, c.updated_at', 'v_emp, c.updated_at, nullif(r->>''llegaron'', '''')::numeric');
  d := replace(d, 'GET DIAGNOSTICS n = ROW_COUNT;', 'GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.compra_por_llegar (registro_id, carga_id, faltan)
  SELECT g.id, g.carga_id, g.unidades - g.llegaron
    FROM public.compra_registro g
   WHERE g.carga_id = c.id AND g.llegaron IS NOT NULL AND g.unidades > g.llegaron
  ON CONFLICT (registro_id) DO NOTHING;');
  EXECUTE d;
END $$;

-- Cambiar el estado: Bodega marca «llegó», «reclamar» (pedir nota) o «nota_credito».
CREATE OR REPLACE FUNCTION public.compra_por_llegar_marcar(p_id bigint, p_estado text, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_emp uuid := public.auth_employee_id(); v_actual text;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['cargar_compra', 'compras']) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_estado NOT IN ('por_llegar', 'llego', 'reclamar', 'nota_credito') THEN
    RAISE EXCEPTION 'Estado desconocido: %', p_estado;
  END IF;
  SELECT estado INTO v_actual FROM public.compra_por_llegar WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el faltante %', p_id; END IF;
  IF v_actual IN ('llego', 'nota_credito') AND p_estado <> 'por_llegar' THEN
    RAISE EXCEPTION 'Ese faltante ya está cerrado.';
  END IF;
  UPDATE public.compra_por_llegar
     SET estado = p_estado, nota = nullif(btrim(p_nota), ''), cambiado_por = v_emp, cambiado_at = now()
   WHERE id = p_id;
  INSERT INTO public.compra_por_llegar_log (por_llegar_id, estado, nota, por)
  VALUES (p_id, p_estado, nullif(btrim(p_nota), ''), v_emp);
  RETURN json_build_object('ok', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.compra_por_llegar_marcar(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_por_llegar_marcar(bigint, text, text) TO authenticated, service_role;

-- La lista: abiertos siempre, cerrados de los últimos 60 días.
CREATE OR REPLACE FUNCTION public.get_compra_por_llegar_json()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT ((SELECT public.auth_has_module_permission('cargar_compra', 'can_view'))
       OR (SELECT public.auth_has_module_permission('compras', 'can_view'))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT coalesce(json_agg(to_json(t) ORDER BY t.abierto DESC, t.fecha_documento, t.id), '[]'::json)
      FROM (
        SELECT f.id, f.estado, f.faltan, f.nota, f.cambiado_at, f.created_at,
               f.estado IN ('por_llegar', 'reclamar') AS abierto,
               (current_date - g.fecha_documento) AS dias,
               g.fecha_documento, g.proveedor_nombre, g.proveedor_nit, g.tipo_documento, g.numero_documento,
               g.erp_product_id, g.producto, g.descripcion_proveedor, g.presentacion,
               g.unidades, g.llegaron, g.costo_unidad, round(f.faltan * g.costo_unidad, 2) AS monto,
               f.cambiado_por, e.name AS cambiado_por_nombre
          FROM public.compra_por_llegar f
          JOIN public.compra_registro g ON g.id = f.registro_id
          LEFT JOIN public.employees e ON e.id = f.cambiado_por
         WHERE f.estado IN ('por_llegar', 'reclamar') OR f.cambiado_at > now() - interval '60 days'
      ) t
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.get_compra_por_llegar_json() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_compra_por_llegar_json() TO authenticated, service_role;
