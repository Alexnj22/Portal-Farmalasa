SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Contar una bolsa no la cierra: la MARCA. Cierra el conteo entero
-- ═══════════════════════════════════════════════════════════════════════════
--
-- «al confirmar una bolsa pasa a confirmado de un solo? debe pasar hasta que se
-- confirme todo el conteo» (usuario, 2026-08-24).
--
-- Hasta acá un toque en «Cuadra» ponía la bolsa en CONTADA en el acto, y si no
-- cuadraba disparaba en ese mismo momento el aviso con push a la sala. Cada
-- bolsa se cerraba sola, sin que existiera el conteo del que forma parte.
--
-- El proceso real, dictado por el usuario, es otro: se llevan todos los cortes a
-- donde se cuentan, se va **sucursal por sucursal y dentro de cada una día por
-- día, del más viejo al más nuevo**, sale el total de esa sucursal, se repite
-- con todas, y **recién al final se hace el conteo total** — que es el momento
-- en que la cosa queda firmada. Después de eso se arma la remesa.
--
-- ── Por qué el marcado vive en la BASE y no en el navegador ────────────────
-- Era la decisión barata de tomar mal. Lo que se está escribiendo es efectivo
-- contado a mano: si se cierra la pestaña, se corta la red o la sesión se cierra
-- sola —y esta pantalla se usa con seis salas de bolsas sobre una mesa—, perder
-- lo marcado significa **volver a contar el dinero**. Una migración es más
-- barata que eso.
--
-- ── Tres columnas y no una tabla ───────────────────────────────────────────
-- La «sesión de conteo» no necesita existir como fila: es, exactamente, el
-- conjunto de bolsas marcadas y sin confirmar. Una tabla aparte habría que
-- abrirla, cerrarla, limpiarla si alguien se va a almorzar, y podría quedar
-- huérfana de sus bolsas. Acá no hay nada que se pueda desincronizar.
--
-- ── Quién contó y quién confirmó son dos personas distintas ────────────────
-- `contado_por` guarda a quien MARCÓ —quien tuvo el dinero en la mano— y no a
-- quien apretó el botón final. Quien confirma queda en `bolsas_eventos`. Sin esa
-- separación, el conteo de seis salas quedaría todo a nombre de la última
-- persona que pasó por la pantalla.
--
-- Probado antes en el entorno de pruebas: marca, desmarca, rebota el esperado
-- desactualizado, confirma seis bolsas en una tanda, rechaza la segunda
-- confirmación, y `contar_bolsa` queda cerrada para el navegador.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.bolsas
    ADD COLUMN IF NOT EXISTS conteo_marcado      numeric,
    ADD COLUMN IF NOT EXISTS conteo_marcado_por  uuid REFERENCES public.employees(id),
    ADD COLUMN IF NOT EXISTS conteo_marcado_at   timestamptz;

COMMENT ON COLUMN public.bolsas.conteo_marcado IS
  'Lo que se contó, todavía sin confirmar. La bolsa sigue en RECIBIDA hasta que confirmar_conteo cierra la tanda.';

-- Sólo tiene sentido marcado mientras la bolsa espera conteo.
ALTER TABLE public.bolsas DROP CONSTRAINT IF EXISTS bolsas_marcado_solo_recibida;
ALTER TABLE public.bolsas ADD CONSTRAINT bolsas_marcado_solo_recibida
    CHECK (conteo_marcado IS NULL OR estado = 'RECIBIDA');

-- ── Marcar ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marcar_conteo_bolsa(
    p_id bigint, p_contado numeric, p_esperado numeric)
RETURNS public.bolsas
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_bolsa public.bolsas;
    v_saldo numeric;
    v_yo    uuid := (SELECT auth_employee_id());
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_contado IS NULL OR p_contado < 0 THEN
        RAISE EXCEPTION 'Hay que escribir cuánto se contó.';
    END IF;

    SELECT * INTO v_bolsa FROM public.bolsas WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La bolsa no existe.'; END IF;

    IF (SELECT auth_module_scope('bolsas_conteo')) IS DISTINCT FROM 'ALL'
       AND v_bolsa.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_bolsa.estado <> 'RECIBIDA' THEN
        RAISE EXCEPTION 'La bolsa % no está lista para contar.', v_bolsa.folio;
    END IF;

    -- Igual que antes: el monto lo calcula el servidor y `p_esperado` es sólo lo
    -- que la pantalla mostró. Si cambió en el medio hay que volver a mirarla.
    v_saldo := public.bolsa_saldo(p_id);
    IF round(coalesce(p_esperado, -1), 2) <> round(v_saldo, 2) THEN
        RAISE EXCEPTION 'Lo que debe haber cambió mientras la pantalla estaba abierta: ahora son % y en pantalla decía %. Hay que abrirla de nuevo.',
            to_char(v_saldo, 'FM999999990.00'),
            to_char(round(coalesce(p_esperado, 0), 2), 'FM999999990.00');
    END IF;

    UPDATE public.bolsas
       SET conteo_marcado     = round(p_contado, 2),
           conteo_marcado_por = v_yo,
           conteo_marcado_at  = now(),
           updated_at         = now()
     WHERE id = p_id
     RETURNING * INTO v_bolsa;

    RETURN v_bolsa;
END;
$function$;

-- ── Desmarcar ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.desmarcar_conteo_bolsa(p_id bigint)
RETURNS public.bolsas
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_bolsa public.bolsas;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    UPDATE public.bolsas
       SET conteo_marcado = NULL, conteo_marcado_por = NULL, conteo_marcado_at = NULL,
           updated_at = now()
     WHERE id = p_id AND estado = 'RECIBIDA'
     RETURNING * INTO v_bolsa;

    IF NOT FOUND THEN RAISE EXCEPTION 'La bolsa ya no se puede desmarcar.'; END IF;
    RETURN v_bolsa;
END;
$function$;

-- ── Confirmar la tanda entera ──────────────────────────────────────────────
--
-- Acá pasa TODO lo que antes pasaba bolsa por bolsa: el cambio de estado, la
-- bitácora y el aviso. Y el aviso se manda UNO POR SALA con todas sus
-- diferencias, no uno por bolsa: la sala no necesita seis mensajes, necesita
-- saber qué pasó con su dinero.
--
-- La diferencia se recalcula ACÁ contra el saldo del momento, no contra el que
-- se vio al marcar. Si entre las dos cosas salió un vale de esa bolsa, el número
-- honesto es el de ahora.
CREATE OR REPLACE FUNCTION public.confirmar_conteo(p_ids bigint[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_yo    uuid := (SELECT auth_employee_id());
    v_n     integer := 0;
    r       record;
    v_saldo numeric;
    v_dif   numeric;
    b       record;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    FOR r IN SELECT * FROM public.bolsas
              WHERE id = ANY(p_ids) AND estado = 'RECIBIDA' AND conteo_marcado IS NOT NULL
              ORDER BY id FOR UPDATE
    LOOP
        IF (SELECT auth_module_scope('bolsas_conteo')) IS DISTINCT FROM 'ALL'
           AND r.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
            RAISE EXCEPTION 'FORBIDDEN';
        END IF;

        v_saldo := public.bolsa_saldo(r.id);
        v_dif   := round(r.conteo_marcado - v_saldo, 2);

        UPDATE public.bolsas
           SET estado      = 'CONTADA',
               contado     = r.conteo_marcado,
               contado_por = r.conteo_marcado_por,   -- quien CONTÓ, no quien confirma
               contado_at  = now(),
               conteo_marcado = NULL, conteo_marcado_por = NULL, conteo_marcado_at = NULL,
               updated_at  = now()
         WHERE id = r.id;

        INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
        VALUES (r.id, 'CONTAR', 'RECIBIDA', 'CONTADA', v_dif, v_yo,
                CASE WHEN abs(v_dif) < 0.01 THEN 'Cuadró.' ELSE 'No cuadró.' END
                || ' Conteo confirmado en tanda.');

        v_n := v_n + 1;
    END LOOP;

    IF v_n = 0 THEN
        RAISE EXCEPTION 'No hay ninguna bolsa marcada para confirmar.';
    END IF;

    -- Un aviso por sala, y sólo a las salas que tuvieron alguna diferencia.
    FOR b IN
        SELECT s.branch_id,
               (SELECT name FROM public.branches WHERE id = s.branch_id) AS sala,
               count(*) AS cuantas,
               sum(s.dif) AS neto,
               string_agg(s.folio || ' ' ||
                          CASE WHEN s.dif < 0 THEN 'faltó ' ELSE 'sobró ' END ||
                          '$' || to_char(abs(s.dif), 'FM999,999,990.00'),
                          ', ' ORDER BY s.folio) AS detalle
          FROM (SELECT bo.branch_id, bo.folio,
                       round(bo.contado - public.bolsa_saldo(bo.id), 2) AS dif
                  FROM public.bolsas bo
                 WHERE bo.id = ANY(p_ids) AND bo.estado = 'CONTADA') s
         WHERE abs(s.dif) >= 0.01
         GROUP BY s.branch_id
    LOOP
        PERFORM public.notify_employees(
            public.destinatarios_de_modulo(b.branch_id::integer, 'bolsas'),
            'bolsa_no_cuadra',
            CASE WHEN b.cuantas = 1 THEN 'Una bolsa no cuadró en el conteo'
                 ELSE b.cuantas || ' bolsas no cuadraron en el conteo' END,
            format('%s · %s.', coalesce(b.sala, 'Sala'), b.detalle),
            '/cortes',
            jsonb_build_object('branch_id', b.branch_id, 'bolsas', b.cuantas, 'neto', b.neto),
            true,
            b.branch_id::integer
        );
    END LOOP;

    RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.marcar_conteo_bolsa(bigint, numeric, numeric)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.desmarcar_conteo_bolsa(bigint)                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirmar_conteo(bigint[])                      FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marcar_conteo_bolsa(bigint, numeric, numeric)   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.desmarcar_conteo_bolsa(bigint)                  TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.confirmar_conteo(bigint[])                      TO authenticated, service_role;

-- El camino viejo se cierra: era el que cerraba una bolsa sola y avisaba en el
-- acto. Dejarlo ejecutable sería dejar viva la conducta que se vino a quitar.
REVOKE EXECUTE ON FUNCTION public.contar_bolsa(bigint, numeric, numeric) FROM PUBLIC, anon, authenticated;
