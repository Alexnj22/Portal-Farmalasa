SET lock_timeout = '5s';

-- El ranking de vendedores aprende a dividir por HORAS, no sólo por días.
--
-- Un día trabajado no es una unidad comparable: el horario real de la empresa
-- tiene jornadas de 6, 7, 8, 9 y 11 horas, y semanas de 9, 16, 36 y 44. Medido
-- sobre agosto en La Popular, la ventana de venta de Katherine Salinas promedia
-- 5.7 h contra 7.5 h de Nataly Flores; por día queda 5ª y por hora queda 1ª. O
-- sea que «por día trabajado» sigue castigando a quien está media jornada, que
-- es justo lo que ese interruptor venía a corregir.
--
-- El denominador sale del HORARIO PUBLICADO (`employee_rosters`, status
-- PUBLISHED), no de un reloj: `attendance` tiene 0 filas y
-- `timesheets.regular_hours` está en 0 en las 391 filas que existen, así que
-- las horas trabajadas no son un dato del portal todavía. Las programadas sí.
--
-- La regla de horas es una TRADUCCIÓN de `calculateEmployeeWeeklyHoursLocal`
-- (src/utils/scheduleHelpers.js), que es la que ya usa el módulo de Horarios:
--   inicio = customStart, y si viene vacío el del turno
--   fin    = customEnd,   y si viene vacío el del turno
--   minutos = fin - inicio  (+24 h si cruza la medianoche)
--   si hasLunch, -60 min.  La LACTANCIA NO SE RESTA: en El Salvador esa hora
--   es tiempo de trabajo pagado, y el original tampoco la resta.
-- Se enfrentaron las dos implementaciones sobre las 94 semanas publicadas
-- reales: **94 iguales, 0 distintas**. De las seis ramas, los datos ejercitan
-- cuatro (658 días: 209 libres, 156 con almuerzo); lactancia, caída al turno y
-- cruce de medianoche no aparecen todavía en ninguna fila, así que están
-- escritas igual que el original pero no medidas contra él.
-- Cualquier cambio en cualquiera de las dos exige volver a correr la
-- comparación, o se pierde justo lo que la hace confiable.
--
-- El día es la unidad de las DOS puntas: `horas` suma los días que la persona
-- efectivamente vendió EN ESA SALA y que el horario cubre, y la venta del
-- cociente es la de esos mismos días. Así nunca se mezcla un numerador de todo
-- el mes con un denominador de media semana, y de paso resuelve a quien vende
-- en dos salas el mismo mes (Marilyn Menjivar, Fernando Oliva y Yessica
-- Hernández, en agosto): el horario es de la persona y no dice sucursal, pero
-- el día sí.
--
-- `dias_horario` viaja al cliente para que la pantalla pueda decir cuándo el
-- horario no cubre el mes entero, y `con_horario` cuenta a cuántos de la lista
-- se les pudo calcular: la vista «por hora» sólo se habilita cuando están
-- todos, porque un ranking a medias mezcla dos unidades en la misma columna.

CREATE OR REPLACE FUNCTION public.get_metas_mes_en_curso(p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_metas   boolean := auth_has_module_permission('metas', 'can_view');
  v_widget  boolean := auth_has_module_permission('dash_meta_sala', 'can_view');
  v_todas   boolean := false;
  v_branch  bigint;
  v_hoy     date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ini     date := date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date)::date;
  v_ym      text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
  v_fin     date;
  v_cfg     record;
  v_meta numeric; v_base numeric; v_recup numeric; v_estado text;
  v_acum numeric; v_proy numeric; v_dias int; v_dia_hoy int;
  v_dias_json json; v_vend json;
  v_prom_venta numeric; v_prom_ticket numeric; v_prom_dia numeric;
  v_prom_hora numeric; v_con_horario int; v_personas int;
BEGIN
  IF NOT (v_metas OR v_widget) THEN RETURN NULL; END IF;

  -- Quien tiene alcance de todas las salas puede pedir «todas» (NULL) o una.
  -- Quien no, ve la suya y el parámetro se ignora.
  IF (v_metas AND auth_module_scope('metas') = 'ALL')
     OR (v_widget AND auth_module_scope('dash_meta_sala') = 'ALL') THEN
    v_branch := p_branch_id;
    v_todas  := p_branch_id IS NULL;
  ELSE
    v_branch := auth_employee_branch_id();
  END IF;

  IF NOT v_todas AND v_branch IS NULL THEN RETURN NULL; END IF;
  IF NOT v_todas AND NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map m
                                 WHERE m.branch_id = v_branch AND NOT m.es_bodega) THEN
    RETURN NULL;
  END IF;

  v_fin := (v_ini + interval '1 month - 1 day')::date;
  SELECT * INTO v_cfg FROM public.metas_config LIMIT 1;

  -- La meta y la proyección salen del mismo sitio que el tablero: si acá se
  -- recalcularan, un día dirían otra cosa que las tarjetas de al lado.
  SELECT sum(d.monto_meta), sum(d.venta_acumulada), sum(d.proyeccion),
         max(d.dias_mes), max(d.dias_transcurridos)
    INTO v_meta, v_acum, v_proy, v_dias, v_dia_hoy
  FROM public.get_metas_dashboard(v_ym) d
  WHERE v_todas OR d.branch_id = v_branch;

  SELECT sum(m.monto_base), sum(m.monto_recuperacion),
         CASE WHEN count(*) FILTER (WHERE m.estado <> 'oficial') > 0 THEN 'pendiente' ELSE 'oficial' END
    INTO v_base, v_recup, v_estado
  FROM public.metas_sucursal m
  WHERE m.year_month = v_ym AND (v_todas OR m.branch_id = v_branch)
    AND m.branch_id IN (SELECT s.branch_id FROM public.erp_sucursal_map s WHERE NOT s.es_bodega);

  -- ── Día por día ─────────────────────────────────────────────────────────
  SELECT json_agg(to_json(t) ORDER BY t.dia) INTO v_dias_json
  FROM (
    SELECT EXTRACT(day FROM si.fecha)::int AS dia,
           round(sum(si.total::numeric), 2) AS venta,
           (si.fecha = v_hoy) AS es_hoy
    FROM public.sales_invoices si
    WHERE si.fecha BETWEEN v_ini AND v_fin
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (v_todas OR si.branch_id = v_branch)
      AND si.branch_id IN (SELECT s.branch_id FROM public.erp_sucursal_map s WHERE NOT s.es_bodega)
    GROUP BY si.fecha
  ) t;

  -- ── Quién vende ─────────────────────────────────────────────────────────
  -- `dias` sigue siendo «días con venta»: es el único dato de presencia que hay
  -- (attendance en 0, timesheets sin horas). Lo que se suma ahora son las
  -- HORAS PROGRAMADAS de esos mismos días, que sí existen desde que el horario
  -- se publica.
  SELECT json_agg(to_json(v) ORDER BY v.venta DESC) INTO v_vend
  FROM (
    WITH ventas AS (
      SELECT e.id AS employee_id, e.name AS nombre, si.branch_id, si.fecha,
             sum(si.total::numeric) AS venta_dia_monto,
             count(*)::int          AS tickets_dia
      FROM public.sales_invoices si
      JOIN public.employees e ON e.code = si.cod_vendedor AND e.status = 'ACTIVO'
      WHERE si.fecha BETWEEN v_ini AND v_fin
        AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
        AND (v_todas OR si.branch_id = v_branch)
        AND si.branch_id IN (SELECT s.branch_id FROM public.erp_sucursal_map s WHERE NOT s.es_bodega)
      GROUP BY e.id, e.name, si.branch_id, si.fecha
    ),
    -- Las horas que el horario publicado le asigna a cada día que vendió.
    -- `NULL` = ese día no está cubierto por un horario publicado, o es día
    -- libre: no suma ni al numerador ni al denominador.
    con_horas AS (
      SELECT vt.*,
             CASE
               WHEN r.id IS NOT NULL
                AND coalesce((r.schedule_data -> k.dia ->> 'isOff')::boolean, true) = false
                AND h.ini IS NOT NULL AND h.fin IS NOT NULL
               THEN GREATEST(0,
                      EXTRACT(epoch FROM (h.fin::time - h.ini::time)) / 3600.0
                      + CASE WHEN h.fin::time < h.ini::time THEN 24 ELSE 0 END
                      - CASE WHEN coalesce((r.schedule_data -> k.dia ->> 'hasLunch')::boolean, false)
                             THEN 1 ELSE 0 END)
             END AS horas_dia
      FROM ventas vt
      CROSS JOIN LATERAL (SELECT EXTRACT(dow FROM vt.fecha)::int::text AS dia) k
      LEFT JOIN public.employee_rosters r
             ON r.employee_id     = vt.employee_id
            AND r.week_start_date = date_trunc('week', vt.fecha)::date
            AND r.status          = 'PUBLISHED'
      LEFT JOIN public.shifts sh
             ON sh.id::text = nullif(r.schedule_data -> k.dia ->> 'shiftId', '')
      CROSS JOIN LATERAL (
        SELECT coalesce(nullif(r.schedule_data -> k.dia ->> 'customStart', ''), sh.start_time::text) AS ini,
               coalesce(nullif(r.schedule_data -> k.dia ->> 'customEnd',   ''), sh.end_time::text)   AS fin
      ) h
    )
    SELECT ch.employee_id, ch.nombre,
           (SELECT b.name FROM public.branches b WHERE b.id = ch.branch_id) AS sala,
           round(sum(ch.venta_dia_monto), 2)                       AS venta,
           sum(ch.tickets_dia)::int                                AS tickets,
           round(sum(ch.venta_dia_monto) / sum(ch.tickets_dia), 2) AS ticket,
           count(*)::int                                           AS dias,
           round(sum(ch.venta_dia_monto) / count(*), 2)            AS venta_dia,
           round(coalesce(sum(ch.horas_dia) FILTER (WHERE ch.horas_dia > 0), 0), 2) AS horas,
           count(*) FILTER (WHERE ch.horas_dia > 0)::int                            AS dias_horario,
           round(sum(ch.venta_dia_monto) FILTER (WHERE ch.horas_dia > 0)
                 / nullif(sum(ch.horas_dia) FILTER (WHERE ch.horas_dia > 0), 0), 2) AS venta_hora
    FROM con_horas ch
    GROUP BY ch.employee_id, ch.nombre, ch.branch_id
  ) v;

  SELECT round(avg((x->>'venta')::numeric), 2),
         round(avg((x->>'ticket')::numeric), 2),
         round(avg((x->>'venta_dia')::numeric), 2),
         round(avg((x->>'venta_hora')::numeric), 2),
         count(*) FILTER (WHERE (x->>'venta_hora') IS NOT NULL)::int,
         count(*)::int
    INTO v_prom_venta, v_prom_ticket, v_prom_dia, v_prom_hora, v_con_horario, v_personas
  FROM json_array_elements(coalesce(v_vend, '[]'::json)) x;

  RETURN json_build_object(
    'todas',        v_todas,
    'branch_id',    v_branch,
    'sala',         CASE WHEN v_todas THEN 'Todas las salas'
                         ELSE (SELECT b.name FROM public.branches b WHERE b.id = v_branch) END,
    'year_month',   v_ym,
    'meta',         v_meta,
    'monto_base',   v_base,
    'monto_recuperacion', v_recup,
    'estado_meta',  v_estado,
    'acumulado',    v_acum,
    'proyeccion',   v_proy,
    'dias_mes',     v_dias,
    'dia_hoy',      v_dia_hoy,
    'ritmo_diario', CASE WHEN v_dias > 0 THEN round(v_meta / v_dias, 2) END,
    'umbral_medio', v_cfg.umbral_bono_medio,
    'umbral_total', v_cfg.umbral_bono_total,
    'dias',         coalesce(v_dias_json, '[]'::json),
    'vendedores',   coalesce(v_vend, '[]'::json),
    'promedio_venta',  v_prom_venta,
    'promedio_ticket', v_prom_ticket,
    'promedio_dia',    v_prom_dia,
    -- Horario: el promedio por hora, a cuántos se les pudo calcular y sobre
    -- cuántos. La pantalla habilita la vista «por hora» sólo si son todos.
    'promedio_hora',   v_prom_hora,
    'con_horario',     coalesce(v_con_horario, 0),
    'personas',        coalesce(v_personas, 0)
  );
END;
$function$;
