SET lock_timeout = '5s';

-- ═══ El remanente sale del circuito ═════════════════════════════════════════
--
-- «el remanente ya no es responsabilidad ni control del portal. es efectivo del
-- dueño» (usuario, 2026-08-26).
--
-- Hasta hoy el portal hacía tres cosas con él, y las tres sobran:
--
--   1. Se lo ASIGNABA a una persona (`remanente_recibido_por` = el Gerente
--      General) y guardaba quién se lo entregó. Registrar a las manos de quién
--      pasa un efectivo que el portal no sigue es prometer un control que no
--      existe.
--   2. **BLOQUEABA el cierre si no había ningún Gerente General activo.** Ése
--      era el peor: el registro del efectivo —lo que sí es del portal— se caía
--      por una asignación de cargo que ya no le incumbe. Una regla que frena lo
--      que importa por algo que dejó de importar.
--   3. Lo nombraba en el aviso como si fuera una entrega pendiente.
--
-- Lo que SÍ se queda es el número. El remanente es la resta que cierra la
-- cuenta —contado + aporte − banco − mano— y sin él un cierre parcial se leería
-- como un hueco. `deposito_cuadra` lo exige, y con razón. Lo que cambia es que
-- deja de tener dueño: es lo que no salió por el circuito, y ahí termina.
--
-- Las dos filas que ya lo tienen asignado se dejan como están: pasó, y borrarlo
-- sería reescribir lo que se registró en su momento. Lo que no se vuelve a
-- escribir es de hoy en adelante.
COMMENT ON COLUMN public.depositos_bancarios.remanente IS
    'Lo que NO salió por el circuito: contado + aporte − al banco − en mano. Sin dueño desde el 2026-08-26: es efectivo del dueño y el portal no lo sigue.';
COMMENT ON COLUMN public.depositos_bancarios.remanente_recibido_por IS
    'HISTÓRICO. No se escribe desde el 2026-08-26: el remanente dejó de asignarse a una persona.';
COMMENT ON COLUMN public.depositos_bancarios.remanente_entregado_por IS
    'HISTÓRICO. No se escribe desde el 2026-08-26: ver remanente_recibido_por.';

CREATE OR REPLACE FUNCTION public.registrar_deposito_bancario(
    p_bolsa_ids  bigint[],
    p_monto      numeric,
    p_aporte     numeric DEFAULT 0,
    p_aporte_nota text   DEFAULT NULL,
    p_nota       text    DEFAULT NULL,
    p_llevado_por uuid   DEFAULT NULL,
    p_banco_id   smallint DEFAULT NULL,
    p_destino    text    DEFAULT NULL,   -- ya no se usa: el destino se deriva
    p_entregado_a uuid   DEFAULT NULL,
    p_monto_efectivo numeric DEFAULT 0)
 RETURNS depositos_bancarios
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo        uuid := (SELECT auth_employee_id());
    v_hoy       date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_contado   numeric;
    v_cuantas   integer;
    v_aporte    numeric := round(coalesce(p_aporte, 0), 2);
    v_banco_mto numeric := round(coalesce(p_monto, 0), 2);
    v_mano_mto  numeric := round(coalesce(p_monto_efectivo, 0), 2);
    v_remanente numeric;
    v_destino   text;
    v_folio     text;
    v_banco     text;
    v_a_quien   text;
    v_dep       public.depositos_bancarios;
    v_gerentes  uuid[];
    v_quien     text;
    v_partes    text;
    v_cola      text;
    v_titulo    text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    PERFORM 1 FROM public.bolsas
      WHERE id = ANY(p_bolsa_ids) AND estado = 'CONTADA' AND deposito_id IS NULL
      FOR UPDATE;

    SELECT coalesce(sum(b.contado), 0), count(*)
      INTO v_contado, v_cuantas
      FROM public.bolsas b
     WHERE b.id = ANY(p_bolsa_ids)
       AND b.estado = 'CONTADA'
       AND b.deposito_id IS NULL;

    IF v_cuantas = 0 THEN
        RAISE EXCEPTION 'No hay bolsas contadas y sin cerrar en esa lista.';
    END IF;
    IF v_cuantas <> coalesce(array_length(p_bolsa_ids, 1), 0) THEN
        RAISE EXCEPTION 'Alguna de esas bolsas ya se cerró o dejó de estar contada. Vuelve a abrir la pantalla.';
    END IF;

    IF v_banco_mto < 0 OR v_mano_mto < 0 THEN
        RAISE EXCEPTION 'Ninguna parte del reparto puede ser negativa.';
    END IF;
    IF v_aporte > 0 AND nullif(btrim(coalesce(p_aporte_nota, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Si entra dinero de afuera hay que decir de dónde salió.';
    END IF;

    -- Cada parte exige lo suyo, y sólo si esa parte existe.
    IF v_banco_mto > 0 THEN
        SELECT b.nombre INTO v_banco FROM public.bancos b
         WHERE b.id = p_banco_id AND b.activo;
        IF v_banco IS NULL THEN
            RAISE EXCEPTION 'Hay que decir a qué banco va esa parte. Si no ves ese campo, recarga la pantalla.';
        END IF;
    END IF;

    IF p_entregado_a IS NOT NULL THEN
        SELECT e.name INTO v_a_quien
          FROM public.employees e
          JOIN public.roles r ON r.id = e.role_id
         WHERE e.id = p_entregado_a
           AND e.status = 'ACTIVO'
           AND r.name = ANY (public.cargos_de_administracion());
        IF v_a_quien IS NULL THEN
            RAISE EXCEPTION 'El efectivo en mano sólo se le entrega a administración.';
        END IF;
    ELSIF v_mano_mto > 0 THEN
        RAISE EXCEPTION 'Hay que decir a quién se le entrega el efectivo en mano.';
    END IF;

    v_remanente := round(v_contado + v_aporte - v_banco_mto - v_mano_mto, 2);
    IF v_remanente < 0 THEN
        RAISE EXCEPTION 'No alcanza: hay % y se están repartiendo %. Faltan %.',
            to_char(v_contado + v_aporte, 'FM999,999,990.00'),
            to_char(v_banco_mto + v_mano_mto, 'FM999,999,990.00'),
            to_char(abs(v_remanente), 'FM999,999,990.00');
    END IF;

    v_destino := CASE
        WHEN v_banco_mto > 0 AND v_mano_mto > 0 THEN 'MIXTO'
        WHEN v_banco_mto > 0                    THEN 'BANCO'
        ELSE 'EFECTIVO'
    END;

    -- Acá vivía el freno por «no hay Gerente General activo». Se fue: el
    -- remanente es efectivo del dueño y el portal no lo sigue, así que no puede
    -- ser el motivo por el que no se registra un depósito.

    SELECT 'DEP-' || to_char(v_hoy, 'YYMMDD') || '-' || (count(*) + 1)
      INTO v_folio
      FROM public.depositos_bancarios WHERE fecha = v_hoy;

    INSERT INTO public.depositos_bancarios (
        folio, fecha, total_contado, aporte, aporte_nota,
        monto_deposito, monto_efectivo, remanente,
        nota, cerrado_por, llevado_por, banco_id, destino, entregado_a)
    VALUES (v_folio, v_hoy, round(v_contado, 2), v_aporte,
            nullif(btrim(coalesce(p_aporte_nota, '')), ''),
            v_banco_mto, v_mano_mto, v_remanente,
            nullif(btrim(coalesce(p_nota, '')), ''), v_yo,
            CASE WHEN v_banco_mto > 0 THEN p_llevado_por END,
            CASE WHEN v_banco_mto > 0 THEN p_banco_id END,
            v_destino, p_entregado_a)
    RETURNING * INTO v_dep;

    UPDATE public.bolsas SET deposito_id = v_dep.id, updated_at = now()
     WHERE id = ANY(p_bolsa_ids);

    v_partes := concat_ws(' y ',
        CASE WHEN v_banco_mto > 0
             THEN '$' || to_char(v_banco_mto, 'FM999,999,990.00') || ' al banco · ' || v_banco END,
        CASE WHEN v_mano_mto > 0
             THEN '$' || to_char(v_mano_mto, 'FM999,999,990.00') || ' en efectivo a ' || v_a_quien END);
    IF v_partes IS NULL OR v_partes = '' THEN
        v_partes := CASE WHEN v_a_quien IS NOT NULL
                         THEN 'sin efectivo que mover · queda con ' || v_a_quien
                         ELSE 'sin efectivo que mover' END;
    END IF;

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
    SELECT b.id, 'DEPOSITAR', 'CONTADA', 'CONTADA', b.contado, v_yo,
           'Efectivo cerrado · ' || v_dep.folio || ' · ' || v_partes
      FROM public.bolsas b WHERE b.id = ANY(p_bolsa_ids);

    -- ── El aviso ───────────────────────────────────────────────────────────
    v_titulo := CASE v_destino
        WHEN 'BANCO'    THEN 'Depósito al banco · $' || to_char(v_banco_mto, 'FM999,999,990.00')
        WHEN 'EFECTIVO' THEN 'Efectivo entregado en mano · $' || to_char(v_mano_mto, 'FM999,999,990.00')
        ELSE 'Efectivo cerrado · $' || to_char(v_banco_mto + v_mano_mto, 'FM999,999,990.00')
    END;

    SELECT e.name INTO v_quien FROM public.employees e
     WHERE e.id = coalesce(CASE WHEN v_banco_mto > 0 THEN p_llevado_por END, v_yo);
    v_quien := CASE WHEN v_banco_mto > 0 AND p_llevado_por IS NOT NULL
                    THEN 'lo lleva ' || coalesce(v_quien, 'alguien sin nombre en el padrón')
                    ELSE 'lo cerró ' || coalesce(v_quien, 'alguien sin nombre en el padrón') END;

    -- El remanente se DICE, no se le asigna a nadie: es lo que no salió por el
    -- circuito, y de ahí en adelante es efectivo del dueño.
    v_cola := CASE WHEN v_remanente >= 0.01
                   THEN 'Quedan $' || to_char(v_remanente, 'FM999,999,990.00') || ' sin salir.'
                   ELSE 'Sin remanente.' END;

    SELECT array_agg(e.id ORDER BY e.name) INTO v_gerentes
      FROM public.employees e
      JOIN public.roles r ON r.id = e.role_id
     WHERE r.name = 'Gerente General' AND e.status = 'ACTIVO';

    IF v_gerentes IS NOT NULL THEN
        PERFORM public.notify_employees(
            v_gerentes,
            'DEPOSITO_BANCO',
            v_titulo,
            v_dep.folio || ' · ' || v_partes || ' · ' || v_quien || '. ' || v_cola,
            '/bolsas?tab=finalizadas',
            jsonb_build_object(
                'deposito_id',    v_dep.id,
                'folio',          v_dep.folio,
                'destino',        v_destino,
                'banco',          v_banco,
                'entregado_a',    v_a_quien,
                'monto_banco',    v_banco_mto,
                'monto_efectivo', v_mano_mto,
                'remanente',      v_dep.remanente,
                'bolsas',         v_cuantas),
            true,
            NULL
        );
    END IF;

    RETURN v_dep;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_deposito_bancario(bigint[], numeric, numeric, text, text, uuid, smallint, text, uuid, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_deposito_bancario(bigint[], numeric, numeric, text, text, uuid, smallint, text, uuid, numeric) TO authenticated, service_role;
