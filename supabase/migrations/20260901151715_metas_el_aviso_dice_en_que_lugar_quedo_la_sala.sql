SET lock_timeout = '5s';

-- ── El mes no se cierra solo: se cierra CONTRA las otras cinco salas ───────
--
-- «Cerraste en 95.0%» no dice si eso estuvo bien. Agosto 2026 lo muestra
-- entero: 101.5, 97.7, 95.5, 95.0, 94.3, 89.2 — o sea que un 95.0% que suena a
-- casi-lo-logré es en realidad el cuarto lugar y por debajo del promedio, y un
-- 94.3% que suena parecido es el quinto. La distancia entre esas dos lecturas
-- es lo que el aviso no estaba diciendo.
--
-- ── Se compara en PORCENTAJE, nunca en dólares ─────────────────────────────
-- Salud 1 vendió $50,354.03 y Salud 5 $14,345.77: en dólares el ranking sería
-- el tamaño de la sala, que nadie eligió y nadie puede cambiar. El
-- cumplimiento sí es comparable — cada sala contra la meta que le tocó.
--
-- ── El listado completo va sólo a quien ya ve montos ────────────────────────
-- Que son los cinco jefes de sala. Reusar `dash_meta_sala_vista_completa` en
-- vez de inventar un permiso nuevo es deliberado: un permiso nuevo nace SIN
-- otorgar, y un permiso que falta no da error — da una tarjeta a la que
-- simplemente le falta un pedazo, que es indistinguible de una que salió bien.
-- Y el listado no dice dólares de nadie, así que revela menos de lo que ese
-- permiso ya autoriza.
--
-- El puesto y el promedio, en cambio, van para todos: son el contexto de un
-- número que el título ya dijo en voz alta.

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
  v_n           integer;
BEGIN
  IF p_ym_cerrado IS NULL OR p_ym_cerrado !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_ym_cerrado;
  END IF;

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
  -- El puesto sale con `rank()` y no con `row_number()`: dos salas que cierran
  -- en el mismo porcentaje empataron, y desempatarlas por el orden en que
  -- Postgres las devolvió sería inventar una diferencia que no existe.
  -- Una sala sin meta ese mes no tiene porcentaje, así que no entra al ranking
  -- ni al promedio — pero SÍ recibe su aviso.
  puestos AS (
    SELECT s.*,
           CASE WHEN s.pct IS NULL THEN NULL
                ELSE rank() OVER (PARTITION BY (s.pct IS NULL) ORDER BY s.pct DESC) END AS puesto,
           count(s.pct) OVER ()                        AS cuantas,
           ROUND(avg(s.pct) OVER (), 1)                AS promedio
    FROM salas s
  ),
  -- El listado, una sola vez para todas las filas: la misma tabla ordenada que
  -- va adentro del aviso de cada jefe.
  tabla AS (
    SELECT json_agg(json_build_object('sala', b.name, 'pct', p.pct)
                    ORDER BY p.pct DESC) AS filas
    FROM puestos p
    JOIN public.branches b ON b.id = p.branch_id
    WHERE p.pct IS NOT NULL
  ),
  destinatarios AS (
    SELECT e.id AS employee_id, s.branch_id, s.venta, s.meta_cerrada, s.pct, s.meta_nueva,
           s.puesto, s.cuantas, s.promedio,
           EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.module_key = 'dash_meta_sala_vista_completa'
                      AND rp.can_view
                      AND rp.role_id IN (e.role_id, e.secondary_role_id)) AS ve_montos
    FROM puestos s
    JOIN public.employees e ON e.branch_id = s.branch_id AND e.status = 'ACTIVO'
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
             'puesto',        d.puesto,
             'de',            d.cuantas,
             'promedio',      d.promedio
           )
           || CASE WHEN d.ve_montos
                   THEN jsonb_build_object(
                          'venta',      d.venta,
                          'meta',       d.meta_cerrada,
                          'meta_nueva', d.meta_nueva,
                          'tabla',      (SELECT filas FROM tabla))
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
  'Avisa a cada sala cómo cerró el mes, en qué lugar quedó entre las salas y cuál es su meta nueva. Dos cuerpos: con montos y con el listado completo para quien tiene dash_meta_sala_vista_completa, en porcentaje para el resto — y la metadata se parte igual, porque el destinatario puede leer su propia fila. El ranking es por cumplimiento, nunca por dólares. Idempotente por (persona, mes cerrado).';

REVOKE EXECUTE ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) TO service_role;
