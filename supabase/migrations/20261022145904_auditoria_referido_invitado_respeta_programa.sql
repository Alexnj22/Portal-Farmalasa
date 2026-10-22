SET lock_timeout = '5s';

-- Auditoría 2026-10-21 · grupo 5 · H8. El invitado recibía los 50 puntos de
-- bienvenida sin mirar si su ficha está en el programa: acumula_puntos y
-- acepta_programa_puntos se miraban sólo para quien invita. Ahora se aplica la
-- MISMA condición al invitado. El referido se sigue marcando 'premiado' (la
-- compra existió y quien invita conserva su premio). `motivo` NO se toca a
-- propósito: el tope de 10 por mes cuenta las filas con motivo IS NULL, y
-- anotar ahí al invitado haría que dejara de contar para quien invita.
-- Partido de la definición viva (md5 prosrc 570ac422b21e8a148cfe3e6baafab3b4).
CREATE OR REPLACE FUNCTION public.puntos_premiar_referidos(p_simular boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c_pts      constant integer := 50;
  c_minimo   constant numeric := 10;
  c_tope_mes constant integer := 10;
  c_dias     constant integer := 120;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  r record; f record;
  v_premiados int := 0; v_rechazados int := 0; v_vencidos int := 0;
  v_invitado_en_programa boolean;
BEGIN
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('omitido', 'el programa todavía no funciona en el portal');
  END IF;

  IF NOT p_simular THEN
    UPDATE public.app_cliente_referidos rf
       SET invitado_id = p.customer_id
      FROM public.app_cliente_preregistros p
     WHERE rf.estado = 'pendiente' AND rf.invitado_id IS NULL
       AND p.id = rf.preregistro_id AND p.customer_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.app_cliente_referidos o WHERE o.invitado_id = p.customer_id);
  END IF;

  FOR r IN
    SELECT * FROM public.app_cliente_referidos WHERE estado = 'pendiente' ORDER BY id FOR UPDATE SKIP LOCKED
  LOOP
    IF r.created_at < now() - make_interval(days => c_dias) THEN
      v_vencidos := v_vencidos + 1;
      IF NOT p_simular THEN
        UPDATE public.app_cliente_referidos SET estado = 'vencido', motivo = 'sin compra en ' || c_dias || ' días' WHERE id = r.id;
      END IF;
      CONTINUE;
    END IF;
    CONTINUE WHEN r.invitado_id IS NULL;

    IF EXISTS (SELECT 1 FROM public.sales_invoices si
                WHERE si.customer_id = r.invitado_id AND public.venta_valida(si.estado)
                  AND si.fecha < (r.created_at AT TIME ZONE 'America/El_Salvador')::date)
       OR r.invitado_id = r.referidor_id THEN
      v_rechazados := v_rechazados + 1;
      IF NOT p_simular THEN
        UPDATE public.app_cliente_referidos SET estado = 'rechazado',
               motivo = CASE WHEN r.invitado_id = r.referidor_id THEN 'se invitó a sí mismo' ELSE 'ya era cliente' END
         WHERE id = r.id;
      END IF;
      CONTINUE;
    END IF;

    SELECT si.id, si.fecha INTO f
      FROM public.sales_invoices si
     WHERE si.customer_id = r.invitado_id AND public.venta_valida(si.estado)
       AND si.fecha >= (r.created_at AT TIME ZONE 'America/El_Salvador')::date
       AND si.total >= c_minimo
     ORDER BY si.fecha, si.id LIMIT 1;
    CONTINUE WHEN NOT FOUND;

    v_premiados := v_premiados + 1;
    CONTINUE WHEN p_simular;

    -- H8: la misma regla que para quien invita. Sin esto, una ficha marcada
    -- acumula_puntos=false (personal) o sin consentimiento cobraba la bienvenida.
    v_invitado_en_programa := EXISTS (
      SELECT 1 FROM public.customers c WHERE c.id = r.invitado_id
         AND coalesce(c.acumula_puntos, true) AND c.acepta_programa_puntos IS DISTINCT FROM false);

    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.invitado_id), (r.referidor_id) ON CONFLICT (customer_id) DO NOTHING;
    IF v_invitado_en_programa THEN
      INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
      VALUES (r.invitado_id, 'referido', c_pts, c_pts, v_hoy, public.puntos_vence_el(v_hoy), 'Bienvenida por invitación');
      UPDATE public.puntos_cuenta SET saldo = saldo + c_pts, ganados = ganados + c_pts, updated_at = now()
       WHERE customer_id = r.invitado_id;
    END IF;

    IF (SELECT count(*) FROM public.app_cliente_referidos
         WHERE referidor_id = r.referidor_id AND estado = 'premiado' AND motivo IS NULL
           AND premiado_at >= date_trunc('month', now() AT TIME ZONE 'America/El_Salvador') AT TIME ZONE 'America/El_Salvador') < c_tope_mes
       AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = r.referidor_id
                     AND coalesce(c.acumula_puntos, true) AND c.acepta_programa_puntos IS DISTINCT FROM false) THEN
      INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
      VALUES (r.referidor_id, 'referido', c_pts, c_pts, v_hoy, public.puntos_vence_el(v_hoy), 'Invitaste a un amigo');
      UPDATE public.puntos_cuenta SET saldo = saldo + c_pts, ganados = ganados + c_pts, updated_at = now()
       WHERE customer_id = r.referidor_id;
      UPDATE public.app_cliente_referidos SET estado = 'premiado', premiado_at = now(), invoice_id = f.id WHERE id = r.id;
    ELSE
      UPDATE public.app_cliente_referidos SET estado = 'premiado', premiado_at = now(), invoice_id = f.id,
             motivo = 'quien invita llegó al tope del mes o no está en el programa' WHERE id = r.id;
    END IF;
  END LOOP;

  RETURN json_build_object('simulado', p_simular, 'premiados', v_premiados, 'rechazados', v_rechazados, 'vencidos', v_vencidos);
END;
$function$;
