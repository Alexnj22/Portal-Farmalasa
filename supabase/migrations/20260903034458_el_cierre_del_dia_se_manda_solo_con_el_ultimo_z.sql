SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El cierre del día se manda solo, cuando entra el último corte Z.
--
-- La TARJETA existe desde v2.951.0 (`datosDeCierreDelDia` + `CierreDeMeta.jsx`)
-- y se aprobó con una notificación insertada A MANO. Lo que faltaba es esto: la
-- función que arma los números y el disparador que decide cuándo.
--
-- ── Cuándo: al entrar el sexto Z, no a una hora ────────────────────────────
-- Pedido del usuario: «al tener todos los cortes Z (de cada sucursal) arma el
-- mensaje y los calculos de resultado diario y lo manda». Las salas no cierran
-- todas a la misma hora —el 2-sep, entre las 19:03 y las 21:02— así que una
-- hora fija o llega temprano con salas abiertas o llega tarde siempre.
--
-- Pero un disparador que espera a TODOS necesita una salida: el día que una
-- sala no cierre, el aviso no saldría nunca y nadie se enteraría de que faltó.
-- Por eso el cron de las 23:50 lo manda IGUAL con `p_forzado`, y la tarjeta
-- dice «No cerraron: …» — que es justamente la noticia de esa noche.
--
-- ── Los números, verificados contra la tarjeta que el usuario aprobó ────────
-- Reproducen al centavo el aviso del 1-sep:
--   $7,302.34 de $7,781.63 · 94% · 11% menos que el martes pasado
--   Salud 5 135% · Salud 2 107% · Salud 1 96% · Salud 4 88% · La Popular 85% ·
--   Salud 3 77%
--
--  · **La venta es NETA y sin lo que no es producto** (`sum_total -
--    sum_no_producto`), la misma fuente y la misma resta que usa el cierre de
--    mes. Nada de ingresos ni vales: eso es movimiento de caja, no venta.
--  · **La meta del día es la del mes repartida entre sus días.** No existía el
--    concepto en la base; se define acá y se dice en el aviso.
--  · **El % global se calcula sumando, no promediando** — igual que el de mes.
--    El promedio de los seis porcentajes le daría el mismo peso a Salud 5
--    ($717) que a Salud 1 ($1,569), y sería el número equivocado para decir si
--    la empresa cumplió el día.
--  · **La comparación es contra el MISMO día de la semana pasada**, no contra
--    ayer: un martes contra un lunes no dice nada. El «contra qué» viaja dentro
--    del dato (`contra_texto`) para que la tarjeta no tenga que adivinarlo.
--  · **La diferencia de caja sale del último corte CONFIRMADO** de la sala, con
--    `corte_diferencia` —el canónico, gemelo del de la pantalla—. `NULL` no es
--    cero: es «no se pudo saber», y la tarjeta lo dice distinto («Sin corte
--    confirmado: …»). Confundirlos daría por cuadrada una caja que nadie contó.
--
-- ── Una sola vez por día ───────────────────────────────────────────────────
-- La marca va en `avisos_emitidos` (`CIERRE_DEL_DIA:<fecha>`) y no en la
-- notificación misma. Es la lección del 2-sep: el cierre de agosto salió DOS
-- veces porque la guarda preguntaba «¿todavía la tiene?» y la campana se puede
-- vaciar. Acá el disparador es un trigger que puede correr seis veces por día
-- (una por Z) más el cron, o sea que sin marca durable saldría siete veces.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.avisar_cierre_del_dia(
  p_fecha   date    DEFAULT NULL,
  p_forzado boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
    RETURNING recipient_id
  ),
  marca AS (
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    SELECT v_clave, i.recipient_id FROM ins i
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_cierre_del_dia(date, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.avisar_cierre_del_dia(date, boolean) TO service_role;


-- ── El disparador: el último Z del día ─────────────────────────────────────
-- Corre en el INSERT del Z, o sea cuando `sync-cortes-caja` lo captura. La
-- función se encarga de no mandar nada si todavía falta una sala, así que el
-- trigger no necesita saber contar: dispara seis veces y sólo la última hace
-- algo. La marca en `avisos_emitidos` cierra el caso de que dos Z entren en la
-- misma corrida.
CREATE OR REPLACE FUNCTION public.cortes_caja_avisar_cierre_del_dia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF NEW.tipo <> 'Z' THEN RETURN NULL; END IF;

  -- El repaso de las 23:40 y una recarga manual pueden traer días viejos.
  -- Avisar del cierre de la semana pasada es el ruido que enseña a ignorar la
  -- campana — misma ventana que usa `notificar_corte_de_caja`.
  IF NEW.fecha < ((now() AT TIME ZONE 'America/El_Salvador')::date - 1) THEN
    RETURN NULL;
  END IF;

  PERFORM public.avisar_cierre_del_dia(NEW.fecha, false);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cortes_caja_cierre_del_dia ON public.cortes_caja;
CREATE TRIGGER trg_cortes_caja_cierre_del_dia
  AFTER INSERT ON public.cortes_caja
  FOR EACH ROW EXECUTE FUNCTION public.cortes_caja_avisar_cierre_del_dia();
