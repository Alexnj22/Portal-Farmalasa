SET lock_timeout = '5s';

-- Aviso de corte de caja: sólo cuando el corte NO cuadra (2026-11-14).
--
-- Lo pidió el usuario: el CORTE_NUEVO salía por cada corte a toda la sala
-- (~600 avisos por semana a 20 dependientes, más jefes y regentes). Ahora sale
-- sólo si el corte tiene diferencia según el juez de siempre (`corte_tramo`,
-- que ya resta los cobros del portal en efectivo) o si salió sin contar el
-- efectivo (`corte_no_conto_efectivo`): esos dos piden una acción distinta de
-- «confirmar». El corte que cuadra al centavo se sigue confirmando desde
-- Cortes, y si queda pendiente lo recuerda `avisar_cortes_pendientes` (07:30)
-- y lo frena el cierre del día. Medido en prod: 59 de 149 cortes de la semana
-- cuadraron al centavo. Partido de la definición VIVA; sólo cambia el freno
-- nuevo y el texto del `ELSE`, que ya no se alcanza.

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
  v_quien      text;
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

  v_sin_conteo := public.corte_no_conto_efectivo(NEW.tipo, NEW.total_declarado,
                                                 NEW.diferencia_erp, NEW.tk_total_caja);

  -- `cobros_portal_efectivo` ya está sellado: lo escribe
  -- `cortes_caja_sella_cobros_portal`, que es BEFORE INSERT. Sin él el tramo
  -- nacería con el efectivo de los cobros del portal contado como sobrante —
  -- que es exactamente el «+$78.40 sobre un faltante de $9.85» del 2-sep.
  IF NOT v_sin_conteo THEN
    v_tramo := public.corte_tramo(NEW.id);
    -- 2026-11-14: el corte que cuadró no se avisa (ver el encabezado).
    IF v_tramo IS NOT NULL AND abs(v_tramo) < 0.01 THEN
      RETURN NULL;
    END IF;
    v_monto := '$' || to_char(abs(v_tramo), 'FM999,999,990.00');
  END IF;

  SELECT name INTO v_sala FROM public.branches WHERE id = NEW.branch_id;
  -- Quién hizo el corte, para la tarjeta (23-sep: «falta quien hizo el
  -- corte»). Sólo la ficha ligada: `empleado_texto` es el nombre de la CUENTA
  -- con la que opera la caja, no el de la persona.
  SELECT e.name INTO v_quien FROM public.employees e WHERE e.id = NEW.employee_id;

  v_dest := public.destinatarios_de_cortes(NEW.branch_id);
  IF v_dest IS NULL THEN
    RETURN NULL;
  END IF;

  -- Título neutro (usuario, 23-sep: «siento too much, límpialo»): el monto lo
  -- dibuja la tarjeta a la derecha y lo dice el cuerpo, que es lo que se lee en
  -- el push. La sala va en el título (23-sep).
  v_titulo := coalesce(v_sala || ' · ', '') || 'Corte de las ' || public.hora_12(NEW.hora);

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
                ELSE 'hay que revisarlo y confirmarlo.'
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
      -- El número que se anunció. `null` cuando no hubo conteo: no es cero.
      'tramo',     v_tramo,
      'sala',      v_sala,
      'quien_id',  NEW.employee_id,
      'quien',     v_quien,
      'quien_foto', public.foto_de_empleado(NEW.employee_id),
      'contado',   CASE WHEN v_sin_conteo THEN NULL ELSE NEW.total_declarado END,
      'ventas',    NEW.tk_venta
    ),
    true,            -- push: hay que ir a revisarlo, no es informativo
    NEW.branch_id
  );

  RETURN NULL;
END;
$function$;
