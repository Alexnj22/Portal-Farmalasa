-- Dos vigías de reservas en una sola corrida cada 15 min (2026-10-21):
--
--  1. El saldo a favor VENCIDO se apaga: lo que quedaba pasa a 0 y queda en el
--     libro (`saldo_favor_movimientos`, tipo 'vencimiento'). Lo que ya se había
--     convertido en puntos vence con su lote (`puntos_vencer_lotes`).
--
--  2. Si la existencia de una sala cae por debajo de lo apartado de un
--     producto (reservas abiertas), se le avisa a la sala
--     (`destinatarios_de_reservas`). Barato a propósito: sólo mira los
--     productos que HOY tienen una reserva abierta —decenas—, por índice, con
--     la misma cuenta que usa la app (`app_existencias_netas`). Nada de
--     disparador sobre `inventory` (tabla caliente: la escriben siete syncs
--     por minuto) ni barrido del inventario entero. Un aviso por sala, producto
--     y día.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reservas_vigilar()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_apagados integer := 0;
  v_avisos integer := 0;
  v_ids integer[];
  v_dest uuid[];
  v_clave text;
  s record;
  x record;
BEGIN
  -- 1 · saldos vencidos
  FOR s IN
    SELECT id, saldo_favor FROM public.app_reservas
     WHERE saldo_favor > 0 AND saldo_favor_usado_at IS NULL AND saldo_favor_devuelto_at IS NULL
       AND saldo_favor_vence < v_hoy
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.app_reservas
       SET saldo_favor_inicial = coalesce(saldo_favor_inicial, saldo_favor), saldo_favor = 0, updated_at = now()
     WHERE id = s.id;
    INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, nota)
    VALUES (s.id, 'vencimiento', s.saldo_favor, 0, 'venció sin usarse');
    v_apagados := v_apagados + 1;
  END LOOP;

  -- 2 · existencia por debajo de lo apartado
  SELECT array_agg(DISTINCT producto_id::int) INTO v_ids
    FROM public.app_reservas
   WHERE estado IN ('en_revision', 'pendiente', 'lista') AND producto_id IS NOT NULL;
  IF v_ids IS NOT NULL THEN
    FOR x IN
      SELECT e.product_id, e.branch_id, e.existencia, e.apartadas,
             (SELECT r.producto_nombre FROM public.app_reservas r
               WHERE r.producto_id = e.product_id AND r.branch_id = e.branch_id
                 AND r.estado IN ('en_revision', 'pendiente', 'lista') ORDER BY r.id LIMIT 1) AS producto,
             (SELECT count(*) FROM public.app_reservas r
               WHERE r.producto_id = e.product_id AND r.branch_id = e.branch_id
                 AND r.estado IN ('en_revision', 'pendiente', 'lista')) AS reservas
        FROM json_to_recordset(public.app_existencias_netas(v_ids))
             AS e(product_id int, branch_id bigint, existencia numeric, apartadas numeric, disponibles numeric)
       WHERE e.apartadas > 0 AND e.existencia < e.apartadas
    LOOP
      v_clave := 'reserva_sin_existencia:' || x.branch_id || ':' || x.product_id || ':' || v_hoy;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
                             WHERE n.metadata ? 'check_key' AND n.metadata->>'check_key' = v_clave);
      v_dest := public.destinatarios_de_reservas(x.branch_id);
      CONTINUE WHEN v_dest IS NULL;
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        'Falta existencia para una reserva',
        coalesce(x.producto, 'Un producto') || ': hay ' || trim(to_char(x.existencia, 'FM999,990'))
          || ' y ' || CASE WHEN x.reservas = 1 THEN 'una reserva aparta ' ELSE x.reservas || ' reservas apartan ' END
          || trim(to_char(x.apartadas, 'FM999,990')) || '. Revísalo antes de que el cliente llegue.',
        '/reservas', jsonb_build_object('check_key', v_clave, 'producto_id', x.product_id,
                                        'existencia', x.existencia, 'apartadas', x.apartadas),
        true, x.branch_id::integer);
      v_avisos := v_avisos + 1;
    END LOOP;
  END IF;

  RETURN json_build_object('saldos_apagados', v_apagados, 'avisos_existencia', v_avisos);
END $function$;
REVOKE EXECUTE ON FUNCTION public.reservas_vigilar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservas_vigilar() TO service_role;

-- 7:00 a 21:45 SV (13–03 UTC): fuera de horario no hay a quién avisar.
SELECT cron.schedule('reservas-vigilar-15min', '*/15 13-23,0-3 * * *', 'SELECT public.reservas_vigilar()');
