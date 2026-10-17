SET lock_timeout = '5s';

-- Buscar en la bitácora de aplicaciones de inyecciones con SUBFILTROS y por
-- PÁGINAS (pedido del usuario, 2026-10-17): «si busco por cliente, vendedor o
-- medicamento, que busque por más tiempo, con paginación, y que se puedan
-- sumar filtros: por cliente y después por medicamento».
--
-- Diferencias con `inyecciones_bitacora` (que se queda: la llaman las apps ya
-- instaladas):
--   · `p_filtros` es una lista [{campo, texto}] que se cumple TODA (AND).
--     campo ∈ cliente | medicamento | vendedor | factura | todo.
--   · Con algún filtro, el rango de fechas es OPCIONAL (null = todo el
--     historial) y no tiene el tope de tres meses: lo acota el filtro.
--     Sin filtros sigue el tope, porque sin él se baja la tabla entera.
--   · Devuelve UNA página (`p_limite`/`p_offset`) más las cuentas del conjunto
--     completo, para que las tarjetas digan el total y no el de la página.
--   · El estado (aplicada/pendiente) se filtra acá, así la paginación y el
--     filtro hablan del mismo conjunto. Las tarjetas cuentan SIN el estado.
--   · «Vendedor» es quien cobró la aplicación o quien hizo la venta.
--   · Se compara sin tildes: «Pérez» encuentra «PEREZ».
CREATE OR REPLACE FUNCTION public.inyecciones_bitacora_buscar(
  p_branch_id integer,
  p_desde date,
  p_hasta date,
  p_filtros jsonb DEFAULT '[]'::jsonb,
  p_estado text DEFAULT NULL,
  p_limite integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_filtros jsonb;
  v_limite integer := least(greatest(coalesce(p_limite, 50), 1), 5000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_estado text := nullif(upper(trim(coalesce(p_estado, ''))), '');
BEGIN
  IF NOT (SELECT auth_has_module_permission('inyecciones_tab_bitacora', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce((SELECT auth_module_scope('inyecciones')), '') <> 'ALL' THEN
    p_branch_id := (SELECT auth_employee_branch_id());
    IF p_branch_id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  END IF;

  -- Sólo los filtros con texto, ya normalizados (mayúsculas y sin tildes).
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'campo', lower(coalesce(f->>'campo', 'todo')),
           'texto', translate(upper(trim(f->>'texto')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'))), '[]'::jsonb)
    INTO v_filtros
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_filtros) = 'array' THEN p_filtros ELSE '[]'::jsonb END) f
   WHERE nullif(trim(f->>'texto'), '') IS NOT NULL;

  IF jsonb_array_length(v_filtros) = 0 THEN
    IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 92 THEN
      RAISE EXCEPTION 'Rango de fechas inválido (hasta tres meses).';
    END IF;
  ELSIF p_desde IS NOT NULL AND p_hasta IS NOT NULL AND p_hasta < p_desde THEN
    RAISE EXCEPTION 'Rango de fechas inválido.';
  END IF;

  RETURN (
    WITH base AS (
      SELECT a.id, a.origen, a.branch_id, b.name AS sala, a.invoice_id, si.correlativo,
             CASE WHEN si.branch_id IS DISTINCT FROM a.branch_id THEN bv.name END AS venta_sala,
             coalesce(a.cliente, si.cliente) AS cliente,
             CASE WHEN mz.otros IS NULL THEN a.producto
                  ELSE a.producto || coalesce(' ' || trim_scale(a.dosis_ml) || ' ml', '') || ' + ' || mz.otros END AS producto,
             CASE WHEN mz.otros IS NULL THEN a.dosis_ml END AS dosis_ml, (mz.otros IS NOT NULL) AS mezclada,
             a.precio, a.cobro_id,
             c.registrado_at AS cobrada_at, ec.name AS cobrada_por, c.registrado_por AS cobrada_por_id,
             ev.name AS vendedor, ev.id AS vendedor_id,
             a.aplicada_at, ea.name AS aplicada_por, a.aplicada_por AS aplicada_por_id, a.aplicada_branch_id, ba.name AS aplicada_en,
             (a.vinculada_por IS NOT NULL) AS asignada_a_mano,
             CASE WHEN a.aplicada_at IS NULL THEN 'PENDIENTE' ELSE 'APLICADA' END AS estado
      FROM inyeccion_aplicaciones a
      JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
      JOIN branches b ON b.id = a.branch_id
      LEFT JOIN branches ba ON ba.id = a.aplicada_branch_id
      LEFT JOIN sales_invoices si ON si.id = a.invoice_id
      LEFT JOIN branches bv ON bv.id = si.branch_id
      LEFT JOIN employees ec ON ec.id = c.registrado_por
      LEFT JOIN employees ea ON ea.id = a.aplicada_por
      LEFT JOIN LATERAL (
        SELECT e.id, e.name FROM employees e
         WHERE si.cod_vendedor IS NOT NULL AND e.code = si.cod_vendedor
         ORDER BY e.id LIMIT 1
      ) ev ON true
      LEFT JOIN LATERAL (
        SELECT string_agg(m.producto || coalesce(' ' || trim_scale(m.dosis_ml) || ' ml', ''), ' + ' ORDER BY m.id) AS otros
        FROM inyeccion_aplicaciones m WHERE m.mezcla_de = a.id
      ) mz ON true
      WHERE a.confirmada
        AND a.mezcla_de IS NULL
        AND (p_desde IS NULL OR c.fecha >= p_desde)
        AND (p_hasta IS NULL OR c.fecha <= p_hasta)
        AND (p_branch_id IS NULL OR a.branch_id = p_branch_id OR a.aplicada_branch_id = p_branch_id)
        -- Cada filtro se tiene que cumplir: no existe ninguno que falle.
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_filtros) f,
            LATERAL (SELECT '%' || (f->>'texto') || '%' AS pat,
                            translate(upper(coalesce(a.cliente, si.cliente, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') AS t_cliente,
                            translate(upper(a.producto || ' ' || coalesce(mz.otros, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') AS t_med,
                            translate(upper(coalesce(ec.name, '') || ' ' || coalesce(ev.name, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') AS t_vend,
                            coalesce(si.correlativo, '') AS t_fact) t
           WHERE NOT CASE f->>'campo'
             WHEN 'cliente'     THEN t.t_cliente LIKE t.pat
             WHEN 'medicamento' THEN t.t_med LIKE t.pat
             WHEN 'vendedor'    THEN t.t_vend LIKE t.pat
             WHEN 'factura'     THEN t.t_fact LIKE t.pat
             ELSE t.t_cliente LIKE t.pat OR t.t_med LIKE t.pat OR t.t_vend LIKE t.pat OR t.t_fact LIKE t.pat
           END
        )
    ), sel AS (
      SELECT * FROM base WHERE v_estado IS NULL OR estado = v_estado
    )
    SELECT json_build_object(
      'total', (SELECT count(*) FROM base),
      'aplicadas', (SELECT count(*) FROM base WHERE estado = 'APLICADA'),
      'monto', (SELECT coalesce(sum(precio), 0) FROM base),
      'total_filtrado', (SELECT count(*) FROM sel),
      'desde', (SELECT min(cobrada_at)::date FROM base),
      'filas', coalesce((
        SELECT json_agg(to_json(x) ORDER BY x.cobrada_at DESC, x.id DESC)
        FROM (SELECT * FROM sel ORDER BY cobrada_at DESC, id DESC LIMIT v_limite OFFSET v_offset) x
      ), '[]'::json)
    )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.inyecciones_bitacora_buscar(integer, date, date, jsonb, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyecciones_bitacora_buscar(integer, date, date, jsonb, text, integer, integer) TO authenticated, service_role;
