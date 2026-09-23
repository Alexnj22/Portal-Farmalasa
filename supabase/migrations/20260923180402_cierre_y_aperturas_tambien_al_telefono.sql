SET lock_timeout = '5s';

-- El cierre del día y las aperturas de la mañana llegaban a la campana y no al
-- teléfono. «Si no entro no me entero» (usuario, 2026-09-23): los dos pasan a
-- mandar push siempre.
--  · avisar_aperturas_de_la_manana: el push ya no depende de que falte una sala.
--  · avisar_cierre_del_dia: nunca mandaba push; ahora sí, a los mismos
--    destinatarios que reciben el aviso en la campana.

CREATE OR REPLACE FUNCTION public.avisar_aperturas_de_la_manana(p_fecha date DEFAULT NULL::date, p_forzado boolean DEFAULT false, p_sin_respuesta integer[] DEFAULT NULL::integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_fecha    date    := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_clave    text    := 'APERTURAS_MANANA:' || v_fecha::text;
  v_estado   jsonb;
  v_hora     text    := to_char(now() AT TIME ZONE 'America/El_Salvador', 'HH24:MI');
  v_abiertas integer;
  v_sin_resp text[];
  v_no_abrio text[];
  v_lista    text;
  v_primera  text;
  v_ultima   text;
  v_titulo   text;
  v_cuerpo   text;
  v_dest     uuid[];
  v_n        integer;
BEGIN
  -- La marca es global (`recipient_id IS NULL`) y vive en `avisos_emitidos`,
  -- no en la campana: un `NOT EXISTS … FROM notifications` pregunta «¿todavía
  -- la tiene?», así que quien vacía su campana lo recibiría de nuevo.
  IF EXISTS (SELECT 1 FROM public.avisos_emitidos a
              WHERE a.clave = v_clave AND a.recipient_id IS NULL) THEN
    RETURN 0;
  END IF;

  v_estado   := public.aperturas_de_la_manana(v_fecha);
  v_abiertas := (v_estado->>'abiertas')::int;

  -- Lo que no contestó el origen se separa de lo que no abrió: no distinguirlos
  -- convierte un rato de origen caído en seis salas acusadas de no abrir.
  SELECT coalesce(array_agg(x.sala ORDER BY x.sala) FILTER (WHERE     x.muda), '{}'::text[]),
         coalesce(array_agg(x.sala ORDER BY x.sala) FILTER (WHERE NOT x.muda), '{}'::text[])
    INTO v_sin_resp, v_no_abrio
    FROM (SELECT f.value #>> '{}' AS sala,
                 (i.value::text)::int = ANY (coalesce(p_sin_respuesta, '{}'::integer[])) AS muda
            FROM jsonb_array_elements(v_estado->'faltan')     WITH ORDINALITY f(value, n)
            JOIN jsonb_array_elements(v_estado->'faltan_ids') WITH ORDINALITY i(value, n)
              ON i.n = f.n) x;

  -- Todavía puede abrir: no es el momento. El cron de la hora tope vuelve con
  -- `p_forzado` y entonces sí sale, diciendo cuáles faltaron.
  IF NOT p_forzado AND (coalesce(array_length(v_no_abrio, 1), 0) > 0 OR coalesce(array_length(v_sin_resp, 1), 0) > 0) THEN
    RETURN 0;
  END IF;

  -- Ni una sala abierta y sin forzar: es demasiado temprano, no es una noticia.
  IF NOT p_forzado AND v_abiertas = 0 THEN
    RETURN 0;
  END IF;

  -- La lista: sala, hora y quién. Ya viene ordenada por hora desde el estado,
  -- así que la primera del renglón es la que abrió primero y la última la que
  -- cerró la mañana — que es la que se busca cuando se mira esto.
  SELECT string_agg(
           (s.value->>'sala') || ' ' || (s.value->>'hora') || ' ' ||
           coalesce(s.value->>'quien', 'desde la caja'), ' · ' ORDER BY s.n),
         min(s.value->>'hora'), max(s.value->>'hora')
    INTO v_lista, v_primera, v_ultima
    FROM jsonb_array_elements(v_estado->'salas') WITH ORDINALITY s(value, n);

  /* «apertura» y no «abrieron caja»: es la palabra con la que la pantalla de
   * cajas nombra este acto y con la que el usuario lo busca. Ver el encabezado
   * — el título y el cuerpo son las DOS únicas columnas que mira el buscador
   * de /notificaciones, así que la palabra que no está acá no existe. */
  v_titulo := CASE
    WHEN coalesce(array_length(v_no_abrio, 1), 0) = 1
      THEN '⚠️ ' || v_no_abrio[1] || ' no ha hecho su apertura de caja'
    WHEN coalesce(array_length(v_no_abrio, 1), 0) > 1
      THEN '⚠️ ' || coalesce(array_length(v_no_abrio, 1), 0) || ' salas no han hecho su apertura de caja'
    WHEN coalesce(array_length(v_sin_resp, 1), 0) > 0
      THEN '⚠️ No se pudo comprobar la apertura de caja de ' || array_to_string(v_sin_resp, ', ')
    ELSE 'Las ' || v_abiertas || ' salas hicieron su apertura de caja'
  END;

  v_cuerpo :=
       CASE WHEN coalesce(array_length(v_no_abrio, 1), 0) = 1
            THEN 'A las ' || v_hora || ' todavía no abría ' || v_no_abrio[1] || '. '
            WHEN coalesce(array_length(v_no_abrio, 1), 0) > 1
            THEN 'A las ' || v_hora || ' todavía no abrían ' ||
                 array_to_string(v_no_abrio, ', ') || '. '
            -- Con todas abiertas el cuerpo tiene que decir algo por sí solo:
            -- es lo que se lee donde la tarjeta no se sabe pintar. Y el rango
            -- va sólo con dos o más, porque «entre las 06:53 y las 06:53» es
            -- una frase que se delata sola.
            WHEN v_abiertas >= 2 AND v_primera IS NOT NULL
            THEN 'La apertura de caja fue entre las ' || v_primera || ' y las ' || v_ultima || '. '
            ELSE '' END
    || CASE WHEN coalesce(array_length(v_sin_resp, 1), 0) > 0
            THEN 'No se pudo comprobar ' || array_to_string(v_sin_resp, ', ') || '. '
            ELSE '' END
    || CASE WHEN v_abiertas = 0 THEN 'Ninguna sala había hecho su apertura.'
            WHEN coalesce(array_length(v_no_abrio, 1), 0) > 0 OR coalesce(array_length(v_sin_resp, 1), 0) > 0
            THEN 'Abrieron: ' || v_lista
            ELSE v_lista END;

  -- SÓLO Supervisor/a de Ventas: lo pidió en primera persona, y es una
  -- vigilancia de operación, no el informe de gerencia que es el cierre del día.
  SELECT array_agg(DISTINCT e.id) INTO v_dest
    FROM public.employees e
    JOIN public.roles r ON r.name = 'Supervisor/a de Ventas'
   WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
     AND e.status = 'ACTIVO'
     AND coalesce(e.tipo_ficha, 'empleado') = 'empleado';
  IF v_dest IS NULL THEN RETURN 0; END IF;

  v_n := public.notify_employees(
    v_dest,
    'APERTURAS_DE_LA_MANANA',
    v_titulo,
    v_cuerpo,
    '/caja?pestana=cortes',
    jsonb_build_object(
      'fecha',         v_fecha,
      'hora_aviso',    v_hora,
      'forzado',       p_forzado,
      'total',         (v_estado->>'total')::int,
      'abiertas',      v_abiertas,
      'salas',         v_estado->'salas',
      'no_abrieron',   to_jsonb(v_no_abrio),
      'sin_respuesta', to_jsonb(v_sin_resp)),
    -- Push SIEMPRE (2026-09-23). Antes salía sólo cuando faltaba una sala, para
    -- que un «todo bien» diario no enseñara a ignorar los push; el usuario lo
    -- pidió al revés: «si no entro no me entero». Es un solo aviso por mañana.
    true,
    NULL
  );

  -- La marca sólo si algo se mandó de verdad. Escribirla igual dejaría el aviso
  -- del día apagado para siempre por una corrida que no llegó a nadie.
  IF coalesce(v_n, 0) > 0 THEN
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    VALUES (v_clave, NULL)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN coalesce(v_n, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_cierre_del_dia(p_fecha date DEFAULT NULL::date, p_forzado boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_fecha  date := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_clave  text := 'CIERRE_DEL_DIA:' || v_fecha::text;
  v_ym     text := to_char(v_fecha, 'YYYY-MM');
  v_dias   integer := EXTRACT(day FROM (date_trunc('month', v_fecha) + interval '1 month -1 day'))::int;
  v_ref    date := v_fecha - 7;
  -- `to_char` da los nombres en inglés salvo que la base tenga otro lc_time, y
  -- el aviso lo lee gente que no tiene por qué. Se escriben acá.
  v_dow    text[] := ARRAY['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  v_mes    text[] := ARRAY['enero','febrero','marzo','abril','mayo','junio','julio',
                           'agosto','septiembre','octubre','noviembre','diciembre'];
  v_faltan text[];
  v_n      integer := 0;
  v_ids    uuid[];
  v_titulo text;
  v_cuerpo text;
BEGIN
  -- Las salas son las del mapa del origen sin la bodega: bodega no vende ni
  -- abre caja, y contarla dejaría el aviso esperando un Z que no va a existir.
  SELECT array_agg(b.name ORDER BY b.name) INTO v_faltan
    FROM public.branches b
    JOIN public.erp_sucursal_map em ON em.branch_id = b.id AND NOT em.es_bodega
   WHERE NOT EXISTS (SELECT 1 FROM public.cortes_caja c
                      WHERE c.branch_id = b.id AND c.fecha = v_fecha AND c.tipo = 'Z');

  -- Todavía hay salas abiertas: no es el momento. El cron de la noche vuelve
  -- con `p_forzado` y entonces sí sale, diciendo cuáles faltaron.
  IF NOT p_forzado AND coalesce(array_length(v_faltan, 1), 0) > 0 THEN
    RETURN 0;
  END IF;

  WITH salas AS (
    SELECT b.id AS branch_id, b.name AS sala
      FROM public.branches b
      JOIN public.erp_sucursal_map em ON em.branch_id = b.id AND NOT em.es_bodega
  ),
  -- El último corte CONFIRMADO de la sala lleva el acumulado del día: los
  -- cortes se suman, así que el de la noche contiene a los de la mañana.
  ultimo AS (
    SELECT DISTINCT ON (c.branch_id) c.branch_id, c.id
      FROM public.cortes_caja c
     WHERE c.fecha = v_fecha AND c.tipo = 'C' AND c.estado = 'CONFIRMADO'
     ORDER BY c.branch_id, c.hora DESC, c.id DESC
  ),
  dif AS (
    SELECT u.branch_id,
           round(public.corte_diferencia(c.total_declarado, c.diferencia_erp, c.tk_total_caja,
                                         c.tk_subtotal, c.tk_vales, c.tk_cobros_credito,
                                         c.cobros_portal_efectivo), 2) AS diferencia
      FROM ultimo u JOIN public.cortes_caja c ON c.id = u.id
  ),
  filas AS (
    SELECT s.sala,
           round((v.sum_total - v.sum_no_producto)::numeric, 2)      AS venta,
           m.monto_meta / v_dias                                     AS meta_dia,
           round((r.sum_total - r.sum_no_producto)::numeric, 2)      AS venta_ref,
           d.diferencia
      FROM salas s
      LEFT JOIN public.sales_daily_stats v ON v.branch_id = s.branch_id AND v.date = v_fecha
      LEFT JOIN public.sales_daily_stats r ON r.branch_id = s.branch_id AND r.date = v_ref
      LEFT JOIN public.metas_sucursal    m ON m.branch_id = s.branch_id AND m.year_month = v_ym
      LEFT JOIN dif d ON d.branch_id = s.branch_id
  ),
  global AS (
    SELECT round(sum(coalesce(venta, 0)), 2)                              AS venta,
           round(sum(meta_dia), 2)                                        AS meta,
           CASE WHEN sum(meta_dia) > 0
                THEN round(sum(coalesce(venta, 0)) / sum(meta_dia) * 100, 0) END AS pct,
           CASE WHEN sum(venta_ref) > 0
                THEN round((sum(coalesce(venta, 0)) / sum(venta_ref) - 1) * 100, 0) END AS variacion,
           count(*)::int                                                  AS cajas,
           count(*) FILTER (WHERE diferencia IS NOT NULL AND abs(diferencia) < 0.005)::int AS cuadraron
      FROM filas
  ),
  detalle AS (
    SELECT json_agg(json_build_object(
             'sala',       f.sala,
             'pct',        round(f.venta / f.meta_dia * 100, 0),
             'venta',      f.venta,
             -- `diferencia` ausente no es 0: la tarjeta distingue «no cuadró»
             -- de «no se pudo saber», y para eso el null tiene que llegar.
             'diferencia', f.diferencia,
             'variacion',  CASE WHEN f.venta_ref > 0
                                THEN round((f.venta / f.venta_ref - 1) * 100, 0) END)
             ORDER BY round(f.venta / f.meta_dia * 100, 0) DESC) AS filas
      FROM filas f
     WHERE f.venta IS NOT NULL AND f.meta_dia > 0
  ),
  texto AS (
    SELECT v_dow[EXTRACT(dow FROM v_fecha)::int + 1] AS dia,
           v_dow[EXTRACT(dow FROM v_fecha)::int + 1] || ' ' ||
             EXTRACT(day FROM v_fecha)::int || ' de ' ||
             v_mes[EXTRACT(month FROM v_fecha)::int] AS fecha_texto
  ),
  destinatarios AS (
    -- Los dos cargos que el usuario nombró. Por rol y no por una lista de ids:
    -- el día que cambie la persona, el aviso la alcanza sola.
    SELECT DISTINCT e.id AS employee_id
      FROM public.employees e
      JOIN public.roles r ON r.name IN ('Gerente General', 'Supervisor/a de Ventas')
     WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
       AND e.status = 'ACTIVO'
       AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
  ),
  ins AS (
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata)
    SELECT d.employee_id,
           'CIERRE_DEL_DIA',
           'El ' || (SELECT dia FROM texto) || ' ' || EXTRACT(day FROM v_fecha)::int
             || ' cerró en ' || (SELECT pct FROM global) || '%',
           -- El texto plano es el respaldo: lo que se lee si el aviso llega a
           -- un sitio que no sabe pintar la tarjeta. Dice lo mismo en prosa.
           'Se vendieron $' || to_char((SELECT venta FROM global), 'FM999,999,990.00')
             || ' de una meta de $' || to_char((SELECT meta FROM global), 'FM999,999,990.00')
             || ' para el día.'
             || CASE WHEN (SELECT variacion FROM global) IS NULL THEN ''
                     WHEN abs((SELECT variacion FROM global)) < 1 THEN ''
                     ELSE ' ' || abs((SELECT variacion FROM global))::int || '% '
                          || CASE WHEN (SELECT variacion FROM global) > 0 THEN 'más' ELSE 'menos' END
                          || ' que el ' || (SELECT dia FROM texto) || ' pasado.' END
             || CASE WHEN coalesce(array_length(v_faltan, 1), 0) > 0
                     THEN ' No cerraron: ' || array_to_string(v_faltan, ', ') || '.'
                     WHEN (SELECT cuadraron FROM global) = (SELECT cajas FROM global)
                     THEN ' Las ' || (SELECT cajas FROM global) || ' cajas cuadraron.'
                     ELSE '' END,
           '/cortes',
           jsonb_build_object(
             'fecha',           v_fecha,
             'fecha_texto',     (SELECT fecha_texto FROM texto),
             'pct',             (SELECT pct       FROM global),
             'venta',           (SELECT venta     FROM global),
             'meta',            (SELECT meta      FROM global),
             'variacion',       (SELECT variacion FROM global),
             'contra_texto',    'el ' || (SELECT dia FROM texto) || ' pasado',
             'cajas',           (SELECT cajas     FROM global),
             'cajas_cuadraron', (SELECT cuadraron FROM global),
             'salas_sin_cerrar', to_jsonb(coalesce(v_faltan, ARRAY[]::text[])),
             'sucursales',      coalesce((SELECT filas FROM detalle), '[]'::json))
      FROM destinatarios d
     -- Sin porcentaje no hay tarjeta que dibujar: mejor no mandar nada que
     -- mandar un aviso que la campana no sabe pintar.
     WHERE (SELECT pct FROM global) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                        WHERE a.recipient_id = d.employee_id AND a.clave = v_clave)
    RETURNING recipient_id, title, body
  ),
  marca AS (
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    SELECT v_clave, i.recipient_id FROM ins i
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*), array_agg(recipient_id), min(title), min(body)
    INTO v_n, v_ids, v_titulo, v_cuerpo
    FROM ins;

  -- Al teléfono también (2026-09-23): en la campana sola, quien no entra al
  -- portal no se entera del cierre. Mismo cuerpo que `notify_employees`; el
  -- título y el texto son iguales para todos los destinatarios.
  IF v_n > 0 THEN
    PERFORM net.http_post(
      url     := public.push_function_url(),
      headers := public.push_function_headers(),
      body    := jsonb_build_object(
        'title',        v_titulo,
        'message',      coalesce(v_cuerpo, ''),
        'url',          '/cortes',
        'target_type',  'EMPLOYEE',
        'target_value', to_jsonb(v_ids)
      )
    );
  END IF;

  RETURN v_n;
END;
$function$;
