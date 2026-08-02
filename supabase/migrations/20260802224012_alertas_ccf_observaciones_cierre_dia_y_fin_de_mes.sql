SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Tres avisos de CCF, pedidos el 2026-08-02.
--
-- Lo que YA existia: `check-sales-alerts` corre cada 5 minutos de 06:00 a
-- 23:59 SV y avisa de los CCF del dia sin sello o anulados sin completar.
-- Lo que faltaba:
--   1. que las OBSERVACIONES tambien avisen (hoy solo se ven entrando a la
--      pestaña);
--   2. un repaso a las 22:00 SV de lo que siga sin corregir — imposible hasta
--      hoy porque `sales_alert_log` excluye para siempre lo ya avisado;
--   3. un aviso el ULTIMO dia del mes, que es cuando todavia se puede corregir.
--      El unico cron de cierre corre el dia 1, o sea despues.
--
-- Los tres avisan SOLO SI HAY ALGO. Un aviso que suena todas las noches diciendo
-- "no hay nada" deja de mirarse, y entonces tampoco se ve el que si importa.
--
-- (La primera version de `get_ccf_con_problema` que traia esta migracion tenia
-- un defecto en como apagaba los avisos ya resueltos; lo corrige
-- 20260802224144, que es la vigente. El resto de esta migracion sigue en pie.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── El aviso inmediato ahora incluye las observaciones ──────────────────────
CREATE OR REPLACE FUNCTION public.get_ccf_alerts()
 RETURNS TABLE(branch_id bigint, branch_name text, correlativo text, tipo text, estado text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH today_date AS (
    SELECT (current_timestamp AT TIME ZONE 'America/El_Salvador')::date AS d
  ),
  problemas AS (
    SELECT p.branch_id, p.branch_name, p.correlativo, p.estado, p.problemas
    FROM today_date t, public.get_ccf_con_problema(t.d, t.d) p
  )
  SELECT p.branch_id, p.branch_name, p.correlativo,
         CASE
           WHEN p.estado = 'NULA' THEN 'ccf_null'
           WHEN EXISTS (SELECT 1 FROM unnest(p.problemas) x WHERE x LIKE 'sin sello%')
             THEN 'ccf_pending'
           ELSE 'ccf_observacion'
         END AS tipo,
         p.estado
  FROM problemas p
  WHERE NOT EXISTS (
      SELECT 1 FROM public.sales_alert_log l
      WHERE l.branch_id  = p.branch_id
        AND l.alert_type = CASE
              WHEN p.estado = 'NULA' THEN 'ccf_null'
              WHEN EXISTS (SELECT 1 FROM unnest(p.problemas) x WHERE x LIKE 'sin sello%')
                THEN 'ccf_pending'
              ELSE 'ccf_observacion' END
        AND l.alert_key  = p.correlativo
  );
$function$;

-- ── El repaso de las 22:00 y el del ultimo dia del mes ──────────────────────
--
-- `p_modo`:
--   'cierre_dia' → los CCF de HOY que sigan con problema.
--   'fin_de_mes' → todos los del mes en curso.
--
-- La clave del log lleva la FECHA, asi que el repaso puede volver a sonar cada
-- noche mientras el problema siga. Eso es lo contrario del aviso inmediato, y a
-- proposito: uno anuncia que algo aparecio, el otro recuerda que sigue ahi.
CREATE OR REPLACE FUNCTION public.get_ccf_repaso(p_modo text)
 RETURNS TABLE(branch_id bigint, branch_name text, correlativo text,
               fecha date, estado text, total numeric, problemas text[], alert_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH hoy AS (
        SELECT (current_timestamp AT TIME ZONE 'America/El_Salvador')::date AS d
    ),
    rango AS (
        SELECT CASE WHEN p_modo = 'fin_de_mes' THEN date_trunc('month', h.d)::date ELSE h.d END AS desde,
               h.d AS hasta, h.d AS dia
        FROM hoy h
    )
    SELECT p.branch_id, p.branch_name, p.correlativo, p.fecha, p.estado, p.total,
           p.problemas,
           p_modo || '|' || r.dia::text || '|' || p.correlativo AS alert_key
    FROM rango r, public.get_ccf_con_problema(r.desde, r.hasta) p
    WHERE NOT EXISTS (
        SELECT 1 FROM public.sales_alert_log l
         WHERE l.branch_id  = p.branch_id
           AND l.alert_type = 'ccf_repaso'
           AND l.alert_key  = p_modo || '|' || r.dia::text || '|' || p.correlativo
    );
$function$;

COMMENT ON FUNCTION public.get_ccf_repaso(text) IS
  'El repaso de las 22:00 (modo cierre_dia) y el del ultimo dia del mes (modo fin_de_mes). La alert_key incluye la fecha para que pueda volver a sonar cada noche mientras el problema siga sin resolverse — el aviso inmediato usa una clave sin fecha y suena una sola vez. Devuelve vacio si no hay nada: quien lo llama NO debe mandar un aviso de "todo bien".';

REVOKE EXECUTE ON FUNCTION public.get_ccf_repaso(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ccf_repaso(text) TO authenticated, service_role;

-- ── ¿Hoy es el ultimo dia del mes en El Salvador? ──────────────────────────
-- Vive en la base y no en el cron porque un cron no sabe expresar "el ultimo
-- dia del mes": habria que programarlo del 28 al 31 y filtrar igual.
CREATE OR REPLACE FUNCTION public.es_ultimo_dia_del_mes_sv()
 RETURNS boolean
 LANGUAGE sql STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT (current_timestamp AT TIME ZONE 'America/El_Salvador')::date
         = (date_trunc('month', (current_timestamp AT TIME ZONE 'America/El_Salvador'))
            + interval '1 month' - interval '1 day')::date;
$function$;
