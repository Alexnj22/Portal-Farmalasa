SET lock_timeout = '5s';

-- Alias: nombre alterno de búsqueda a criterio del usuario (ej. como le dicen
-- de palabra en Bodega, distinto del nombre legal/comercial que trae el DTE).
-- Curación manual, mismo patrón que nombre_cheques/notas.
ALTER TABLE public.proveedores_maestro ADD COLUMN IF NOT EXISTS alias text;

-- get_proveedores_maestro: agrega alias + regimen_fiscal (derivado, NO
-- almacenado). "Tipo de Proveedor" NO es la clase de gasto/costo (eso es la
-- categoría contable asignada, ver categoria_clase) — es la clasificación
-- fiscal real del Código Tributario: Contribuyente de IVA (tiene NRC, emite
-- CCF/Factura/NC/ND) vs Sujeto Excluido de IVA (Art. 119 CT — sin NRC, emite
-- Factura de Sujeto Excluido tipo_dte=14; sin derecho a crédito fiscal para
-- quien le compra, y sujeto a retención de Renta del 10% por servicios,
-- Art. 156 CT, si es persona natural). nrc ya viene NULL para sujetos
-- excluidos desde extractProveedorFromDte (proveedorFromDte.ts) — se deriva
-- sin necesitar backfill ni columna nueva.
CREATE OR REPLACE FUNCTION public.get_proveedores_maestro()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT
      p.id, p.nit, p.dui, p.nrc, p.nombre, p.nombre_comercial, p.alias,
      p.cod_actividad, p.desc_actividad, p.tipo_establecimiento,
      p.departamento, p.municipio, p.direccion, p.telefono, p.correo,
      p.percibe_1, p.retiene_renta,
      p.categoria_id, c.nombre AS categoria_nombre, c.clase AS categoria_clase,
      CASE
        WHEN p.nrc IS NOT NULL THEN 'contribuyente'
        WHEN p.nit IS NOT NULL OR p.dui IS NOT NULL THEN 'sujeto_excluido'
        ELSE NULL
      END AS regimen_fiscal,
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
$function$;

-- update_proveedor_manual: agrega p_alias (default NULL, retrocompatible).
CREATE OR REPLACE FUNCTION public.update_proveedor_manual(
  p_id bigint, p_contacto_nombre text, p_telefono2 text, p_nombre_cheques text,
  p_notas text, p_activo boolean, p_percibe_1 boolean, p_alias text DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE public.proveedores_maestro SET
    contacto_nombre    = p_contacto_nombre,
    telefono2          = p_telefono2,
    nombre_cheques     = p_nombre_cheques,
    notas              = p_notas,
    activo             = p_activo,
    percibe_1          = p_percibe_1,
    percibe_1_override = p_percibe_1,
    alias              = p_alias,
    updated_at         = now()
  WHERE id = p_id;
END;
$function$;
