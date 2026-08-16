-- La ficha del proveedor tiene que TRAER lo que la pantalla deja editar.
--
-- `get_proveedores_maestro` lista las columnas una por una, así que los tres
-- campos nuevos —días de crédito, límite y forma de pago— no salían: la ficha
-- los mostraba siempre vacíos y guardar encima habría BORRADO lo que hubiera.
-- Es la misma clase de error que un `.update()` sin policy: no falla, miente.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_proveedores_maestro()
RETURNS json
LANGUAGE sql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT
      p.id, p.nit, p.dui, p.nrc, p.nombre, p.nombre_comercial, p.alias,
      p.cod_actividad, p.desc_actividad, p.tipo_establecimiento,
      p.departamento, p.municipio, p.direccion, p.telefono, p.correo,
      p.percibe_1, p.percibe_1_override, p.retiene_renta,
      p.categoria_id, c.nombre AS categoria_nombre, c.clase AS categoria_clase,
      sc.id AS categoria_sugerida_id, sc.nombre AS categoria_sugerida_nombre,
      CASE
        WHEN p.nrc IS NOT NULL THEN 'contribuyente'
        WHEN p.nit IS NOT NULL OR p.dui IS NOT NULL THEN 'sujeto_excluido'
        ELSE NULL
      END AS regimen_fiscal,
      -- Clasificación fiscal (Art. 65 LIVA + catálogos del anexo F-07 v14).
      p.iva_deducible, p.clasificacion_estado, p.clasificacion_base_legal,
      p.clasificacion_nota, p.clasificado_at,
      p.f07_clasificacion, p.f07_sector, p.f07_tipo_costo_gasto, p.f07_tipo_operacion,
      e.name AS clasificado_por_nombre,
      p.supplier_id, s.nombre AS supplier_nombre,
      p.contacto_nombre, p.telefono2, p.nombre_cheques, p.notas,
      -- Condiciones de crédito: el plazo, el techo que autoriza comprarle y
      -- cómo se le paga. Los edita su ficha y también Cuentas por pagar.
      p.dias_credito, p.limite_credito, p.forma_pago,
      p.activo, p.pais, p.source,
      p.primera_vez_visto, p.ultima_vez_visto, p.docs_count,
      p.created_at, p.updated_at
    FROM public.proveedores_maestro p
    LEFT JOIN public.proveedores_categorias c  ON c.id = p.categoria_id
    LEFT JOIN public.suppliers s               ON s.id = p.supplier_id
    LEFT JOIN public.employees e               ON e.id = p.clasificado_por
    LEFT JOIN public.proveedores_categorias sc ON sc.id = public.suggest_proveedor_categoria_id(p.desc_actividad)
    ORDER BY p.nombre
  ) t;
$function$;
