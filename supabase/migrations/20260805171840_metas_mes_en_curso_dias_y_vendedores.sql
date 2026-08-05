SET lock_timeout = '5s';

-- Cómo va el mes en curso y quién lo está vendiendo, en UNA llamada.
--
-- Dos audiencias con dos permisos distintos: el módulo Metas (supervisión, que
-- puede pedir «todas» o una sala) y el widget de la sala en el Inicio (que
-- siempre ve la suya). El scope lo impone el servidor, no la pantalla.
--
-- Los días y los vendedores salen de `sales_invoices` —la misma fuente y los
-- mismos filtros de estado que `get_bono_meta_sala`— y por eso la función es
-- DEFINER: ningún rol de sala puede leer esa tabla, y por el camino ingenuo la
-- consulta no falla, devuelve cero filas (lección del widget, 2026-08-04).
CREATE OR REPLACE FUNCTION public.get_metas_mes_en_curso(p_branch_id bigint DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
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
  -- «días con venta» es el único dato de asistencia disponible hoy:
  -- `timesheets.absence_type` existe y está en cero, y `employee_events` tiene
  -- una sola fila. Cuando se registren las ausencias, acá cambia el
  -- denominador y la pantalla no se entera.
  SELECT json_agg(to_json(v) ORDER BY v.venta DESC) INTO v_vend
  FROM (
    SELECT e.id AS employee_id, e.name AS nombre,
           (SELECT b.name FROM public.branches b WHERE b.id = si.branch_id) AS sala,
           round(sum(si.total::numeric), 2) AS venta,
           count(*)::int AS tickets,
           round(sum(si.total::numeric) / count(*), 2) AS ticket,
           count(DISTINCT si.fecha)::int AS dias,
           round(sum(si.total::numeric) / count(DISTINCT si.fecha), 2) AS venta_dia
    FROM public.sales_invoices si
    JOIN public.employees e ON e.code = si.cod_vendedor AND e.status = 'ACTIVO'
    WHERE si.fecha BETWEEN v_ini AND v_fin
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (v_todas OR si.branch_id = v_branch)
      AND si.branch_id IN (SELECT s.branch_id FROM public.erp_sucursal_map s WHERE NOT s.es_bodega)
    GROUP BY e.id, e.name, si.branch_id
  ) v;

  SELECT round(avg((x->>'venta')::numeric), 2),
         round(avg((x->>'ticket')::numeric), 2),
         round(avg((x->>'venta_dia')::numeric), 2)
    INTO v_prom_venta, v_prom_ticket, v_prom_dia
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
    'promedio_dia',    v_prom_dia
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_metas_mes_en_curso(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_metas_mes_en_curso(bigint) TO authenticated, service_role;

-- Verificado en prod actuando como un usuario autenticado: «todas» devuelve
-- meta 241,503.53, acumulado 33,478.04, proyección 234,652.12, día 5 de 31,
-- ritmo 7,790.44/día, 5 días con venta y 34 vendedores; La Popular devuelve sus
-- 7 con ticket y días — Katherine con 1 día y $334.60, que por total es 6ª y
-- por día trabajado es 4ª.
