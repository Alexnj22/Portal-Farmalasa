SET lock_timeout = '5s';

-- ── El cierre del mes deja de estar SÓLO dentro de la frase ────────────────
--
-- El aviso decía «Vendiste $39,103.10 de tu meta de $41,155.66…» y las tres
-- cifras vivían nada más adentro del párrafo: la campana no podía dibujar nada
-- porque no tenía los números, sólo la oración que los nombra. Ahora viajan
-- también como datos, y el cuerpo de texto se queda IGUAL — es el respaldo, lo
-- que se lee si el aviso llega a un sitio que no sabe pintar la tarjeta.
--
-- ── Por qué los montos NO van para todos ───────────────────────────────────
-- La misma regla que parte el cuerpo en dos parte la metadata. Quien no tiene
-- `dash_meta_sala_vista_completa` recibe un cuerpo sin dólares A PROPÓSITO (28
-- de las 33 personas de sala), y su fila de `notifications` la puede leer
-- entera: su RLS es `recipient_id = auth_employee_id()`. O sea que meter
-- `venta`, `meta` o `meta_nueva` en la metadata de todos publicaría por la
-- puerta de atrás exactamente lo que el cuerpo se cuida de no decir.
--
-- `meta_nueva` está adentro de esa guarda por el mismo motivo, aunque hable del
-- mes que empieza: también es un monto, y a quien no ve montos el cuerpo sólo
-- le dice que su meta «ya está publicada».
--
-- `pct` sí va para todos: es el número que el título YA dice en voz alta.

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
  destinatarios AS (
    SELECT e.id AS employee_id, s.branch_id, s.venta, s.meta_cerrada, s.pct, s.meta_nueva,
           EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.module_key = 'dash_meta_sala_vista_completa'
                      AND rp.can_view
                      AND rp.role_id IN (e.role_id, e.secondary_role_id)) AS ve_montos
    FROM salas s
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
             'pct',           d.pct
           )
           || CASE WHEN d.ve_montos
                   THEN jsonb_build_object(
                          'venta',      d.venta,
                          'meta',       d.meta_cerrada,
                          'meta_nueva', d.meta_nueva)
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
  'Avisa a cada sala cómo cerró el mes y cuál es su meta nueva. Dos cuerpos: con montos para quien tiene dash_meta_sala_vista_completa, en porcentaje para el resto — y la metadata se parte igual, porque el destinatario puede leer su propia fila. Idempotente por (persona, mes cerrado).';

REVOKE EXECUTE ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.metas_avisar_cierre_a_salas(text, boolean) TO service_role;
