SET lock_timeout = '5s';

-- ═══ Puntos: vence EXACTAMENTE el lote vencido (2026-10-19) ═════════════════
-- Hallazgo de la auditoría de niveles (2026-10-19). `puntos_vencer_lotes`
-- sumaba lo vencido por cliente y lo descontaba con `puntos_consumir`, que
-- recorre los lotes por `ganado_el` (FIFO). La suposición escrita al lado —«los
-- que vencen son los más viejos»— no vale para el cupón del mes: vence a fin
-- de mes, mucho ANTES que compras ganadas antes que él (que vencen a los 12
-- meses, o el 2027-10-01 las previas al arranque).
--
-- Con un cupón vencido y una compra vieja viva, FIFO restaba de la COMPRA: el
-- cupón quedaba con `restantes > 0` y `vence_el` pasado, así que al día
-- siguiente volvía a «vencer» y volvía a quemar otro lote ajeno. Cada día.
-- Medido en prod el 2026-10-19: 0 salidas de vencimiento todavía (ningún lote
-- había llegado a su fecha), o sea que se corrige antes del primer daño.
-- Reproducido en el entorno de pruebas con tres lotes (compra 300 viva, cupón
-- 200 y cumpleaños 50 vencidos): la versión vieja dejó la compra en 0 y el
-- cupón en 100 tras dos corridas (450 puntos quemados por 250 vencidos); esta
-- deja la compra en 300, el cupón y el cumpleaños en 0, y la segunda corrida
-- no resta nada.
--
-- Ahora: se bloquean los lotes vencidos del cliente, se lleva cada uno a 0
-- (sus `restantes`, ni un punto más) y se anota en `puntos_salida_lote` cuál
-- salió de cuál. Idempotente: un lote vencido en 0 ya no entra en el filtro, y
-- correrlo dos veces el mismo día no resta nada la segunda.
CREATE OR REPLACE FUNCTION public.puntos_vencer_lotes(p_al_dia date DEFAULT CURRENT_DATE, p_simular boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record; v_salida bigint; v_vencen integer;
  v_clientes integer := 0; v_puntos bigint := 0;
BEGIN
  FOR r IN
    SELECT customer_id, sum(restantes)::integer AS puntos
    FROM public.puntos_lote
    WHERE restantes > 0 AND vence_el <= p_al_dia
    GROUP BY customer_id
    ORDER BY customer_id
  LOOP
    IF p_simular THEN
      v_clientes := v_clientes + 1;
      v_puntos   := v_puntos + r.puntos;
      CONTINUE;
    END IF;

    -- Los lotes vencidos de ESTE cliente, bloqueados: un canje simultáneo
    -- espera, y lo que se suma después del bloqueo es lo que de verdad queda
    -- (un canje que entró entre la lista de arriba y este punto ya restó).
    PERFORM 1 FROM public.puntos_lote
     WHERE customer_id = r.customer_id AND restantes > 0 AND vence_el <= p_al_dia
     FOR UPDATE;
    SELECT coalesce(sum(restantes), 0)::integer INTO v_vencen FROM public.puntos_lote
     WHERE customer_id = r.customer_id AND restantes > 0 AND vence_el <= p_al_dia;
    CONTINUE WHEN v_vencen <= 0;

    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, motivo)
    VALUES (r.customer_id, 'vencimiento', v_vencen, format('vencieron al %s', p_al_dia))
    RETURNING id INTO v_salida;

    -- De cada lote vencido sale exactamente lo que le quedaba.
    INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos)
    SELECT v_salida, l.id, l.restantes FROM public.puntos_lote l
     WHERE l.customer_id = r.customer_id AND l.restantes > 0 AND l.vence_el <= p_al_dia
    ON CONFLICT (salida_id, lote_id) DO UPDATE SET puntos = puntos_salida_lote.puntos + EXCLUDED.puntos;
    UPDATE public.puntos_lote SET restantes = 0
     WHERE customer_id = r.customer_id AND restantes > 0 AND vence_el <= p_al_dia;

    UPDATE public.puntos_cuenta
       SET saldo = saldo - v_vencen, usados = usados + v_vencen, updated_at = now()
     WHERE customer_id = r.customer_id;

    v_clientes := v_clientes + 1;
    v_puntos   := v_puntos + v_vencen;
  END LOOP;

  RETURN json_build_object('simulado', p_simular, 'al_dia', p_al_dia,
                           'clientes', v_clientes, 'puntos', v_puntos);
END;
$function$;
