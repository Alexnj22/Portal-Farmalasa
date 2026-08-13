SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- La revisión de la deducibilidad se hace POR REGLA, no por proveedor.
--
-- POR QUÉ. La pantalla de la v2.584.0 pedía confirmar 67 propuestas que no
-- estaban en la lista: ni el estado ni la propuesta se veían. Rechazada por el
-- usuario el 2026-08-12, y con razón — no se puede confirmar lo que no se ve.
--
-- Medido el 2026-08-13 contra producción, las 162 fichas se reparten en
-- 12 reglas más un resto sin giro registrado:
--
--    7 reglas  ·  67 proveedores  ·  $56,504.16   propuestas del sistema
--    5 reglas  ·  36 proveedores  ·   $3,220.83   las que la ley condiciona
--    —         ·  59 proveedores  ·       $7.94   sin código de actividad
--
-- Son 12 decisiones, no 162. Y el reparto por PLATA no se parece al reparto por
-- documentos: servicios financieros tiene 190 documentos y $81.82 (comisiones de
-- banco, $0.43 cada una) mientras el alquiler tiene 7 documentos y $341.30. Por
-- eso las tarjetas se ordenan por crédito fiscal y esta función lo devuelve.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1 · LECTURA DEL PANEL ────────────────────────────────────────────────────
-- SECURITY DEFINER, y NO es una copia mecánica del criterio de
-- `get_proveedores_maestro` (que es INVOKER a propósito).
--
-- El motivo es medido: `proveedores_maestro` exige el módulo `proveedores` y
-- `purchase_dte_documents` exige `facturas_compra`, y hay roles con uno y sin el
-- otro — `Administrador` ve proveedores y NO ve facturas de compra. Con INVOKER
-- el LEFT JOIN contra una tabla que la policy le esconde no falla: devuelve
-- NULL, el coalesce lo vuelve 0, y el panel le muestra **$0.00 de crédito fiscal
-- en las doce tarjetas** sin un solo error. Un cero de permiso y un cero de dato
-- se ven igual, y acá el cero decide si alguien confirma o no.
--
-- Entonces el acceso lo controla UNA sola condición explícita —can_view sobre
-- `proveedores`, que es el módulo donde vive la pantalla— y el monto sale
-- completo o no sale.
CREATE OR REPLACE FUNCTION public.get_clasificacion_fiscal_pendiente()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_out json;
BEGIN
  IF NOT (SELECT auth_has_module_permission('proveedores', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v_out
  FROM (
    SELECT
      p.id, p.nombre, p.nombre_comercial, p.alias, p.desc_actividad, p.cod_actividad,
      p.clasificacion_estado, p.clasificacion_base_legal, p.clasificacion_nota,
      p.iva_deducible,
      p.f07_clasificacion, p.f07_sector, p.f07_tipo_costo_gasto, p.f07_tipo_operacion,
      coalesce(cf.ccf, 0)              AS ccf,
      coalesce(cf.credito_fiscal, 0)   AS credito_fiscal
    FROM public.proveedores_maestro p
    -- Sólo los CCF vigentes: el crédito fiscal de un documento invalidado no
    -- existe, y los otros tipos de DTE no dan crédito por esta vía.
    LEFT JOIN LATERAL (
      SELECT count(*) AS ccf,
             round(coalesce(sum(d.total_iva), 0), 2) AS credito_fiscal
        FROM public.purchase_dte_documents d
       WHERE d.proveedor_id = p.id
         AND d.tipo_dte = '03'
         AND coalesce(d.invalidado, false) = false
    ) cf ON true
    -- Las confirmadas ya no son trabajo: salen del panel y el conjunto se achica
    -- solo a medida que se decide.
    WHERE p.clasificacion_estado <> 'confirmada'
    ORDER BY coalesce(cf.credito_fiscal, 0) DESC, p.nombre
  ) t;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.get_clasificacion_fiscal_pendiente() IS
  'Fichas sin clasificación confirmada, con su crédito fiscal en juego. DEFINER a propósito: el monto cruza purchase_dte_documents, que pide otro módulo — con INVOKER un rol sin facturas_compra vería $0.00 en vez de un error.';

-- ── 2 · RESOLVER UNA REGLA CONDICIONADA, EN TANDA ────────────────────────────
-- `confirmar_clasificacion_propuesta` sólo mueve 'propuesta' → 'confirmada' y no
-- escribe valores: sirve para lo que el sistema ya propuso. Las condicionadas
-- —combustible, ferretería, alimentos, cómputo— nacen SIN valores del F-07
-- porque la ley no permite derivarlos, así que resolverlas es escribir la
-- decisión, no confirmarla.
--
-- Va aparte y no como parámetro de la otra por lo mismo que aquélla fue aparte
-- de `update_proveedor_manual`: son actos distintos. Uno acepta lo propuesto;
-- éste decide lo que estaba en blanco.
CREATE OR REPLACE FUNCTION public.resolver_clasificacion_pendiente(
  p_ids               bigint[],
  p_iva_deducible     boolean,
  p_clasificacion     smallint DEFAULT NULL,
  p_sector            smallint DEFAULT NULL,
  p_tipo_costo_gasto  smallint DEFAULT NULL,
  p_tipo_operacion    smallint DEFAULT NULL
) RETURNS integer
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
  IF p_iva_deducible IS NULL THEN
    RAISE EXCEPTION 'Para confirmar hay que decidir si el crédito fiscal es deducible (Art. 65 LIVA).';
  END IF;

  UPDATE public.proveedores_maestro SET
    iva_deducible        = p_iva_deducible,
    -- No deducible es no deducible: los catálogos del anexo quedan en blanco, no
    -- se arrastra lo que viniera en el parámetro.
    f07_clasificacion    = CASE WHEN p_iva_deducible THEN p_clasificacion    END,
    f07_sector           = CASE WHEN p_iva_deducible THEN p_sector           END,
    f07_tipo_costo_gasto = CASE WHEN p_iva_deducible THEN p_tipo_costo_gasto END,
    f07_tipo_operacion   = CASE WHEN p_iva_deducible THEN p_tipo_operacion   END,
    clasificacion_estado = 'confirmada',
    clasificado_por      = (SELECT auth_employee_id()),
    clasificado_at       = now(),
    updated_at           = now()
  WHERE id = ANY(p_ids)
    -- Sólo las que están en blanco. Una 'propuesta' se confirma con su propio
    -- RPC y una 'confirmada' no se repisa desde una pantalla de tanda.
    AND clasificacion_estado = 'pendiente';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_clasificacion_fiscal_pendiente() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolver_clasificacion_pendiente(bigint[], boolean, smallint, smallint, smallint, smallint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_clasificacion_fiscal_pendiente() TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.resolver_clasificacion_pendiente(bigint[], boolean, smallint, smallint, smallint, smallint) TO authenticated, service_role;
