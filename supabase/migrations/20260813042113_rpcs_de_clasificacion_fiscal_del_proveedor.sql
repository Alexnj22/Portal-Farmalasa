SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Los tres RPC que hacen usable la clasificación fiscal del proveedor.
--
-- La migración 20260813041109 dejó las columnas y la propuesta derivada del CIIU,
-- pero nada en el portal las leía ni las escribía: 67 propuestas y 36 pendientes
-- invisibles. Sin esto el contador no tiene dónde confirmarlas.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1 · LECTURA ──────────────────────────────────────────────────────────────
-- Se conservan sus atributos: INVOKER, STABLE, search_path fijo. NO pasarla a
-- DEFINER — el control de acceso lo hace la policy de `proveedores_maestro`, y
-- un INVOKER convertido en DEFINER cambia a quién le contesta.
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
      -- Clasificación fiscal (Art. 65 LIVA + catálogos del anexo F-07 v14).
      p.iva_deducible, p.clasificacion_estado, p.clasificacion_base_legal,
      p.clasificacion_nota, p.clasificado_at,
      p.f07_clasificacion, p.f07_sector, p.f07_tipo_costo_gasto, p.f07_tipo_operacion,
      e.name AS clasificado_por_nombre,
      p.supplier_id, s.nombre AS supplier_nombre,
      p.contacto_nombre, p.telefono2, p.nombre_cheques, p.notas,
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
$$;

-- ── 2 · ESCRITURA INDIVIDUAL ─────────────────────────────────────────────────
-- RPC propio y no un parámetro más de `update_proveedor_manual`, por dos motivos:
-- ya hay DOS sobrecargas de esa función con DEFAULT y una tercera vuelve ambigua
-- la llamada; y esto es un acto distinto —lleva autor y fecha— igual que
-- `set_proveedor_categoria` y `set_proveedor_supplier`, que ya viven aparte.
--
-- El autor sale de la SESIÓN, nunca de un parámetro del cliente.
CREATE OR REPLACE FUNCTION public.set_proveedor_clasificacion_fiscal(
  p_id                  bigint,
  p_iva_deducible       boolean,
  p_clasificacion       smallint DEFAULT NULL,
  p_sector              smallint DEFAULT NULL,
  p_tipo_costo_gasto    smallint DEFAULT NULL,
  p_tipo_operacion      smallint DEFAULT NULL,
  p_nota                text     DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- Confirmar sin decidir la deducibilidad no es confirmar. El CHECK de la tabla
  -- también lo impide; acá se explica, que es lo que el usuario va a leer.
  IF p_iva_deducible IS NULL THEN
    RAISE EXCEPTION 'Para confirmar hay que decidir si el crédito fiscal es deducible (Art. 65 LIVA).';
  END IF;

  UPDATE public.proveedores_maestro SET
    iva_deducible        = p_iva_deducible,
    f07_clasificacion    = p_clasificacion,
    f07_sector           = p_sector,
    f07_tipo_costo_gasto = p_tipo_costo_gasto,
    f07_tipo_operacion   = p_tipo_operacion,
    clasificacion_nota   = coalesce(p_nota, clasificacion_nota),
    clasificacion_estado = 'confirmada',
    clasificado_por      = (SELECT auth_employee_id()),
    clasificado_at       = now(),
    updated_at           = now()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el proveedor %', p_id;
  END IF;
END;
$$;

-- ── 3 · CONFIRMAR EN TANDA ───────────────────────────────────────────────────
-- Sólo pasa de 'propuesta' a 'confirmada'. NO toca las 'pendiente': ésas son
-- justamente las que la ley condiciona y las que nadie puede confirmar en masa
-- sin mirarlas.
--
-- Devuelve cuántas cambiaron DE VERDAD, no cuántas se seleccionaron — mismo
-- criterio que `apply_proveedores_categoria_sugerida`, para que el aviso no
-- mienta cuando algunas ya estaban confirmadas.
CREATE OR REPLACE FUNCTION public.confirmar_clasificacion_propuesta(p_ids bigint[])
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

  UPDATE public.proveedores_maestro SET
    clasificacion_estado = 'confirmada',
    clasificado_por      = (SELECT auth_employee_id()),
    clasificado_at       = now(),
    updated_at           = now()
  WHERE id = ANY(p_ids)
    AND clasificacion_estado = 'propuesta'
    AND iva_deducible IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_proveedor_clasificacion_fiscal(bigint, boolean, smallint, smallint, smallint, smallint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirmar_clasificacion_propuesta(bigint[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_proveedor_clasificacion_fiscal(bigint, boolean, smallint, smallint, smallint, smallint, text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.confirmar_clasificacion_propuesta(bigint[]) TO authenticated, service_role;
