SET lock_timeout = '5s';

-- ═══ Un cierre se REPARTE; no elige ═════════════════════════════════════════
--
-- «¿qué pasa si una parte va en efectivo y otra en depósito?» (usuario,
-- 2026-08-26), sobre el control de dos opciones excluyentes que salió hace un
-- rato. La respuesta era mala: sólo se podía si la parte en efectivo iba al
-- Gerente General —porque eso ya es el remanente— y a cualquier otro de
-- administración, no se podía en absoluto.
--
-- El error de fondo fue modelar «a dónde va» como UNA elección. Un cierre no
-- elige un destino: **reparte** lo contado en hasta tres partes, y las tres
-- pueden convivir el mismo día:
--
--     contado + lo que entró de afuera
--       − al banco          (exige banco)
--       − en mano           (exige a quién, y sólo administración)
--       = remanente         (siempre del Gerente General, decisión del 26-ago)
--
-- `monto_deposito` pasa a ser SÓLO la parte del banco —que es lo que su nombre
-- decía— y `monto_efectivo` es la parte en mano. `destino` deja de ser algo que
-- alguien elige y pasa a DERIVARSE del reparto: es un rótulo, no un dato.
ALTER TABLE public.depositos_bancarios
    ADD COLUMN IF NOT EXISTS monto_efectivo numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.depositos_bancarios DROP CONSTRAINT IF EXISTS depositos_destino_valido;
ALTER TABLE public.depositos_bancarios
    ADD CONSTRAINT depositos_destino_valido CHECK (destino IN ('BANCO', 'EFECTIVO', 'MIXTO'));

COMMENT ON COLUMN public.depositos_bancarios.destino IS
    'DERIVADO del reparto, no elegido: MIXTO si sale por los dos lados, BANCO si sólo al banco, EFECTIVO si todo sale (o queda) en mano.';
COMMENT ON COLUMN public.depositos_bancarios.monto_deposito IS
    'Sólo la parte que va al BANCO. La parte en mano vive en monto_efectivo.';


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
    v_gerente   uuid;
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

    -- Cada parte exige lo suyo, y sólo si esa parte existe. Así un cierre que
    -- va entero al banco no pide a quién, y uno que va entero en mano no pide
    -- banco — pero uno repartido pide las dos cosas.
    IF v_banco_mto > 0 THEN
        SELECT b.nombre INTO v_banco FROM public.bancos b
         WHERE b.id = p_banco_id AND b.activo;
        IF v_banco IS NULL THEN
            RAISE EXCEPTION 'Hay que decir a qué banco va esa parte. Si no ves ese campo, recarga la pantalla.';
        END IF;
    END IF;

    IF p_entregado_a IS NOT NULL THEN
        -- En mano SÓLO a administración, y el servidor lo comprueba contra la
        -- MISMA lista que llena el selector.
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

    -- El destino se DERIVA del reparto. Sin parte de banco, todo lo que sale
    -- —o lo que queda de remanente— cambia de manos en efectivo.
    v_destino := CASE
        WHEN v_banco_mto > 0 AND v_mano_mto > 0 THEN 'MIXTO'
        WHEN v_banco_mto > 0                    THEN 'BANCO'
        ELSE 'EFECTIVO'
    END;

    -- El Gerente General activo. Sólo hace falta si hay remanente que entregar.
    IF v_remanente >= 0.01 THEN
        SELECT e.id INTO v_gerente
          FROM public.employees e
          JOIN public.roles r ON r.id = e.role_id
         WHERE r.name = 'Gerente General' AND e.status = 'ACTIVO'
         ORDER BY e.name
         LIMIT 1;
        IF v_gerente IS NULL THEN
            RAISE EXCEPTION 'El remanente se le entrega al Gerente General y no hay ninguno activo. Hay que asignar el cargo antes de cerrar.';
        END IF;
    END IF;

    SELECT 'DEP-' || to_char(v_hoy, 'YYMMDD') || '-' || (count(*) + 1)
      INTO v_folio
      FROM public.depositos_bancarios WHERE fecha = v_hoy;

    INSERT INTO public.depositos_bancarios (
        folio, fecha, total_contado, aporte, aporte_nota,
        monto_deposito, monto_efectivo, remanente,
        remanente_entregado_por, remanente_recibido_por, nota, cerrado_por, llevado_por,
        banco_id, destino, entregado_a)
    VALUES (v_folio, v_hoy, round(v_contado, 2), v_aporte,
            nullif(btrim(coalesce(p_aporte_nota, '')), ''),
            v_banco_mto, v_mano_mto, v_remanente,
            CASE WHEN v_remanente >= 0.01 THEN v_yo END,
            CASE WHEN v_remanente >= 0.01 THEN v_gerente END,
            nullif(btrim(coalesce(p_nota, '')), ''), v_yo,
            CASE WHEN v_banco_mto > 0 THEN p_llevado_por END,
            CASE WHEN v_banco_mto > 0 THEN p_banco_id END,
            v_destino, p_entregado_a)
    RETURNING * INTO v_dep;

    UPDATE public.bolsas SET deposito_id = v_dep.id, updated_at = now()
     WHERE id = ANY(p_bolsa_ids);

    -- La bitácora dice el reparto entero, no una de sus mitades.
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

    v_cola := CASE WHEN v_remanente >= 0.01
                   THEN 'Remanente de $' || to_char(v_remanente, 'FM999,999,990.00')
                        || ' para ' || coalesce((SELECT e.name FROM public.employees e WHERE e.id = v_gerente), 'el Gerente General') || '.'
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

-- La firma de hace un rato, la de nueve parámetros, se va: dos sobrecargas de
-- la misma función es cómo se cuela una puerta sin candado.
DROP FUNCTION IF EXISTS public.registrar_deposito_bancario(bigint[], numeric, numeric, text, text, uuid, smallint, text, uuid);


-- ── El archivo dice el reparto ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_depositos(p_desde date, p_hasta date)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN NOT (SELECT auth_has_module_permission('bolsas_conteo', 'can_view')) THEN NULL
    ELSE coalesce((
      SELECT json_agg(to_json(t) ORDER BY t.fecha DESC, t.folio DESC)
      FROM (
        SELECT d.id, d.folio, d.fecha,
               d.total_contado, d.aporte, d.aporte_nota,
               d.monto_deposito, d.monto_efectivo, d.remanente, d.nota,
               d.cerrado_at, d.destino,
               (SELECT b.nombre FROM public.bancos b WHERE b.id = d.banco_id)                  AS banco,
               (SELECT e.name FROM public.employees e WHERE e.id = d.cerrado_por)              AS cerrado_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.remanente_entregado_por)  AS entregado_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.remanente_recibido_por)   AS recibido_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.llevado_por)              AS llevado_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.entregado_a)              AS entregado_a,
               (SELECT count(*) FROM public.bolsas b WHERE b.deposito_id = d.id)               AS cuantas,
               (SELECT min(b.fecha) FROM public.bolsas b WHERE b.deposito_id = d.id)           AS dia_desde,
               (SELECT max(b.fecha) FROM public.bolsas b WHERE b.deposito_id = d.id)           AS dia_hasta,
               coalesce((
                 SELECT json_agg(json_build_object('fecha', x.fecha, 'cuantas', x.cuantas, 'contado', x.contado)
                                 ORDER BY x.fecha)
                   FROM (SELECT b.fecha, count(*) AS cuantas, sum(b.contado) AS contado
                           FROM public.bolsas b WHERE b.deposito_id = d.id
                          GROUP BY b.fecha) x
               ), '[]'::json) AS por_dia,
               coalesce((
                 SELECT json_agg(json_build_object(
                          'id', b.id, 'folio', b.folio, 'branch_id', b.branch_id,
                          'fecha', b.fecha, 'hora', b.hora, 'contado', b.contado)
                        ORDER BY b.branch_id, b.fecha, b.folio)
                   FROM public.bolsas b WHERE b.deposito_id = d.id
               ), '[]'::json) AS bolsas
          FROM public.depositos_bancarios d
         WHERE (p_desde IS NULL OR d.fecha >= p_desde)
           AND (p_hasta IS NULL OR d.fecha <= p_hasta)
      ) t
    ), '[]'::json)
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_depositos(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_depositos(date, date) TO authenticated, service_role;
