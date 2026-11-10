-- Dos pedidos del usuario (2026-11-10):
--
-- 1. «Compró en 3 salas o más» NO lo ve la jefatura, sólo supervisión: se
--    deshace lo de 20261110215511 en el panel y en la policy (vuelven a la
--    forma de 20261110212527).
-- 2. Los avisos de reservas y encargos (confirmaciones, cambios de fecha,
--    prórrogas, cancelaciones, pagos) no van a la administración: «que no me
--    lleguen a mí ni a admin, sólo a las salas / personas involucradas».
--    `destinatarios_de_reservas` sumaba a TODO el que tuviera Reservas con
--    alcance de red, que son los cuatro cargos de admin además de Bodega.
--    Ahora: la sala de la reserva (o quien la cubre hoy) y Bodega, que es
--    quien consigue y confirma. Las «Devolución en efectivo por autorizar» no
--    usan esta función: van a quien puede autorizarla, que sí es parte.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.destinatarios_de_reservas(p_branch_id bigint)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT array_agg(DISTINCT e.id)
    FROM public.employees e
    JOIN public.role_permissions rp
      ON rp.role_id = ANY (public.roles_efectivos_de(e.id))
     AND rp.module_key = 'reservas'
     AND (rp.can_view OR rp.can_edit)
   WHERE e.status = 'ACTIVO'
     AND (coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = p_branch_id
          -- De los que ven toda la red, sólo Bodega (2026-11-10): la
          -- administración no recibe cada movimiento de una reserva.
          OR (rp.scope = 'ALL'
              AND coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint)
                  IN (SELECT b.id FROM public.branches b WHERE b.type = 'BODEGA')));
$function$;

CREATE OR REPLACE FUNCTION public.puntos_panel_avisos()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json; v_todas boolean; v_sala integer;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver los avisos de puntos.' USING ERRCODE = '42501';
  END IF;
  -- Alcance (2026-11-10): ALL ve todas las salas; la jefatura (BRANCH), sólo
  -- la suya. Un aviso sin sala no se le muestra a quien no ve todas.
  v_todas := public.auth_module_scope('puntos_tab_avisos') = 'ALL';
  v_sala  := public.auth_employee_branch_id();

  -- Quién vendió y cómo quedó la venta (2026-10-01): se agrega UNA vez sobre
  -- la unión, desde la factura del aviso. El vendedor sale de
  -- `cod_vendedor` → `employees.code` (único, medido: 0 duplicados).
  SELECT coalesce(json_agg(y ORDER BY y.cuando DESC), '[]'::json) INTO v FROM (
  SELECT x.tipo, x.cuando, x.customer_id, x.cliente, x.sala, x.documento, x.invoice_id,
         x.puntos, x.faltaron,
         -- El canje sin saldo dice qué pasó y cuál es el error, con el MISMO
         -- texto de la notificación (2026-11-10).
         CASE WHEN x.tipo = 'canje_sin_saldo' AND x.pedidos IS NOT NULL
              THEN public.puntos_aviso_sin_saldo_texto(x.invoice_id, x.pedidos, x.tenia)->>'cuerpo'
              ELSE x.nota END AS nota,
         x.quien_id, x.quien, x.pedidos, x.tenia, x.descuento,
         ven.id AS vendedor_id, coalesce(ven.name, vs.cod_vendedor) AS vendedor,
         vs.fecha AS venta_fecha, vs.hora AS venta_hora, vs.total AS venta_total,
         vs.estado AS venta_estado, public.venta_valida(vs.estado) AS venta_vigente
    FROM (
    SELECT z.*,
           z.puntos + z.faltaron AS pedidos, z.puntos AS tenia,
           coalesce(z.monto, (z.puntos + z.faltaron) / 100.0) AS descuento
      FROM (
      SELECT 'canje_sin_saldo' AS tipo, s.created_at AS cuando, s.customer_id, c.name AS cliente,
             coalesce(b.name, s.sucursal) AS sala, si.correlativo AS documento, si.id AS invoice_id,
             s.puntos AS puntos,
             nullif(substring(s.motivo FROM 'faltaron ([0-9]+) puntos'), '')::int AS faltaron,
             NULL::text AS nota, NULL::uuid AS quien_id, NULL::text AS quien, b.id AS branch_id, s.monto
        FROM public.puntos_salida s
        JOIN public.customers c ON c.id = s.customer_id
        LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
        LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
       WHERE s.tipo = 'canje' AND s.invoice_id IS NOT NULL AND s.motivo LIKE '%faltaron%'
         AND s.created_at >= now() - interval '60 days'
      ) z
    UNION ALL
    SELECT 'anulada_con_puntos_gastados', g.created_at, g.customer_id, c.name,
           coalesce(b.name, g.sucursal), si.correlativo, si.id,
           g.no_recuperados, g.no_recuperados, NULL, NULL, NULL, b.id, NULL, NULL::int, NULL::int, NULL::numeric
      FROM public.puntos_anulacion_gastada g
      JOIN public.sales_invoices si ON si.id = g.invoice_id
      LEFT JOIN public.customers c ON c.id = g.customer_id
      LEFT JOIN public.branches b ON b.codigo_puntos = g.sucursal
     WHERE g.created_at >= now() - interval '60 days'
    UNION ALL
    -- Regla del usuario (2026-09-28): un canje no puede dejar la venta en $0.00.
    SELECT 'canje_venta_en_cero', s.created_at, s.customer_id, c.name,
           coalesce(b.name, s.sucursal), si.correlativo, si.id,
           s.puntos, NULL::int, NULL, NULL, NULL, b.id, NULL, NULL, NULL, NULL
      FROM public.puntos_salida s
      JOIN public.sales_invoices si ON si.id = s.invoice_id
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.revertida_at IS NULL AND si.total < public.puntos_minimo_a_pagar(si.fecha)
       AND s.created_at >= now() - interval '60 days'
    UNION ALL
    SELECT 'canje_devuelto', s.revertida_at, s.customer_id, c.name,
           coalesce(b.name, s.sucursal), si.correlativo, si.id,
           s.puntos, NULL::int, NULL, NULL, NULL, b.id, NULL, NULL, NULL, NULL
      FROM public.puntos_salida s
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.revertida_at >= now() - interval '60 days'
    UNION ALL
    -- Movimientos fuera de lo normal (2026-10-01). Incluye el canje hecho con
    -- saldo 0, que no deja salida en el libro: «faltaron» y «tenia» viajan en
    -- `detalle`, y `puntos` es lo que aplicó la caja.
    SELECT i.tipo, i.created_at, i.customer_id, c.name,
           coalesce(b.name, i.sucursal), si.correlativo, i.invoice_id,
           i.puntos, (i.detalle->>'faltaron')::int, i.nota, i.employee_id, e.name, b.id, NULL,
           CASE WHEN i.tipo = 'canje_sin_saldo' THEN i.puntos END,
           CASE WHEN i.tipo = 'canje_sin_saldo' THEN coalesce((i.detalle->>'tenia')::int, 0) END,
           CASE WHEN i.tipo = 'canje_sin_saldo' THEN i.puntos / 100.0 END
      FROM public.puntos_irregularidad i
      LEFT JOIN public.customers c ON c.id = i.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = i.invoice_id
      -- Unos avisos guardan el código de la sala (FLS2) y otros su nombre
      -- (Salud 2: mismo vendedor, venta a sí mismo, acumulación alta).
      LEFT JOIN public.branches b ON b.codigo_puntos = i.sucursal OR b.name = i.sucursal
      LEFT JOIN public.employees e ON e.id = i.employee_id
     WHERE i.tipo <> 'anulada_gastada' AND i.created_at >= now() - interval '60 days'
  ) x
    LEFT JOIN public.sales_invoices vs ON vs.id = x.invoice_id
    LEFT JOIN public.employees ven ON ven.code = vs.cod_vendedor
   WHERE NOT (x.tipo = 'canje_sin_saldo' AND vs.id IS NOT NULL
              AND NOT public.venta_valida(vs.estado))
     AND (v_todas OR (v_sala IS NOT NULL AND coalesce(x.branch_id, vs.branch_id) = v_sala))
  ) y;
  RETURN v;
END;
$function$;

DROP POLICY IF EXISTS puntos_irregularidad_select ON public.puntos_irregularidad;
CREATE POLICY puntos_irregularidad_select ON public.puntos_irregularidad
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view'))
         AND ((SELECT public.auth_module_scope('puntos_tab_avisos')) = 'ALL'
              OR sucursal IN (SELECT x FROM public.branches b,
                                LATERAL (VALUES (b.codigo_puntos), (b.name)) v(x)
                               WHERE b.id = (SELECT public.auth_employee_branch_id()))));
