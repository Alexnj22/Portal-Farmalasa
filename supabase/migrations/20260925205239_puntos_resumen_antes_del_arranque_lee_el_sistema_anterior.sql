SET lock_timeout = '5s';

-- La vista «Puntos» salía en CERO antes del arranque, y el usuario lo leyó como
-- que no daba información (2026-09-25): el resumen sólo miraba el libro del
-- portal, que está vacío hasta el 1-oct. El aviso lo decía, pero una pantalla
-- de ceros no sirve para nada durante los días en que alguien la abre para ver
-- cómo va el programa.
--
-- Hasta que el libro mande (`puntos_config.fuente <> 'portal'`), las cifras
-- salen del sistema que HOY es la verdad, cada una de su mejor fuente:
--   · puntos de los clientes  → la última copia completa del sistema anterior
--                               (con su fecha: es una foto, no el saldo vivo)
--   · ganados hoy / en el mes → las ventas que el puente mandó con puntos
--                               (`puntos_enviados` pendiente o acumulado)
--   · canjeados               → las ventas con descuento de puntos
--                               (`has_puntos`), convertidas a puntos
--   · vencimientos            → todo lo anterior al 1-oct vence el 1-oct-2027
-- `origen` le dice a la pantalla cuál de las dos lecturas está mostrando.
CREATE OR REPLACE FUNCTION public.puntos_panel_resumen()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v json; v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
        v_mes date := date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador'))::date;
        v_carga record;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver Puntos.' USING ERRCODE = '42501';
  END IF;

  -- ── Antes del arranque: el sistema anterior ───────────────────────────────
  IF public.puntos_fuente() <> 'portal' THEN
    SELECT id, terminada_at INTO v_carga FROM public.puntos_archivo_carga
     WHERE completa ORDER BY id DESC LIMIT 1;

    WITH ganadas AS (
      SELECT pe.fecha, pe.sucursal, floor(pe.total)::int AS puntos
        FROM public.puntos_enviados pe
       WHERE pe.fecha >= v_mes AND pe.estado_puntos IN ('pendiente', 'acumulado')
    ),
    canjes AS (
      SELECT si.fecha, b.codigo_puntos AS sucursal,
             greatest(round(((SELECT coalesce(sum(ii.total_linea), 0) FROM public.sales_invoice_items ii
                               WHERE ii.invoice_id = si.id) - si.total - coalesce(si.retencion, 0)) * 100), 0)::int AS puntos
        FROM public.sales_invoices si
        JOIN public.branches b ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
        LEFT JOIN public.customers cu ON cu.id = si.customer_id
       WHERE si.fecha >= v_mes AND si.has_puntos AND si.estado = 'FINALIZADA'
         AND coalesce(cu.acumula_puntos, true)
    )
    SELECT json_build_object(
      'hoy', v_hoy,
      'origen', 'sistema_anterior',
      'copia_al', v_carga.terminada_at,
      'config', (SELECT json_build_object('fuente', fuente, 'encendido', acumulacion_activa,
                                          'inicio', inicio, 'minimo_canje', minimo_canje)
                   FROM public.puntos_config WHERE id),
      'arranque', (SELECT json_build_object('ok', ok, 'encendido', encendido, 'simulado', simulado,
                                            'cuando', created_at, 'error', resultado->>'error',
                                            'cuentas', resultado->'cuadre'->'cuentas')
                     FROM public.puntos_arranque ORDER BY id DESC LIMIT 1),
      'libro', (SELECT json_build_object('cuentas_con_saldo', count(*) FILTER (WHERE puntos > 0),
                                         'puntos', coalesce(sum(puntos) FILTER (WHERE puntos > 0), 0))
                  FROM public.puntos_archivo_cliente WHERE carga_id = v_carga.id),
      'ultima_acumulacion', (SELECT max(enviado_at) FROM public.puntos_enviados
                              WHERE fecha >= v_hoy - 3 AND estado_puntos IN ('pendiente', 'acumulado')),
      'periodos', json_build_object(
        'hoy', json_build_object(
          'acumulado', (SELECT coalesce(sum(puntos), 0) FROM ganadas WHERE fecha >= v_hoy),
          'ventas',    (SELECT count(*) FROM ganadas WHERE fecha >= v_hoy),
          'canjeado',  (SELECT coalesce(sum(puntos), 0) FROM canjes WHERE fecha >= v_hoy),
          'canjes',    (SELECT count(*) FROM canjes WHERE fecha >= v_hoy),
          'devuelto',  0),
        'mes', json_build_object(
          'acumulado', (SELECT coalesce(sum(puntos), 0) FROM ganadas),
          'ventas',    (SELECT count(*) FROM ganadas),
          'canjeado',  (SELECT coalesce(sum(puntos), 0) FROM canjes),
          'canjes',    (SELECT count(*) FROM canjes),
          'devuelto',  0)),
      'por_sala', (
        SELECT coalesce(json_agg(x ORDER BY x.acumulado DESC), '[]'::json) FROM (
          SELECT coalesce(b.name, s.sucursal) AS sala, s.sucursal,
                 sum(s.acumulado)::bigint AS acumulado, sum(s.canjeado)::bigint AS canjeado
            FROM (SELECT sucursal, puntos AS acumulado, 0 AS canjeado FROM ganadas
                  UNION ALL
                  SELECT sucursal, 0, puntos FROM canjes) s
            LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
           GROUP BY 1, 2) x),
      'vencimientos', (
        SELECT coalesce(json_agg(x), '[]'::json) FROM (
          SELECT DATE '2027-10-01' AS mes, sum(puntos)::bigint AS puntos, count(*) AS clientes
            FROM public.puntos_archivo_cliente WHERE carga_id = v_carga.id AND puntos > 0
          HAVING count(*) > 0) x),
      'pendientes', (
        SELECT json_build_object('cuentas', count(*), 'puntos', coalesce(sum(saldo), 0))
          FROM public.puntos_cuentas_pendientes
         WHERE motivo <> 'tiene ficha: pasa sola en la migración')
    ) INTO v;
    RETURN v;
  END IF;

  -- ── Desde el arranque: el libro del portal ────────────────────────────────
  SELECT json_build_object(
    'hoy', v_hoy,
    'origen', 'portal',
    'config', (SELECT json_build_object('fuente', fuente, 'encendido', acumulacion_activa,
                                        'inicio', inicio, 'minimo_canje', minimo_canje)
                 FROM public.puntos_config WHERE id),
    'arranque', (SELECT json_build_object('ok', ok, 'encendido', encendido, 'simulado', simulado,
                                          'cuando', created_at, 'error', resultado->>'error',
                                          'cuentas', resultado->'cuadre'->'cuentas')
                   FROM public.puntos_arranque ORDER BY id DESC LIMIT 1),
    'libro', (SELECT json_build_object('cuentas_con_saldo', count(*) FILTER (WHERE saldo > 0),
                                       'puntos', coalesce(sum(saldo), 0))
                FROM public.puntos_cuenta),
    'ultima_acumulacion', (SELECT max(created_at) FROM public.puntos_lote WHERE origen = 'venta'),
    'periodos', (
      SELECT json_object_agg(p.nombre, json_build_object(
        'acumulado', (SELECT coalesce(sum(puntos), 0) FROM public.puntos_lote
                       WHERE origen = 'venta' AND ganado_el >= p.desde),
        'ventas',    (SELECT count(*) FROM public.puntos_lote
                       WHERE origen = 'venta' AND ganado_el >= p.desde),
        'canjeado',  (SELECT coalesce(sum(puntos), 0) FROM public.puntos_salida
                       WHERE tipo = 'canje' AND invoice_id IS NOT NULL
                         AND (created_at AT TIME ZONE 'America/El_Salvador')::date >= p.desde),
        'canjes',    (SELECT count(*) FROM public.puntos_salida
                       WHERE tipo = 'canje' AND invoice_id IS NOT NULL
                         AND (created_at AT TIME ZONE 'America/El_Salvador')::date >= p.desde),
        'devuelto',  (SELECT coalesce(sum(puntos), 0) FROM public.puntos_salida
                       WHERE tipo = 'anulacion'
                         AND (created_at AT TIME ZONE 'America/El_Salvador')::date >= p.desde)))
        FROM (VALUES ('hoy', v_hoy), ('mes', v_mes)) p(nombre, desde)),
    'por_sala', (
      SELECT coalesce(json_agg(x ORDER BY x.acumulado DESC), '[]'::json) FROM (
        SELECT coalesce(b.name, s.sucursal) AS sala, s.sucursal,
               sum(s.acumulado)::bigint AS acumulado, sum(s.canjeado)::bigint AS canjeado
          FROM (
            SELECT sucursal, puntos AS acumulado, 0 AS canjeado FROM public.puntos_lote
             WHERE origen = 'venta' AND ganado_el >= v_mes
            UNION ALL
            SELECT sucursal, 0, puntos FROM public.puntos_salida
             WHERE tipo = 'canje' AND invoice_id IS NOT NULL
               AND (created_at AT TIME ZONE 'America/El_Salvador')::date >= v_mes
          ) s
          LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
         GROUP BY 1, 2) x),
    'vencimientos', (
      SELECT coalesce(json_agg(x ORDER BY x.mes), '[]'::json) FROM (
        SELECT date_trunc('month', vence_el)::date AS mes, sum(restantes)::bigint AS puntos,
               count(DISTINCT customer_id) AS clientes
          FROM public.puntos_lote WHERE restantes > 0
         GROUP BY 1) x),
    'pendientes', (
      SELECT json_build_object('cuentas', count(*), 'puntos', coalesce(sum(saldo), 0))
        FROM public.puntos_cuentas_pendientes
       WHERE motivo <> 'tiene ficha: pasa sola en la migración')
  ) INTO v;
  RETURN v;
END;
$$;
