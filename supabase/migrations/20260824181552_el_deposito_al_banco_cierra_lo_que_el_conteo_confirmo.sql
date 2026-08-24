SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El depósito al banco: lo que sigue después de confirmar el conteo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Dictado por el usuario el 2026-08-24, con su ejemplo:
--
--   contado          $22,350.35   (de eso, $300 en moneda)
--   se quiere llevar $22,400.00
--   1. la moneda se cambia por billete
--   2. los ~$50 que faltan salen por un vale en Salud 3
--   3. se confirman los $22,400 para el banco
--   4. el remanente se le entrega al gerente general
--
-- ── «Depósito al banco» y no «Remesa» ──────────────────────────────────────
-- El usuario lo llama remesar, y tiene razón en su idioma. Pero DENTRO de este
-- módulo la palabra «Remesa» ya está tomada: es el motivo con el que una sala
-- paga una transferencia de MoneyGram o RIA a un cliente, y vive en
-- `bolsas_tipos_salida` con su boleta y su foto obligatoria. Son dos cosas
-- distintas que se hacen en la misma pantalla; llamarlas igual garantiza que
-- alguien elija la equivocada. Acá se llama depósito.
--
-- ── El remanente lo firma quien CIERRA, no quien lo recibe ─────────────────
-- «quien marca como finalizado / entregado, queda registrado que fue quien
-- entrego el remanente. no hace falta que don rutilio confirme» (usuario). Es
-- distinto de la entrega de bolsas, donde quien retira sí se identifica con su
-- carné: allá el dinero se va de la empresa a la calle, acá pasa de una persona
-- de administración a otra dentro de la misma oficina. Se guardan los dos
-- nombres —quien entregó y a quién— pero sólo el primero es un hecho probado.
--
-- ── El cambio de moneda NO se registra ─────────────────────────────────────
-- Cambiar $300 de moneda por $300 en billete no mueve ningún total. Registrarlo
-- sería un paso que no cambia ninguna cuenta — y de este mismo módulo ya se
-- quitó un motivo de salida por exactamente eso.
--
-- ── El aporte es un monto con su motivo escrito, no un vínculo ─────────────
-- Los ~$50 que completan salen por «Sacar dinero», que ya existe («ya es un
-- proceso que ya creamos»). Vincular ACÁ el vale exacto exigiría adivinar con
-- qué motivo se registró, y un vínculo mal adivinado es peor que ninguno. Por
-- ahora el aporte va como monto **con nota obligatoria** que diga de dónde
-- salió. Enlazarlo al movimiento real queda pendiente y escrito.
--
-- Probado en el entorno de pruebas: frena llevarse más de lo que hay, frena un
-- aporte sin explicar, arma el depósito con su remanente, y rechaza depositar
-- dos veces las mismas bolsas. Ahí se cazó además que `FOR UPDATE` no se puede
-- usar junto a un agregado — el candado va en una consulta aparte.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.depositos_bancarios (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    folio                   text        NOT NULL UNIQUE,
    fecha                   date        NOT NULL,
    total_contado           numeric     NOT NULL,
    aporte                  numeric     NOT NULL DEFAULT 0,
    aporte_nota             text,
    monto_deposito          numeric     NOT NULL,
    remanente               numeric     NOT NULL,
    remanente_entregado_por uuid        REFERENCES public.employees(id),
    remanente_recibido_por  uuid        REFERENCES public.employees(id),
    nota                    text,
    cerrado_por             uuid        REFERENCES public.employees(id),
    cerrado_at              timestamptz NOT NULL DEFAULT now(),
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT deposito_monto_positivo CHECK (monto_deposito > 0),
    CONSTRAINT deposito_aporte_no_negativo CHECK (aporte >= 0),
    CONSTRAINT deposito_remanente_no_negativo CHECK (remanente >= 0),
    -- El aporte sin explicación es plata que aparece de la nada.
    CONSTRAINT deposito_aporte_con_nota
        CHECK (aporte = 0 OR nullif(btrim(coalesce(aporte_nota, '')), '') IS NOT NULL),
    -- La aritmética queda anclada en la tabla y no sólo en la función.
    CONSTRAINT deposito_cuadra
        CHECK (round(total_contado + aporte - monto_deposito, 2) = round(remanente, 2))
);

-- Qué bolsas se fueron en cada depósito. Una bolsa entra en uno solo.
ALTER TABLE public.bolsas
    ADD COLUMN IF NOT EXISTS deposito_id bigint REFERENCES public.depositos_bancarios(id);
CREATE INDEX IF NOT EXISTS idx_bolsas_deposito ON public.bolsas(deposito_id);
CREATE INDEX IF NOT EXISTS idx_depositos_fecha ON public.depositos_bancarios(fecha DESC);

ALTER TABLE public.depositos_bancarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS depositos_select ON public.depositos_bancarios;
CREATE POLICY depositos_select ON public.depositos_bancarios FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('bolsas_conteo', 'can_view')));

-- Sin policy de escritura: sólo entra por la función DEFINER de abajo. Un
-- depósito escrito a mano por el navegador no tendría ni folio ni bolsas.

COMMENT ON TABLE public.depositos_bancarios IS
  'El efectivo que se lleva al banco después de confirmar un conteo. NO es la «Remesa» de bolsas_tipos_salida, que es pagarle una transferencia a un cliente.';

-- ── Registrar el depósito ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_deposito_bancario(
    p_bolsa_ids     bigint[],
    p_monto         numeric,
    p_aporte        numeric DEFAULT 0,
    p_aporte_nota   text    DEFAULT NULL,
    p_recibido_por  uuid    DEFAULT NULL,
    p_nota          text    DEFAULT NULL)
RETURNS public.depositos_bancarios
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_yo        uuid := (SELECT auth_employee_id());
    v_hoy       date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_contado   numeric;
    v_cuantas   integer;
    v_aporte    numeric := round(coalesce(p_aporte, 0), 2);
    v_remanente numeric;
    v_folio     text;
    v_dep       public.depositos_bancarios;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    -- El total lo suma el SERVIDOR sobre las bolsas que se mandan, y no se
    -- acepta el número que trae la pantalla: es la cifra contra la que se decide
    -- cuánto va al banco.
    -- El candado va en una consulta APARTE: Postgres no acepta `FOR UPDATE`
    -- junto a un agregado, y sin candado dos cierres simultáneos podrían llevarse
    -- las mismas bolsas dos veces. (Lo cazó la prueba en el entorno de pruebas.)
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
        RAISE EXCEPTION 'No hay bolsas contadas y sin depositar en esa lista.';
    END IF;
    IF v_cuantas <> coalesce(array_length(p_bolsa_ids, 1), 0) THEN
        RAISE EXCEPTION 'Alguna de esas bolsas ya se depositó o dejó de estar contada. Vuelve a abrir la pantalla.';
    END IF;

    IF p_monto IS NULL OR p_monto <= 0 THEN
        RAISE EXCEPTION 'Hay que escribir cuánto va al banco.';
    END IF;
    IF v_aporte > 0 AND nullif(btrim(coalesce(p_aporte_nota, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Si entra dinero de afuera hay que decir de dónde salió.';
    END IF;

    v_remanente := round(v_contado + v_aporte - p_monto, 2);
    IF v_remanente < 0 THEN
        RAISE EXCEPTION 'No alcanza: hay % y se quieren llevar %. Faltan %.',
            to_char(v_contado + v_aporte, 'FM999,999,990.00'),
            to_char(round(p_monto, 2), 'FM999,999,990.00'),
            to_char(abs(v_remanente), 'FM999,999,990.00');
    END IF;

    -- Folio del día. La tabla lo tiene UNIQUE, así que dos cierres a la vez no
    -- pueden compartirlo aunque cuenten lo mismo.
    SELECT 'DEP-' || to_char(v_hoy, 'YYMMDD') || '-' || (count(*) + 1)
      INTO v_folio
      FROM public.depositos_bancarios WHERE fecha = v_hoy;

    INSERT INTO public.depositos_bancarios (
        folio, fecha, total_contado, aporte, aporte_nota, monto_deposito, remanente,
        remanente_entregado_por, remanente_recibido_por, nota, cerrado_por)
    VALUES (v_folio, v_hoy, round(v_contado, 2), v_aporte,
            nullif(btrim(coalesce(p_aporte_nota, '')), ''),
            round(p_monto, 2), v_remanente,
            -- Quien cierra ES quien entregó el remanente: es lo único que el
            -- portal puede afirmar. A quién se lo dio queda como dato, no como
            -- prueba — nadie del otro lado confirma.
            CASE WHEN v_remanente >= 0.01 THEN v_yo END,
            CASE WHEN v_remanente >= 0.01 THEN p_recibido_por END,
            nullif(btrim(coalesce(p_nota, '')), ''), v_yo)
    RETURNING * INTO v_dep;

    UPDATE public.bolsas SET deposito_id = v_dep.id, updated_at = now()
     WHERE id = ANY(p_bolsa_ids);

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
    SELECT b.id, 'DEPOSITAR', 'CONTADA', 'CONTADA', b.contado, v_yo,
           'Depositada en el banco · ' || v_dep.folio
      FROM public.bolsas b WHERE b.id = ANY(p_bolsa_ids);

    RETURN v_dep;
END;
$function$;

-- ── Lo contado y todavía sin depositar ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_por_depositar()
RETURNS json
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.fecha, t.folio), '[]'::json)
  FROM (
    SELECT b.id, b.folio, b.branch_id, b.fecha, b.hora, b.contado
      FROM public.bolsas b
     WHERE b.estado = 'CONTADA' AND b.deposito_id IS NULL AND b.contado IS NOT NULL
  ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_deposito_bancario(bigint[], numeric, numeric, text, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_por_depositar() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_deposito_bancario(bigint[], numeric, numeric, text, uuid, text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_por_depositar() TO authenticated, service_role;
