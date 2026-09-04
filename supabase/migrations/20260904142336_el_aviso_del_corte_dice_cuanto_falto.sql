SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El aviso del corte dice CUÁNTO faltó.
--
-- Pedido del usuario (2026-09-04): «que a la sala le llegue notificación si
-- tuvo diferencia negativa».
--
-- ── Por qué NO es un aviso nuevo ───────────────────────────────────────────
-- `notificar_corte_de_caja` ya le escribe a la sala por CADA corte tipo C —36
-- el 3-sep entre las seis salas— y decía «hay que revisarlo y confirmarlo»,
-- sin la cifra. Un segundo aviso sobre el mismo corte sería un ping de más
-- para contar algo que el primero ya podía decir, y son justo los pings de más
-- los que enseñan a ignorar la campana. Acá el faltante entra en el TÍTULO del
-- aviso que ya salía: cero avisos nuevos.
--
-- ── El número es el TRAMO, no la diferencia acumulada ──────────────────────
-- Los cortes del día se suman: el de la noche contiene a los de la mañana. La
-- tarjeta muestra `corte.tramo` (`conTramo` en `cortesDiagnostico.js`) y el
-- aviso tiene que nombrar el MISMO número — si no, la campana dice $8.90 y la
-- pantalla $8.45 sobre el corte de las 21:03, y no hay forma de saber cuál es.
-- `corte_tramo` es el gemelo SQL, con la misma base: el último CONFIRMADO
-- anterior del día (un descartado no corre la referencia).
--
-- Medido sobre el 3-sep: de 36 cortes tipo C, cinco quedaron con tramo
-- negativo, así que el título cambia en el corte que lo tuvo y en ninguno más.
--
-- ── El umbral es el de la pantalla, no uno nuevo ───────────────────────────
-- `severidad` (`cortesDiagnostico.js`) llama «falta» a todo tramo <= -0.01, y
-- `seConfirmaDeUnClic` deja pasar de un clic lo que cuadra al centavo. Un
-- umbral propio acá —«avisá sólo desde $1»— haría que la tarjeta pintara
-- «Faltante» sobre un corte del que la campana no dijo nada, y la sala tendría
-- dos fuentes que se contradicen sobre el mismo corte.
--
-- ── El sobrante también se nombra, y el título NO cambia ───────────────────
-- Se pidió el faltante, y es el que se anuncia desde el título. Pero decir la
-- cifra sólo cuando falta dejaría al exceso con el texto genérico de siempre —
-- y un exceso también es un descuadre que hay que mirar. Lleva su cifra en el
-- cuerpo; lo que no lleva es la urgencia del título.
--
-- Un corte SIN CONTEO se queda como estaba: no midió dinero, así que no tiene
-- diferencia que nombrar (`corte_tramo` lo rechaza a propósito, porque
-- devolver `0 - base` sería un faltante inventado del tamaño de la caja del
-- día).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notificar_corte_de_caja()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sala       text;
  v_dest       uuid[];
  v_titulo     text;
  v_cuerpo     text;
  v_sin_conteo boolean;
  v_tramo      numeric;
  v_monto      text;
BEGIN
  -- El cierre del día (Z) no se confirma ni se descarta —lo rechaza
  -- `resolver_corte_caja`—, así que avisarlo sería pedir una acción que no
  -- existe.
  IF NEW.tipo <> 'C' THEN
    RETURN NULL;
  END IF;

  -- Sólo lo recién hecho. El repaso de las 23:40 no reinserta nada (el upsert
  -- ignora duplicados), pero una recarga manual de días pasados sí, y avisarle
  -- a la sala de un corte de la semana pasada es el ruido que enseña a ignorar
  -- la campana. Dos días de ventana y medio día de desfase cubren el corte de
  -- las 23:59, que se captura recién a las 6 del otro día.
  IF NEW.fecha < ((now() AT TIME ZONE 'America/El_Salvador')::date - 1)
     OR coalesce(NEW.desfase_seg, 0) > 43200 THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_sala FROM public.branches WHERE id = NEW.branch_id;

  v_dest := public.destinatarios_de_cortes(NEW.branch_id);
  IF v_dest IS NULL THEN
    RETURN NULL;
  END IF;

  v_sin_conteo := public.corte_no_conto_efectivo(NEW.tipo, NEW.total_declarado,
                                                 NEW.diferencia_erp, NEW.tk_total_caja);

  -- `cobros_portal_efectivo` ya está sellado: lo escribe
  -- `cortes_caja_sella_cobros_portal`, que es BEFORE INSERT. Sin él el tramo
  -- nacería con el efectivo de los cobros del portal contado como sobrante —
  -- que es exactamente el «+$78.40 sobre un faltante de $9.85» del 2-sep.
  IF NOT v_sin_conteo THEN
    v_tramo := public.corte_tramo(NEW.id);
    v_monto := '$' || to_char(abs(v_tramo), 'FM999,999,990.00');
  END IF;

  -- Misma hora que la tarjeta (hh:mm, 24h): el aviso y la pantalla tienen que
  -- nombrar al mismo corte igual.
  v_titulo := CASE
    WHEN v_tramo IS NOT NULL AND v_tramo <= -0.01
      THEN 'Faltan ' || v_monto || ' en el corte de las ' || to_char(NEW.hora, 'HH24:MI')
    ELSE 'Corte de caja de las ' || to_char(NEW.hora, 'HH24:MI')
  END;

  -- Un corte sin conteo no se confirma: pedirlo manda a la sala a buscar un
  -- botón que no está. Lo que corresponde es descartarlo y volver a cortar.
  v_cuerpo := coalesce(v_sala, 'Tu sala') || ' — '
           || CASE
                WHEN v_sin_conteo
                  THEN 'salió sin contar el efectivo. Hay que descartarlo y volver a hacer el corte.'
                WHEN v_tramo <= -0.01
                  THEN 'el efectivo contado quedó ' || v_monto
                       || ' abajo de lo esperado. Hay que revisarlo y confirmarlo.'
                WHEN v_tramo >= 0.01
                  THEN 'el efectivo contado quedó ' || v_monto
                       || ' arriba de lo esperado. Hay que revisarlo y confirmarlo.'
                ELSE 'cuadró al centavo. Hay que confirmarlo.'
              END;

  PERFORM public.notify_employees(
    v_dest,
    'CORTE_NUEVO',
    v_titulo,
    v_cuerpo,
    '/cortes',
    jsonb_build_object(
      'corte_id',  NEW.id,
      'branch_id', NEW.branch_id,
      'fecha',     NEW.fecha,
      'hora',      to_char(NEW.hora, 'HH24:MI'),
      -- El número que se anunció, para que un aviso viejo se pueda cotejar
      -- contra lo que la pantalla muestra hoy. `null` cuando no hubo conteo:
      -- no es cero.
      'tramo',     v_tramo
    ),
    true,            -- push: hay que ir a confirmarlo, no es informativo
    NEW.branch_id
  );

  RETURN NULL;
END;
$function$;
