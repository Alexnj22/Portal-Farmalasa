-- Dos pedidos del usuario del 2026-09-25 sobre los faltantes de caja:
--
-- 1. El aviso de las 8:00 («ayer faltaron $X en el corte de las …») dice
--    también QUIÉN confirmó ese corte, con su id en metadata para que la
--    campana pinte su foto. `cortes_caja.resuelto_por` es quien confirmó.
--
-- 2. `avisar_diferencias_pendientes_a_jefes()`: a cada Jefe/a y Subjefe/a de
--    Sala, lo que su sala tiene pendiente de TODO el historial —faltantes sin
--    resolver y responsables con saldo—. Mismo criterio que la pestaña
--    Diferencias (`diferenciasDeCaja.js`): corte C confirmado, que contó
--    efectivo, con tramo ≤ −$0.01. Un sobrante no es pendiente: se acumula.
--    Se dispara UNA vez, el 2026-09-26 a las 8:00 SV, con un cron que se borra
--    a sí mismo al terminar.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.avisar_diferencia_de_ayer(p_fecha date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_fecha date := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date - 1);
  v_c     record;
  v_dest  uuid[];
  v_clave text;
  v_monto text;
  v_quien text;
  v_n     integer := 0;
BEGIN
  FOR v_c IN
    WITH conf AS (
      -- Los confirmados del día que SÍ midieron dinero. Un descartado no es un
      -- tramo y uno sin conteo no tiene diferencia que medir: `corte_tramo` los
      -- rechaza a propósito, así que se filtran antes de llamarla.
      SELECT c.id, c.branch_id, c.hora, c.total_declarado, c.resuelto_por,
             public.corte_tramo(c.id) AS tramo,
             round(public.corte_diferencia(c.total_declarado, c.diferencia_erp, c.tk_total_caja,
                                           c.tk_subtotal, c.tk_vales, c.tk_cobros_credito,
                                           c.cobros_portal_efectivo), 2) AS acum
        FROM public.cortes_caja c
       WHERE c.tipo = 'C' AND c.estado = 'CONFIRMADO' AND c.fecha = v_fecha
         AND NOT public.corte_no_conto_efectivo(c.tipo, c.total_declarado,
                                                c.diferencia_erp, c.tk_total_caja)
    )
    SELECT k.id AS corte_id, k.branch_id, k.hora, k.total_declarado AS contado,
           k.tramo, b.name AS sala,
           k.resuelto_por AS confirmado_por,
           CASE WHEN e.id IS NOT NULL
                THEN public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name) END AS confirmado_nombre,
           -- Lo que el día ya cargaba ANTES de este corte. Mismo gemelo que
           -- `conTramo` en `cortesDiagnostico.js`.
           round(k.acum - k.tramo, 2) AS arrastre,
           -- De dónde salió: el último confirmado anterior que movió el
           -- acumulado. Se nombra sólo si fue UNO; con varios, la tarjeta dice
           -- cuántos — nombrar uno de tres manda a revisar el corte equivocado.
           (SELECT count(*) FROM conf p
             WHERE p.branch_id = k.branch_id AND (p.hora, p.id) < (k.hora, k.id)
               AND abs(p.tramo) >= 0.01)                                   AS aportes,
           (SELECT to_char(p.hora, 'HH24:MI') FROM conf p
             WHERE p.branch_id = k.branch_id AND (p.hora, p.id) < (k.hora, k.id)
               AND abs(p.tramo) >= 0.01
             ORDER BY p.hora DESC, p.id DESC LIMIT 1)                      AS arrastre_desde
      FROM conf k JOIN public.branches b ON b.id = k.branch_id
      LEFT JOIN public.employees e ON e.id = k.resuelto_por
     WHERE k.tramo <= -0.01                 -- el mismo umbral de `severidad`
     ORDER BY b.name, k.hora
  LOOP
    -- Ya la resolvieron: no se vuelve a pedir.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                           WHERE d.corte_id = v_c.corte_id AND d.anulada_at IS NULL);

    -- La marca es por CORTE. En `avisos_emitidos` y no en la campana: un
    -- `NOT EXISTS … FROM notifications` pregunta «¿todavía la tiene?», y quien
    -- vacía su campana lo recibe de nuevo.
    v_clave := 'CORTE_DIF_AYER:' || v_fecha::text || ':' || v_c.corte_id;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.avisos_emitidos a
                           WHERE a.clave = v_clave AND a.recipient_id IS NULL);

    v_dest := public.destinatarios_de_cortes(v_c.branch_id);
    CONTINUE WHEN v_dest IS NULL;

    v_monto := '$' || to_char(abs(v_c.tramo), 'FM999,999,990.00');
    v_quien := CASE WHEN v_c.confirmado_nombre IS NOT NULL
                    THEN ', confirmado por ' || v_c.confirmado_nombre || ',' ELSE '' END;

    PERFORM public.notify_employees(
      v_dest,
      'CORTE_DIFERENCIA_AYER',
      -- Nombra el CORTE, no la caja: es lo que la tarjeta rotula «Faltante», y
      -- decir «la caja cerró con» sobre un día que cerró exacto era la
      -- contradicción que trajo este cambio.
      'Ayer faltaron ' || v_monto || ' en el corte de las ' || public.hora_12(v_c.hora),
      v_c.sala || ' — el corte de las ' || public.hora_12(v_c.hora) || v_quien
        || ' quedó ' || v_monto || ' abajo de lo esperado. Hay que revisarlo y '
        || 'registrar la diferencia.',
      '/caja?tab=diferencias',
      jsonb_build_object(
        'corte_id',          v_c.corte_id,
        'branch_id',         v_c.branch_id,
        'sala',              v_c.sala,
        'fecha',             v_fecha,
        'hora',              to_char(v_c.hora, 'HH24:MI'),
        'diferencia',        v_c.tramo,
        'contado',           v_c.contado,
        -- Lo que debía haber en ese corte. Derivado, para que los números de la
        -- tarjeta cierren entre ellos.
        'esperado',          round(v_c.contado - v_c.tramo, 2),
        'arrastre',          v_c.arrastre,
        'arrastre_desde',    CASE WHEN v_c.aportes = 1 THEN v_c.arrastre_desde END,
        'aportes',           v_c.aportes,
        -- Quién confirmó: la ficha, para que la campana pinte su foto.
        'confirmado_por',    v_c.confirmado_por,
        'confirmado_nombre', v_c.confirmado_nombre
      ),
      true,            -- push: es dinero que falta, no es informativo
      v_c.branch_id
    );

    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    VALUES (v_clave, NULL)
    ON CONFLICT DO NOTHING;

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_diferencias_pendientes_a_jefes(p_solo uuid[] DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- `p_solo`: mandar sólo a esas fichas (una prueba). NULL = a los jefes.
DECLARE
  v_s    record;
  v_dest uuid[];
  v_n    integer := 0;
  v_partes text[];
BEGIN
  FOR v_s IN
    WITH c AS (
      SELECT c.id, c.branch_id, public.corte_tramo(c.id) AS tramo
        FROM public.cortes_caja c
       WHERE c.tipo = 'C' AND c.estado = 'CONFIRMADO'
         AND c.fecha >= date '2026-08-14'      -- desde que hay cortes capturados
         AND NOT public.corte_no_conto_efectivo(c.tipo, c.total_declarado,
                                                c.diferencia_erp, c.tk_total_caja)
    ), f AS (
      SELECT c.branch_id, c.tramo, d.id AS dif_id, d.via,
             (SELECT coalesce(sum(p.monto), 0) FROM public.cortes_caja_diferencia_personas p
               WHERE p.diferencia_id = d.id)
           - (SELECT coalesce(sum(a.monto), 0) FROM public.cortes_caja_diferencia_abonos a
               WHERE a.diferencia_id = d.id AND a.anulada_at IS NULL) AS saldo
        FROM c
        LEFT JOIN public.cortes_caja_diferencias d ON d.corte_id = c.id AND d.anulada_at IS NULL
       WHERE c.tramo <= -0.01
    )
    SELECT f.branch_id, b.name AS sala,
           count(*) FILTER (WHERE f.dif_id IS NULL)                               AS sin_resolver,
           coalesce(sum(-f.tramo) FILTER (WHERE f.dif_id IS NULL), 0)             AS monto_sin_resolver,
           count(*) FILTER (WHERE f.via = 'REPONE' AND f.saldo >= 0.01)           AS con_saldo,
           coalesce(sum(f.saldo) FILTER (WHERE f.via = 'REPONE' AND f.saldo >= 0.01), 0) AS por_cobrar
      FROM f JOIN public.branches b ON b.id = f.branch_id
     GROUP BY f.branch_id, b.name
    HAVING count(*) FILTER (WHERE f.dif_id IS NULL OR (f.via = 'REPONE' AND f.saldo >= 0.01)) > 0
     ORDER BY b.name
  LOOP
    IF p_solo IS NOT NULL THEN
      v_dest := p_solo;
    ELSE
      SELECT array_agg(e.id) INTO v_dest
        FROM public.employees e JOIN public.roles r ON r.id = e.role_id
       WHERE e.status = 'ACTIVO' AND e.branch_id = v_s.branch_id
         AND r.name IN ('Jefe/a de Sala', 'Subjefe/a de Sala');
    END IF;
    CONTINUE WHEN coalesce(array_length(v_dest, 1), 0) = 0;

    v_partes := ARRAY[]::text[];
    IF v_s.sin_resolver > 0 THEN
      v_partes := v_partes || (v_s.sin_resolver || CASE WHEN v_s.sin_resolver = 1 THEN ' corte' ELSE ' cortes' END
                  || ' sin resolver por $' || to_char(v_s.monto_sin_resolver, 'FM999,999,990.00'));
    END IF;
    IF v_s.con_saldo > 0 THEN
      v_partes := v_partes || ('$' || to_char(v_s.por_cobrar, 'FM999,999,990.00') || ' por cobrar a responsables');
    END IF;

    PERFORM public.notify_employees(
      v_dest,
      'CORTE_DIFERENCIAS_PENDIENTES',
      v_s.sala || ': diferencias de caja pendientes',
      'Tienes ' || array_to_string(v_partes, ' y ') || '. Resuélvelas en Efectivo → Diferencias: '
        || 'cada faltante se paga o se explica con su comprobante.',
      '/caja?tab=diferencias',
      jsonb_build_object(
        'branch_id',          v_s.branch_id,
        'sala',               v_s.sala,
        'sin_resolver',       v_s.sin_resolver,
        'monto_sin_resolver', v_s.monto_sin_resolver,
        'con_saldo',          v_s.con_saldo,
        'por_cobrar',         v_s.por_cobrar,
        'prueba',             p_solo IS NOT NULL
      ),
      true,
      v_s.branch_id
    );
    v_n := v_n + 1;
    -- Una prueba lleva UN aviso, no uno por sala.
    EXIT WHEN p_solo IS NOT NULL;
  END LOOP;
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_diferencias_pendientes_a_jefes(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_diferencias_pendientes_a_jefes(uuid[]) TO service_role;

-- (El comando lleva la guarda del `unschedule` desde 20260925231939, que la
-- agregó en prod con `cron.alter_job`; acá se escribe ya con ella.)
-- Una sola vez: 2026-09-26 08:00 SV (14:00 UTC). Se borra al terminar, así que
-- el año que viene no vuelve a sonar. Guarda de «sólo si no existe» para que
-- un branch que rehaga la historia no falle.
SELECT cron.schedule(
  'diferencias-pendientes-jefes-2026-09-26',
  '0 14 26 9 *',
  $cron$SELECT public.avisar_diferencias_pendientes_a_jefes(); SELECT cron.unschedule('diferencias-pendientes-jefes-2026-09-26') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'diferencias-pendientes-jefes-2026-09-26');$cron$
)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'diferencias-pendientes-jefes-2026-09-26');
