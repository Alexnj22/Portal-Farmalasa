SET lock_timeout = '5s';

-- El aviso del cierre del día lee la venta del día EN VIVO (2026-10-24).
--
-- Desde HC2 (20261023155526) `refresh_sales_daily_stats` agrega sólo los días
-- ANTERIORES al «hoy» de El Salvador. Antes usaba el día UTC, que desde las
-- 18:00 SV ya es mañana, y por eso de noche el día en curso estaba agregado
-- por casualidad. Este aviso corre el MISMO día que reporta (el último Z, o el
-- cron de las 23:50), así que desde el 23-oct leía cero filas: el viernes 23
-- salió «$0.00 · 0% · 100% menos» sobre $6,976.12 vendidos.
--
-- La venta del día sale ahora de la misma cuenta que hace el refresco
-- (`venta_valida` menos `ventas_sin_producto`), así no depende de cuándo corra
-- el agregado. La referencia de hace siete días sigue saliendo del agregado:
-- ésa siempre es un día pasado.
--
-- Segundo arreglo: la marca de `avisos_emitidos` salía del RETURNING del
-- INSERT, y fuera de horario el trigger `avisos_horario` aparta la fila
-- (RETURN NULL) → RETURNING vacío → sin marca → el candado contra repetidos no
-- existía justo de noche. La marca sale ahora de los destinatarios. Y la fila
-- apartada lleva `con_push`, para que el teléfono suene al entregarse.
--
-- Partido de la definición VIVA (pg_get_functiondef, 2026-10-24).

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

  -- Fuera de horario `avisos_horario` aparta la fila: que al entregarla
  -- también suene el teléfono, como cuando sale en el momento.
  PERFORM set_config('avisos.con_push', 'on', true);

  WITH salas AS (
    SELECT b.id AS branch_id, b.name AS sala
      FROM public.branches b
      JOIN public.erp_sucursal_map em ON em.branch_id = b.id AND NOT em.es_bodega
  ),
  -- La venta del día EN VIVO: el agregado diario no tiene el día en curso
  -- (ver encabezado de 20261024161848_cierre_del_dia_lee_la_venta_en_vivo). Misma
  -- cuenta que `refresh_sales_daily_stats`.
  viva AS (
    SELECT si.branch_id, sum(si.total::numeric) AS total
      FROM public.sales_invoices si
     WHERE si.fecha = v_fecha AND public.venta_valida(si.estado)
     GROUP BY si.branch_id
  ),
  np AS (
    SELECT v.branch_id, sum(v.total::numeric) AS total
      FROM public.ventas_sin_producto v
     WHERE v.fecha = v_fecha
     GROUP BY v.branch_id
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
           round(vv.total - coalesce(n.total, 0), 2)                 AS venta,
           m.monto_meta / v_dias                                     AS meta_dia,
           round((r.sum_total - r.sum_no_producto)::numeric, 2)      AS venta_ref,
           d.diferencia
      FROM salas s
      LEFT JOIN viva vv ON vv.branch_id = s.branch_id
      LEFT JOIN np   n  ON n.branch_id  = s.branch_id
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
  -- A quién le toca: sin porcentaje no hay tarjeta que dibujar, y a quien ya
  -- se le avisó no se le repite.
  a_avisar AS (
    SELECT d.employee_id
      FROM destinatarios d
     WHERE (SELECT pct FROM global) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                        WHERE a.recipient_id = d.employee_id AND a.clave = v_clave)
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
      FROM a_avisar d
    RETURNING recipient_id, title, body
  ),
  -- La marca sale de A QUIÉN se le avisó, no del RETURNING: una fila apartada
  -- por el horario no vuelve en el RETURNING y quedaba sin marca.
  marca AS (
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    SELECT v_clave, a.employee_id FROM a_avisar a
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*), array_agg(recipient_id), min(title), min(body)
    INTO v_n, v_ids, v_titulo, v_cuerpo
    FROM ins;

  PERFORM set_config('avisos.con_push', '', true);

  -- Al teléfono también (2026-09-23). `v_n` cuenta sólo las filas que salieron
  -- en el momento; las apartadas suenan al entregarse (`con_push`).
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
