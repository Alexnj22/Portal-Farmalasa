SET lock_timeout = '5s';

-- Segunda vuelta de las tarjetas de la campana (usuario, 23-sep: «no me parece
-- que sean modernos · falta quien hizo el corte · los 3 se ven solo puro
-- texto, no se ven estructurados»).
--
--  · notificar_corte_de_caja: el aviso lleva quién hizo el corte, la sala, lo
--    contado y las ventas del corte.
--  · bitacora_pendientes_por_vencer: devuelve además `detalle`, qué falta en
--    cada área y en qué franja. Cambia la forma del resultado, así que se
--    borra y se crea; su único lector es `avisar-bitacora-por-vencer`.

DROP FUNCTION IF EXISTS public.bitacora_pendientes_por_vencer(integer);

CREATE OR REPLACE FUNCTION public.bitacora_pendientes_por_vencer(p_minutos integer DEFAULT 45)
 RETURNS TABLE(branch_id bigint, branch_name text, fecha date, cierra text, minutos integer, pendientes integer, lecturas integer, limpiezas integer, areas text, detalle jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH ahora AS (
        SELECT public.bitacora_hoy_sv() AS hoy, public.bitacora_ahora_sv()::time AS t
    ),
    bloques AS (
        -- Las franjas de temperatura y los turnos de limpieza son el mismo
        -- objeto para este cálculo: algo que hay que anotar dentro de una
        -- ventana. Tratarlos aparte daría dos avisos para la misma vuelta.
        SELECT ar.branch_id, ar.id AS area_id, ar.nombre, 'lectura'::text AS tipo,
               f->>'clave' AS clave, (f->>'desde')::time AS desde, (f->>'hasta')::time AS hasta
          FROM public.bitacora_areas ar
          CROSS JOIN ahora
          CROSS JOIN LATERAL jsonb_array_elements(ar.franjas) f
         WHERE ar.activa
           AND extract(isodow FROM ahora.hoy)::smallint = ANY (ar.dias_semana)
           AND ahora.hoy >= ar.vigente_desde
        UNION ALL
        SELECT ar.branch_id, ar.id, ar.nombre, 'limpieza',
               f->>'clave', (f->>'desde')::time, (f->>'hasta')::time
          FROM public.bitacora_areas ar
          CROSS JOIN ahora
          CROSS JOIN LATERAL jsonb_array_elements(ar.limpiezas) f
         WHERE ar.activa
           AND extract(isodow FROM ahora.hoy)::smallint = ANY (ar.dias_semana)
           AND ahora.hoy >= ar.vigente_desde
    ),
    faltan AS (
        SELECT b.*, ahora.hoy, ahora.t
          FROM bloques b CROSS JOIN ahora
         WHERE b.desde <= ahora.t
           AND b.hasta >  ahora.t
           AND b.hasta <= ahora.t + make_interval(mins => p_minutos)
           AND NOT public.bitacora_periodo_cerrado(b.branch_id, to_char(ahora.hoy, 'YYYY-MM'))
           AND NOT EXISTS (
               SELECT 1 FROM public.bitacora_lecturas l
                WHERE b.tipo = 'lectura' AND l.area_id = b.area_id
                  AND l.fecha = ahora.hoy AND l.franja = b.clave)
           AND NOT EXISTS (
               SELECT 1 FROM public.bitacora_limpiezas li
                WHERE b.tipo = 'limpieza' AND li.area_id = b.area_id
                  AND li.fecha = ahora.hoy AND li.turno = b.clave)
    )
    SELECT f.branch_id,
           br.name,
           f.hoy,
           to_char(f.hasta, 'HH24:MI'),
           -- Se redondea hacia abajo: decir «quedan 20» cuando quedan 20.7 es
           -- preferible a decir 21 y que la franja cierre antes.
           floor(extract(epoch FROM (f.hasta - f.t)) / 60)::integer,
           count(*)::integer,
           count(*) FILTER (WHERE f.tipo = 'lectura')::integer,
           count(*) FILTER (WHERE f.tipo = 'limpieza')::integer,
           string_agg(DISTINCT f.nombre, ', '),
           -- Qué falta en cada área, para la tarjeta de la campana (23-sep):
           -- un renglón por área y por tipo, con su franja.
           jsonb_agg(jsonb_build_object(
               'area',  f.nombre,
               'tipo',  f.tipo,
               'desde', to_char(f.desde, 'HH24:MI'),
               'hasta', to_char(f.hasta, 'HH24:MI')) ORDER BY f.nombre, f.tipo)
      FROM faltan f
      JOIN public.branches br ON br.id = f.branch_id
     -- Se agrupa por HORA DE CIERRE y no por sucursal: la bodega central tiene
     -- franjas propias (cierra 08:00 y no abre a las 07:00 como las farmacias),
     -- así que una sala puede tener dos ventanas distintas cerrando en la misma
     -- media hora y cada una es un aviso con su propia hora.
     GROUP BY f.branch_id, br.name, f.hoy, f.hasta, f.t
     ORDER BY f.branch_id, f.hasta;
$function$;

REVOKE ALL ON FUNCTION public.bitacora_pendientes_por_vencer(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bitacora_pendientes_por_vencer(integer) TO service_role;

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
