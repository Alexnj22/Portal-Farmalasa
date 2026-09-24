-- Las horas que la base escribe en un TEXTO que lee una persona salen en 12
-- horas (usuario, 23-sep y 24-sep: «en todo el portal 12 horas, no 24»).
-- `public.hora_12(time)` ya existía y la usaban los avisos de cortes; estas seis
-- funciones seguían con `to_char(..., 'HH24:MI')` dentro del título, del cuerpo
-- o del mensaje de error. Los campos `hora` que viajan en `datos`/jsonb se
-- quedan en HH:MM a propósito: son DATO, y los formatea la pantalla.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.avisar_aperturas_de_la_manana(p_fecha date DEFAULT NULL::date, p_forzado boolean DEFAULT false, p_sin_respuesta integer[] DEFAULT NULL::integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_fecha    date    := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_clave    text    := 'APERTURAS_MANANA:' || v_fecha::text;
  v_estado   jsonb;
  v_hora     text    := to_char(now() AT TIME ZONE 'America/El_Salvador', 'HH24:MI');
  v_abiertas integer;
  v_sin_resp text[];
  v_no_abrio text[];
  v_lista    text;
  v_primera  text;
  v_ultima   text;
  v_titulo   text;
  v_cuerpo   text;
  v_dest     uuid[];
  v_n        integer;
BEGIN
  -- La marca es global (`recipient_id IS NULL`) y vive en `avisos_emitidos`,
  -- no en la campana: un `NOT EXISTS … FROM notifications` pregunta «¿todavía
  -- la tiene?», así que quien vacía su campana lo recibiría de nuevo.
  IF EXISTS (SELECT 1 FROM public.avisos_emitidos a
              WHERE a.clave = v_clave AND a.recipient_id IS NULL) THEN
    RETURN 0;
  END IF;

  v_estado   := public.aperturas_de_la_manana(v_fecha);
  v_abiertas := (v_estado->>'abiertas')::int;

  -- Lo que no contestó el origen se separa de lo que no abrió: no distinguirlos
  -- convierte un rato de origen caído en seis salas acusadas de no abrir.
  SELECT coalesce(array_agg(x.sala ORDER BY x.sala) FILTER (WHERE     x.muda), '{}'::text[]),
         coalesce(array_agg(x.sala ORDER BY x.sala) FILTER (WHERE NOT x.muda), '{}'::text[])
    INTO v_sin_resp, v_no_abrio
    FROM (SELECT f.value #>> '{}' AS sala,
                 (i.value::text)::int = ANY (coalesce(p_sin_respuesta, '{}'::integer[])) AS muda
            FROM jsonb_array_elements(v_estado->'faltan')     WITH ORDINALITY f(value, n)
            JOIN jsonb_array_elements(v_estado->'faltan_ids') WITH ORDINALITY i(value, n)
              ON i.n = f.n) x;

  -- Todavía puede abrir: no es el momento. El cron de la hora tope vuelve con
  -- `p_forzado` y entonces sí sale, diciendo cuáles faltaron.
  IF NOT p_forzado AND (coalesce(array_length(v_no_abrio, 1), 0) > 0 OR coalesce(array_length(v_sin_resp, 1), 0) > 0) THEN
    RETURN 0;
  END IF;

  -- Ni una sala abierta y sin forzar: es demasiado temprano, no es una noticia.
  IF NOT p_forzado AND v_abiertas = 0 THEN
    RETURN 0;
  END IF;

  -- La lista: sala, hora y quién. Ya viene ordenada por hora desde el estado,
  -- así que la primera del renglón es la que abrió primero y la última la que
  -- cerró la mañana — que es la que se busca cuando se mira esto.
  SELECT string_agg(
           (s.value->>'sala') || ' ' || public.hora_12((s.value->>'hora')::time) || ' ' ||
           coalesce(s.value->>'quien', 'desde la caja'), ' · ' ORDER BY s.n),
         min(s.value->>'hora'), max(s.value->>'hora')
    INTO v_lista, v_primera, v_ultima
    FROM jsonb_array_elements(v_estado->'salas') WITH ORDINALITY s(value, n);

  /* «apertura» y no «abrieron caja»: es la palabra con la que la pantalla de
   * cajas nombra este acto y con la que el usuario lo busca. Ver el encabezado
   * — el título y el cuerpo son las DOS únicas columnas que mira el buscador
   * de /notificaciones, así que la palabra que no está acá no existe. */
  v_titulo := CASE
    WHEN coalesce(array_length(v_no_abrio, 1), 0) = 1
      THEN '⚠️ ' || v_no_abrio[1] || ' no ha hecho su apertura de caja'
    WHEN coalesce(array_length(v_no_abrio, 1), 0) > 1
      THEN '⚠️ ' || coalesce(array_length(v_no_abrio, 1), 0) || ' salas no han hecho su apertura de caja'
    WHEN coalesce(array_length(v_sin_resp, 1), 0) > 0
      THEN '⚠️ No se pudo comprobar la apertura de caja de ' || array_to_string(v_sin_resp, ', ')
    ELSE 'Las ' || v_abiertas || ' salas hicieron su apertura de caja'
  END;

  v_cuerpo :=
       CASE WHEN coalesce(array_length(v_no_abrio, 1), 0) = 1
            THEN 'A las ' || public.hora_12(v_hora::time) || ' todavía no abría ' || v_no_abrio[1] || '. '
            WHEN coalesce(array_length(v_no_abrio, 1), 0) > 1
            THEN 'A las ' || public.hora_12(v_hora::time) || ' todavía no abrían ' ||
                 array_to_string(v_no_abrio, ', ') || '. '
            -- Con todas abiertas el cuerpo tiene que decir algo por sí solo:
            -- es lo que se lee donde la tarjeta no se sabe pintar. Y el rango
            -- va sólo con dos o más, porque «entre las 06:53 y las 06:53» es
            -- una frase que se delata sola.
            WHEN v_abiertas >= 2 AND v_primera IS NOT NULL
            THEN 'La apertura de caja fue entre las ' || public.hora_12(v_primera::time) || ' y las ' || public.hora_12(v_ultima::time) || '. '
            ELSE '' END
    || CASE WHEN coalesce(array_length(v_sin_resp, 1), 0) > 0
            THEN 'No se pudo comprobar ' || array_to_string(v_sin_resp, ', ') || '. '
            ELSE '' END
    || CASE WHEN v_abiertas = 0 THEN 'Ninguna sala había hecho su apertura.'
            WHEN coalesce(array_length(v_no_abrio, 1), 0) > 0 OR coalesce(array_length(v_sin_resp, 1), 0) > 0
            THEN 'Abrieron: ' || v_lista
            ELSE v_lista END;

  -- SÓLO Supervisor/a de Ventas: lo pidió en primera persona, y es una
  -- vigilancia de operación, no el informe de gerencia que es el cierre del día.
  SELECT array_agg(DISTINCT e.id) INTO v_dest
    FROM public.employees e
    JOIN public.roles r ON r.name = 'Supervisor/a de Ventas'
   WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
     AND e.status = 'ACTIVO'
     AND coalesce(e.tipo_ficha, 'empleado') = 'empleado';
  IF v_dest IS NULL THEN RETURN 0; END IF;

  v_n := public.notify_employees(
    v_dest,
    'APERTURAS_DE_LA_MANANA',
    v_titulo,
    v_cuerpo,
    '/caja?pestana=cortes',
    jsonb_build_object(
      'fecha',         v_fecha,
      'hora_aviso',    v_hora,
      'forzado',       p_forzado,
      'total',         (v_estado->>'total')::int,
      'abiertas',      v_abiertas,
      'salas',         v_estado->'salas',
      'no_abrieron',   to_jsonb(v_no_abrio),
      'sin_respuesta', to_jsonb(v_sin_resp)),
    -- Push SIEMPRE (2026-09-23). Antes salía sólo cuando faltaba una sala, para
    -- que un «todo bien» diario no enseñara a ignorar los push; el usuario lo
    -- pidió al revés: «si no entro no me entero». Es un solo aviso por mañana.
    true,
    NULL
  );

  -- La marca sólo si algo se mandó de verdad. Escribirla igual dejaría el aviso
  -- del día apagado para siempre por una corrida que no llegó a nadie.
  IF coalesce(v_n, 0) > 0 THEN
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    VALUES (v_clave, NULL)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN coalesce(v_n, 0);
END;
$function$;


CREATE OR REPLACE FUNCTION public.avisar_dias_sin_cierre(p_fecha date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dow  text[] := ARRAY['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  v_mes  text[] := ARRAY['enero','febrero','marzo','abril','mayo','junio','julio',
                         'agosto','septiembre','octubre','noviembre','diciembre'];
  v_fecha_texto text := v_dow[EXTRACT(dow FROM p_fecha)::int + 1] || ' '
                        || EXTRACT(day FROM p_fecha)::int || ' de '
                        || v_mes[EXTRACT(month FROM p_fecha)::int];
  v_n integer;
BEGIN
  WITH salas AS (
    SELECT DISTINCT a.branch_id FROM public.cortes_caja_aperturas a WHERE a.abierta_el = p_fecha
  ),
  casos AS (
    SELECT s.branch_id, b.name AS sala, ca.resultado, ca.motivo, ca.falta,
           ca.corte_hora, (ca.detalle->>'z_hora') AS z_hora
      FROM salas s
      JOIN public.branches b ON b.id = s.branch_id
      LEFT JOIN public.caja_cierres_automaticos ca
             ON ca.branch_id = s.branch_id AND ca.fecha = p_fecha
     WHERE ca.resultado = 'cerrado'
        OR NOT EXISTS (SELECT 1 FROM public.cortes_caja c
                        WHERE c.branch_id = s.branch_id AND c.fecha = p_fecha AND c.tipo = 'Z')
  ),
  destinatarios AS (
    -- La gente de la sala…
    SELECT c.branch_id, e.id AS employee_id
      FROM casos c
      JOIN public.employees e ON e.branch_id = c.branch_id
     WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
    UNION
    -- …y supervisión, por cargo y no por lista de ids.
    SELECT c.branch_id, e.id
      FROM casos c
      CROSS JOIN public.employees e
      JOIN public.roles r ON r.name IN ('Gerente General', 'Supervisor/a de Ventas')
     WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
       AND e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
  ),
  ins AS (
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id)
    SELECT d.employee_id,
           'DIA_SIN_CIERRE',
           CASE WHEN c.resultado = 'cerrado'
                THEN c.sala || ': el portal cerró el día solo'
                ELSE c.sala || ': el día quedó sin cierre' END,
           'Nadie hizo el cierre del día del ' || v_fecha_texto || '. '
             || CASE WHEN c.resultado = 'cerrado'
                     THEN 'El portal lo hizo solo'
                          || coalesce(' a las ' || CASE WHEN c.z_hora ~ '^\d{1,2}:\d{2}' THEN public.hora_12(c.z_hora::time) ELSE c.z_hora END, '')
                          || coalesce(', con el corte de las ' || public.hora_12(c.corte_hora)
                                      || ' como último conteo', '')
                          || '. La próxima vez, cierren el día antes de irse.'
                     ELSE 'El portal no pudo hacerlo solo porque '
                          || CASE c.motivo
                               WHEN 'sin_corte_al_cierre'
                                 THEN 'no hubo un corte de caja cerca de la hora de cierre'
                               WHEN 'efectivo_sin_contar'
                                 THEN 'entraron $' || to_char(c.falta, 'FM999,990.00')
                                      || ' después del último corte y nadie los contó'
                               WHEN 'turno_parado' THEN 'el turno estaba cerrado'
                               ELSE 'no se pudo comprobar la caja' END
                          || '. Avisen a supervisión.' END,
           '/cortes',
           jsonb_build_object('fecha', p_fecha, 'fecha_texto', v_fecha_texto,
                              'sala', c.sala, 'resultado', coalesce(c.resultado, 'no_cerrado'),
                              'motivo', c.motivo),
           c.branch_id
      FROM destinatarios d
      JOIN casos c ON c.branch_id = d.branch_id
     WHERE NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                        WHERE a.recipient_id = d.employee_id
                          AND a.clave = 'DIA_SIN_CIERRE:' || c.branch_id || ':' || p_fecha)
    RETURNING recipient_id, branch_id
  ),
  marca AS (
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    SELECT 'DIA_SIN_CIERRE:' || i.branch_id || ':' || p_fecha, i.recipient_id FROM ins i
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END $function$;


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
  v_n     integer := 0;
BEGIN
  FOR v_c IN
    WITH conf AS (
      -- Los confirmados del día que SÍ midieron dinero. Un descartado no es un
      -- tramo y uno sin conteo no tiene diferencia que medir: `corte_tramo` los
      -- rechaza a propósito, así que se filtran antes de llamarla.
      SELECT c.id, c.branch_id, c.hora, c.total_declarado,
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
     WHERE k.tramo <= -0.01                 -- el mismo umbral de `severidad`
     ORDER BY b.name, k.hora
  LOOP
    -- Ya la resolvieron: no se vuelve a pedir.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                           WHERE d.corte_id = v_c.corte_id AND d.anulada_at IS NULL);

    -- La marca es por CORTE. En `avisos_emitidos` y no en la campana: un
    -- `NOT EXISTS … FROM notifications` pregunta «¿todavía la tiene?», y quien
    -- vacía su campana lo recibe de nuevo.
    v_clave := 'CORTE_DIF_AYER:' || v_fecha::text || ':' || v_c.corte_id;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.avisos_emitidos a
                           WHERE a.clave = v_clave AND a.recipient_id IS NULL);

    v_dest := public.destinatarios_de_cortes(v_c.branch_id);
    CONTINUE WHEN v_dest IS NULL;

    v_monto := '$' || to_char(abs(v_c.tramo), 'FM999,999,990.00');

    PERFORM public.notify_employees(
      v_dest,
      'CORTE_DIFERENCIA_AYER',
      -- Nombra el CORTE, no la caja: es lo que la tarjeta rotula «Faltante», y
      -- decir «la caja cerró con» sobre un día que cerró exacto era la
      -- contradicción que trajo este cambio.
      'Ayer faltaron ' || v_monto || ' en el corte de las ' || public.hora_12(v_c.hora),
      v_c.sala || ' — el corte de las ' || public.hora_12(v_c.hora)
        || ' quedó ' || v_monto || ' abajo de lo esperado. Hay que revisarlo y '
        || 'registrar la diferencia.',
      '/cortes',
      jsonb_build_object(
        'corte_id',       v_c.corte_id,
        'branch_id',      v_c.branch_id,
        'sala',           v_c.sala,
        'fecha',          v_fecha,
        'hora',           to_char(v_c.hora, 'HH24:MI'),
        'diferencia',     v_c.tramo,
        'contado',        v_c.contado,
        -- Lo que debía haber en ese corte. Derivado, para que los números de la
        -- tarjeta cierren entre ellos.
        'esperado',       round(v_c.contado - v_c.tramo, 2),
        'arrastre',       v_c.arrastre,
        'arrastre_desde', CASE WHEN v_c.aportes = 1 THEN v_c.arrastre_desde END,
        'aportes',        v_c.aportes
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


CREATE OR REPLACE FUNCTION public.corte_trabado_por_posterior(p_corte_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v      public.cortes_caja;
    v_hora text;
BEGIN
    SELECT * INTO v FROM public.cortes_caja WHERE id = p_corte_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT public.hora_12(c2.hora) INTO v_hora
      FROM public.cortes_caja c2
      JOIN public.cortes_caja_diferencias d ON d.corte_id = c2.id AND d.anulada_at IS NULL
     WHERE c2.branch_id = v.branch_id
       AND c2.fecha     = v.fecha
       AND c2.tipo      = 'C'
       AND (c2.hora, c2.id) > (v.hora, v.id)
     ORDER BY c2.hora
     LIMIT 1;

    IF v_hora IS NOT NULL THEN
        RAISE EXCEPTION 'El corte de las % ya tiene su diferencia resuelta y se mide contra este. Hay que anular esa resolucion antes de tocar este corte.', v_hora;
    END IF;
END;
$function$;


CREATE OR REPLACE FUNCTION public.resolver_corte_caja(p_id bigint, p_estado text, p_motivo text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text, p_recibido_por uuid DEFAULT NULL::uuid, p_vale uuid DEFAULT NULL::uuid, p_sin_entrega_motivo text DEFAULT NULL::text)
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
        SELECT public.hora_12(c2.hora) INTO v_prev
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


CREATE OR REPLACE FUNCTION public.vigilar_reinicio_de_la_base()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_arranque timestamptz := pg_postmaster_start_time();
  v_dest     uuid[];
BEGIN
  INSERT INTO public.reinicios_de_la_base (arranco_at) VALUES (v_arranque)
  ON CONFLICT (arranco_at) DO NOTHING;
  -- Ya anotado: es el mismo arranque de la corrida anterior.
  IF NOT FOUND THEN RETURN; END IF;

  -- Mismo destinatario que check-sync-health-alerts: el rol de alertas técnicas,
  -- como cargo principal o secundario, y sólo fichas activas.
  SELECT array_agg(DISTINCT e.id) INTO v_dest
  FROM public.employees e
  JOIN public.roles r ON r.id IN (e.role_id, e.secondary_role_id)
  WHERE r.name = 'Sistema — Alertas Técnicas'
    AND e.status = 'ACTIVO';

  UPDATE public.reinicios_de_la_base
     SET destinatarios = coalesce(cardinality(v_dest), 0)
   WHERE arranco_at = v_arranque;

  IF coalesce(cardinality(v_dest), 0) = 0 THEN RETURN; END IF;

  PERFORM public.notify_employees(
    v_dest,
    'SISTEMA_REINICIO',
    'La base de datos del portal se reinició',
    'Volvió a arrancar a las '
      || public.hora_12((v_arranque AT TIME ZONE 'America/El_Salvador')::time) || ' del ' || to_char(v_arranque AT TIME ZONE 'America/El_Salvador', 'DD/MM')
      || '. Si poco antes el portal estuvo lento o no dejaba entrar, fue esto.',
    '/actualizacion-de-datos',
    jsonb_build_object('arranco_at', v_arranque),
    true,
    NULL);
END;
$function$;

