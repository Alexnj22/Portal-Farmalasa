-- Una causa puede explicar PARTE de la diferencia de un corte (usuario,
-- 2026-09-29): «qué pasa si encontré causa pero no del total… imagina que de
-- eso, solo $20 se encontró causa».
--
-- Hasta hoy la resolución era todo o nada: el servidor fijaba el monto en el
-- tramo entero y admitía UNA resolución viva por corte. Con un sobrante de
-- $28.93 del que sólo $20 tienen comprobante, la sala tenía dos salidas malas:
-- justificar los $28.93 (y $8.93 que nadie encontró desaparecen del acumulado)
-- o no justificar nada (y $20 con causa quedan como si no la tuvieran).
--
-- ── EL MODELO ───────────────────────────────────────────────────────────────
-- Un corte puede tener VARIAS resoluciones vivas:
--   · cero o más JUSTIFICA, cada una por la parte que su comprobante explica;
--   · a lo sumo UNA que mueve dinero (REPONE / RETIRA), y esa cubre
--     EXACTAMENTE lo que queda sin causa.
-- La suma de las vivas nunca pasa del tramo. El corte está resuelto cuando
-- llega al tramo. Lo que queda de un sobrante sigue en el acumulado de la sala;
-- lo que queda de un faltante sigue «sin resolver» hasta que alguien lo explique
-- o le asigne responsables.
--
-- Invariante que sostiene todo lo demás: **si hay una REPONE/RETIRA viva, el
-- corte está cubierto entero**. Por eso ésa se crea sólo por el resto, y una
-- JUSTIFICA no se anula mientras exista (dejaría un hueco que ninguna vía
-- puede llenar: la de dinero ya está puesta y por otro monto).
--
-- Lectores que suponían «una por corte» y se ajustan acá:
--   get_dias_con_diferencia        — su subconsulta escalar reventaba con 2 filas
--   avisar_diferencias_pendientes_a_jefes — «hay fila» = resuelto
--   avisar_diferencia_de_ayer      — ídem
-- `reabrir_corte_caja` y `corte_trabado_por_posterior` preguntan «¿hay alguna
-- viva?», que sigue siendo la pregunta correcta. `justificar_diferencia_corte`
-- convierte una REPONE en JUSTIFICA por el mismo monto: la suma no cambia.

SET lock_timeout = '5s';

-- ── 1. El índice único deja pasar varias causas ────────────────────────────
DROP INDEX IF EXISTS public.idx_cortes_dif_una_viva_por_corte;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cortes_dif_un_movimiento_vivo_por_corte
    ON public.cortes_caja_diferencias (corte_id)
 WHERE anulada_at IS NULL AND via <> 'JUSTIFICA';

-- Cubre la FK y las búsquedas por corte que antes cubría el único.
CREATE INDEX IF NOT EXISTS idx_cortes_dif_vivas_por_corte
    ON public.cortes_caja_diferencias (corte_id)
 WHERE anulada_at IS NULL;

-- ── 2. Resolver: con `p_monto`, la parte que esta resolución cubre ─────────
-- La firma cambia, así que la vieja se BORRA: dejarla viva sería una segunda
-- puerta con la regla de «todo o nada» y sus propios permisos.
DROP FUNCTION IF EXISTS public.resolver_diferencia_corte(bigint, text, text, numeric, jsonb, text, text);

CREATE FUNCTION public.resolver_diferencia_corte(
    p_corte_id bigint, p_via text, p_causa text, p_monto_esperado numeric,
    p_personas jsonb DEFAULT '[]'::jsonb,
    p_evidencia_ref text DEFAULT NULL::text,
    p_evidencia_foto text DEFAULT NULL::text,
    p_monto numeric DEFAULT NULL::numeric)
 RETURNS cortes_caja_diferencias
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_corte    public.cortes_caja;
    v_scope    text;
    v_monto    numeric;
    v_cubierto numeric;
    v_resta    numeric;
    v_parte    numeric;
    v_dif      public.cortes_caja_diferencias;
    v_suma     numeric;
    v_cuenta   integer;
    v_ajeno    text;
    v_ref      text := NULLIF(btrim(coalesce(p_evidencia_ref, '')), '');
    v_foto     text := NULLIF(btrim(coalesce(p_evidencia_foto, '')), '');
BEGIN
    IF NOT (SELECT auth_has_module_permission('cortes_caja_resolver', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_via NOT IN ('REPONE','RETIRA','JUSTIFICA') THEN
        RAISE EXCEPTION 'Via invalida: %', p_via;
    END IF;

    IF p_causa IS NULL OR btrim(p_causa) = '' THEN
        RAISE EXCEPTION 'Resolver una diferencia exige decir la causa.';
    END IF;

    -- Decidido con el usuario el 2026-09-25: una causa encontrada se respalda.
    IF p_via = 'JUSTIFICA' AND v_ref IS NULL AND v_foto IS NULL THEN
        RAISE EXCEPTION 'Una causa encontrada necesita su comprobante: el numero del documento que se corrigio o una foto.';
    END IF;

    -- El candado del corte serializa a dos personas resolviendo a la vez: sin
    -- él, dos causas parciales podrían sumar más que el tramo.
    SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_corte_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El corte no existe.'; END IF;

    v_scope := (SELECT auth_module_scope('cortes_caja'));
    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_corte.tipo <> 'C' THEN
        RAISE EXCEPTION 'El cierre del dia no tiene diferencia que resolver.';
    END IF;

    IF v_corte.estado = 'DESCARTADO' THEN
        RAISE EXCEPTION 'Un corte descartado no tiene diferencia que reponer.';
    END IF;

    -- El monto lo pone el servidor. Ver el encabezado de 20260814211953.
    v_monto := public.corte_tramo(p_corte_id);

    IF abs(v_monto) < 0.01 THEN
        RAISE EXCEPTION 'Este corte cuadra: no hay diferencia que resolver.';
    END IF;

    IF p_monto_esperado IS NULL OR abs(v_monto - p_monto_esperado) >= 0.01 THEN
        RAISE EXCEPTION 'La diferencia cambio mientras se resolvia: ahora es %, no %. Hay que abrirla de nuevo.',
            to_char(v_monto, 'FM999999990.00'), to_char(coalesce(p_monto_esperado, 0), 'FM999999990.00');
    END IF;

    IF p_via = 'REPONE' AND v_monto > 0 THEN
        RAISE EXCEPTION 'Este corte tiene sobrante: no hay nada que reponer.';
    END IF;
    IF p_via = 'RETIRA' AND v_monto < 0 THEN
        RAISE EXCEPTION 'Este corte tiene faltante: no hay nada que retirar.';
    END IF;

    -- Lo que ya está cubierto por las resoluciones vivas, y lo que queda.
    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.corte_id = p_corte_id AND d.anulada_at IS NULL
                  AND d.via <> 'JUSTIFICA') THEN
        RAISE EXCEPTION 'Este corte ya tiene su diferencia resuelta.';
    END IF;

    SELECT coalesce(sum(abs(d.monto)), 0) INTO v_cubierto
      FROM public.cortes_caja_diferencias d
     WHERE d.corte_id = p_corte_id AND d.anulada_at IS NULL;

    v_resta := round(abs(v_monto) - v_cubierto, 2);
    IF v_resta < 0.01 THEN
        RAISE EXCEPTION 'Este corte ya tiene su diferencia resuelta.';
    END IF;

    -- Sin `p_monto`, la resolución cubre todo lo que queda: es lo que hacía
    -- antes, y lo que siguen mandando las pantallas viejas en caché.
    v_parte := round(abs(coalesce(p_monto, v_resta)), 2);

    IF p_via = 'JUSTIFICA' THEN
        IF v_parte < 0.01 THEN
            RAISE EXCEPTION 'Hay que decir cuanto explica la causa.';
        END IF;
        IF v_parte - v_resta >= 0.01 THEN
            RAISE EXCEPTION 'La causa explica % y quedan % por explicar: no puede explicar mas de lo que queda.',
                to_char(v_parte, 'FM999999990.00'), to_char(v_resta, 'FM999999990.00');
        END IF;
    ELSIF abs(v_parte - v_resta) >= 0.01 THEN
        -- La vía que mueve dinero cierra el corte: va por lo que queda, justo.
        RAISE EXCEPTION 'Quedan % sin causa y esta resolucion cubre %: tienen que ser iguales.',
            to_char(v_resta, 'FM999999990.00'), to_char(v_parte, 'FM999999990.00');
    END IF;

    SELECT count(*), coalesce(sum((x->>'monto')::numeric), 0)
      INTO v_cuenta, v_suma
      FROM jsonb_array_elements(coalesce(p_personas, '[]'::jsonb)) x;

    IF p_via = 'REPONE' THEN
        IF v_cuenta = 0 THEN
            RAISE EXCEPTION 'Falta decir quien responde por el faltante.';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_personas) x
                    WHERE coalesce((x->>'monto')::numeric, 0) <= 0) THEN
            RAISE EXCEPTION 'Cada responsable tiene que llevar una parte mayor que cero.';
        END IF;
        IF abs(v_suma - v_parte) >= 0.01 THEN
            RAISE EXCEPTION 'Las partes suman % y el faltante sin causa es %.',
                to_char(v_suma, 'FM999999990.00'), to_char(v_parte, 'FM999999990.00');
        END IF;

        -- Puede responder quien trabaja en la sala, o quien vendió en el tramo
        -- aunque su ficha sea de otra (estaba cubriendo).
        SELECT coalesce(e.name, 'Esa persona') INTO v_ajeno
          FROM jsonb_array_elements(p_personas) x
          LEFT JOIN public.employees e ON e.id = (x->>'employee_id')::uuid
         WHERE e.id IS NULL
            OR e.status <> 'ACTIVO'
            OR (e.branch_id IS DISTINCT FROM v_corte.branch_id
                AND NOT EXISTS (SELECT 1 FROM public.employee_branches eb
                                 WHERE eb.employee_id = e.id AND eb.branch_id = v_corte.branch_id)
                AND NOT EXISTS (SELECT 1 FROM public.corte_vendedores_del_tramo(p_corte_id) vt
                                 WHERE vt.employee_id = e.id))
         LIMIT 1;

        IF v_ajeno IS NOT NULL THEN
            RAISE EXCEPTION '% no trabaja en esa sala ni vendio en ese corte, o ya no esta activa: no puede responder por este faltante.', v_ajeno;
        END IF;
    ELSIF v_cuenta > 0 THEN
        RAISE EXCEPTION 'Solo un faltante sin causa lleva responsables.';
    END IF;

    -- El monto se guarda con el signo del tramo, como siempre.
    INSERT INTO public.cortes_caja_diferencias
        (corte_id, branch_id, fecha, monto, via, causa, registrado_por,
         evidencia_ref, evidencia_foto_url)
    VALUES (p_corte_id, v_corte.branch_id, v_corte.fecha, sign(v_monto) * v_parte, p_via,
            btrim(p_causa), (SELECT auth_employee_id()), v_ref, v_foto)
    RETURNING * INTO v_dif;

    IF v_cuenta > 0 THEN
        INSERT INTO public.cortes_caja_diferencia_personas
            (diferencia_id, employee_id, monto, del_turno)
        SELECT v_dif.id, (x->>'employee_id')::uuid, round((x->>'monto')::numeric, 2),
               coalesce((x->>'del_turno')::boolean, false)
          FROM jsonb_array_elements(p_personas) x;
    END IF;

    INSERT INTO public.cortes_caja_eventos
        (corte_id, accion, motivo, nota, employee_id)
    VALUES (p_corte_id, 'RESOLVER_DIFERENCIA', btrim(p_causa),
            p_via || ' ' || to_char(v_dif.monto, 'FM999999990.00')
              || CASE WHEN v_parte < abs(v_monto) - 0.005
                      THEN ' de ' || to_char(v_monto, 'FM999999990.00') ELSE '' END
              || CASE WHEN v_ref IS NOT NULL THEN ' · ' || v_ref ELSE '' END,
            (SELECT auth_employee_id()));

    RETURN v_dif;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolver_diferencia_corte(bigint, text, text, numeric, jsonb, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_diferencia_corte(bigint, text, text, numeric, jsonb, text, text, numeric) TO authenticated, service_role;

-- ── 3. Anular: una causa no se quita de debajo de los responsables ─────────
CREATE OR REPLACE FUNCTION public.anular_diferencia_corte(p_id bigint, p_motivo text)
 RETURNS cortes_caja_diferencias
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dif public.cortes_caja_diferencias;
BEGIN
    IF NOT (SELECT auth_has_module_permission('cortes_caja_resolver', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Anular exige decir por que.';
    END IF;

    SELECT * INTO v_dif FROM public.cortes_caja_diferencias WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa resolucion no existe.'; END IF;

    IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
       AND v_dif.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_dif.anulada_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esa resolucion ya estaba anulada.';
    END IF;

    IF v_dif.asentado_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esta resolucion ya se registro en el sistema: no se puede anular desde aca.';
    END IF;

    -- Anularla con abonos vivos borraría de la cuenta dinero que ya entró.
    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencia_abonos a
                WHERE a.diferencia_id = p_id AND a.anulada_at IS NULL) THEN
        RAISE EXCEPTION 'Este faltante ya tiene abonos: hay que anularlos primero.';
    END IF;

    -- Una causa parcial sostiene el monto de los responsables (o del retiro):
    -- esos cubren SÓLO lo que la causa no explicó. Quitarla dejaría un hueco
    -- que ninguna vía puede llenar. Se anula primero la de dinero.
    IF v_dif.via = 'JUSTIFICA' AND EXISTS (
        SELECT 1 FROM public.cortes_caja_diferencias d
         WHERE d.corte_id = v_dif.corte_id AND d.anulada_at IS NULL
           AND d.via <> 'JUSTIFICA' AND d.id <> p_id) THEN
        RAISE EXCEPTION 'Lo que esta causa no explico ya tiene responsables: hay que anular esa resolucion primero.';
    END IF;

    UPDATE public.cortes_caja_diferencias SET
        anulada_at = now(), anulada_por = (SELECT auth_employee_id()),
        anulada_motivo = btrim(p_motivo), updated_at = now()
    WHERE id = p_id RETURNING * INTO v_dif;

    INSERT INTO public.cortes_caja_eventos (corte_id, accion, motivo, employee_id)
    VALUES (v_dif.corte_id, 'ANULAR_DIFERENCIA', btrim(p_motivo), (SELECT auth_employee_id()));

    RETURN v_dif;
END;
$function$;

-- ── 4. Los días: `diferencias` (todas las vivas) y `cubierto` ──────────────
-- `diferencia` (singular) se queda por las pantallas en caché: es la última
-- viva. Con dos filas la subconsulta escalar vieja lanzaba «more than one row».
CREATE OR REPLACE FUNCTION public.get_dias_con_diferencia(p_desde date, p_hasta date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_scope text;
    v_rama  bigint;
BEGIN
    IF NOT (SELECT auth_has_module_permission('cortes_caja', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    v_scope := (SELECT auth_module_scope('cortes_caja'));
    v_rama  := (SELECT auth_employee_branch_id());

    RETURN (
        WITH base AS (
            SELECT c.id, c.branch_id, c.fecha, c.hora, c.estado, c.empleado_texto,
                   c.total_declarado, public.corte_tramo(c.id) AS tramo
              FROM public.cortes_caja c
             WHERE c.tipo = 'C'
               AND c.estado <> 'DESCARTADO'
               AND c.fecha BETWEEN p_desde AND p_hasta
               AND (v_scope = 'ALL' OR c.branch_id = v_rama)
               AND NOT public.corte_no_conto_efectivo(c.tipo, c.total_declarado, c.diferencia_erp, c.tk_total_caja)
        ), dias AS (
            SELECT b.branch_id, b.fecha,
                   round(coalesce(sum(b.tramo) FILTER (WHERE b.estado = 'CONFIRMADO'), 0), 2) AS neto,
                   count(*) AS cortes
              FROM base b GROUP BY 1, 2
        ), con AS (
            SELECT b.* FROM base b WHERE abs(b.tramo) >= 0.01
        ), res AS (
            SELECT df.corte_id, df.id, df.registrado_at,
                   json_build_object(
                       'id', df.id, 'via', df.via, 'monto', df.monto,
                       'causa', df.causa,
                       'evidencia_ref', df.evidencia_ref,
                       'evidencia_foto_url', df.evidencia_foto_url,
                       'registrado_at', df.registrado_at,
                       'registrado_nombre', rg.name,
                       'asentado_at', df.asentado_at, 'asentado_ref', df.asentado_ref,
                       'impreso_at', df.impreso_at,
                       'responsables', (SELECT count(*) FROM public.cortes_caja_diferencia_personas p
                                         WHERE p.diferencia_id = df.id),
                       'asignado', (SELECT coalesce(sum(p.monto), 0) FROM public.cortes_caja_diferencia_personas p
                                     WHERE p.diferencia_id = df.id),
                       'abonado', (SELECT coalesce(sum(ab.monto), 0) FROM public.cortes_caja_diferencia_abonos ab
                                    WHERE ab.diferencia_id = df.id AND ab.anulada_at IS NULL),
                       'abonos_sin_asentar', (SELECT count(*) FROM public.cortes_caja_diferencia_abonos ab
                                               WHERE ab.diferencia_id = df.id AND ab.anulada_at IS NULL
                                                 AND ab.asentado_at IS NULL)) AS fila,
                   abs(df.monto) AS parte
              FROM public.cortes_caja_diferencias df
              LEFT JOIN public.employees rg ON rg.id = df.registrado_por
             WHERE df.anulada_at IS NULL
               AND df.corte_id IN (SELECT k.id FROM con k)
        )
        SELECT coalesce(json_agg(json_build_object(
                   'branch_id', d.branch_id, 'fecha', d.fecha, 'neto', d.neto,
                   'cortes_del_dia', d.cortes,
                   'cortes', (
                       SELECT json_agg(json_build_object(
                                  'id', k.id, 'hora', k.hora, 'estado', k.estado,
                                  'empleado_texto', k.empleado_texto, 'tramo', k.tramo,
                                  'diferencias', coalesce((SELECT json_agg(r.fila ORDER BY r.registrado_at, r.id)
                                                             FROM res r WHERE r.corte_id = k.id), '[]'::json),
                                  'cubierto', (SELECT round(coalesce(sum(r.parte), 0), 2)
                                                 FROM res r WHERE r.corte_id = k.id),
                                  'diferencia', (SELECT r.fila FROM res r WHERE r.corte_id = k.id
                                                  ORDER BY r.registrado_at DESC, r.id DESC LIMIT 1))
                              ORDER BY k.hora, k.id)
                         FROM con k
                        WHERE k.branch_id = d.branch_id AND k.fecha = d.fecha))
                   ORDER BY d.fecha DESC, d.branch_id), '[]'::json)
          FROM dias d
         WHERE EXISTS (SELECT 1 FROM con k WHERE k.branch_id = d.branch_id AND k.fecha = d.fecha)
    );
END;
$function$;

-- ── 5. Aviso a jefes: «sin resolver» es lo que queda, no «no hay fila» ─────
CREATE OR REPLACE FUNCTION public.avisar_diferencias_pendientes_a_jefes(p_solo uuid[] DEFAULT NULL::uuid[])
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
      -- Una fila por corte. Una causa parcial deja un RESTO sin resolver.
      SELECT c.branch_id, c.tramo,
             round(-c.tramo - coalesce((SELECT sum(abs(d.monto)) FROM public.cortes_caja_diferencias d
                                         WHERE d.corte_id = c.id AND d.anulada_at IS NULL), 0), 2) AS pendiente,
             (SELECT coalesce(sum(p.monto), 0)
                FROM public.cortes_caja_diferencias d
                JOIN public.cortes_caja_diferencia_personas p ON p.diferencia_id = d.id
               WHERE d.corte_id = c.id AND d.anulada_at IS NULL AND d.via = 'REPONE')
           - (SELECT coalesce(sum(a.monto), 0)
                FROM public.cortes_caja_diferencias d
                JOIN public.cortes_caja_diferencia_abonos a ON a.diferencia_id = d.id
               WHERE d.corte_id = c.id AND d.anulada_at IS NULL AND d.via = 'REPONE'
                 AND a.anulada_at IS NULL) AS saldo
        FROM c
       WHERE c.tramo <= -0.01
    )
    SELECT f.branch_id, b.name AS sala,
           count(*) FILTER (WHERE f.pendiente >= 0.01)                    AS sin_resolver,
           coalesce(sum(f.pendiente) FILTER (WHERE f.pendiente >= 0.01), 0) AS monto_sin_resolver,
           count(*) FILTER (WHERE f.saldo >= 0.01)                        AS con_saldo,
           coalesce(sum(f.saldo) FILTER (WHERE f.saldo >= 0.01), 0)       AS por_cobrar
      FROM f JOIN public.branches b ON b.id = f.branch_id
     GROUP BY f.branch_id, b.name
    HAVING count(*) FILTER (WHERE f.pendiente >= 0.01 OR f.saldo >= 0.01) > 0
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

-- ── 6. Aviso de ayer: se calla sólo si el corte quedó cubierto ENTERO ──────
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
    -- Ya la resolvieron ENTERA: no se vuelve a pedir. Una causa que explica
    -- una parte deja el resto pendiente (2026-09-29).
    CONTINUE WHEN (SELECT coalesce(sum(abs(d.monto)), 0) FROM public.cortes_caja_diferencias d
                    WHERE d.corte_id = v_c.corte_id AND d.anulada_at IS NULL)
                  > abs(v_c.tramo) - 0.005;

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
