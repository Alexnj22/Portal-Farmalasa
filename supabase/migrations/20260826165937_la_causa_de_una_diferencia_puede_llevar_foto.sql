SET lock_timeout = '5s';

-- ── La causa de una diferencia puede llevar foto ────────────────────────────
--
-- «que permita adjuntar o tomar foto de ser necesario» (usuario, 2026-08-26).
--
-- Una diferencia de efectivo se explica con papel: el vale que apareció después,
-- la boleta del depósito que repone el faltante, la foto del sobre. Hasta hoy la
-- causa era sólo texto, así que el respaldo quedaba fuera del portal —o sea, en
-- ninguna parte auditable—.
--
-- Va al mismo bucket privado que la foto del comprobante de una salida, y se
-- guarda la URL en formato PÚBLICO como identificador: la firmada expira (regla
-- 10 de CLAUDE.md). Quien la mira la pide firmada en el momento.
ALTER TABLE public.bolsas ADD COLUMN IF NOT EXISTS dif_foto_url text;

-- ⚠ Se BORRA la firma vieja antes de crear la nueva. Con `p_foto_url DEFAULT
-- NULL` conviviendo con la de tres argumentos, una llamada de tres queda
-- AMBIGUA y Postgres la rechaza; y aunque no lo hiciera, la vieja se quedaría
-- con sus permisos propios. Es exactamente lo que pasó con las dos sobrecargas
-- de `update_proveedor_manual`, donde la revocación alcanzó a una sola.
DROP FUNCTION IF EXISTS public.resolver_diferencia_bolsa(bigint, text, text);

CREATE FUNCTION public.resolver_diferencia_bolsa(
    p_id bigint, p_via text, p_causa text, p_foto_url text DEFAULT NULL)
RETURNS public.bolsas
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_bolsa   public.bolsas;
    v_yo      uuid := (SELECT auth_employee_id());
    v_scope   text := (SELECT auth_module_scope('bolsas'));
    v_contado numeric;
    v_dif     numeric;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo','bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_via NOT IN ('REPONE','RETIRA','JUSTIFICA') THEN
        RAISE EXCEPTION 'Vía inválida: %', p_via;
    END IF;
    IF p_causa IS NULL OR btrim(p_causa) = '' THEN
        RAISE EXCEPTION 'Resolver una diferencia exige decir por qué.';
    END IF;

    SELECT * INTO v_bolsa FROM public.bolsas WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La bolsa no existe.'; END IF;

    -- Las DOS ventanas donde hay un conteo contra el que medir: la tanda ya
    -- firmada (`contado`) y la que todavía se está contando (`conteo_marcado`).
    v_contado := CASE
        WHEN v_bolsa.estado = 'CONTADA'  THEN v_bolsa.contado
        WHEN v_bolsa.estado = 'RECIBIDA' THEN v_bolsa.conteo_marcado
        ELSE NULL
    END;
    IF v_contado IS NULL THEN
        RAISE EXCEPTION 'Esta bolsa todavía no se contó.';
    END IF;

    v_dif := round(v_contado - public.bolsa_saldo(p_id), 2);
    IF abs(v_dif) < 0.01 THEN
        RAISE EXCEPTION 'Esta bolsa cuadró: no hay nada que resolver.';
    END IF;

    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo']))
       AND v_scope IS DISTINCT FROM 'ALL'
       AND v_bolsa.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    UPDATE public.bolsas
       SET dif_via = p_via, dif_causa = btrim(p_causa), dif_por = v_yo, dif_at = now(),
           dif_foto_url = nullif(btrim(coalesce(p_foto_url, '')), ''),
           updated_at = now()
     WHERE id = p_id
     RETURNING * INTO v_bolsa;

    -- El estado va REAL en los dos lados y no clavado en 'CONTADA': la bitácora
    -- es lo que después dice si la causa se supo mientras se contaba o después.
    INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, motivo, nota, monto, employee_id)
    VALUES (p_id, 'RESOLVER', v_bolsa.estado, v_bolsa.estado, btrim(p_causa),
            CASE WHEN v_bolsa.dif_foto_url IS NOT NULL THEN 'Con foto de respaldo.' END,
            v_dif, v_yo);

    RETURN v_bolsa;
END;
$function$;

-- ── Las dos limpiezas tienen que alcanzar también a la foto ─────────────────
-- Una causa que deja de aplicar y se lleva su texto pero no su foto deja un
-- respaldo huérfano colgado de una bolsa que ya no lo explica.
CREATE OR REPLACE FUNCTION public.desmarcar_conteo_bolsa(p_id bigint)
RETURNS public.bolsas
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_bolsa public.bolsas;
    v_tenia boolean;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    SELECT (dif_at IS NOT NULL) INTO v_tenia
      FROM public.bolsas WHERE id = p_id AND estado = 'RECIBIDA';

    UPDATE public.bolsas
       SET conteo_marcado = NULL, conteo_marcado_por = NULL, conteo_marcado_at = NULL,
           dif_via = NULL, dif_causa = NULL, dif_por = NULL, dif_at = NULL,
           dif_foto_url = NULL,
           updated_at = now()
     WHERE id = p_id AND estado = 'RECIBIDA'
     RETURNING * INTO v_bolsa;

    IF NOT FOUND THEN RAISE EXCEPTION 'La bolsa ya no se puede desmarcar.'; END IF;

    IF coalesce(v_tenia, false) THEN
        INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, employee_id, nota)
        VALUES (p_id, 'RESOLVER', 'RECIBIDA', 'RECIBIDA', (SELECT auth_employee_id()),
                'Se descartó el conteo: la causa anotada dejó de aplicar.');
    END IF;

    RETURN v_bolsa;
END;
$function$;

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
               -- Una resolución sobre una bolsa que terminó cuadrando explica
               -- algo que no pasó: se borra, foto incluida.
               dif_via      = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_via      END,
               dif_causa    = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_causa    END,
               dif_por      = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_por      END,
               dif_at       = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_at       END,
               dif_foto_url = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_foto_url END,
               updated_at  = now()
         WHERE id = r.id;

        INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
        VALUES (r.id, 'CONTAR', 'RECIBIDA', 'CONTADA', v_dif, v_yo,
                CASE WHEN abs(v_dif) < 0.01 THEN 'Cuadró.' ELSE 'No cuadró.' END
                || ' Conteo confirmado en tanda.'
                || CASE WHEN abs(v_dif) >= 0.01 AND r.dif_at IS NOT NULL
                        THEN ' La causa ya estaba anotada.' ELSE '' END);

        v_n := v_n + 1;
    END LOOP;

    IF v_n = 0 THEN
        RAISE EXCEPTION 'No hay ninguna bolsa marcada para confirmar.';
    END IF;

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

REVOKE EXECUTE ON FUNCTION public.resolver_diferencia_bolsa(bigint, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.desmarcar_conteo_bolsa(bigint)                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirmar_conteo(bigint[])                          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolver_diferencia_bolsa(bigint, text, text, text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.desmarcar_conteo_bolsa(bigint)                      TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.confirmar_conteo(bigint[])                          TO authenticated, service_role;
