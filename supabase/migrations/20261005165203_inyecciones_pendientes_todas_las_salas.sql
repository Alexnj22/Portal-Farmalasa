-- Lo pagado y sin aplicar se ve desde TODAS las salas (2026-10-05).
--
-- Reporte del usuario: «si ya está pagado y va de Salud 1 a Salud 2, en Salud 2
-- no aparece que el cliente ya lo tiene». Quien no opera caja ni tiene alcance
-- total quedaba forzado a su sala, y la sala que se comparaba es la del PAGO:
-- el cliente que pagó en Salud 1 era invisible en Salud 2, que es justo donde
-- vino a aplicarse. `p_branch_id` queda como filtro, no como candado.
--
-- Es una LECTURA (cliente, inyección, quién cobró). Aplicar ya cruzaba salas
-- (`inyeccion_aplicar` marca la sala de la caja, no la del pago).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.inyecciones_pendientes(p_buscar text DEFAULT NULL::text, p_branch_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_buscar text := nullif(upper(trim(coalesce(p_buscar, ''))), '');
BEGIN
  IF NOT ((SELECT auth_has_module_permission('caja_vales', 'can_edit'))
          OR (SELECT auth_has_module_permission('inyecciones_tab_pendientes', 'can_view'))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  -- Sin candado por sala, a propósito: el cliente paga en una sucursal y se
  -- aplica en otra. Ver el encabezado de la migración.
  RETURN coalesce((
    SELECT json_agg(x ORDER BY x.pagada_at DESC)
    FROM (
      SELECT a.id, a.branch_id, b.name AS sala, a.origen, a.invoice_id, si.correlativo,
             -- La sala de la VENTA, sólo cuando no es donde se cobró (comprada en otra sucursal).
             CASE WHEN si.branch_id IS DISTINCT FROM a.branch_id THEN bv.name END AS venta_sala,
             coalesce(a.cliente, si.cliente) AS cliente, a.customer_id,
             CASE WHEN mz.otros IS NULL THEN a.producto
                  ELSE a.producto || coalesce(' ' || trim_scale(a.dosis_ml) || ' ml', '') || ' + ' || mz.otros END AS producto,
             CASE WHEN mz.otros IS NULL THEN a.dosis_ml END AS dosis_ml, (mz.otros IS NOT NULL) AS mezclada, a.precio,
             c.registrado_at AS pagada_at, ec.name AS cobrada_por, c.registrado_por AS cobrada_por_id, a.cobro_id,
             -- Lo que YA se aplicó de este mismo pago: dónde, quién y cuándo
             -- (pedido del usuario: «¿la card muestra el historial de cada una?»).
             (SELECT json_agg(json_build_object('aplicada_at', h.aplicada_at, 'aplicada_por', eh.name,
                                                'aplicada_por_id', h.aplicada_por, 'aplicada_en', bh.name)
                              ORDER BY h.aplicada_at)
                FROM inyeccion_aplicaciones h
                LEFT JOIN employees eh ON eh.id = h.aplicada_por
                LEFT JOIN branches bh ON bh.id = h.aplicada_branch_id
               WHERE h.cobro_id = a.cobro_id AND h.mezcla_de IS NULL AND h.aplicada_at IS NOT NULL
                 AND h.producto = a.producto) AS historial
      FROM inyeccion_aplicaciones a
      JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
      JOIN branches b ON b.id = a.branch_id
      LEFT JOIN sales_invoices si ON si.id = a.invoice_id
      LEFT JOIN branches bv ON bv.id = si.branch_id
      LEFT JOIN employees ec ON ec.id = c.registrado_por
      LEFT JOIN LATERAL (
        -- Lo que va mezclado con esta (si es la principal de una mezcla).
        SELECT string_agg(m.producto || coalesce(' ' || trim_scale(m.dosis_ml) || ' ml', ''), ' + ' ORDER BY m.id) AS otros
        FROM inyeccion_aplicaciones m WHERE m.mezcla_de = a.id
      ) mz ON true
      WHERE a.confirmada AND a.aplicada_at IS NULL
        AND a.mezcla_de IS NULL
        AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
        AND (v_buscar IS NULL
             OR upper(coalesce(a.cliente, si.cliente, '')) LIKE '%' || v_buscar || '%'
             OR coalesce(si.correlativo, '') LIKE '%' || v_buscar || '%'
             OR upper(a.producto) LIKE '%' || v_buscar || '%'
             OR upper(coalesce(mz.otros, '')) LIKE '%' || v_buscar || '%')
      ORDER BY c.registrado_at DESC
      LIMIT 200
    ) x
  ), '[]'::json);
END;
$function$;
