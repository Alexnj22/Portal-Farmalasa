SET lock_timeout = '5s';

-- ── Dos cambios sobre el depósito al banco ─────────────────────────────────
--
-- 1. «el remanente siempre es a Gerente General. así que no debe haber opción»
-- 2. «en el modal de depósito, que pregunte quién lo lleva a depositar»
--    (usuario, 2026-08-26).
--
-- ── Quién lo LLEVA no es quién lo cierra ───────────────────────────────────
-- `cerrado_por` es quien apretó el botón, sentado en administración.
-- `llevado_por` es quien agarra el efectivo y va al banco — la persona que lo
-- tiene en la mano mientras está en la calle, que es justo el tramo que ningún
-- registro cubría. Son dos personas distintas y ninguna de las dos se puede
-- deducir de la otra.
--
-- Sin índice a propósito: es una columna de auditoría (`*_por`) en una tabla
-- chica, que es la excepción escrita en la regla 2 de CLAUDE.md.
ALTER TABLE public.depositos_bancarios ADD COLUMN IF NOT EXISTS llevado_por uuid
    REFERENCES public.employees(id);

-- ── El remanente lo resuelve la BASE, no el navegador ──────────────────────
--
-- Antes era un desplegable con las 49 personas y `p_recibido_por` entraba tal
-- cual. Que siempre sea el Gerente General y aun así se pregunte es pedirle a
-- alguien que acierte una respuesta que ya está decidida — y deja la puerta
-- abierta a registrar que el efectivo se le entregó a cualquier otro.
--
-- Se resuelve por `roles.name = 'Gerente General'`. La tabla `roles` NO tiene
-- columna de código: su `name` ES la clave, que es el caso que CLAUDE.md
-- permite explícitamente («si `value === label`, cambiarlo exige migración»).
-- Renombrar ese cargo rompe esto, y por eso queda dicho acá.
--
-- ⚠ Y si no se puede resolver, NO se escribe un `null` en silencio: eso sería
-- convertir «no encontré» en «no se le entregó a nadie», que es la familia de
-- `feedback_sin_policy_de_update_el_write_devuelve_cero`. Se lanza, y quien
-- cierra se entera de que falta poner el cargo antes de mover el dinero.
CREATE OR REPLACE FUNCTION public.registrar_deposito_bancario(
    p_bolsa_ids bigint[],
    p_monto numeric,
    p_aporte numeric DEFAULT 0,
    p_aporte_nota text DEFAULT NULL,
    p_recibido_por uuid DEFAULT NULL,   -- ya no se usa: lo decide el cargo
    p_nota text DEFAULT NULL,
    p_llevado_por uuid DEFAULT NULL)
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
    v_gerente   uuid;
    v_folio     text;
    v_dep       public.depositos_bancarios;
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

    -- El Gerente General activo. Sólo hace falta si hay remanente que entregar.
    IF v_remanente >= 0.01 THEN
        SELECT e.id INTO v_gerente
          FROM public.employees e
          JOIN public.roles r ON r.id = e.role_id
         WHERE r.name = 'Gerente General' AND e.status = 'ACTIVO'
         ORDER BY e.name
         LIMIT 1;
        IF v_gerente IS NULL THEN
            RAISE EXCEPTION 'El remanente se le entrega al Gerente General y no hay ninguno activo. Hay que asignar el cargo antes de cerrar el depósito.';
        END IF;
    END IF;

    SELECT 'DEP-' || to_char(v_hoy, 'YYMMDD') || '-' || (count(*) + 1)
      INTO v_folio
      FROM public.depositos_bancarios WHERE fecha = v_hoy;

    INSERT INTO public.depositos_bancarios (
        folio, fecha, total_contado, aporte, aporte_nota, monto_deposito, remanente,
        remanente_entregado_por, remanente_recibido_por, nota, cerrado_por, llevado_por)
    VALUES (v_folio, v_hoy, round(v_contado, 2), v_aporte,
            nullif(btrim(coalesce(p_aporte_nota, '')), ''),
            round(p_monto, 2), v_remanente,
            CASE WHEN v_remanente >= 0.01 THEN v_yo END,
            CASE WHEN v_remanente >= 0.01 THEN v_gerente END,
            nullif(btrim(coalesce(p_nota, '')), ''), v_yo, p_llevado_por)
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

-- ── El archivo dice QUÉ DÍAS cubre y cuánto se contó ───────────────────────
--
-- «podré ver por ejemplo cada conteo? los días y el monto que se llevó al banco
-- / se contó?» (usuario). Lo contado ya salía; los DÍAS no, y son la pregunta
-- de quien cuadra contra el banco: un depósito junta bolsas de varios días y la
-- lista de bolsas de a una no responde «¿de cuándo es esta plata?».
--
-- `dia_desde`/`dia_hasta` salen de las bolsas que quedaron adentro, no de un
-- campo aparte: un rango guardado a mano puede dejar de coincidir con lo que el
-- depósito realmente tiene, y éste no puede.
CREATE OR REPLACE FUNCTION public.get_depositos(p_desde date, p_hasta date)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT CASE
    WHEN NOT (SELECT auth_has_module_permission('bolsas_conteo', 'can_view')) THEN NULL
    ELSE coalesce((
      SELECT json_agg(to_json(t) ORDER BY t.fecha DESC, t.folio DESC)
      FROM (
        SELECT d.id, d.folio, d.fecha,
               d.total_contado, d.aporte, d.aporte_nota,
               d.monto_deposito, d.remanente, d.nota,
               d.cerrado_at,
               (SELECT e.name FROM public.employees e WHERE e.id = d.cerrado_por)              AS cerrado_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.remanente_entregado_por)  AS entregado_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.remanente_recibido_por)   AS recibido_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.llevado_por)              AS llevado_por,
               (SELECT count(*) FROM public.bolsas b WHERE b.deposito_id = d.id)               AS cuantas,
               (SELECT min(b.fecha) FROM public.bolsas b WHERE b.deposito_id = d.id)           AS dia_desde,
               (SELECT max(b.fecha) FROM public.bolsas b WHERE b.deposito_id = d.id)           AS dia_hasta,
               -- El desglose POR DÍA, que es como se cuadra: 43 bolsas de a una
               -- no responden «¿cuánto entró del martes?».
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

REVOKE EXECUTE ON FUNCTION public.registrar_deposito_bancario(bigint[], numeric, numeric, text, uuid, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_depositos(date, date)                                                       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_deposito_bancario(bigint[], numeric, numeric, text, uuid, text, uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_depositos(date, date)                                                       TO authenticated, service_role;

-- La firma de SEIS argumentos queda huérfana: con la nueva de siete y todos sus
-- defaults, una llamada vieja de seis sería AMBIGUA. Se borra, que es la lección
-- de `update_proveedor_manual` (dos sobrecargas, una sola revocada).
DROP FUNCTION IF EXISTS public.registrar_deposito_bancario(bigint[], numeric, numeric, text, uuid, text);
