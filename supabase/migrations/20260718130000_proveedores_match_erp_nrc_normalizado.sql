-- Match ERP de proveedores_maestro daba casi 0 resultados: suppliers.nrc
-- a veces trae guión (ej. "9407-2", entrada manual/legacy) y el NRC que sale
-- del DTE nunca lo trae ("94072", formato crudo del MH). Mismo NRC, string
-- distinto → el match exacto (=) no encontraba nada. Con normalización
-- (solo dígitos) se identificaron 51 matches limpios, sin ambigüedad
-- (0 NRC normalizado duplicado en ninguna de las dos tablas), verificados a
-- mano contra el nombre del proveedor.
SET lock_timeout = '5s';

-- 1. Comparación futura: upsert_proveedor_from_dte matchea por NRC normalizado.
CREATE OR REPLACE FUNCTION public.upsert_proveedor_from_dte(p_data jsonb)
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
    SELECT id INTO v_supplier_id FROM public.suppliers
      WHERE regexp_replace(nrc, '[^0-9]', '', 'g') = regexp_replace(v_nrc, '[^0-9]', '', 'g')
      LIMIT 1;
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

-- 2. Backfill: aplica el mismo criterio a los proveedores ya existentes sin
-- match (no se pisa un supplier_id que el usuario ya haya asignado a mano).
UPDATE public.proveedores_maestro p
SET supplier_id = s.id, updated_at = now()
FROM public.suppliers s
WHERE p.supplier_id IS NULL
  AND p.nrc IS NOT NULL AND s.nrc IS NOT NULL
  AND regexp_replace(s.nrc, '[^0-9]', '', 'g') = regexp_replace(p.nrc, '[^0-9]', '', 'g');
