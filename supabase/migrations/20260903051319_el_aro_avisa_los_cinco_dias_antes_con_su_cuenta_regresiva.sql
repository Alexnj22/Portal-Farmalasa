SET lock_timeout = '5s';

-- ── El aro avisa ANTES, con la cuenta regresiva ────────────────────────────
--
-- Pedido del usuario: «para todos los últimos 5 días diga eso, un conteo,
-- -5 -4 …». O sea que la ausencia no se anuncie el día que empieza, sino cinco
-- días antes y contando.
--
-- El motivo es operativo y no estético: lo que más recibe el supervisor son
-- SOLICITUDES que trancan trabajo de sala —anulaciones, descargos, cambios de
-- pago—. Enterarse de que se va el mismo día que se fue no sirve para nada;
-- enterarse cinco días antes es lo que deja mandarle lo pendiente a tiempo.
--
-- ── `faltan` y por qué es un número y no un booleano ───────────────────────
-- 0 = ya empezó (el caso de siempre). 1..5 = falta ese número de días. La
-- pantalla pinta «−3» con él y arma la frase; un booleano «por empezar»
-- obligaría a que el navegador reste fechas otra vez, y eso ya sería la MISMA
-- pregunta respondida en dos sitios — que es como se desincronizan el aro y el
-- texto de al lado.
--
-- ── El orden importa, y es lo único delicado ───────────────────────────────
-- Al ampliar la ventana a futuro, una persona puede tener a la vez algo VIGENTE
-- y algo POR EMPEZAR. Con el `ORDER BY x.date DESC` de antes ganaba el futuro,
-- así que alguien de incapacidad hoy aparecería como «vacaciones en 4 días» y
-- el estado real desaparecía. Por eso ordena primero por si ya empezó.
CREATE OR REPLACE FUNCTION public.get_estados_de_personas(p_ids uuid[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy   date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_yo    uuid := auth_employee_id();
  v_ve    boolean := auth_has_module_permission('staff_detail', 'can_view')
                  OR auth_has_module_permission('schedules', 'can_view');
  -- Cuántos días antes empieza a avisar. Cinco los pidió el usuario; vive acá
  -- con nombre para que el día que se mueva no haya que leer el WHERE.
  v_aviso integer := 5;
  v_out   json;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v_out
  FROM (
    SELECT e.id,
           CASE
             WHEN upper(coalesce(e.status, '')) IN ('INACTIVO', 'BAJA') THEN 'INACTIVO'
             WHEN upper(coalesce(e.status, '')) = 'LIQUIDADO'  THEN 'LIQUIDADO'
             WHEN upper(coalesce(e.status, '')) = 'SUSPENDIDO' THEN 'SUSPENDIDO'
             WHEN ev.type IS NULL THEN NULL
             WHEN v_ve OR e.id = v_yo THEN ev.type
             ELSE 'AUSENTE'
           END AS clave,
           CASE WHEN v_ve OR e.id = v_yo
                THEN nullif(ev.metadata->>'endDate', '')
                ELSE NULL
           END AS hasta,
           -- Los días que faltan viajan SIEMPRE, aun para quien sólo puede ver
           -- «AUSENTE»: saber que alguien no va a estar la semana que viene no
           -- dice de qué. El motivo sigue tapado; la fecha no es el motivo.
           coalesce(ev.faltan, 0) AS faltan
    FROM public.employees e
    LEFT JOIN LATERAL (
      SELECT x.type, x.metadata,
             greatest((x.date - v_hoy), 0)::int AS faltan
      FROM public.employee_events x
      WHERE x.employee_id = e.id
        AND x.type IN ('VACATION', 'DISABILITY', 'SUPPORT', 'PERMIT', 'INDUCTION', 'SUSPENSION')
        -- La ventana se abre hacia adelante: lo vigente sigue entrando igual.
        AND x.date <= v_hoy + v_aviso
        AND (nullif(x.metadata->>'endDate', '') IS NULL
             OR (x.metadata->>'endDate')::date >= v_hoy)
        -- Una sanción revocada por el reclamo del Art. 77 dejó de existir: no
        -- puede seguir pintando un aro en la foto de nadie.
        AND coalesce(x.metadata->'reclamo'->>'estado', '') <> 'REVOCADA'
      -- Lo que YA empezó manda sobre lo que está por empezar; entre dos que ya
      -- empezaron, el más reciente, que es el orden de antes.
      ORDER BY (x.date > v_hoy), x.date DESC
      LIMIT 1
    ) ev ON true
    WHERE e.id = ANY(p_ids)
  ) t
  WHERE t.clave IS NOT NULL;

  RETURN v_out;
END;
$function$;
