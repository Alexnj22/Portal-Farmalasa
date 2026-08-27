-- El aviso de «una bolsa no cuadro» llevaba a una puerta cerrada.
--
-- `confirmar_conteo` le avisa a la sala desde el 15-ago cuando alguna de sus
-- bolsas no cuadro, con el folio y cuanto falto. El aviso estaba bien y el
-- permiso tambien: `resolver_diferencia_bolsa` acepta a quien tenga `bolsas` con
-- `can_edit` sobre una bolsa de SU sucursal, que es lo que tienen los cuatro
-- cargos de sala (Dependiente, Jefe/a y Subjefe/a de Sala, Regente).
--
-- Lo que fallaba era el DESTINO: `/bolsas?tab=finalizadas` es una pestaña
-- `soloAdmin`. La sala tocaba la notificacion, la pestaña no existia para ella y
-- caia en «En la sala» — donde esa bolsa ya no esta, porque se conto hace dias.
--
-- «ellos deben de poder justificar esa diferencia, que llegue notificacion con
-- la opcion de contestar y explicar. y en las bolsas de efectivo que tengan un
-- apartado de esto» (usuario, 2026-08-26). El apartado es la pestaña
-- «Diferencias», que las dos partes ven: la sala las suyas, administracion
-- todas. Esta migracion es la otra mitad — que el aviso apunte ahi.
--
-- Se toca UNA linea del cuerpo. El resto de la funcion queda igual.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.confirmar_conteo(p_ids bigint[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_yo       uuid := (SELECT auth_employee_id());
    v_n        integer := 0;
    r          record;
    v_saldo    numeric;
    v_dif      numeric;
    b          record;
    v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_folio    text;
    v_conteo   public.bolsas_conteos;
    v_esperado numeric := 0;
    v_contado  numeric := 0;
    v_desc     integer := 0;
    v_quien    text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    -- La cabecera se abre ANTES del recorrido porque cada bolsa necesita su id.
    -- Si al final no se cerró ninguna, el RAISE de abajo tira la transacción
    -- entera y esta fila no queda: un folio sin bolsas sería una tanda que nunca
    -- pasó.
    SELECT 'CNT-' || to_char(v_hoy, 'YYMMDD') || '-' || (count(*) + 1)
      INTO v_folio
      FROM public.bolsas_conteos WHERE fecha = v_hoy;

    INSERT INTO public.bolsas_conteos (folio, fecha, cerrado_por)
    VALUES (v_folio, v_hoy, v_yo)
    RETURNING * INTO v_conteo;

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

        v_esperado := v_esperado + v_saldo;
        v_contado  := v_contado  + r.conteo_marcado;
        IF abs(v_dif) >= 0.01 THEN v_desc := v_desc + 1; END IF;

        UPDATE public.bolsas
           SET estado      = 'CONTADA',
               contado     = r.conteo_marcado,
               contado_por = r.conteo_marcado_por,   -- quien CONTÓ, no quien confirma
               contado_at  = now(),
               conteo_id   = v_conteo.id,
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

        -- La bitácora nombra a quien CONTÓ esta bolsa, que puede no ser quien
        -- firma la tanda. Sin esto el único nombre del renglón era el del que
        -- apretó «Confirmar», y así es como el rastro termina diciendo que una
        -- sola persona hizo todo.
        SELECT e.name INTO v_quien FROM public.employees e WHERE e.id = r.conteo_marcado_por;

        INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
        VALUES (r.id, 'CONTAR', 'RECIBIDA', 'CONTADA', v_dif, v_yo,
                CASE WHEN abs(v_dif) < 0.01 THEN 'Cuadró.' ELSE 'No cuadró.' END
                || CASE WHEN v_quien IS NOT NULL THEN ' La contó ' || v_quien || '.' ELSE '' END
                || ' Conteo confirmado en la tanda ' || v_conteo.folio || '.'
                || CASE WHEN abs(v_dif) >= 0.01 AND r.dif_at IS NOT NULL
                        THEN ' La causa ya estaba anotada.' ELSE '' END);

        v_n := v_n + 1;
    END LOOP;

    IF v_n = 0 THEN
        RAISE EXCEPTION 'No hay ninguna bolsa marcada para confirmar.';
    END IF;

    UPDATE public.bolsas_conteos
       SET cuantas        = v_n,
           total_esperado = round(v_esperado, 2),
           total_contado  = round(v_contado, 2),
           diferencia     = round(v_contado - v_esperado, 2),
           descuadradas   = v_desc
     WHERE id = v_conteo.id;

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
            format('%s · %s. Entrá a explicar qué pasó.', coalesce(b.sala, 'Sala'), b.detalle),
            -- La pestaña donde la sala PUEDE contestar. Antes iba a
            -- «finalizadas», que es soloAdmin: el aviso llegaba y no había
            -- adónde. Ver el encabezado de esta migración.
            '/bolsas?tab=diferencias',
            jsonb_build_object('branch_id', b.branch_id, 'bolsas', b.cuantas, 'neto', b.neto),
            true,
            b.branch_id::integer
        );
    END LOOP;

    RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirmar_conteo(bigint[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirmar_conteo(bigint[]) TO authenticated, service_role;
