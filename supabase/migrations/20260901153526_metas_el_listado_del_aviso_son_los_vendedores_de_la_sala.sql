SET lock_timeout = '5s';

-- ── El listado son los VENDEDORES de la sala, no las otras salas ───────────
--
-- Corregido por el usuario: «los jefes no deben de ver las demás salas, debe de
-- ver cómo quedaron sus dependientes, lo que te pedí es el listado / ranking de
-- vendedores».
--
-- El aviso comparaba la sala contra las otras cinco. Eso ponía delante de cada
-- jefe el resultado de salas que no maneja, y dejaba afuera lo único sobre lo
-- que sí puede hacer algo: cómo le fue a su gente. El ranking pasa a ser el de
-- los vendedores de SU sala.
--
-- ── En porcentaje de la venta de la sala, nunca en dólares ─────────────────
-- Es lo que pidió («la venta de cada uno en porcentaje») y además es lo que
-- vuelve el listado seguro: una participación no dice cuánto vendió nadie en
-- plata. El módulo de Metas ya había tomado esta misma decisión — el ranking
-- del Inicio, sin `dash_vendedores_vista_completa`, muestra participación en
-- vez de montos.
--
-- ── El denominador es la venta de la sala; la LISTA, sus fichas ────────────
-- Dos conjuntos distintos, y confundirlos da un promedio falso. En La Popular,
-- agosto 2026 trae ONCE códigos de vendedor: seis son las fichas de la sala y
-- cinco son códigos sueltos —«el vendedor 20», «el vendedor 1»— con entre $1.25
-- y $254.19. Rankeando los once, el promedio de participación cae a 9.1% y Ana
-- Aleman (9.8%) queda «sobre el promedio» siendo la última de las seis reales.
--
-- Así que la lista se arma con las fichas ACTIVAS de esa sucursal, y la
-- participación se calcula igual sobre la venta COMPLETA de la sala. Las seis
-- de La Popular suman 99.3% y no 100%: la diferencia es real —es venta que no
-- hizo ninguna de ellas— y redondearla a 100 sería inventar.
--
-- Quien vendió ese mes y ya no está en la sala no aparece en la lista, pero su
-- venta sigue contando en el total. Es la lectura correcta: el listado dice
-- «cómo quedaron tus dependientes», no «quién facturó con qué código».

CREATE OR REPLACE FUNCTION public.metas_avisar_cierre_a_salas(
  p_ym_cerrado text,
  p_ultimo_intento boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_ym_nuevo    text := to_char(((p_ym_cerrado || '-01')::date + interval '1 month')::date, 'YYYY-MM');
  v_dias_mes    integer := EXTRACT(day FROM ((p_ym_cerrado || '-01')::date + interval '1 month -1 day'))::int;
  v_fini        date;
  v_ffin        date;
  v_n           integer;
BEGIN
  IF p_ym_cerrado IS NULL OR p_ym_cerrado !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_ym_cerrado;
  END IF;
  v_fini := (p_ym_cerrado || '-01')::date;
  v_ffin := (v_fini + interval '1 month -1 day')::date;

  WITH
  cerrado AS (
    SELECT d.branch_id::bigint AS branch_id,
           SUM(d.sum_total - d.sum_no_producto)::numeric AS venta,
           COUNT(*)::int AS dias_dato
    FROM public.sales_daily_stats d
    WHERE to_char(d.date, 'YYYY-MM') = p_ym_cerrado
    GROUP BY 1
  ),
  salas AS (
    SELECT c.branch_id,
           -- El congelado manda cuando ya existe: la campana no puede decir un
           -- número y el histórico otro.
           COALESCE(res.venta_total, ROUND(c.venta, 2)) AS venta,
           mv.monto_meta AS meta_cerrada,
           COALESCE(res.pct_cumplimiento,
                    CASE WHEN mv.monto_meta > 0
                         THEN ROUND(c.venta / mv.monto_meta * 100, 1) END) AS pct,
           mn.monto_meta AS meta_nueva
    FROM cerrado c
    JOIN public.erp_sucursal_map em ON em.branch_id = c.branch_id AND NOT em.es_bodega
    LEFT JOIN public.metas_sucursal mv
           ON mv.branch_id = c.branch_id AND mv.year_month = p_ym_cerrado
    LEFT JOIN public.metas_resultado res
           ON res.branch_id = c.branch_id AND res.year_month = p_ym_cerrado
    LEFT JOIN public.metas_sucursal mn
           ON mn.branch_id = c.branch_id AND mn.year_month = v_ym_nuevo
          AND mn.estado = 'oficial'
    -- Un mes con días faltantes daría un resultado bajo, y ya estaría dicho.
    WHERE (c.dias_dato = v_dias_mes OR res.year_month IS NOT NULL)
      AND (mn.year_month IS NOT NULL OR p_ultimo_intento)
  ),
  -- MATERIALIZED a propósito: esta función tarda ~4.3 s para las siete
  -- sucursales de un mes, y abajo se la lee dos veces (el puesto propio y el
  -- listado). Sin la cerca, Postgres podría correrla una vez por lectura.
  vend AS MATERIALIZED (
    SELECT * FROM public.get_vendedores_resumen(v_fini, v_ffin, NULL)
  ),
  venta_sala AS (
    SELECT branch_id, SUM(total_ventas) AS total FROM vend GROUP BY 1
  ),
  vendedores AS MATERIALIZED (
    SELECT x.*,
           rank()  OVER (PARTITION BY x.branch_id ORDER BY x.parte DESC) AS puesto,
           count(*) OVER (PARTITION BY x.branch_id)                      AS cuantos,
           ROUND(avg(x.parte) OVER (PARTITION BY x.branch_id), 1)        AS promedio
    FROM (
      SELECT v.branch_id, v.cod_vendedor, e2.name AS nombre,
             ROUND(v.total_ventas / NULLIF(t.total, 0) * 100, 1) AS parte
      FROM vend v
      JOIN venta_sala t ON t.branch_id = v.branch_id
      JOIN public.employees e2
        ON e2.code = v.cod_vendedor AND e2.branch_id = v.branch_id AND e2.status = 'ACTIVO'
    ) x
  ),
  destinatarios AS (
    SELECT e.id AS employee_id, e.code AS mi_codigo,
           s.branch_id, s.venta, s.meta_cerrada, s.pct, s.meta_nueva,
           mio.parte AS mi_parte, mio.puesto AS mi_puesto,
           mio.cuantos AS de, mio.promedio,
           EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.module_key = 'dash_meta_sala_vista_completa'
                      AND rp.can_view
                      AND rp.role_id IN (e.role_id, e.secondary_role_id)) AS ve_montos
    FROM salas s
    JOIN public.employees e ON e.branch_id = s.branch_id AND e.status = 'ACTIVO'
    LEFT JOIN vendedores mio
           ON mio.branch_id = s.branch_id AND mio.cod_vendedor = e.code
    WHERE EXISTS (SELECT 1 FROM public.role_permissions rp
                   WHERE rp.module_key = 'dash_meta_sala'
                     AND rp.can_view
                     AND rp.role_id IN (e.role_id, e.secondary_role_id))
  ),
  ins AS (
    INSERT INTO public.notifications
      (recipient_id, type, title, body, link, metadata, branch_id)
    SELECT d.employee_id,
           'METAS_CIERRE_SALA',
           CASE WHEN d.pct IS NULL
                THEN 'Así cerró ' || public.metas_mes_label(p_ym_cerrado)
                ELSE 'Cerraste ' || public.metas_mes_label(p_ym_cerrado) || ' en ' || d.pct || '%'
           END,
           -- Primera oración: el mes que cerró. Segunda: el que empieza.
           CASE
             WHEN d.ve_montos AND d.pct IS NOT NULL THEN
               'Vendiste $' || to_char(d.venta, 'FM999,999,990.00')
               || ' de tu meta de $' || to_char(d.meta_cerrada, 'FM999,999,990.00') || '. '
             WHEN d.ve_montos THEN
               'Vendiste $' || to_char(d.venta, 'FM999,999,990.00')
               || '. Ese mes no tuvo meta. '
             ELSE ''
           END
           ||
           CASE
             WHEN d.meta_nueva IS NULL THEN
               'Tu meta de ' || public.metas_mes_label(v_ym_nuevo) || ' todavía se está definiendo.'
             WHEN d.ve_montos THEN
               'Tu meta de ' || public.metas_mes_label(v_ym_nuevo)
               || ' es $' || to_char(d.meta_nueva, 'FM999,999,990.00') || '.'
             ELSE
               'Tu meta de ' || public.metas_mes_label(v_ym_nuevo)
               || ' ya está publicada. Mírala en Inicio.'
           END,
           '/overview',
           -- Las etiquetas de mes viajan armadas para que la tarjeta no tenga
           -- que traducir '2026-08' por su cuenta: el rótulo lo escribe la
           -- MISMA función que lo escribe en el título.
           jsonb_build_object(
             'ym_cerrado',    p_ym_cerrado,
             'ym_nuevo',      v_ym_nuevo,
             'mes_cerrado',   public.metas_mes_label(p_ym_cerrado),
             'mes_nuevo',     public.metas_mes_label(v_ym_nuevo),
             'pct',           d.pct,
             -- El puesto propio va para TODOS: es de la persona, y no dice
             -- plata. Nulo para quien no vendió ese mes (un regente, alguien
             -- que entró después) — y ahí la tarjeta simplemente no lo pinta.
             'mi_parte',      d.mi_parte,
             'puesto',        d.mi_puesto,
             'de',            d.de,
             'promedio',      d.promedio
           )
           || CASE WHEN d.ve_montos
                   THEN jsonb_build_object(
                          'venta',      d.venta,
                          'meta',       d.meta_cerrada,
                          'meta_nueva', d.meta_nueva,
                          -- El listado se arma POR DESTINATARIO para poder
                          -- marcarle su propia fila sin publicar el código de
                          -- nadie: `employees.code` es la semilla del PIN del
                          -- kiosco (SHA-256 del código), así que no puede
                          -- viajar en la metadata de un aviso ajeno.
                          'tabla', (
                            SELECT json_agg(json_build_object(
                                     'nombre', x.nombre,
                                     'parte',  x.parte,
                                     'yo',     x.cod_vendedor = d.mi_codigo)
                                   ORDER BY x.parte DESC)
                            FROM vendedores x
                            WHERE x.branch_id = d.branch_id))
                   ELSE '{}'::jsonb
              END,
           d.branch_id::integer
    FROM destinatarios d
    -- Una vez por persona y por mes cerrado: la ventana del 1 al 5 reintenta,
    -- no repite.
    WHERE NOT EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.recipient_id = d.employee_id
         AND n.type = 'METAS_CIERRE_SALA'
         AND n.metadata ->> 'ym_cerrado' = p_ym_cerrado
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) IS
  'Avisa a cada sala cómo cerró el mes, en qué lugar quedó la persona entre los vendedores de SU sala y cuál es su meta nueva. Dos cuerpos: con montos y con el listado de vendedores para quien tiene dash_meta_sala_vista_completa, en porcentaje para el resto. El listado es de participación en la venta de la sala, nunca de dólares, y se arma por destinatario para marcarle su fila sin publicar el código de nadie. Idempotente por (persona, mes cerrado).';

REVOKE EXECUTE ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) TO service_role;
