-- Lo que ya tiene causa sale de la diferencia del corte, en TODAS partes.
--
-- Salud 2, 27-nov: el sobrante de +$11.85 del corte de las 12:10 tiene $4.95
-- explicados por la Fac 77149. Cortes ya decía +$6.90, pero el Inicio, Mi caja,
-- Bolsas, la app y los avisos seguían con +$11.85 porque cada uno calcula por
-- su cuenta. Usuario: «no tiene sentido tener información distinta según donde
-- se vea».
--
-- · `cortes_caja.explicado_causa`: suma con signo de las causas vivas
--   (`via = 'JUSTIFICA'`) de ese corte. La sella un trigger desde
--   `cortes_caja_diferencias`; nadie la escribe a mano. Viaja con cada fila,
--   así que `conTramoPorSalaYDia` (portal y app) la lee sin otra consulta.
-- · `corte_explicado_hasta(id)`: lo explicado que pesa en el acumulado de ese
--   corte (lo propio + lo de los confirmados anteriores del día). Mismo
--   criterio que la base de `corte_tramo`: sólo un confirmado corre la base.
-- · `caja_estado` manda la columna; `avisar_cierre_del_dia` y
--   `avisar_diferencia_de_ayer` hablan de lo que queda sin causa.
-- `corte_tramo` y `corte_diferencia` NO cambian: miden el dinero del cajón y
-- son la base para resolver (lo que queda por explicar sale de ahí).
SET lock_timeout = '5s';

-- ── 1. La columna y su sello ────────────────────────────────────────────────
ALTER TABLE public.cortes_caja
  ADD COLUMN IF NOT EXISTS explicado_causa numeric(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.cortes_caja.explicado_causa IS
  'Suma con signo de las causas vivas (JUSTIFICA) de la diferencia de este corte. Se descuenta de lo que se MUESTRA (cifra, acumulado, arrastre); no del dinero. La sella un trigger.';

CREATE OR REPLACE FUNCTION public.corte_explicado_de(p_corte_id bigint)
RETURNS numeric LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    SELECT coalesce(sum(d.monto), 0)::numeric(12,2)
      FROM public.cortes_caja_diferencias d
     WHERE d.corte_id = p_corte_id AND d.via = 'JUSTIFICA' AND d.anulada_at IS NULL
$$;
REVOKE EXECUTE ON FUNCTION public.corte_explicado_de(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.corte_explicado_de(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.diferencias_sella_explicado()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
    v_id bigint;
BEGIN
    FOR v_id IN
        SELECT DISTINCT x FROM (VALUES (NEW.corte_id),
                                       (CASE WHEN TG_OP = 'UPDATE' THEN OLD.corte_id END)) v(x)
         WHERE x IS NOT NULL
    LOOP
        UPDATE public.cortes_caja c
           SET explicado_causa = public.corte_explicado_de(v_id)
         WHERE c.id = v_id
           AND c.explicado_causa IS DISTINCT FROM public.corte_explicado_de(v_id);
    END LOOP;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS diferencias_sella_explicado ON public.cortes_caja_diferencias;
CREATE TRIGGER diferencias_sella_explicado
    AFTER INSERT OR UPDATE OF anulada_at, monto, via, corte_id
    ON public.cortes_caja_diferencias
    FOR EACH ROW EXECUTE FUNCTION public.diferencias_sella_explicado();

UPDATE public.cortes_caja c
   SET explicado_causa = public.corte_explicado_de(c.id)
 WHERE c.id IN (SELECT d.corte_id FROM public.cortes_caja_diferencias d
                 WHERE d.via = 'JUSTIFICA' AND d.anulada_at IS NULL)
   AND c.explicado_causa IS DISTINCT FROM public.corte_explicado_de(c.id);

-- ── 2. Lo explicado que pesa en el acumulado de un corte ────────────────────
CREATE OR REPLACE FUNCTION public.corte_explicado_hasta(p_corte_id bigint)
RETURNS numeric LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    SELECT (coalesce(v.explicado_causa, 0) + coalesce((
              SELECT sum(c2.explicado_causa)
                FROM public.cortes_caja c2
               WHERE c2.branch_id = v.branch_id AND c2.fecha = v.fecha
                 AND c2.tipo = 'C' AND c2.estado = 'CONFIRMADO'
                 AND (c2.hora, c2.id) < (v.hora, v.id)), 0))::numeric(12,2)
      FROM public.cortes_caja v
     WHERE v.id = p_corte_id
$$;
REVOKE EXECUTE ON FUNCTION public.corte_explicado_hasta(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.corte_explicado_hasta(bigint) TO authenticated, service_role;

-- ── 3. Mi caja y el aviso del cierre: partir de la viva ─────────────────────
DO $$
DECLARE
    v_def   text;
    v_nuevo text;
BEGIN
    v_def := pg_get_functiondef('public.caja_estado(integer)'::regprocedure);
    v_nuevo := regexp_replace(v_def,
        'cobros_portal_efectivo, efectivo_otro_corte,(\s+)CASE',
        'cobros_portal_efectivo, efectivo_otro_corte, explicado_causa,\1CASE');
    IF v_nuevo = v_def THEN RAISE EXCEPTION 'caja_estado: no se encontró la lista de columnas'; END IF;
    EXECUTE v_nuevo;

    v_def := pg_get_functiondef('public.avisar_cierre_del_dia(date,boolean)'::regprocedure);
    v_nuevo := regexp_replace(v_def,
        'c\.cobros_portal_efectivo, c\.efectivo_otro_corte\),(\s*)2\)(\s+)AS diferencia',
        'c.cobros_portal_efectivo, c.efectivo_otro_corte)\1- public.corte_explicado_hasta(c.id), 2)\2AS diferencia');
    IF v_nuevo = v_def THEN RAISE EXCEPTION 'avisar_cierre_del_dia: no se encontró la diferencia del último corte'; END IF;
    EXECUTE v_nuevo;
END $$;

-- ── 4. El aviso del faltante de ayer: partir de la viva ─────────────────────
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
             c.explicado_causa AS expl,
             round(public.corte_diferencia(c.total_declarado, c.diferencia_erp, c.tk_total_caja,
                                           c.tk_subtotal, c.tk_vales, c.tk_cobros_credito,
                                           c.cobros_portal_efectivo, c.efectivo_otro_corte), 2) AS acum
        FROM public.cortes_caja c
       WHERE c.tipo = 'C' AND c.estado = 'CONFIRMADO' AND c.fecha = v_fecha
         AND NOT public.corte_no_conto_efectivo(c.tipo, c.total_declarado,
                                                c.diferencia_erp, c.tk_total_caja)
    )
    SELECT k.id AS corte_id, k.branch_id, k.hora, k.total_declarado AS contado,
           k.tramo, b.name AS sala,
           -- Lo que queda sin causa (2026-11-27): es lo que se avisa.
           round(k.tramo - k.expl, 2) AS sin_causa,
           k.expl AS con_causa,
           k.resuelto_por AS confirmado_por,
           CASE WHEN e.id IS NOT NULL
                THEN public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name) END AS confirmado_nombre,
           -- Lo que el día ya cargaba ANTES de este corte, sin lo que ya tiene
           -- causa. Mismo gemelo que `conTramo` en `cortesDiagnostico.js`.
           round(k.acum - k.tramo
                 - coalesce((SELECT sum(p.expl) FROM conf p
                              WHERE p.branch_id = k.branch_id AND (p.hora, p.id) < (k.hora, k.id)), 0), 2) AS arrastre,
           -- De dónde salió: el último confirmado anterior que movió el
           -- acumulado. Se nombra sólo si fue UNO; con varios, la tarjeta dice
           -- cuántos — nombrar uno de tres manda a revisar el corte equivocado.
           (SELECT count(*) FROM conf p
             WHERE p.branch_id = k.branch_id AND (p.hora, p.id) < (k.hora, k.id)
               AND abs(p.tramo - p.expl) >= 0.01)                          AS aportes,
           (SELECT to_char(p.hora, 'HH24:MI') FROM conf p
             WHERE p.branch_id = k.branch_id AND (p.hora, p.id) < (k.hora, k.id)
               AND abs(p.tramo - p.expl) >= 0.01
             ORDER BY p.hora DESC, p.id DESC LIMIT 1)                      AS arrastre_desde
      FROM conf k JOIN public.branches b ON b.id = k.branch_id
      LEFT JOIN public.employees e ON e.id = k.resuelto_por
     WHERE k.tramo <= -0.01                 -- el mismo umbral de `severidad`
     ORDER BY b.name, k.hora
  LOOP
    -- Ya la resolvieron ENTERA: no se vuelve a pedir. Una causa que explica
    -- una parte deja el resto pendiente (2026-09-29).
    CONTINUE WHEN (SELECT coalesce(sum(abs(d.monto)), 0) FROM public.cortes_caja_diferencias d
                    WHERE d.corte_id = v_c.corte_id AND d.anulada_at IS NULL)
                  > abs(v_c.tramo) - 0.005;
    -- Lo que queda sin causa ya no es faltante: nada que avisar.
    CONTINUE WHEN v_c.sin_causa > -0.01;

    -- La marca es por CORTE. En `avisos_emitidos` y no en la campana: un
    -- `NOT EXISTS … FROM notifications` pregunta «¿todavía la tiene?», y quien
    -- vacía su campana lo recibe de nuevo.
    v_clave := 'CORTE_DIF_AYER:' || v_fecha::text || ':' || v_c.corte_id;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.avisos_emitidos a
                           WHERE a.clave = v_clave AND a.recipient_id IS NULL);

    v_dest := public.destinatarios_de_cortes(v_c.branch_id);
    CONTINUE WHEN v_dest IS NULL;

    v_monto := '$' || to_char(abs(v_c.sin_causa), 'FM999,999,990.00');
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
        'diferencia',        v_c.sin_causa,
        'con_causa',         v_c.con_causa,
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
