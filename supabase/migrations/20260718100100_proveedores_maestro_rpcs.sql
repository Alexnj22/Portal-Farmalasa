-- Maestro de Proveedores — RPCs (PLAN-PROVEEDORES-2026-07.md §4.3 / Fase 1.2)
SET lock_timeout = '5s';

-- Upsert condicional desde un DTE parseado (service_role only — la llama la edge
-- function de sync/backfill, nunca el cliente). Un llamado = un documento nuevo
-- realmente insertado, así que docs_count/ultima_vez_visto SIEMPRE reflejan un
-- evento real (no es el patrón de sync incondicional que el proyecto prohíbe).
-- NUNCA pisa campos manuales (categoria_id, supplier_id ya seteado, contacto,
-- notas, activo): solo escribe columnas que vienen del DTE. percibe_1/
-- retiene_renta solo suben a true, nunca bajan solas (override manual manda).
CREATE FUNCTION public.upsert_proveedor_from_dte(p_data jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_nit         text := nullif(p_data->>'nit', '');
  v_dui         text := nullif(p_data->>'dui', '');
  v_nrc         text := nullif(p_data->>'nrc', '');
  v_fecha       date := (p_data->>'fecha_emision')::date;
  v_supplier_id integer;
  v_id          bigint;
BEGIN
  IF v_nit IS NULL AND v_dui IS NULL THEN
    RAISE EXCEPTION 'nit o dui requerido';
  END IF;

  IF v_nrc IS NOT NULL THEN
    SELECT id INTO v_supplier_id FROM public.suppliers WHERE nrc = v_nrc LIMIT 1;
  END IF;

  IF v_nit IS NOT NULL THEN
    SELECT id INTO v_id FROM public.proveedores_maestro WHERE nit = v_nit;
  ELSE
    SELECT id INTO v_id FROM public.proveedores_maestro WHERE dui = v_dui AND nit IS NULL;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.proveedores_maestro (
      nit, dui, nrc, nombre, nombre_comercial, cod_actividad, desc_actividad,
      tipo_establecimiento, departamento, municipio, direccion, telefono, correo,
      percibe_1, retiene_renta, supplier_id, source,
      primera_vez_visto, ultima_vez_visto, docs_count
    ) VALUES (
      v_nit, v_dui, v_nrc, p_data->>'nombre', p_data->>'nombre_comercial',
      p_data->>'cod_actividad', p_data->>'desc_actividad', p_data->>'tipo_establecimiento',
      p_data->>'departamento', p_data->>'municipio', p_data->>'direccion',
      p_data->>'telefono', p_data->>'correo',
      coalesce((p_data->>'percibe_1')::boolean, false),
      coalesce((p_data->>'retiene_renta')::boolean, false),
      v_supplier_id, 'dte', v_fecha, v_fecha, 1
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.proveedores_maestro p SET
      nrc                   = coalesce(v_nrc, p.nrc),
      nombre                = coalesce(p_data->>'nombre', p.nombre),
      nombre_comercial      = coalesce(p_data->>'nombre_comercial', p.nombre_comercial),
      cod_actividad         = coalesce(p_data->>'cod_actividad', p.cod_actividad),
      desc_actividad        = coalesce(p_data->>'desc_actividad', p.desc_actividad),
      tipo_establecimiento  = coalesce(p_data->>'tipo_establecimiento', p.tipo_establecimiento),
      departamento          = coalesce(p_data->>'departamento', p.departamento),
      municipio             = coalesce(p_data->>'municipio', p.municipio),
      direccion             = coalesce(p_data->>'direccion', p.direccion),
      telefono              = coalesce(p_data->>'telefono', p.telefono),
      correo                = coalesce(p_data->>'correo', p.correo),
      percibe_1             = p.percibe_1 OR coalesce((p_data->>'percibe_1')::boolean, false),
      retiene_renta         = p.retiene_renta OR coalesce((p_data->>'retiene_renta')::boolean, false),
      supplier_id           = coalesce(p.supplier_id, v_supplier_id),
      primera_vez_visto     = LEAST(p.primera_vez_visto, v_fecha),
      ultima_vez_visto      = GREATEST(p.ultima_vez_visto, v_fecha),
      docs_count            = p.docs_count + 1,
      updated_at            = now()
    WHERE p.id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_proveedor_from_dte(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_proveedor_from_dte(jsonb) TO service_role;

-- Lectura para la vista — Patrón C (evita cap de 1000 filas / N ejecuciones por chunk)
CREATE FUNCTION public.get_proveedores_maestro()
RETURNS json
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT
      p.id, p.nit, p.dui, p.nrc, p.nombre, p.nombre_comercial,
      p.cod_actividad, p.desc_actividad, p.tipo_establecimiento,
      p.departamento, p.municipio, p.direccion, p.telefono, p.correo,
      p.percibe_1, p.retiene_renta,
      p.categoria_id, c.nombre AS categoria_nombre, c.clase AS categoria_clase,
      p.supplier_id, s.nombre AS supplier_nombre,
      p.contacto_nombre, p.telefono2, p.nombre_cheques, p.notas,
      p.activo, p.pais, p.source,
      p.primera_vez_visto, p.ultima_vez_visto, p.docs_count,
      p.created_at, p.updated_at
    FROM public.proveedores_maestro p
    LEFT JOIN public.proveedores_categorias c ON c.id = p.categoria_id
    LEFT JOIN public.suppliers s ON s.id = p.supplier_id
    ORDER BY p.nombre
  ) t;
$$;

REVOKE EXECUTE ON FUNCTION public.get_proveedores_maestro() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_proveedores_maestro() TO authenticated, service_role;

CREATE FUNCTION public.set_proveedor_categoria(p_id bigint, p_categoria_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE public.proveedores_maestro
    SET categoria_id = p_categoria_id, updated_at = now()
    WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_proveedor_categoria(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_proveedor_categoria(bigint, bigint) TO authenticated, service_role;

-- Match manual con suppliers (ERP); p_supplier_id NULL = cancelar match.
CREATE FUNCTION public.set_proveedor_supplier(p_id bigint, p_supplier_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE public.proveedores_maestro
    SET supplier_id = p_supplier_id, updated_at = now()
    WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_proveedor_supplier(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_proveedor_supplier(bigint, integer) TO authenticated, service_role;

-- Campos de curación manual del modal detalle (§4.2). percibe_1 es override manual
-- del flag observado (regla: nunca lo baja el DTE solo, pero un humano sí puede).
CREATE FUNCTION public.update_proveedor_manual(
  p_id               bigint,
  p_contacto_nombre  text,
  p_telefono2        text,
  p_nombre_cheques   text,
  p_notas            text,
  p_activo           boolean,
  p_percibe_1        boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE public.proveedores_maestro SET
    contacto_nombre  = p_contacto_nombre,
    telefono2        = p_telefono2,
    nombre_cheques   = p_nombre_cheques,
    notas            = p_notas,
    activo           = p_activo,
    percibe_1        = p_percibe_1,
    updated_at       = now()
  WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_proveedor_manual(bigint, text, text, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_proveedor_manual(bigint, text, text, text, text, boolean, boolean) TO authenticated, service_role;
