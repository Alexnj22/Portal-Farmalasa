SET lock_timeout = '5s';

-- La firma vieja se BORRA, no se deja al lado. Dos versiones con la misma
-- cantidad de argumentos por defecto dejan la llamada ambigua, y PostgREST
-- elige una — que es como `update_proveedor_manual` terminó con una sobrecarga
-- vieja conservando permisos que ya se le habían quitado a la nueva.
DROP FUNCTION IF EXISTS public.resolver_corte_caja(bigint, text, text, text);

CREATE OR REPLACE FUNCTION public.resolver_corte_caja(
    p_id                bigint,
    p_estado            text,
    p_motivo            text DEFAULT NULL,
    p_observaciones     text DEFAULT NULL,
    p_recibido_por      uuid DEFAULT NULL,
    p_vale              uuid DEFAULT NULL,
    p_sin_entrega_motivo text DEFAULT NULL
)
 RETURNS cortes_caja
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_corte   public.cortes_caja;
    v_scope   text;
    v_antes   text;
    v_prev    text;
    v_cerrada boolean;
    v_entrega text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_estado NOT IN ('CONFIRMADO','DESCARTADO') THEN
        RAISE EXCEPTION 'Estado invalido: %', p_estado;
    END IF;

    IF p_estado = 'DESCARTADO' AND (p_motivo IS NULL OR btrim(p_motivo) = '') THEN
        RAISE EXCEPTION 'Descartar un corte exige decir por que.';
    END IF;

    SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El corte no existe.';
    END IF;

    -- Quien ve solo su sala no resuelve la de otra. Se chequea aca porque la
    -- funcion es DEFINER y por lo tanto no pasa por la policy de la tabla.
    v_scope := (SELECT auth_module_scope('cortes_caja'));
    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    -- El Z es el cierre del dia, no un conteo: no se confirma ni se descarta.
    IF v_corte.tipo <> 'C' THEN
        RAISE EXCEPTION 'El cierre del dia no se confirma.';
    END IF;

    -- Un corte resuelto no se repisa: para cambiar la decision hay que reabrirlo
    -- con `reabrir_corte_caja`, que exige motivo y lo deja en la bitacora.
    IF v_corte.estado <> 'PENDIENTE' THEN
        RAISE EXCEPTION 'Este corte ya fue resuelto. Hay que reabrirlo para cambiar la decision.';
    END IF;

    IF p_estado = 'CONFIRMADO' THEN
        -- Un corte sin conteo no se firma: no hay conteo que dar por bueno, y
        -- confirmarlo correria la base de los que vienen despues contra un cero
        -- que nadie conto. La salida es descartarlo.
        IF public.corte_no_conto_efectivo(v_corte.tipo, v_corte.total_declarado,
                                          v_corte.diferencia_erp, v_corte.tk_total_caja) THEN
            RAISE EXCEPTION 'Este corte no conto el efectivo: el comprobante dice 0.00 y aun asi lo da por exacto. No hay nada que confirmar — hay que descartarlo y volver a hacer el corte.';
        END IF;

        -- Los cortes son acumulativos: el de la noche contiene al de la manana.
        -- Confirmar salteado le da al de la noche un tramo que en realidad
        -- pertenece a los dos, y le inventa uno al de la manana cuando llega su
        -- turno. Descartar SIEMPRE se puede: es la salida para un conteo malo
        -- que traba la serie.
        --
        -- Los que no contaron el efectivo quedan FUERA de esta guarda: no
        -- midieron nada, asi que no hay contra que medir este. Sin esa
        -- excepcion, uno solo de ellos traba todos los cortes posteriores del
        -- dia y la sala no puede cerrar — pasado en Salud 4 el 2-sep.
        SELECT to_char(c2.hora, 'HH24:MI') INTO v_prev
          FROM public.cortes_caja c2
         WHERE c2.branch_id = v_corte.branch_id
           AND c2.fecha     = v_corte.fecha
           AND c2.tipo      = 'C'
           AND c2.estado    = 'PENDIENTE'
           AND (c2.hora, c2.id) < (v_corte.hora, v_corte.id)
           AND NOT public.corte_no_conto_efectivo(c2.tipo, c2.total_declarado,
                                                  c2.diferencia_erp, c2.tk_total_caja)
         ORDER BY c2.hora
         LIMIT 1;

        IF v_prev IS NOT NULL THEN
            RAISE EXCEPTION 'Antes hay que resolver el corte de las %: los cortes del dia se suman, asi que este se mide contra aquel.', v_prev;
        END IF;

        PERFORM public.corte_trabado_por_posterior(p_id);

        /* ── LA ENTREGA DE LA CAJA ─────────────────────────────────────────
         *
         * Confirmar CIERRA EL TURNO, o sea que este es el momento en que la
         * caja cambia de manos. Quien recibe firma con su carne y se hace
         * cargo del dinero desde aca.
         *
         * NO BLOQUEA (decision del usuario, 3-sep: «avisar primero, medir,
         * despues bloquear»). Sin firma el corte se confirma igual y queda
         * marcado, porque un candado que deja a una sala sin poder cerrar el
         * turno produce el atajo en vez del control — ya paso con las bolsas.
         *
         * Lo unico que SI se rechaza es una firma falsa: quien conto no puede
         * recibir su propia caja. Eso no traba a nadie —siempre queda la
         * salida de confirmar sin entrega— y evita que la segunda firma sea la
         * misma persona, que es como un control de dos firmas deja de serlo.
         */
        IF p_recibido_por IS NOT NULL THEN
            IF v_corte.employee_id IS NOT NULL AND p_recibido_por = v_corte.employee_id THEN
                RAISE EXCEPTION 'Quien hizo el corte no puede recibir su propia caja. Tiene que firmar quien se queda con ella.';
            END IF;
            -- El vale es de un solo uso y dura 5 minutos: lo emitio el servidor
            -- al reconocer el carne, y el navegador no elige a quien nombra.
            PERFORM public.consumir_vale_de_identidad(p_vale, p_recibido_por);
            v_entrega := 'RECIBIDO';
        ELSE
            -- Sin firma, el desenlace lo decide el horario de la sala y no
            -- quien opera la pantalla.
            v_cerrada := public.sala_ya_cerro(v_corte.branch_id);
            v_entrega := CASE
                WHEN v_cerrada IS TRUE  THEN 'CIERRE'
                WHEN v_cerrada IS NULL  THEN 'SIN_HORARIO'
                ELSE 'SIN_ENTREGA'
            END;
        END IF;
    END IF;

    v_antes := v_corte.estado;

    UPDATE public.cortes_caja SET
        estado          = p_estado,
        motivo_descarte = CASE WHEN p_estado = 'DESCARTADO' THEN btrim(p_motivo) END,
        observaciones   = NULLIF(btrim(coalesce(p_observaciones,'')), ''),
        resuelto_por    = (SELECT auth_employee_id()),
        resuelto_at     = now(),
        -- Descartar no termina el turno de nadie, asi que no hay entrega que
        -- anotar: un conteo que no se firmo no cambio la caja de manos.
        recibido_por    = CASE WHEN p_estado = 'CONFIRMADO' THEN p_recibido_por END,
        recibido_at     = CASE WHEN p_estado = 'CONFIRMADO' AND p_recibido_por IS NOT NULL
                               THEN now() END,
        entrega         = v_entrega,
        sin_entrega_motivo = CASE WHEN v_entrega = 'SIN_ENTREGA'
                                  THEN NULLIF(btrim(coalesce(p_sin_entrega_motivo,'')), '') END,
        updated_at      = now()
    WHERE id = p_id
    RETURNING * INTO v_corte;

    INSERT INTO public.cortes_caja_eventos
        (corte_id, accion, estado_antes, estado_despues, motivo, nota, employee_id)
    VALUES (p_id,
            CASE WHEN p_estado = 'CONFIRMADO' THEN 'CONFIRMAR' ELSE 'DESCARTAR' END,
            v_antes, p_estado,
            CASE WHEN p_estado = 'DESCARTADO' THEN btrim(p_motivo) END,
            NULLIF(btrim(coalesce(p_observaciones,'')), ''),
            (SELECT auth_employee_id()));

    -- La entrega es un acto propio y va a la bitacora como tal: sin esto, el
    -- unico rastro seria una columna que se puede volver a escribir al reabrir
    -- el corte, y quedaria sin registro de quien recibio la primera vez.
    IF v_entrega = 'RECIBIDO' THEN
        INSERT INTO public.cortes_caja_eventos
            (corte_id, accion, estado_antes, estado_despues, nota, employee_id)
        VALUES (p_id, 'RECIBIR', v_antes, p_estado,
                'Recibe la caja y se hace cargo del efectivo.', p_recibido_por);
    END IF;

    RETURN v_corte;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolver_corte_caja(bigint,text,text,text,uuid,uuid,text)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolver_corte_caja(bigint,text,text,text,uuid,uuid,text)
  TO authenticated, service_role;
