SET lock_timeout = '5s';

-- Encuestas a clientes: el aviso de «cliente insatisfecho» sale de la
-- SATISFACCIÓN, no de la recomendación (2026-11-14, lo pidió el usuario).
--
-- Antes: `encuesta_cliente_avisar_detractor` disparaba con `nps <= 6` y ponía
-- de cuerpo la primera respuesta de texto. Medido en «Encuesta de satisfacción»
-- (277 respuestas): de los 8 avisos, 7 eran de clientes con satisfacción 7–10
-- —uno con satisfacción 10, recomendación 3 y «Lo ve bien» salió como
-- «insatisfecho 3/10»—, y de los 8 clientes con satisfacción 3–5 sólo UNO
-- llegó a avisar. El texto era la respuesta a «¿qué le gustaría que
-- implementáramos?», que se leía como la queja.
--
-- Ahora:
--   · nota de satisfacción ≤ 3 de 10 → aviso al momento (como antes, a la
--     jefatura de la sala y a Supervisor/a de Ventas);
--   · 4–5 de 10 → no va suelto: entra al resumen de la noche
--     (`encuesta_cliente_avisar_quejas_del_dia`, cron 21:50 SV), uno por persona.
--     Lo que el freno de ráfaga no avisó al momento también va ahí;
--   · encuesta sin pregunta de satisfacción → recomendación con su nombre:
--     ≤ 3 al momento, 4–6 a la noche, y el título dice «no recomendaría».
--   · el cuerpo rotula cada nota (Satisfacción · Recomendación · Confianza) y
--     el comentario como «Sugiere: …».
--
-- La pregunta se busca por id o por dimensión ('satisfaccion', 'confianza'),
-- nunca por posición: el cuestionario es dato.

-- La nota de una pregunta de puntaje y su máximo, o NULL si no la contestó o
-- la encuesta no la tiene. «Opción única» de números (1…10): el texto de la
-- opción marcada; caritas: 1–5; recomendación: 0–10.
CREATE OR REPLACE FUNCTION public.encuesta_cliente_nota(p_cuestionario jsonb, p_respuestas jsonb, p_clave text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE p->>'tipo'
           WHEN 'unica' THEN (
             SELECT CASE WHEN max(btrim(o->>'texto')::int) FILTER (WHERE o->>'id' = p_respuestas->>(p->>'id')) IS NOT NULL
                         THEN jsonb_build_object(
                                'valor', max(btrim(o->>'texto')::int) FILTER (WHERE o->>'id' = p_respuestas->>(p->>'id')),
                                'max',   max(btrim(o->>'texto')::int)) END
               FROM jsonb_array_elements(coalesce(p->'opciones', '[]')) o
              WHERE btrim(o->>'texto') ~ '^\d{1,2}$')
           WHEN 'csat' THEN CASE WHEN jsonb_typeof(p_respuestas->(p->>'id')) = 'number'
                                 THEN jsonb_build_object('valor', (p_respuestas->>(p->>'id'))::numeric::int, 'max', 5) END
           WHEN 'nps'  THEN CASE WHEN jsonb_typeof(p_respuestas->(p->>'id')) = 'number'
                                 THEN jsonb_build_object('valor', (p_respuestas->>(p->>'id'))::numeric::int, 'max', 10) END
         END
    FROM jsonb_array_elements(coalesce(p_cuestionario->'secciones', '[]')) s,
         jsonb_array_elements(coalesce(s->'preguntas', '[]')) p
   WHERE p->>'id' = p_clave OR p->>'dimension' = p_clave
   LIMIT 1;
$function$;

-- Qué tan mala fue una respuesta y cómo se dice. Juez único: lo leen el
-- trigger (al momento) y el resumen de la noche.
--   nivel: 'grave' (al momento) | 'leve' (resumen de la noche) | NULL (nada)
CREATE OR REPLACE FUNCTION public.encuesta_cliente_queja(p_encuesta_id uuid, p_respuestas jsonb, p_nps integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cuest jsonb;
  v_sat   jsonb;
  v_conf  jsonb;
  v_nivel text;
  v_nota  text;
  v_texto text;
  v_det   text;
BEGIN
  SELECT cuestionario INTO v_cuest FROM public.encuestas_cliente WHERE id = p_encuesta_id;
  v_sat  := public.encuesta_cliente_nota(v_cuest, p_respuestas, 'satisfaccion');
  v_conf := public.encuesta_cliente_nota(v_cuest, p_respuestas, 'confianza');

  IF v_sat IS NOT NULL THEN
    -- Proporcional al máximo: 3 y 5 de 10 (en caritas, 1 y 2 de 5).
    v_nivel := CASE WHEN (v_sat->>'valor')::int * 10 <= (v_sat->>'max')::int * 3 THEN 'grave'
                    WHEN (v_sat->>'valor')::int * 10 <= (v_sat->>'max')::int * 5 THEN 'leve' END;
    v_nota  := 'satisfacción ' || (v_sat->>'valor') || '/' || (v_sat->>'max');
  ELSIF p_nps IS NOT NULL THEN
    v_nivel := CASE WHEN p_nps <= 3 THEN 'grave' WHEN p_nps <= 6 THEN 'leve' END;
    v_nota  := 'recomendación ' || p_nps || '/10';
  END IF;
  IF v_nivel IS NULL THEN
    RETURN jsonb_build_object('nivel', NULL);
  END IF;

  -- La primera respuesta abierta, rotulada como lo que es: una sugerencia.
  SELECT left(btrim(p_respuestas ->> (p ->> 'id')), 160) INTO v_texto
    FROM jsonb_array_elements(coalesce(v_cuest -> 'secciones', '[]')) s,
         jsonb_array_elements(coalesce(s -> 'preguntas', '[]')) p
   WHERE p ->> 'tipo' = 'texto' AND nullif(btrim(p_respuestas ->> (p ->> 'id')), '') IS NOT NULL
   LIMIT 1;

  v_det := concat_ws(' · ',
             CASE WHEN v_sat  IS NOT NULL THEN 'Satisfacción ' || (v_sat->>'valor')  || '/' || (v_sat->>'max') END,
             CASE WHEN p_nps  IS NOT NULL THEN 'Recomendación ' || p_nps || '/10' END,
             CASE WHEN v_conf IS NOT NULL THEN 'Confianza '    || (v_conf->>'valor') || '/' || (v_conf->>'max') END);

  RETURN jsonb_build_object(
    'nivel',        v_nivel,
    'por',          CASE WHEN v_sat IS NOT NULL THEN 'satisfaccion' ELSE 'recomendacion' END,
    'nota',         v_nota,
    'detalle',      v_det,
    'sugerencia',   v_texto);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_nota(jsonb, jsonb, text)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_queja(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_nota(jsonb, jsonb, text)   TO service_role;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_queja(uuid, jsonb, integer) TO service_role;

-- Al momento: sólo lo grave. Partido de la definición VIVA (destinatarios con
-- `roles_efectivos_de` y la sala de apoyo, freno de ráfaga de H11).
CREATE OR REPLACE FUNCTION public.encuesta_cliente_avisar_detractor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_q    jsonb;
    v_dest uuid[];
    v_sala text;
BEGIN
    v_q := public.encuesta_cliente_queja(NEW.encuesta_id, NEW.respuestas, NEW.nps);
    -- 'leve' va al resumen de la noche; nada, a ningún lado.
    IF v_q->>'nivel' IS DISTINCT FROM 'grave' THEN RETURN NULL; END IF;
    -- Freno de ráfaga (H11, 2026-10-23): con 3 o más avisados al momento en
    -- la última hora de la misma encuesta y sala, éste no sale suelto — lo
    -- recoge el resumen de la noche, porque no queda marcado como avisado.
    IF (SELECT count(*) FROM public.encuesta_cliente_respuestas r
         JOIN public.avisos_emitidos a ON a.clave = 'ENC_INSATISFECHO:' || r.id AND a.recipient_id IS NULL
         WHERE r.encuesta_id = NEW.encuesta_id AND r.branch_id IS NOT DISTINCT FROM NEW.branch_id
           AND r.id <> NEW.id AND r.created_at > now() - interval '1 hour') >= 3 THEN
        RETURN NULL;
    END IF;
    SELECT name INTO v_sala FROM public.branches WHERE id = NEW.branch_id;
    SELECT coalesce(array_agg(DISTINCT e.id), '{}') INTO v_dest
      FROM public.employees e
      JOIN public.roles r ON r.id = ANY (public.roles_efectivos_de(e.id))
     WHERE e.status = 'ACTIVO'
       AND ((r.name = 'Jefe/a de Sala' AND coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = NEW.branch_id) OR r.name = 'Supervisor/a de Ventas');
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN NULL; END IF;
    PERFORM public.notify_employees(v_dest, 'ENCUESTAS',
        CASE WHEN v_q->>'por' = 'satisfaccion' THEN 'Cliente insatisfecho en ' ELSE 'Cliente que no recomendaría en ' END
          || coalesce(v_sala, CASE WHEN NEW.canal = 'campo' THEN 'campo' || coalesce(' · ' || NEW.lugar, '') END, 'sala')
          || ' (' || (v_q->>'nota') || ')',
        (v_q->>'detalle') || '.'
          || coalesce(' Sugiere: «' || (v_q->>'sugerencia') || '».', '')
          || CASE WHEN NEW.telefono IS NOT NULL THEN ' Dejó su teléfono para seguimiento.' ELSE '' END,
        '/encuestas-clientes?encuesta=' || NEW.encuesta_id || '&vista=resultados',
        jsonb_build_object('encuesta_id', NEW.encuesta_id, 'respuesta_id', NEW.id, 'nivel', 'grave'), true, NEW.branch_id);
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    VALUES ('ENC_INSATISFECHO:' || NEW.id, NULL)
    ON CONFLICT DO NOTHING;
    RETURN NULL;
END $function$;

-- A la noche: lo leve del día y lo grave que el freno de ráfaga no avisó,
-- en UN aviso por persona. Mismos destinatarios que el trigger.
CREATE OR REPLACE FUNCTION public.encuesta_cliente_avisar_quejas_del_dia(p_fecha date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_fecha date := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_clave text := 'ENC_QUEJAS_DIA:' || v_fecha::text;
  v_n     integer := 0;
  r       record;
BEGIN
  FOR r IN
    WITH resp AS (
      SELECT x.id, x.encuesta_id, x.branch_id, x.created_at, x.canal, x.lugar, q.j
        FROM public.encuesta_cliente_respuestas x
        CROSS JOIN LATERAL (SELECT public.encuesta_cliente_queja(x.encuesta_id, x.respuestas, x.nps) AS j) q
       WHERE x.created_at >= (v_fecha::timestamp AT TIME ZONE 'America/El_Salvador')
         AND x.created_at <  ((v_fecha + 1)::timestamp AT TIME ZONE 'America/El_Salvador')
         AND q.j->>'nivel' IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                          WHERE a.clave = 'ENC_INSATISFECHO:' || x.id AND a.recipient_id IS NULL)
    ),
    dest AS (
      SELECT DISTINCT resp.id, e.id AS emp
        FROM resp
        JOIN public.employees e ON e.status = 'ACTIVO'
        JOIN public.roles ro ON ro.id = ANY (public.roles_efectivos_de(e.id))
       WHERE (ro.name = 'Jefe/a de Sala' AND coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = resp.branch_id)
          OR ro.name = 'Supervisor/a de Ventas'
    )
    SELECT d.emp,
           count(*) AS n,
           count(DISTINCT resp.encuesta_id) AS encuestas,
           min(resp.encuesta_id::text) AS una_encuesta,
           string_agg(coalesce(b.name, CASE WHEN resp.canal = 'campo' THEN 'campo' || coalesce(' · ' || resp.lugar, '') END, 'sala')
                        || ': ' || (resp.j->>'nota')
                        || coalesce(', sugiere «' || left(resp.j->>'sugerencia', 80) || '»', ''),
                      ' · ' ORDER BY resp.created_at) AS lista,
           jsonb_agg(resp.id ORDER BY resp.created_at) AS ids
      FROM dest d
      JOIN resp ON resp.id = d.id
      LEFT JOIN public.branches b ON b.id = resp.branch_id
     GROUP BY d.emp
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.avisos_emitidos a WHERE a.clave = v_clave AND a.recipient_id = r.emp);
    PERFORM public.notify_employees(
      ARRAY[r.emp], 'ENCUESTAS',
      CASE WHEN r.n = 1 THEN 'Un cliente poco satisfecho hoy' ELSE r.n || ' clientes poco satisfechos hoy' END,
      left(r.lista, 700) || '.',
      CASE WHEN r.encuestas = 1 THEN '/encuestas-clientes?encuesta=' || r.una_encuesta || '&vista=resultados'
           ELSE '/encuestas-clientes' END,
      jsonb_build_object('fecha', v_fecha, 'respuestas', r.ids, 'nivel', 'resumen'),
      false, NULL);
    INSERT INTO public.avisos_emitidos (clave, recipient_id) VALUES (v_clave, r.emp) ON CONFLICT DO NOTHING;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.encuesta_cliente_avisar_quejas_del_dia(date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.encuesta_cliente_avisar_quejas_del_dia(date) TO service_role;

-- 21:50 SV = 03:50 UTC del día siguiente; la fecha se toma en hora de SV.
SELECT cron.schedule('encuestas-quejas-del-dia', '50 3 * * *', 'SELECT public.encuesta_cliente_avisar_quejas_del_dia()');
