SET lock_timeout = '5s';

-- El interruptor del bono, con vigencia (pedido del usuario, 2026-08-10).
--
-- `bonificaciones_activas` ya existía como un booleano global, pero no había
-- forma de encenderlo y que se apagara solo: o quedaba prendido para siempre o
-- alguien tenía que acordarse de apagarlo. Ahora el encendido dice HASTA CUÁNDO.
--
--   activas = false                          → apagado
--   activas = true  · hasta_ym = NULL        → encendido, indefinido
--   activas = true  · hasta_ym = '2026-08'   → encendido sólo hasta ese mes
--
-- Y como la respuesta depende del mes que se esté mirando, la regla NO se
-- resuelve en el navegador: vive en `metas_bono_activo(ym)` y los RPC devuelven
-- el resultado ya resuelto. Si se resolviera en el frontend, cada pantalla
-- tendría su copia y el día que cambie la regla una de ellas se quedaría vieja
-- —y sería la del Inicio, que es la que ve la sala.
ALTER TABLE public.metas_config
  ADD COLUMN IF NOT EXISTS bonificaciones_hasta_ym text;

COMMENT ON COLUMN public.metas_config.bonificaciones_hasta_ym IS
  'Último mes (YYYY-MM) con bonificaciones activas; NULL = indefinido. Sólo tiene efecto con bonificaciones_activas = true.';

-- La regla, en un solo sitio.
CREATE OR REPLACE FUNCTION public.metas_bono_activo(p_year_month text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT coalesce((
    SELECT c.bonificaciones_activas
           AND (c.bonificaciones_hasta_ym IS NULL OR p_year_month <= c.bonificaciones_hasta_ym)
    FROM public.metas_config c
    LIMIT 1
  ), false);
$$;

COMMENT ON FUNCTION public.metas_bono_activo(text) IS
  '¿Las bonificaciones estaban/están activas para ese mes? Única fuente de la regla: la usan get_meta_sala, get_bono_meta_sala y la pestaña Bono.';

-- El interruptor se escribe desde la pestaña Bono, y sólo quien puede editar
-- Metas. `p_solo_este_mes` es lo que separa «este mes» de «indefinido»; el mes
-- lo pone el servidor, no el llamador, para que no se pueda encender un mes que
-- no es el de hoy.
CREATE OR REPLACE FUNCTION public.set_bonificaciones_metas(
  p_activas        boolean,
  p_solo_este_mes  boolean DEFAULT false
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ym text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
  v_activas boolean := coalesce(p_activas, false);
  v_hasta text;
BEGIN
  IF NOT public.auth_has_module_permission('metas', 'can_edit') THEN
    RAISE EXCEPTION 'Sin permiso para cambiar las bonificaciones';
  END IF;

  v_hasta := CASE WHEN v_activas AND coalesce(p_solo_este_mes, false) THEN v_ym END;

  UPDATE public.metas_config
     SET bonificaciones_activas  = v_activas,
         bonificaciones_hasta_ym = v_hasta;

  RETURN json_build_object(
    'bonificaciones_activas',  v_activas,
    'bonificaciones_hasta_ym', v_hasta,
    'vigente_este_mes',        public.metas_bono_activo(v_ym)
  );
END;
$$;

COMMENT ON FUNCTION public.set_bonificaciones_metas(boolean, boolean) IS
  'Enciende o apaga las bonificaciones desde la pestaña Bono. Con p_solo_este_mes la vigencia queda en el mes en curso (día de negocio SV) y el bono se apaga solo al cambiar de mes.';

-- Los dos RPC que publican el estado dejan de leer el booleano crudo y pasan
-- por la regla, cada uno con SU mes.
CREATE OR REPLACE FUNCTION public.get_meta_sala(p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(branch_id bigint, sala text, year_month text, monto_meta numeric, estado text, venta_acumulada numeric, venta_hoy numeric, pct_cumplimiento numeric, proyeccion numeric, pct_proyectado numeric, bono_tier text, dias_transcurridos integer, dias_mes integer, dias_restantes integer, falta numeric, ritmo_necesario numeric, umbral_medio numeric, umbral_total numeric, bonificaciones_activas boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch bigint;
    v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_ym     text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
BEGIN
    IF NOT auth_has_module_permission('dash_meta_sala', 'can_view') THEN
        RETURN;
    END IF;

    IF auth_module_scope('dash_meta_sala') = 'ALL' THEN
        v_branch := COALESCE(p_branch_id, auth_employee_branch_id());
    ELSE
        v_branch := auth_employee_branch_id();
    END IF;

    IF v_branch IS NULL THEN
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.erp_sucursal_map m
        WHERE m.branch_id = v_branch AND NOT m.es_bodega
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH d AS (
        SELECT * FROM public.get_metas_dashboard(v_ym) g WHERE g.branch_id = v_branch
    ),
    h AS (
        SELECT COALESCE(SUM(si.total::numeric), 0) AS neto
        FROM public.sales_invoices si
        WHERE si.branch_id = v_branch
          AND si.fecha = v_hoy
          AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    )
    SELECT
        d.branch_id,
        b.name::text,
        v_ym,
        d.monto_meta,
        d.estado,
        d.venta_acumulada,
        ROUND(h.neto, 2),
        d.pct_cumplimiento,
        d.proyeccion,
        d.pct_proyectado,
        d.bono_tier,
        d.dias_transcurridos,
        d.dias_mes,
        (d.dias_mes - d.dias_transcurridos + 1)::integer,
        CASE WHEN d.monto_meta IS NOT NULL
             THEN GREATEST(0, ROUND(d.monto_meta - d.venta_acumulada, 2)) END,
        CASE WHEN d.monto_meta IS NOT NULL
              AND (d.dias_mes - d.dias_transcurridos + 1) > 0
             THEN ROUND(GREATEST(0, d.monto_meta - d.venta_acumulada)
                        / (d.dias_mes - d.dias_transcurridos + 1), 2) END,
        c.umbral_bono_medio,
        c.umbral_bono_total,
        -- Antes: `c.bonificaciones_activas` crudo, que ignora la vigencia.
        public.metas_bono_activo(v_ym)
    FROM d
    CROSS JOIN h
    JOIN public.branches b ON b.id = d.branch_id
    CROSS JOIN public.metas_config c;
END;
$function$;

-- `get_bono_meta_sala` son 8,800 caracteres de reparto de dinero y acá cambia
-- UNA línea: reescribirla entera a mano sería arriesgar un error de
-- transcripción en la parte que menos lo tolera. Se parchea sobre su propia
-- definición, y si el punto no aparece la migración FALLA en vez de no hacer
-- nada — un `replace` que no encuentra su patrón devuelve el texto igual y se
-- aplicaría sin cambiar nada, en silencio.
DO $mig$
DECLARE
  v_def   text;
  v_nuevo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_bono_meta_sala';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'No existe public.get_bono_meta_sala';
  END IF;

  v_nuevo := replace(
    v_def,
    '''bonificaciones_activas'', v_cfg.bonificaciones_activas',
    '''bonificaciones_activas'', public.metas_bono_activo(p_year_month)'
  );

  IF v_nuevo = v_def THEN
    RAISE EXCEPTION 'get_bono_meta_sala ya no publica bonificaciones_activas como se esperaba — revisar a mano';
  END IF;

  EXECUTE v_nuevo;
END
$mig$;

REVOKE EXECUTE ON FUNCTION public.metas_bono_activo(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.metas_bono_activo(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.set_bonificaciones_metas(boolean, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_bonificaciones_metas(boolean, boolean) TO authenticated, service_role;
