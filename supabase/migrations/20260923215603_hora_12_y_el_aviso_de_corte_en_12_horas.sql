SET lock_timeout = '5s';

-- «Necesito que las horas sean 12 horas siempre. No en un lado 12 y en otras
-- 24» (usuario, 23-sep). `hora_12` es la gemela en la base de `hora12`
-- (`src/utils/hora.js`): mismo formato que la campana, «1:06 p. m.». Acá se
-- estrena en el título del aviso de corte; el resto de los avisos que escriben
-- la hora en 24 se pasan a ella en su propia tanda.

CREATE OR REPLACE FUNCTION public.hora_12(p_hora time)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN p_hora IS NULL THEN NULL ELSE
    ((extract(hour FROM p_hora)::int + 11) % 12 + 1)::text || ':' || to_char(p_hora, 'MI')
    || CASE WHEN extract(hour FROM p_hora) < 12 THEN ' a. m.' ELSE ' p. m.' END END;
$function$;

REVOKE ALL ON FUNCTION public.hora_12(time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_12(time) TO authenticated, service_role;

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

  SELECT name INTO v_sala FROM public.branches WHERE id = NEW.branch_id;
  -- Quién hizo el corte, para la tarjeta (23-sep: «falta quien hizo el
  -- corte»). Sólo la ficha ligada: `empleado_texto` es el nombre de la CUENTA
  -- con la que opera la caja, no el de la persona.
  SELECT e.name INTO v_quien FROM public.employees e WHERE e.id = NEW.employee_id;

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

  -- La hora en 12 horas, como en todo el portal (usuario, 23-sep: «las horas
  -- sean 12 horas siempre»). `hora_12` es la gemela de `hora12` del frente.
  v_titulo := CASE
    WHEN v_tramo IS NOT NULL AND v_tramo <= -0.01
      THEN 'Faltan ' || v_monto || ' en el corte de las ' || public.hora_12(NEW.hora)
    ELSE 'Corte de caja de las ' || public.hora_12(NEW.hora)
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
      'tramo',     v_tramo,
      -- Lo que dibuja la tarjeta de la campana.
      'sala',      v_sala,
      'quien_id',  NEW.employee_id,
      'quien',     v_quien,
      'contado',   CASE WHEN v_sin_conteo THEN NULL ELSE NEW.total_declarado END,
      'ventas',    NEW.tk_venta
    ),
    true,            -- push: hay que ir a confirmarlo, no es informativo
    NEW.branch_id
  );

  RETURN NULL;
END;
$function$;
