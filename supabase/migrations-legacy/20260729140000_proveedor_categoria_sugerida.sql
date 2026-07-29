-- H5 — PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md (auditoría 2026-07-29)
--
-- 99 de 99 proveedores están sin categoría, así que todo el aparato contable
-- del maestro (16 categorías, filtro Categoría, filtro Clase, derivación
-- costo/gasto en el detalle) está construido y sin usar: filtrar por cualquier
-- categoría devuelve 0 filas. Clasificar 99 proveedores de a uno desde un
-- modal es la razón por la que nadie lo hizo.
--
-- Decisión del usuario (2026-07-29): SUGERIR + CONFIRMAR. Nada se escribe
-- solo. El giro fiscal (`desc_actividad`) ya viene en los 99 registros desde
-- el propio DTE, y una regla por palabra clave cubre 68 de 99 proveedores =
-- 1,958 de 2,192 documentos (89%) — medido antes de escribir esto.
--
-- Lo que la regla NO cubre a propósito: supermercados, alimentos, lácteos,
-- bebidas y abarrotes (~11 proveedores). En una farmacia pueden ser mercadería
-- para reventa O insumo de uso interno, y PriceSmart es literalmente las dos
-- cosas según la factura. Sugerirle una categoría al usuario ahí sería
-- adivinar; se quedan sin sugerencia para que él decida. (La solución de fondo
-- es H5b: categoría a nivel de DOCUMENTO, con el proveedor como default.)

SET lock_timeout = '5s';

-- Devuelve el id de la categoría sugerida para un giro, o NULL si la regla no
-- opina. Case/acento-insensible: `desc_actividad` llega del DTE con
-- mayúsculas, minúsculas y tildes inconsistentes según el proveedor
-- ("VENTA DE PRODUCTOS FARMACEUTICOS" y "Venta de productos farmacéuticos"
-- son el mismo giro y conviven hoy en la tabla).
CREATE OR REPLACE FUNCTION public.suggest_proveedor_categoria_id(p_desc_actividad text)
RETURNS bigint
LANGUAGE sql
-- STABLE y no IMMUTABLE a propósito: `unaccent(text)` depende del diccionario
-- y del search_path, así que es STABLE. Declarar IMMUTABLE una función que
-- llama a una STABLE es una mentira que Postgres acepta al crearla y después
-- cobra caro si alguien la indexa.
STABLE
SET search_path = public, extensions
AS $$
  SELECT c.id
  FROM public.proveedores_categorias c
  WHERE c.nombre = CASE
    WHEN p_desc_actividad IS NULL OR btrim(p_desc_actividad) = '' THEN NULL
    WHEN unaccent(lower(p_desc_actividad)) ~ 'farmac|medicinal|medicamento|botanic|cosmetic'
      THEN 'Mercadería para reventa'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'banco|financier|intermediacion'
      THEN 'Servicios financieros/bancarios'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'combustible|gasolinera|lubricante|transporte'
      THEN 'Combustible y transporte'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'telefon|telecomunicacion|internet|cable'
      THEN 'Telecomunicaciones'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'agua'                          THEN 'Agua'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'electric|energia'              THEN 'Energía eléctrica'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'inmobiliar|arrendad|alquiler'  THEN 'Alquileres'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'ferreteria|reparacion|mantenimiento|construccion'
      THEN 'Mantenimiento y reparaciones'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'limpieza'                      THEN 'Limpieza'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'vigilancia|seguridad'          THEN 'Vigilancia/seguridad'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'papeler|utiles|imprenta|libreria'
      THEN 'Papelería y útiles'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'seguro'                        THEN 'Seguros'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'publicidad|propaganda'         THEN 'Publicidad'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'contab|juridic|abogad|honorari|consultor|profesional'
      THEN 'Servicios profesionales y honorarios'
    ELSE NULL
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.suggest_proveedor_categoria_id(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.suggest_proveedor_categoria_id(text) TO authenticated, service_role;

-- La sugerencia viaja junto al proveedor (solo informativa: el usuario la ve
-- y decide). Se calcula siempre, no solo cuando falta categoría, para poder
-- señalar más adelante los casos en que la asignada y la sugerida difieren.
CREATE OR REPLACE FUNCTION public.get_proveedores_maestro()
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
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
      p.supplier_id, s.nombre AS supplier_nombre,
      p.contacto_nombre, p.telefono2, p.nombre_cheques, p.notas,
      p.activo, p.pais, p.source,
      p.primera_vez_visto, p.ultima_vez_visto, p.docs_count,
      p.created_at, p.updated_at
    FROM public.proveedores_maestro p
    LEFT JOIN public.proveedores_categorias c  ON c.id = p.categoria_id
    LEFT JOIN public.suppliers s               ON s.id = p.supplier_id
    LEFT JOIN public.proveedores_categorias sc ON sc.id = public.suggest_proveedor_categoria_id(p.desc_actividad)
    ORDER BY p.nombre
  ) t;
$$;

REVOKE EXECUTE ON FUNCTION public.get_proveedores_maestro() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_proveedores_maestro() TO authenticated, service_role;

-- Asignación masiva. p_categoria_id NULL = quitar la categoría (permite
-- deshacer una tanda). Devuelve cuántas filas cambiaron de verdad, para que
-- la UI reporte el número real y no el de seleccionados.
CREATE OR REPLACE FUNCTION public.set_proveedores_categoria_bulk(
  p_ids           bigint[],
  p_categoria_id  bigint
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.proveedores_maestro
     SET categoria_id = p_categoria_id, updated_at = now()
   WHERE id = ANY(p_ids)
     AND categoria_id IS DISTINCT FROM p_categoria_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_proveedores_categoria_bulk(bigint[], bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_proveedores_categoria_bulk(bigint[], bigint) TO authenticated, service_role;

-- Aceptar la sugerencia de varios proveedores de una. Cada uno recibe LA SUYA
-- (no una categoría común), y se ignoran los que no tienen sugerencia.
CREATE OR REPLACE FUNCTION public.apply_proveedores_categoria_sugerida(p_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.proveedores_maestro p
     SET categoria_id = public.suggest_proveedor_categoria_id(p.desc_actividad),
         updated_at   = now()
   WHERE p.id = ANY(p_ids)
     AND public.suggest_proveedor_categoria_id(p.desc_actividad) IS NOT NULL
     AND p.categoria_id IS DISTINCT FROM public.suggest_proveedor_categoria_id(p.desc_actividad);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_proveedores_categoria_sugerida(bigint[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.apply_proveedores_categoria_sugerida(bigint[]) TO authenticated, service_role;
