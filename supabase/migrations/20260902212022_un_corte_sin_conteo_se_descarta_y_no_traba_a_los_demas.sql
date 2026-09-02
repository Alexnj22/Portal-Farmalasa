SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Un corte que NO conto el efectivo se DESCARTA, nunca se confirma, y NO traba
-- a los que vienen despues.
--
-- ── El caso, medido ─────────────────────────────────────────────────────────
-- Salud 4, 2-sep 13:09 (corte 14393, fila 669). Su tiquete termina asi:
--
--     TOTAL CAJA $:   230.85
--     EFECTIVO  $:      0.00
--     EXACTO FELICIDADES $:  0.00
--
-- O sea: no se conto nada y el origen igual lo dio por exacto. El listado del
-- origen lo publica con total 0.00 y diferencia 0.00, asi que el `esperado`
-- generado de la tabla —`total_declarado - diferencia_erp`— nace en CERO. Un
-- corte que dice haber cuadrado sobre una caja que esperaba $319.10.
--
-- ── Lo que fallaba, y por que son DOS frenos correctos sin salida ───────────
-- v2.953.1 le enseño el caso al portal (`noContoEfectivo` en
-- `cortesDiagnostico.js`): dejo de anunciar un faltante inventado de $319.10 y
-- de ofrecer cobrarselo a alguien. Correcto. Pero el mismo criterio apago los
-- botones de la tarjeta y del detalle, y la pantalla quedo diciendo «lo que
-- corresponde es descartarlo» SIN un boton para descartarlo.
--
-- Y esta funcion no conocia el caso, asi que su guarda de orden —correcta
-- tambien: los cortes del dia se suman— lo trataba como un pendiente comun. El
-- resultado es lo que reporto la sala: el corte de las 15:02 no se podia
-- confirmar, «Antes hay que resolver el corte de las 13:09», y el de las 13:09
-- no se podia resolver por ningun lado. La sala quedo sin poder cerrar el dia.
--
-- Cada mitad esta bien y juntas no dejan puerta. Ver
-- [[feedback_dos_frenos_correctos_pueden_dejar_sin_salida]].
--
-- ── Por que las tres condiciones (y no `declarado = 0` a secas) ─────────────
-- Una caja realmente vacia tambien declara cero, y ahi el origen SI marca el
-- faltante — silenciarlo taparia una alarma buena. Las tres juntas dicen
-- exactamente una cosa: el origen esperaba dinero (`tk_total_caja > 0`), no se
-- conto nada, y el origen IGUAL lo dio por exacto. Medido sobre los 501 cortes
-- tipo C capturados: pasa UNA vez, y es este.
--
-- El predicado es el gemelo exacto de `noContoEfectivo` en
-- `src/utils/cortesDiagnostico.js`, escrito con la verdad de JAVASCRIPT y no
-- con la de SQL: ahi `null` cuenta como 0 en las dos primeras y `null > 0` es
-- falso en la tercera, que es lo que hacen los `coalesce`. Cambiar uno exige
-- cambiar el otro — es la misma leccion que `turno_del_dia`.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.corte_no_conto_efectivo(
    p_tipo text, p_declarado numeric, p_dif_erp numeric, p_total_caja numeric)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT p_tipo = 'C'
       AND coalesce(p_declarado,  0) = 0
       AND coalesce(p_dif_erp,    0) = 0
       AND coalesce(p_total_caja, 0) > 0;
$function$;

REVOKE EXECUTE ON FUNCTION public.corte_no_conto_efectivo(text, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.corte_no_conto_efectivo(text, numeric, numeric, numeric) TO authenticated, service_role;


-- ── resolver_corte_caja ────────────────────────────────────────────────────
-- Dos cambios, los dos sobre el mismo hecho: un corte sin conteo no midio nada.
--
--   1. NO se confirma. Firmarlo daria por bueno un «cuadro exacto» sobre una
--      caja que nadie conto, y ademas correria la base de los siguientes: el
--      tramo del corte de la tarde se restaria contra un cero que no es un
--      conteo. Descartarlo si se puede, y es lo unico que corresponde.
--   2. NO cuenta como el pendiente que hay que resolver antes. Mismo criterio
--      que ya usa `conTramo` en el portal: no midio, asi que no puede desplazar
--      la referencia de los que vienen despues.
CREATE OR REPLACE FUNCTION public.resolver_corte_caja(p_id bigint, p_estado text, p_motivo text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text)
 RETURNS cortes_caja
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_corte public.cortes_caja;
    v_scope text;
    v_antes text;
    v_prev  text;
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
    END IF;

    v_antes := v_corte.estado;

    UPDATE public.cortes_caja SET
        estado          = p_estado,
        motivo_descarte = CASE WHEN p_estado = 'DESCARTADO' THEN btrim(p_motivo) END,
        observaciones   = NULLIF(btrim(coalesce(p_observaciones,'')), ''),
        resuelto_por    = (SELECT auth_employee_id()),
        resuelto_at     = now(),
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

    RETURN v_corte;
END;
$function$;


-- ── corte_tramo ────────────────────────────────────────────────────────────
-- Un corte sin conteo no tiene tramo, por el mismo motivo que no lo tiene el Z:
-- no midio dinero. Devolver `0 - base` seria peor que no devolver nada — es el
-- faltante inventado del tamano de la caja del dia, y `resolver_diferencia_corte`
-- usa justo ese numero para decidir cuanto se le cobra a alguien.
CREATE OR REPLACE FUNCTION public.corte_tramo(p_corte_id bigint)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v      public.cortes_caja;
    v_dif  numeric;
    v_base numeric;
BEGIN
    SELECT * INTO v FROM public.cortes_caja WHERE id = p_corte_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El corte no existe.'; END IF;
    IF v.tipo <> 'C' THEN RAISE EXCEPTION 'El cierre del dia no tiene tramo.'; END IF;
    IF public.corte_no_conto_efectivo(v.tipo, v.total_declarado, v.diferencia_erp, v.tk_total_caja) THEN
        RAISE EXCEPTION 'Este corte no conto el efectivo: no tiene diferencia que medir.';
    END IF;

    v_dif := public.corte_diferencia(v.total_declarado, v.diferencia_erp,
                                     v.tk_total_caja, v.tk_cobros_credito);

    -- La base es el ultimo CONFIRMADO anterior. Los sin conteo no pueden serlo
    -- —`resolver_corte_caja` ya no los deja confirmar— asi que no hace falta
    -- excluirlos aca: la condicion de estado alcanza.
    SELECT public.corte_diferencia(c2.total_declarado, c2.diferencia_erp,
                                   c2.tk_total_caja, c2.tk_cobros_credito)
      INTO v_base
      FROM public.cortes_caja c2
     WHERE c2.branch_id = v.branch_id
       AND c2.fecha     = v.fecha
       AND c2.tipo      = 'C'
       AND c2.estado    = 'CONFIRMADO'
       AND (c2.hora, c2.id) < (v.hora, v.id)
     ORDER BY c2.hora DESC, c2.id DESC
     LIMIT 1;

    RETURN round(v_dif - coalesce(v_base, 0), 2);
END;
$function$;


-- ── notificar_corte_de_caja ────────────────────────────────────────────────
-- El aviso tiene que pedir la accion que EXISTE. Para un corte sin conteo,
-- «confirmarlo» no es una de ellas —la funcion de arriba lo rechaza— y el aviso
-- mandaria a la sala a apretar un boton que no esta.
CREATE OR REPLACE FUNCTION public.notificar_corte_de_caja()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sala   text;
  v_dest   uuid[];
  v_titulo text;
  v_cuerpo text;
BEGIN
  -- El cierre del día (Z) no se confirma ni se descarta —lo rechaza
  -- `resolver_corte_caja`—, así que avisarlo sería pedir una acción que no
  -- existe.
  IF NEW.tipo <> 'C' THEN
    RETURN NULL;
  END IF;

  -- Sólo lo recién hecho. El repaso de las 23:40 no reinserta nada (el upsert
  -- ignora duplicados), pero una recarga manual de días pasados sí, y avisarle
  -- a la sala de un corte de la semana pasada es el ruido que enseña a ignorar
  -- la campana. Dos días de ventana y medio día de desfase cubren el corte de
  -- las 23:59, que se captura recién a las 6 del otro día.
  IF NEW.fecha < ((now() AT TIME ZONE 'America/El_Salvador')::date - 1)
     OR coalesce(NEW.desfase_seg, 0) > 43200 THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_sala FROM public.branches WHERE id = NEW.branch_id;

  v_dest := public.destinatarios_de_cortes(NEW.branch_id);
  IF v_dest IS NULL THEN
    RETURN NULL;
  END IF;

  -- Misma hora que la tarjeta (hh:mm, 24h): el aviso y la pantalla tienen que
  -- nombrar al mismo corte igual.
  v_titulo := 'Corte de caja de las ' || to_char(NEW.hora, 'HH24:MI');
  -- Un corte sin conteo no se confirma: pedirlo manda a la sala a buscar un
  -- botón que no está. Lo que corresponde es descartarlo y volver a cortar.
  v_cuerpo := coalesce(v_sala, 'Tu sala') || ' — '
           || CASE WHEN public.corte_no_conto_efectivo(NEW.tipo, NEW.total_declarado,
                                                       NEW.diferencia_erp, NEW.tk_total_caja)
                   THEN 'salió sin contar el efectivo. Hay que descartarlo y volver a hacer el corte.'
                   ELSE 'hay que revisarlo y confirmarlo.' END;

  PERFORM public.notify_employees(
    v_dest,
    'CORTE_NUEVO',
    v_titulo,
    v_cuerpo,
    '/cortes',
    jsonb_build_object(
      'corte_id',  NEW.id,
      'branch_id', NEW.branch_id,
      'fecha',     NEW.fecha,
      'hora',      to_char(NEW.hora, 'HH24:MI')
    ),
    true,            -- push: hay que ir a confirmarlo, no es informativo
    NEW.branch_id
  );

  RETURN NULL;
END;
$function$;
