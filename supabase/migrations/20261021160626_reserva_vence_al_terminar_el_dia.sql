-- El plazo para retirar una reserva lista cuenta el DÍA ENTERO en que vence
-- (2026-10-20, regla del dueño: «para retirar, la hora no, cuenta todo el día»).
-- Antes vencía a la hora exacta de `vence_at`; ahora cuando termina ese día en
-- El Salvador. Sólo cambia la última condición del WHERE; el resto es la
-- definición viva (md5 b413011a880bf203040a051535236a28).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reservas_vencer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ids bigint[];
BEGIN
  WITH v AS (
    UPDATE public.app_reservas
       SET estado = 'vencida', cerrada_at = now(), updated_at = now(),
           vencida_motivo = CASE
             WHEN estado = 'en_revision' AND receta_estado = 'pendiente' THEN 'receta_sin_revisar'
             WHEN estado = 'en_revision' THEN 'sin_receta'
             WHEN estado = 'lista' THEN 'sin_retirar'
             WHEN origen = 'app' AND coalesce(pendiente_at, created_at) < now() - interval '48 hours' THEN 'sin_preparar'
             ELSE 'oferta_terminada' END,
           saldo_favor = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL THEN anticipo ELSE saldo_favor END,
           saldo_favor_vence = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL THEN v_hoy + public.saldo_favor_dias() ELSE saldo_favor_vence END,
           saldo_favor_origen = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL THEN 'anticipo' ELSE saldo_favor_origen END
     WHERE (estado = 'en_revision' AND coalesce(receta_estado, 'otra_foto') = 'otra_foto'
            AND greatest(created_at, coalesce(receta_revisada_at, created_at)) < now() - interval '24 hours')
        OR (estado = 'en_revision' AND receta_estado = 'pendiente' AND receta_subida_at < now() - interval '48 hours')
        OR (estado = 'pendiente' AND origen = 'app' AND coalesce(pendiente_at, created_at) < now() - interval '48 hours')
        OR (estado = 'pendiente' AND pago_estado <> 'pagado' AND oferta_fin IS NOT NULL AND oferta_fin < v_hoy)
        -- Vence cuando TERMINA el día de `vence_at` en El Salvador, no a su hora.
        OR (estado = 'lista' AND (vence_at AT TIME ZONE 'America/El_Salvador')::date < v_hoy)
    RETURNING id)
  SELECT array_agg(id) INTO v_ids FROM v;
  IF v_ids IS NULL THEN RETURN 0; END IF;

  -- Un aviso por pedido (o reserva suelta) de la app.
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  SELECT g.customer_id, 'reserva', 'base:vencida:' || g.grupo,
         CASE g.motivo WHEN 'sin_receta' THEN 'Tu reserva venció sin la foto de la receta'
                       WHEN 'receta_sin_revisar' THEN 'Tu reserva venció'
                       WHEN 'sin_preparar' THEN 'Tu reserva venció'
                       WHEN 'oferta_terminada' THEN 'Tu reserva venció'
                       ELSE 'Tu reserva venció sin retirar' END,
         CASE g.motivo WHEN 'sin_receta' THEN 'No recibimos la foto de tu receta a tiempo. Puedes volver a reservar cuando quieras.'
                       WHEN 'receta_sin_revisar' THEN 'La sucursal no alcanzó a revisar tu receta a tiempo. Disculpa: puedes volver a reservar y no cuenta en tu contra.'
                       WHEN 'sin_preparar' THEN 'La sucursal no alcanzó a preparar tu pedido a tiempo. Disculpa: puedes volver a reservar y no cuenta en tu contra.'
                       WHEN 'oferta_terminada' THEN 'La oferta terminó antes de que se preparara.'
                       ELSE 'Se cumplió el plazo para retirarla.' END
           || CASE WHEN g.saldo > 0 THEN ' Te quedaron $' || to_char(g.saldo, 'FM999990.00') || ' a favor para otra compra en cualquier sucursal.' ELSE '' END,
         '/reservas'
    FROM (SELECT customer_id, coalesce(pedido, id::text) AS grupo, min(vencida_motivo) AS motivo,
                 coalesce(sum(saldo_favor), 0) AS saldo
            FROM public.app_reservas
           WHERE id = ANY (v_ids) AND origen = 'app'
           GROUP BY 1, 2) g
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;

  RETURN array_length(v_ids, 1);
END;
$function$;
