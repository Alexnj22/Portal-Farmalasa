SET lock_timeout = '5s';

-- ===========================================================================
-- C5 (H4) — `docs_count` decia el doble.
--
-- `upsert_proveedor_from_dte` hacia `docs_count = docs_count + 1` cada vez que
-- procesaba un documento. No es idempotente: reprocesar el mismo DTE —cosa que
-- pasa cada vez que corre un backfill o se relee un correo— vuelve a sumar.
--
-- Medido antes de arreglar: 93 de 161 fichas mal, las 93 INFLADAS y ninguna
-- corta, que es la firma exacta de un contador que solo sabe sumar. El peor:
-- COFARSAL decia 462 documentos cuando son 264.
--
-- El arreglo es dejar de acumular. Un conteo que se puede derivar del dato no
-- se guarda: se cuenta. Asi no hay forma de que se desincronice, ni hace falta
-- acordarse de restar cuando un documento se invalida.
--
-- Verificado tras aplicar: 0 fichas mal. COFARSAL quedo en 232 (los 264 incluian
-- notas de credito y debito, que no son documentos de compra: ajustan uno que ya
-- se conto — mismo criterio que tenia el contador viejo, que les sumaba 0).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.recontar_docs_proveedor(p_proveedor_id bigint)
 RETURNS integer
 LANGUAGE sql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    UPDATE public.proveedores_maestro pm
       SET docs_count = (
             SELECT count(*) FROM public.purchase_dte_documents d
              WHERE d.proveedor_id = pm.id
                AND coalesce(d.invalidado, false) = false
                AND d.tipo_dte NOT IN ('05', '06'))
     WHERE pm.id = p_proveedor_id
    RETURNING pm.docs_count;
$function$;

COMMENT ON FUNCTION public.recontar_docs_proveedor(bigint) IS
  'C5/H4: recalcula docs_count contando los documentos reales del proveedor. Reemplaza al `+1` incondicional de upsert_proveedor_from_dte, que no era idempotente y dejaba 93 de 161 fichas infladas (COFARSAL decia 462 y son 264).';

REVOKE EXECUTE ON FUNCTION public.recontar_docs_proveedor(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recontar_docs_proveedor(bigint) TO authenticated, service_role;

-- ── El upsert deja de acumular ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_proveedor_from_dte(p_data jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_nit         text := nullif(p_data->>'nit', '');
  v_dui         text := nullif(p_data->>'dui', '');
  v_nrc         text := nullif(p_data->>'nrc', '');
  v_nrc_norm    text;
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

  v_nrc_norm := regexp_replace(coalesce(v_nrc, ''), '[^0-9]', '', 'g');

  IF v_nrc_norm <> '' THEN
    SELECT s.id INTO v_supplier_id
      FROM public.suppliers s
     WHERE regexp_replace(coalesce(s.nrc, ''), '[^0-9]', '', 'g') = v_nrc_norm
       AND NOT EXISTS (
             SELECT 1 FROM public.proveedores_maestro pm
              WHERE pm.supplier_id = s.id)
     ORDER BY s.id
     LIMIT 1;
  END IF;

  IF v_nit IS NOT NULL THEN
    SELECT id INTO v_id FROM public.proveedores_maestro
      WHERE nit = v_nit ORDER BY id LIMIT 1;
  ELSE
    SELECT id INTO v_id FROM public.proveedores_maestro
      WHERE dui = v_dui AND nit IS NULL ORDER BY id LIMIT 1;
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
      v_supplier_id, 'dte', v_fecha, v_fecha, 0
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
      -- C5: ya NO se acumula. El conteo se recalcula abajo, contando.
      updated_at            = now()
    WHERE p.id = v_id
    RETURNING p.supplier_id INTO v_out_supplier_id;
  END IF;

  -- Se recuenta SIEMPRE, al final: el documento que dispara esta llamada puede
  -- estar insertado o no todavia segun el orden del sync, y contar de nuevo es
  -- correcto en los dos casos. Sumar no lo era en ninguno.
  PERFORM public.recontar_docs_proveedor(v_id);

  RETURN json_build_object('id', v_id, 'supplier_id', v_out_supplier_id);
END;
$function$;

-- ── Y se corrigen las 93 que ya estaban mal ────────────────────────────────
UPDATE public.proveedores_maestro pm
   SET docs_count = (
         SELECT count(*) FROM public.purchase_dte_documents d
          WHERE d.proveedor_id = pm.id
            AND coalesce(d.invalidado, false) = false
            AND d.tipo_dte NOT IN ('05', '06'));
