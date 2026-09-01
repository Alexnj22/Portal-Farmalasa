SET lock_timeout = '5s';

-- ── El cierre de mes, para administración ──────────────────────────────────
--
-- Las seis salas ya se enteran de cómo cerraron. Administración no se enteraba
-- de nada: la única pantalla que junta las seis es el módulo de Metas, y hay
-- que ir a buscarla. El 1 a las 08:00 el mes está completo y ese es el momento
-- en que el dato vale.
--
-- Tres cosas, en el orden en que se miran: cuánto cumplió la EMPRESA, cómo
-- quedó cada sucursal, y quiénes fueron los tres que más vendieron.
--
-- ── Quiénes lo reciben ─────────────────────────────────────────────────────
-- «Admin» en este negocio son cuatro cargos y no el rol llamado Administrador:
-- Gerente General (2), Administrador (3), Jefe/a de Talento Humano (11) y
-- Supervisor/a de Ventas (13). Se resuelve por `role_permissions` y no por una
-- lista de ids escrita acá: el día que se cree un cargo de dirección, el aviso
-- lo alcanza solo.
--
-- ⚠️ La clave de módulo que usa esta versión —`metas_ver`— NO EXISTE. La
-- corrige `20260901154043`, que además la mete en el ciclo diario: acá quedó
-- escrita y sin llamador.
--
-- ── El global se calcula sumando, no promediando ───────────────────────────
-- El cumplimiento de la empresa es la venta total sobre la meta total. El
-- promedio de los seis porcentajes daría otro número —le da el mismo peso a
-- Salud 5 ($14,345.77) que a Salud 1 ($50,354.03)— y sería el número equivocado
-- para decir si la empresa cumplió.
--
-- ── El top 3 va por venta, y eso tiene un costo declarado ──────────────────
-- Rankear por venta total premia a quien más horas estuvo. El módulo de Metas
-- ya midió esto y por eso su ranking tiene «por día» y «por hora»: en agosto,
-- Katherine Salinas quedaba 6ª por total y 1ª por hora. Un aviso no puede
-- llevar un interruptor, y «los tres que más vendieron» es lo que la frase
-- significa en la sala, así que va por total — pero conviene saber que no es
-- lo mismo que «los tres mejores».

CREATE OR REPLACE FUNCTION public.metas_avisar_cierre_a_admin(
  p_ym_cerrado text,
  p_ultimo_intento boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_ym_nuevo   text := to_char(((p_ym_cerrado || '-01')::date + interval '1 month')::date, 'YYYY-MM');
  v_dias_mes   integer := EXTRACT(day FROM ((p_ym_cerrado || '-01')::date + interval '1 month -1 day'))::int;
  v_fini       date;
  v_ffin       date;
  v_n          integer;
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
    SELECT c.branch_id, b.name AS sala,
           COALESCE(res.venta_total, ROUND(c.venta, 2)) AS venta,
           mv.monto_meta AS meta,
           COALESCE(res.pct_cumplimiento,
                    CASE WHEN mv.monto_meta > 0
                         THEN ROUND(c.venta / mv.monto_meta * 100, 1) END) AS pct
    FROM cerrado c
    JOIN public.erp_sucursal_map em ON em.branch_id = c.branch_id AND NOT em.es_bodega
    JOIN public.branches b ON b.id = c.branch_id
    LEFT JOIN public.metas_sucursal mv
           ON mv.branch_id = c.branch_id AND mv.year_month = p_ym_cerrado
    LEFT JOIN public.metas_resultado res
           ON res.branch_id = c.branch_id AND res.year_month = p_ym_cerrado
    -- El aviso de administración exige el mes COMPLETO en las seis: un día que
    -- falte en una sola sala mueve el global de la empresa.
    WHERE (c.dias_dato = v_dias_mes OR res.year_month IS NOT NULL)
  ),
  global AS (
    SELECT SUM(venta) AS venta, SUM(meta) AS meta, COUNT(*) AS cuantas,
           CASE WHEN SUM(meta) > 0 THEN ROUND(SUM(venta) / SUM(meta) * 100, 1) END AS pct
    FROM salas
  ),
  vend AS MATERIALIZED (
    SELECT * FROM public.get_vendedores_resumen(v_fini, v_ffin, NULL)
  ),
  top3 AS (
    SELECT json_agg(json_build_object(
             'employee_id', t.id, 'nombre', t.name, 'sala', t.sala, 'venta', t.total_ventas)
           ORDER BY t.total_ventas DESC) AS filas
    FROM (
      SELECT e.id, e.name, b.name AS sala, v.total_ventas
      FROM vend v
      JOIN public.employees e
        ON e.code = v.cod_vendedor AND e.branch_id = v.branch_id AND e.status = 'ACTIVO'
      JOIN public.branches b ON b.id = v.branch_id
      JOIN public.erp_sucursal_map em ON em.branch_id = v.branch_id AND NOT em.es_bodega
      ORDER BY v.total_ventas DESC
      LIMIT 3
    ) t
  ),
  destinatarios AS (
    SELECT e.id AS employee_id
    FROM public.employees e
    WHERE e.status = 'ACTIVO'
      AND COALESCE(e.tipo_ficha, 'empleado') = 'empleado'
      AND EXISTS (SELECT 1 FROM public.role_permissions rp
                   WHERE rp.module_key = 'metas_ver' AND rp.can_view
                     AND rp.role_id IN (e.role_id, e.secondary_role_id))
      -- Quien está EN una sala ya recibe el aviso de su sala; éste es el de
      -- quien mira las seis.
      AND NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map em
                       WHERE em.branch_id = e.branch_id AND NOT em.es_bodega)
  ),
  ins AS (
    INSERT INTO public.notifications
      (recipient_id, type, title, body, link, metadata)
    SELECT d.employee_id,
           'METAS_CIERRE_EMPRESA',
           'La empresa cerró ' || public.metas_mes_label(p_ym_cerrado)
             || ' en ' || (SELECT pct FROM global) || '%',
           'Las ' || (SELECT cuantas FROM global) || ' salas vendieron $'
             || to_char((SELECT venta FROM global), 'FM999,999,990.00')
             || ' de una meta de $' || to_char((SELECT meta FROM global), 'FM999,999,990.00')
             || '. Las metas de ' || public.metas_mes_label(v_ym_nuevo) || ' ya están publicadas.',
           '/metas',
           jsonb_build_object(
             'ym_cerrado',  p_ym_cerrado,
             'ym_nuevo',    v_ym_nuevo,
             'mes_cerrado', public.metas_mes_label(p_ym_cerrado),
             'mes_nuevo',   public.metas_mes_label(v_ym_nuevo),
             'pct',         (SELECT pct   FROM global),
             'venta',       (SELECT venta FROM global),
             'meta',        (SELECT meta  FROM global),
             'sucursales',  (SELECT json_agg(json_build_object('sala', s.sala, 'pct', s.pct)
                                             ORDER BY s.pct DESC NULLS LAST) FROM salas s),
             'top3',        (SELECT filas FROM top3))
    FROM destinatarios d
    WHERE (SELECT pct FROM global) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.recipient_id = d.employee_id
           AND n.type = 'METAS_CIERRE_EMPRESA'
           AND n.metadata ->> 'ym_cerrado' = p_ym_cerrado
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.metas_avisar_cierre_a_admin(text, boolean) IS
  'El cierre del mes para administración: cumplimiento global de la empresa (venta total sobre meta total, no el promedio de los seis porcentajes), cada sucursal con su porcentaje, y los tres vendedores con más venta. Va a quien puede ver metas y NO está en una sala. Idempotente por (persona, mes cerrado).';

REVOKE EXECUTE ON FUNCTION public.metas_avisar_cierre_a_admin(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.metas_avisar_cierre_a_admin(text, boolean) TO service_role;

