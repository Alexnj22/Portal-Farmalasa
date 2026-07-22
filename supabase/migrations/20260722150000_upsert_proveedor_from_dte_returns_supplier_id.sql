-- Fase 5 E3 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): upsert_proveedor_from_dte
-- devuelve {id, supplier_id} en un solo json en vez de solo bigint — el
-- caller (sync-purchase-emails) ya no necesita un SELECT aparte a
-- proveedores_maestro solo para leer el supplier_id que este RPC ya calculó
-- internamente. La existencia SÍ se verifica antes de decidir INSERT vs
-- UPDATE (sin cambios ahí) — lo que se elimina es la ronda extra post-RPC.
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.upsert_proveedor_from_dte(jsonb);

CREATE FUNCTION public.upsert_proveedor_from_dte(p_data jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_nit         text := nullif(p_data->>'nit', '');
  v_dui         text := nullif(p_data->>'dui', '');
  v_nrc         text := nullif(p_data->>'nrc', '');
  v_fecha       date := (p_data->>'fecha_emision')::date;
  v_tipo_dte    text := p_data->>'tipo_dte';
  v_es_nc_nd    boolean := v_tipo_dte IN ('05', '06');
  v_supplier_id integer;
  v_id          bigint;
  v_out_supplier_id integer;
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
      v_supplier_id, 'dte', v_fecha, v_fecha, CASE WHEN v_es_nc_nd THEN 0 ELSE 1 END
    )
    RETURNING id, supplier_id INTO v_id, v_out_supplier_id;
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
      percibe_1             = CASE
                                 WHEN p.percibe_1_override IS NOT NULL THEN p.percibe_1_override
                                 ELSE p.percibe_1 OR coalesce((p_data->>'percibe_1')::boolean, false)
                               END,
      retiene_renta         = p.retiene_renta OR coalesce((p_data->>'retiene_renta')::boolean, false),
      supplier_id           = coalesce(p.supplier_id, v_supplier_id),
      primera_vez_visto     = LEAST(p.primera_vez_visto, v_fecha),
      ultima_vez_visto      = CASE WHEN v_es_nc_nd THEN p.ultima_vez_visto ELSE GREATEST(p.ultima_vez_visto, v_fecha) END,
      docs_count            = p.docs_count + CASE WHEN v_es_nc_nd THEN 0 ELSE 1 END,
      updated_at            = now()
    WHERE p.id = v_id
    RETURNING p.supplier_id INTO v_out_supplier_id;
  END IF;

  RETURN json_build_object('id', v_id, 'supplier_id', v_out_supplier_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_proveedor_from_dte(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_proveedor_from_dte(jsonb) TO authenticated, service_role;
