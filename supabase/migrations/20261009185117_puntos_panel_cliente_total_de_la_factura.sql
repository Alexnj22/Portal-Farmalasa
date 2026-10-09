-- El detalle de cada movimiento de puntos trae el TOTAL de la factura
-- (2026-10-09). Debajo de «+130» la pantalla mostraba «$1.30» —lo que valen
-- los puntos— y se leía como el monto de la venta, que fue $130.00. Con el
-- total a mano la pantalla dice «Compra de $130.00» y «vale $1.30».
-- Partido de la definición VIVA (pg_get_functiondef); sólo cambia 'total'.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puntos_panel_cliente(p_customer_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_consulta', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para consultar puntos.' USING ERRCODE = '42501';
  END IF;
  SELECT json_build_object(
    'cliente', (SELECT json_build_object('id', c.id, 'nombre', c.name, 'dui', c.dui, 'telefono', c.phone,
                                         'correo', c.email, 'acumula', coalesce(c.acumula_puntos, true))
                  FROM public.customers c WHERE c.id = p_customer_id),
    'cuenta', public.puntos_estado_cuenta(p_customer_id),
    'salas', (SELECT coalesce(json_object_agg(b.codigo_puntos, b.name), '{}'::json)
                FROM public.branches b WHERE b.codigo_puntos IS NOT NULL),
    'cuentas_anteriores', (
      SELECT coalesce(json_agg(json_build_object('id', a.id_cliente, 'como', a.asignada_como,
                                                 'cuando', a.asignada_at, 'nota', a.asignada_nota,
                                                 'saldo_alla', a.puntos) ORDER BY a.id_cliente), '[]'::json)
        FROM public.puntos_archivo_cliente a
        JOIN public.puntos_archivo_carga k ON k.id = a.carga_id AND k.completa
       WHERE a.asignada_a = p_customer_id),
    -- La clave es la misma que arma el detalle: `<tipo>-<id>`. Un canje
    -- devuelto usa la de su canje.
    'detalle', (SELECT coalesce(json_object_agg(d.clave, json_build_object(
                   'documento', d.documento, 'invoice_id', d.invoice_id, 'total', d.total,
                   'quien', d.quien, 'quien_id', d.quien_id, 'rol', d.rol)), '{}'::json)
      FROM (
        SELECT (CASE WHEN l.origen = 'ajuste' THEN 'ajuste'
                     WHEN l.origen = 'cumpleanos' OR l.motivo ILIKE 'cortes%cumple%' THEN 'cumpleanos'
                     ELSE 'compra' END) || '-' || l.id AS clave,
               coalesce(si.correlativo, substring(l.motivo FROM 'ticket ([0-9A-Za-z-]+)'),
                        substring(l.motivo FROM '^(DTE-[0-9]+)')) AS documento,
               si.id AS invoice_id,
               si.total AS total,
               CASE WHEN l.origen = 'ajuste' THEN ea.name
                    WHEN l.origen = 'cumpleanos' OR l.motivo ILIKE 'cortes%cumple%' THEN 'Automático'
                    ELSE ev.name END AS quien,
               CASE WHEN l.origen = 'ajuste' THEN ea.id ELSE ev.id END AS quien_id,
               CASE WHEN l.origen = 'ajuste' THEN 'ajustó'
                    WHEN l.origen = 'cumpleanos' OR l.motivo ILIKE 'cortes%cumple%' THEN NULL
                    ELSE 'vendió' END AS rol
          FROM public.puntos_lote l
          -- Dos búsquedas por índice (id, o el erp_invoice_id único) y no un
          -- OR en el join, que obligaría a recorrer las facturas.
          LEFT JOIN LATERAL (
            SELECT x.* FROM (
              SELECT si2.* FROM public.sales_invoices si2 WHERE si2.id = l.invoice_id
              UNION ALL
              SELECT si3.* FROM public.sales_invoices si3
               WHERE l.invoice_id IS NULL AND l.origen = 'migracion'
                 AND si3.erp_invoice_id = substring(l.motivo FROM 'ticket 0*([0-9]+)')
                 -- Los números de ticket viejos se repiten con los nuevos: se
                 -- exige la misma sala y que la factura sea del mismo día o de
                 -- hasta 90 antes (el cliente presentaba el ticket después).
                 -- Medido: 89% de las compras migradas desde may-2025.
                 AND si3.fecha BETWEEN l.ganado_el - 90 AND l.ganado_el + 1
                 AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = si3.branch_id
                              AND l.sucursal IN (b.codigo_puntos, b.codigo_puntos_previo))
            ) x LIMIT 1) si ON true
          LEFT JOIN LATERAL (SELECT e.id, e.name FROM public.employees e
                              WHERE e.code = si.cod_vendedor LIMIT 1) ev ON true
          LEFT JOIN public.employees ea ON ea.id = l.creado_por
         WHERE l.customer_id = p_customer_id
        UNION ALL
        SELECT s.tipo || '-' || s.id,
               coalesce(si.correlativo, substring(s.motivo FROM 'ticket ([0-9A-Za-z-]+)')),
               si.id,
               si.total,
               CASE WHEN s.tipo = 'ajuste' THEN ea.name
                    WHEN s.tipo IN ('canje', 'anulacion') THEN ev.name END,
               CASE WHEN s.tipo = 'ajuste' THEN ea.id
                    WHEN s.tipo IN ('canje', 'anulacion') THEN ev.id END,
               CASE WHEN s.tipo = 'ajuste' THEN 'ajustó'
                    WHEN s.tipo IN ('canje', 'anulacion') THEN 'vendió' END
          FROM public.puntos_salida s
          LEFT JOIN LATERAL (
            SELECT x.* FROM (
              SELECT si2.* FROM public.sales_invoices si2 WHERE si2.id = s.invoice_id
              UNION ALL
              SELECT si3.* FROM public.sales_invoices si3
               WHERE s.invoice_id IS NULL AND s.tipo = 'canje' AND si3.has_puntos
                 AND si3.erp_invoice_id = substring(s.motivo FROM 'ticket DTE-0*([0-9]+)')
                 AND si3.fecha BETWEEN (s.created_at AT TIME ZONE 'America/El_Salvador')::date - 1
                                   AND (s.created_at AT TIME ZONE 'America/El_Salvador')::date + 1
                 AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = si3.branch_id
                              AND s.sucursal IN (b.codigo_puntos, b.codigo_puntos_previo))
            ) x LIMIT 1) si ON true
          LEFT JOIN LATERAL (SELECT e.id, e.name FROM public.employees e
                              WHERE e.code = si.cod_vendedor LIMIT 1) ev ON true
          LEFT JOIN public.employees ea ON ea.id = s.autorizado_por
         WHERE s.customer_id = p_customer_id
      ) d)
  ) INTO v;
  RETURN v;
END;
$function$;
