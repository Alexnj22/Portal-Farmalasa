SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- El corte que quedó sin resolver se recuerda a las 7:30 de la mañana.
--
-- Pedido del usuario (2026-08-15): «si ayer no se confirmó o descartó alguno
-- que avise, ya que se deben confirmar».
--
-- El aviso de cuando NACE el corte ya existe (`notificar_corte_de_caja`), pero
-- llega a media tarde —con la sala vendiendo— y compite con todo lo del día.
-- Éste llega cuando la sala abre y sólo si de verdad quedó algo colgado, así
-- que su ausencia también dice algo: nada pendiente.
--
-- Ventana de 7 días, no sólo ayer (decisión del usuario, 2026-08-15): un corte
-- que se pasa de largo un día dejaría de nombrarse para siempre, y es
-- exactamente el que hay que resolver. Es la misma ventana que ya usa la
-- baldosa de Inicio, para que las dos pantallas cuenten lo mismo. HOY queda
-- fuera: sus cortes son de la jornada en curso y la sala los resuelve mientras
-- trabaja.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── Quién se entera de un corte de esta sala ────────────────────────────────
--
-- La regla estaba escrita dentro de `notificar_corte_de_caja` y ahora la
-- necesitan dos avisos. Copiada, se desincroniza: un día el aviso del corte
-- nuevo le llega a alguien y el recordatorio de la mañana no, sin que nada lo
-- delate. Se resuelve por `role_id` —no por el secundario— igual que antes: es
-- la misma consulta movida, no una regla nueva.
CREATE OR REPLACE FUNCTION public.destinatarios_de_cortes(p_branch_id integer)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  -- Los de la sala que tienen el módulo. `notify_branch` avisaría a TODOS los
  -- de la sucursal, y a quien no lo tiene el aviso lo manda a una pantalla que
  -- no puede abrir.
  SELECT array_agg(DISTINCT e.id)
    FROM public.employees e
    JOIN public.role_permissions rp
      ON rp.role_id = e.role_id
     AND rp.module_key = 'cortes_caja'
   WHERE e.branch_id = p_branch_id
     AND e.status = 'ACTIVO'
     AND (rp.can_view OR rp.can_edit);
$$;

REVOKE EXECUTE ON FUNCTION public.destinatarios_de_cortes(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.destinatarios_de_cortes(integer) TO service_role;


-- ── El aviso de cuando nace el corte: misma lógica, la regla compartida ──────
--
-- Cambia dos cosas y ninguna toca a quién le llega: los destinatarios salen del
-- helper de arriba, y el cuerpo pasa a impersonal. «revisalo y confirmalo» era
-- voseo y el portal usa tuteo (DESIGN.md §26.7) — se le escapó al mismo punto
-- ciego que `20260814213451`: `gate:design` sólo lee `src/`.
CREATE OR REPLACE FUNCTION public.notificar_corte_de_caja()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_sala   text;
  v_dest   uuid[];
  v_titulo text;
  v_cuerpo text;
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

  -- Misma hora que la tarjeta (hh:mm, 24h): el aviso y la pantalla tienen que
  -- nombrar al mismo corte igual.
  v_titulo := 'Corte de caja de las ' || to_char(NEW.hora, 'HH24:MI');
  v_cuerpo := coalesce(v_sala, 'Tu sala') || ' — hay que revisarlo y confirmarlo.';

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
      'hora',      to_char(NEW.hora, 'HH24:MI')
    ),
    true,            -- push: hay que ir a confirmarlo, no es informativo
    NEW.branch_id
  );

  RETURN NULL;
END;
$$;


-- ── El recordatorio de la mañana ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.avisar_cortes_pendientes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_sala   record;
  v_dest   uuid[];
  v_meta   jsonb;
  v_titulo text;
  v_cuerpo text;
  v_n      integer;
  v_total  integer := 0;
BEGIN
  FOR v_sala IN
    WITH pendientes AS (
      -- Sólo tipo `C`: el cierre del día (Z) nace PENDIENTE y muere PENDIENTE
      -- —no se confirma ni se descarta—, así que contarlo sería inventar
      -- trabajo que nadie puede hacer. Son 6 por día, uno por sala: sin este
      -- filtro el aviso saldría todas las mañanas para siempre.
      SELECT c.id, c.branch_id, c.fecha, c.hora
        FROM public.cortes_caja c
       WHERE c.tipo   = 'C'
         AND c.estado = 'PENDIENTE'
         AND c.fecha BETWEEN v_hoy - 7 AND v_hoy - 1
    ),
    detalle AS (
      -- Cuántos de cada día, para que el cuerpo diga si es lo de anoche o una
      -- pila de tres días.
      SELECT branch_id,
             string_agg(txt, ', ' ORDER BY fecha DESC) AS txt
        FROM (SELECT branch_id, fecha,
                     count(*) || ' del ' || to_char(fecha, 'DD/MM') AS txt
                FROM pendientes
               GROUP BY branch_id, fecha) d
       GROUP BY branch_id
    )
    -- Un aviso por sala, no uno por corte: seis pings a las 7:30 son el ruido
    -- que enseña a ignorar la campana.
    SELECT p.branch_id,
           b.name                                   AS sala,
           count(*)::int                            AS cuantas,
           array_agg(p.id ORDER BY p.fecha, p.hora) AS ids,
           min(p.fecha)                             AS fecha_unica,
           max(to_char(p.hora, 'HH24:MI'))          AS hora_unica,
           d.txt                                    AS detalle
      FROM pendientes p
      JOIN public.branches b ON b.id = p.branch_id
      JOIN detalle       d ON d.branch_id = p.branch_id
     GROUP BY p.branch_id, b.name, d.txt
     ORDER BY p.branch_id
  LOOP
    -- Uno por sala y por día, aunque el trabajo se corra dos veces. La marca es
    -- el propio aviso: no hace falta una tabla para recordar que ya se mandó.
    IF EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.type = 'CORTE_PENDIENTE'
         AND n.created_at >= now() - interval '20 hours'
         AND n.metadata->>'check_key' = v_sala.branch_id || ':' || v_hoy
    ) THEN
      CONTINUE;
    END IF;

    v_dest := public.destinatarios_de_cortes(v_sala.branch_id);
    CONTINUE WHEN v_dest IS NULL;

    v_titulo := CASE WHEN v_sala.cuantas = 1
                     THEN 'Quedó un corte de caja sin confirmar'
                     ELSE 'Quedaron ' || v_sala.cuantas || ' cortes de caja sin confirmar' END;

    v_cuerpo := v_sala.sala || ' — '
             || CASE WHEN v_sala.cuantas = 1
                     THEN 'el de las ' || v_sala.hora_unica
                          || ' del ' || to_char(v_sala.fecha_unica, 'DD/MM')
                          || '. Hay que confirmarlo o descartarlo.'
                     ELSE v_sala.detalle
                          || '. Hay que confirmarlos o descartarlos.' END;

    -- `corte_id` sólo cuando hay uno: es lo que hace que la campana ofrezca
    -- «Confirmar» ahí mismo. Con varios el aviso lleva a la pantalla a
    -- propósito — el tramo de cada corte es la resta contra el confirmado
    -- anterior, así que resolverlos sueltos y en desorden es justo lo que no
    -- hay que hacer.
    v_meta := jsonb_build_object(
      'check_key', v_sala.branch_id || ':' || v_hoy,
      'branch_id', v_sala.branch_id,
      'cuantas',   v_sala.cuantas,
      'corte_ids', to_jsonb(v_sala.ids)
    );
    IF v_sala.cuantas = 1 THEN
      v_meta := v_meta || jsonb_build_object(
        'corte_id', v_sala.ids[1],
        'fecha',    v_sala.fecha_unica,
        'hora',     v_sala.hora_unica
      );
    END IF;

    v_n := public.notify_employees(
      v_dest,
      'CORTE_PENDIENTE',
      v_titulo,
      v_cuerpo,
      '/cortes',
      v_meta,
      true,            -- push: es una tarea sin hacer, no una noticia
      v_sala.branch_id
    );

    v_total := v_total + coalesce(v_n, 0);
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.avisar_cortes_pendientes() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_cortes_pendientes() TO service_role;


-- 13:30 UTC = 7:30 SV, la hora de abrir. Sin `net.http_post`: el trabajo entero
-- es una consulta y dos inserciones, así que no hay nada que mandar afuera.
SELECT cron.schedule(
  'cortes-pendientes-0730-sv',
  '30 13 * * *',
  $cron$ SELECT public.avisar_cortes_pendientes(); $cron$
);
