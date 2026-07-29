-- H2/H8/H9 — PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md (auditoría 2026-07-29)
--
-- H2: `update_proveedor_manual` escribía `percibe_1_override = p_percibe_1` en
-- CADA guardado, tocara o no el usuario ese campo. La columna existía para el
-- tri-estado (NULL = automático), así que corregirle el teléfono a un proveedor
-- congelaba su percibe_1 contra sus propios DTE — para siempre, y sin forma de
-- volver a "automático" desde la UI. `upsert_proveedor_from_dte` sí respeta el
-- override (CASE WHEN percibe_1_override IS NOT NULL...), o sea que el pin era
-- efectivo. 2 filas quedaron así (CAESS y CTE), ambas en false.
--
-- Nuevo contrato: el cliente manda SOLO `p_percibe_1_override` (NULL =
-- automático, true/false = manual). `percibe_1` deja de venir del cliente: con
-- override manda el override, sin override se conserva lo observado en los DTE.
--
-- H8: había DOS overloads en prod (7 y 8 argumentos) — la migración del alias
-- usó CREATE OR REPLACE agregando un parámetro con default, lo que crea una
-- función NUEVA en vez de reemplazar. La de 7 quedó muerta pero con GRANT vivo,
-- y las sobrecargas son fuente conocida de ambigüedad en PostgREST.
--
-- H9: `set_purchase_dte_supplier` quedó sin llamadores cuando la Fase 2.1 movió
-- el match manual al maestro (set_purchase_dte_proveedor). Era un SECURITY
-- DEFINER de escritura con GRANT a authenticated, sin uso.

SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.update_proveedor_manual(bigint, text, text, text, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.update_proveedor_manual(bigint, text, text, text, text, boolean, boolean, text);
DROP FUNCTION IF EXISTS public.set_purchase_dte_supplier(bigint, bigint);

CREATE FUNCTION public.update_proveedor_manual(
  p_id                 bigint,
  p_contacto_nombre    text,
  p_telefono2          text,
  p_nombre_cheques     text,
  p_notas              text,
  p_activo             boolean,
  p_alias              text    DEFAULT NULL,
  p_percibe_1_override boolean DEFAULT NULL
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
    contacto_nombre    = p_contacto_nombre,
    telefono2          = p_telefono2,
    nombre_cheques     = p_nombre_cheques,
    notas              = p_notas,
    activo             = p_activo,
    alias              = p_alias,
    percibe_1_override = p_percibe_1_override,
    -- Con override manual manda el override. Sin él (NULL = automático) se
    -- conserva lo observado en los DTE: este RPC nunca vuelve a decidir
    -- percibe_1 por su cuenta (eso es trabajo de upsert_proveedor_from_dte).
    percibe_1          = coalesce(p_percibe_1_override, percibe_1),
    updated_at         = now()
  WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_proveedor_manual(bigint, text, text, text, text, boolean, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_proveedor_manual(bigint, text, text, text, text, boolean, text, boolean) TO authenticated, service_role;

-- El RPC de lectura no exponía `percibe_1_override`, así que el form no tenía
-- cómo saber si el valor era automático o fijado a mano: mostraría siempre
-- "Automático" y el primer guardado borraría un override real sin avisar.
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
$$;

REVOKE EXECUTE ON FUNCTION public.get_proveedores_maestro() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_proveedores_maestro() TO authenticated, service_role;

-- Corrección de los datos que dañó el bug. Las 2 filas afectadas (CAESS y
-- CTE/Claro) tienen override=false igual a su percibe_1 observado, así que
-- volver a NULL no cambia el valor efectivo hoy — solo devuelve la capacidad
-- de que sus propios DTE lo corrijan. Se acota a ese caso exacto para no
-- borrar un override que alguien haya puesto a propósito y que SÍ difiera de
-- lo observado.
UPDATE public.proveedores_maestro
   SET percibe_1_override = NULL
 WHERE percibe_1_override IS NOT NULL
   AND percibe_1_override = percibe_1;
