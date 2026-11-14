SET lock_timeout = '5s';

-- Resumen de la mañana para administración, y avisos que no se repiten si no
-- cambiaron (2026-11-14, pedido del usuario).
--
-- Antes, entre las 08:00 y las 08:40 SV, Supervisión recibía por separado:
-- «N créditos vencidos» (resumen de la red), «N salas sin conteo de
-- antibióticos», «Una factura no entró a Hacienda anoche», «Clientes con los
-- puntos partidos», «Fichas sin número interno» (y «Puntos en otra ficha»).
-- Ahora cada generador, para ESOS destinatarios, deja un RENGLÓN en
-- `resumen_manana_renglones`, y `armar_resumen_manana()` (08:45 SV, con un
-- reintento 09:15) manda UN aviso por persona. Con un solo renglón sale el
-- aviso tal cual, sin envoltorio. Lo que llega después de las 08:45 sale suelto,
-- como antes: si un generador se atrasa, no se pierde ni espera a mañana.
-- Si un generador falla, el resumen sale igual con lo demás.
--
-- Lo que NO cambia: la apertura de caja (sigue suelta), el crédito vencido de
-- cada sala para jefatura y quien vendió, el conteo de antibióticos para la
-- gente de cada sala, y «Las ventas no están reconociendo a los clientes»
-- (crítico, al momento).
--
-- No repetir lo que no cambió: antibióticos sin conteo, puntos partidos, fichas
-- sin número y puntos en otra ficha llegaban idénticos todos los días. Ahora se
-- avisan cuando el número (o el conjunto de salas) cambia, o una vez por semana
-- si sigue igual — `aviso_cambio_o_semanal`. Cuando el problema desaparece el
-- valor se olvida, y si vuelve, avisa.
--
-- Y el porqué de la repetición de antibióticos: `avisar_cuadre_antibioticos`
-- marcaba el aviso como dado a partir del `RETURNING` del INSERT en
-- `notifications`, pero el trigger `avisos_horario` difiere el aviso (devuelve
-- NULL) cuando la ventana de la persona no abrió — el RETURNING sale vacío, la
-- marca nunca se escribe y mañana vuelve a salir. Se corrige marcando sobre los
-- destinatarios calculados, no sobre lo que devolvió el INSERT.

-- venta-a-mano: `alertar_barrido_dte` se copia TAL CUAL de la definición viva; su
-- filtro de estados pregunta «¿qué tiene que mandar el barrido a Hacienda?» (anulada
-- con sello / no anulada sin sello), no «¿cuenta como venta?».
-- jsonb-agg: `armar_resumen_manana` agrega los renglones de UNA persona en un día
-- (un puñado, ≤ 6), no un payload grande.

-- ── Las piezas ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.resumen_manana_renglones (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha        date        NOT NULL,
  recipient_id uuid        NOT NULL,
  tema         text        NOT NULL,
  orden        integer     NOT NULL DEFAULT 100,
  tipo         text        NOT NULL,           -- el `type` del aviso suelto
  titulo       text        NOT NULL,
  cuerpo       text,
  link         text,
  metadata     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  con_push     boolean     NOT NULL DEFAULT false,
  enviado_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fecha, recipient_id, tema)
);
CREATE INDEX IF NOT EXISTS resumen_manana_renglones_recipient_idx
  ON public.resumen_manana_renglones (recipient_id);
ALTER TABLE public.resumen_manana_renglones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resumen_manana_renglones_select ON public.resumen_manana_renglones;
CREATE POLICY resumen_manana_renglones_select ON public.resumen_manana_renglones
  FOR SELECT TO authenticated USING (recipient_id = (SELECT public.auth_employee_id()));
REVOKE ALL ON public.resumen_manana_renglones FROM anon;

CREATE TABLE IF NOT EXISTS public.avisos_ultimo_valor (
  clave      text PRIMARY KEY,
  valor      text,
  avisado_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.avisos_ultimo_valor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS avisos_ultimo_valor_select ON public.avisos_ultimo_valor;
CREATE POLICY avisos_ultimo_valor_select ON public.avisos_ultimo_valor
  FOR SELECT TO authenticated USING ((SELECT public.auth_can_edit_any(ARRAY['auditview'])));
REVOKE ALL ON public.avisos_ultimo_valor FROM anon;

-- ¿Toca avisar? Sí si es la primera vez, si el valor cambió, o si pasó una
-- semana con el mismo. Y si toca, queda anotado en la misma llamada.
CREATE OR REPLACE FUNCTION public.aviso_cambio_o_semanal(p_clave text, p_valor text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_prev public.avisos_ultimo_valor%ROWTYPE;
BEGIN
  SELECT * INTO v_prev FROM public.avisos_ultimo_valor WHERE clave = p_clave FOR UPDATE;
  IF FOUND AND v_prev.valor IS NOT DISTINCT FROM p_valor
     AND v_prev.avisado_at > now() - interval '7 days' + interval '1 hour' THEN
    RETURN false;
  END IF;
  INSERT INTO public.avisos_ultimo_valor (clave, valor, avisado_at)
  VALUES (p_clave, p_valor, now())
  ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, avisado_at = EXCLUDED.avisado_at;
  RETURN true;
END;
$function$;

-- El problema desapareció: si vuelve, aunque sea con el mismo número, avisa.
CREATE OR REPLACE FUNCTION public.aviso_valor_olvidar(p_clave text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  DELETE FROM public.avisos_ultimo_valor WHERE clave = p_clave;
$function$;

-- La hora del resumen, en un solo sitio: 08:45 SV.
CREATE OR REPLACE FUNCTION public.resumen_manana_paso_la_hora()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT (now() AT TIME ZONE 'America/El_Salvador')::time >= time '08:45';
$function$;

-- Lo que llama cada generador en lugar de `notify_employees` para los avisos de
-- administración. Antes de las 08:45 deja el renglón; después avisa suelto.
CREATE OR REPLACE FUNCTION public.resumen_manana_agregar(
  p_recipients uuid[], p_tema text, p_orden integer, p_tipo text,
  p_titulo text, p_cuerpo text, p_link text, p_metadata jsonb, p_push boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_n   integer;
BEGIN
  IF coalesce(cardinality(p_recipients), 0) = 0 THEN RETURN 0; END IF;

  IF public.resumen_manana_paso_la_hora() THEN
    RETURN coalesce(public.notify_employees(p_recipients, p_tipo, p_titulo, p_cuerpo, p_link,
                                            coalesce(p_metadata, '{}'::jsonb), p_push, NULL), 0);
  END IF;

  INSERT INTO public.resumen_manana_renglones
         (fecha, recipient_id, tema, orden, tipo, titulo, cuerpo, link, metadata, con_push)
  SELECT v_hoy, d, p_tema, p_orden, p_tipo, p_titulo, p_cuerpo, p_link,
         coalesce(p_metadata, '{}'::jsonb), coalesce(p_push, false)
    FROM unnest(p_recipients) d
  ON CONFLICT (fecha, recipient_id, tema) DO UPDATE
     SET titulo = EXCLUDED.titulo, cuerpo = EXCLUDED.cuerpo, link = EXCLUDED.link,
         metadata = EXCLUDED.metadata, con_push = EXCLUDED.con_push, orden = EXCLUDED.orden,
         tipo = EXCLUDED.tipo
   WHERE public.resumen_manana_renglones.enviado_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

-- El armado: un aviso por persona con lo que se juntó hoy y no salió.
-- `p_solo_ver` devuelve lo que mandaría sin mandar nada.
CREATE OR REPLACE FUNCTION public.armar_resumen_manana(p_solo_ver boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy   date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  r       record;
  v_out   jsonb := '[]'::jsonb;
  v_meta  jsonb;
BEGIN
  -- Retención: el renglón es andamio del aviso, el aviso ya vive en la campana.
  IF NOT p_solo_ver THEN
    DELETE FROM public.resumen_manana_renglones WHERE fecha < v_hoy - 30;
  END IF;

  FOR r IN
    SELECT recipient_id,
           array_agg(id ORDER BY orden, id) AS ids,
           count(*) AS n,
           bool_or(con_push) AS push,
           jsonb_agg(jsonb_build_object('tema', tema, 'tipo', tipo, 'titulo', titulo,
                                        'cuerpo', cuerpo, 'link', link, 'metadata', metadata)
                     ORDER BY orden, id) AS renglones
      FROM public.resumen_manana_renglones
     WHERE fecha = v_hoy AND enviado_at IS NULL
     GROUP BY recipient_id
  LOOP
    IF r.n = 1 THEN
      -- Uno solo: sale como siempre salió, con su tarjeta propia.
      v_meta := r.renglones->0;
      v_out := v_out || jsonb_build_object('para', r.recipient_id, 'suelto', v_meta->>'titulo');
      IF NOT p_solo_ver THEN
        PERFORM public.notify_employees(ARRAY[r.recipient_id], v_meta->>'tipo', v_meta->>'titulo',
                                        v_meta->>'cuerpo', v_meta->>'link',
                                        coalesce(v_meta->'metadata', '{}'::jsonb), r.push, NULL);
      END IF;
    ELSE
      v_out := v_out || jsonb_build_object('para', r.recipient_id, 'renglones', r.renglones);
      IF NOT p_solo_ver THEN
        PERFORM public.notify_employees(
          ARRAY[r.recipient_id], 'RESUMEN_MANANA', 'Resumen de la mañana',
          (SELECT string_agg('• ' || (x->>'titulo'), E'\n' ORDER BY o)
             FROM jsonb_array_elements(r.renglones) WITH ORDINALITY t(x, o)),
          r.renglones->0->>'link',
          jsonb_build_object('fecha', v_hoy, 'renglones', r.renglones),
          r.push, NULL);
      END IF;
    END IF;
    IF NOT p_solo_ver THEN
      UPDATE public.resumen_manana_renglones SET enviado_at = now() WHERE id = ANY (r.ids);
    END IF;
  END LOOP;

  RETURN v_out;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aviso_cambio_o_semanal(text, text)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.aviso_valor_olvidar(text)           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resumen_manana_paso_la_hora()       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resumen_manana_agregar(uuid[], text, integer, text, text, text, text, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.armar_resumen_manana(boolean)       FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.aviso_cambio_o_semanal(text, text)  TO service_role;
GRANT  EXECUTE ON FUNCTION public.aviso_valor_olvidar(text)           TO service_role;
GRANT  EXECUTE ON FUNCTION public.resumen_manana_paso_la_hora()       TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.resumen_manana_agregar(uuid[], text, integer, text, text, text, text, jsonb, boolean)
  TO service_role;
GRANT  EXECUTE ON FUNCTION public.armar_resumen_manana(boolean)       TO service_role;

-- ── Generador 1: conteo de antibióticos (partido de la definición VIVA) ────
CREATE OR REPLACE FUNCTION public.avisar_cuadre_antibioticos(p_hoy date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_mes  text[] := ARRAY['enero','febrero','marzo','abril','mayo','junio','julio',
                           'agosto','septiembre','octubre','noviembre','diciembre'];
    v_n integer := 0; v_k integer;
    v_salas text; v_cuantas integer; v_clave text; v_dest uuid[];
    v_este date := date_trunc('month', p_hoy)::date;
    v_prev date := (date_trunc('month', p_hoy) - interval '1 month')::date;
BEGIN
    -- La marca se escribe sobre los DESTINATARIOS calculados y no sobre el
    -- RETURNING del INSERT: el trigger `avisos_horario` difiere el aviso
    -- (devuelve NULL) si la ventana de la persona no abrió, y entonces el
    -- RETURNING sale vacío, la marca no se escribía y el aviso se repetía cada
    -- mañana (2026-11-14).

    -- Recordatorio del mes en curso.
    IF extract(day FROM p_hoy) >= 20 THEN
        WITH casos AS (
            SELECT b.id AS branch_id, b.name AS sala, ((SELECT e.datos->'legal'->>'regentEmployeeId' FROM public.sucursal_expediente e WHERE e.branch_id = b.id)) AS regente
              FROM public.branches b
             WHERE b.type IN ('FARMACIA', 'BODEGA')
               AND NOT EXISTS (SELECT 1 FROM public.conteos_inventario c
                                WHERE c.branch_id = b.id AND c.scope_type IN ('BAJO_RECETA', 'CICLICO')
                                  AND c.status IN ('FINALIZADO', 'CERRADO')
                                  AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date >= v_este)
        ), destinatarios AS (
            SELECT c.branch_id, e.id AS employee_id FROM casos c
              JOIN public.employees e ON e.branch_id = c.branch_id
             WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
            UNION
            SELECT c.branch_id, e.id FROM casos c JOIN public.employees e ON e.id::text = c.regente
             WHERE e.status = 'ACTIVO'
        ), nuevos AS (
            SELECT d.branch_id, d.employee_id,
                   'CUADRE_ABX:' || d.branch_id || ':' || to_char(v_este, 'YYYY-MM') || ':recordatorio' AS clave
              FROM destinatarios d
             WHERE NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                                WHERE a.recipient_id = d.employee_id
                                  AND a.clave = 'CUADRE_ABX:' || d.branch_id || ':' || to_char(v_este, 'YYYY-MM') || ':recordatorio')
        ), ins AS (
            INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id)
            SELECT n.employee_id, 'CUADRE_ANTIBIOTICOS',
                   c.sala || ': falta el conteo de antibióticos de ' || v_mes[extract(month FROM p_hoy)::int],
                   'Cada mes se cuentan todos los antibióticos y se cuadran contra el sistema. '
                     || CASE WHEN c.sala = 'Bodega' THEN 'En Conteo de inventario, «Nuevo conteo» → «Bajo receta».'
                             ELSE 'Van dentro del conteo cíclico del día 15: terminen ese conteo.' END
                     || ' Hay tiempo hasta fin de mes.',
                   '/conteo-inventario',
                   jsonb_build_object('periodo', to_char(v_este, 'YYYY-MM'), 'sala', c.sala, 'clase', 'recordatorio'),
                   c.branch_id
              FROM nuevos n JOIN casos c ON c.branch_id = n.branch_id
            RETURNING 1
        ), marca AS (
            INSERT INTO public.avisos_emitidos (clave, recipient_id)
            SELECT n.clave, n.employee_id FROM nuevos n
            ON CONFLICT DO NOTHING RETURNING 1
        )
        SELECT count(*) INTO v_k FROM nuevos;
        v_n := v_n + v_k;
    END IF;

    -- El mes anterior que quedó sin conteo: a la gente de cada sala, una vez.
    WITH casos AS (
        SELECT b.id AS branch_id, b.name AS sala, ((SELECT e.datos->'legal'->>'regentEmployeeId' FROM public.sucursal_expediente e WHERE e.branch_id = b.id)) AS regente
          FROM public.branches b
         WHERE b.type IN ('FARMACIA', 'BODEGA')
           AND NOT EXISTS (SELECT 1 FROM public.conteos_inventario c
                            WHERE c.branch_id = b.id AND c.scope_type IN ('BAJO_RECETA', 'CICLICO')
                              AND c.status IN ('FINALIZADO', 'CERRADO')
                              AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date >= v_prev
                              AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date < v_este)
    ), destinatarios AS (
        SELECT c.branch_id, e.id AS employee_id FROM casos c
          JOIN public.employees e ON e.branch_id = c.branch_id
         WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
        UNION
        SELECT c.branch_id, e.id FROM casos c JOIN public.employees e ON e.id::text = c.regente
         WHERE e.status = 'ACTIVO'
    ), nuevos AS (
        SELECT d.branch_id, d.employee_id,
               'CUADRE_ABX:' || d.branch_id || ':' || to_char(v_prev, 'YYYY-MM') || ':vencido' AS clave
          FROM destinatarios d
         WHERE NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                            WHERE a.recipient_id = d.employee_id
                              AND a.clave = 'CUADRE_ABX:' || d.branch_id || ':' || to_char(v_prev, 'YYYY-MM') || ':vencido')
    ), ins AS (
        INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id)
        SELECT n.employee_id, 'CUADRE_ANTIBIOTICOS',
               c.sala || ': ' || v_mes[extract(month FROM v_prev)::int] || ' quedó sin conteo de antibióticos',
               'No se terminó el conteo de antibióticos de ' || v_mes[extract(month FROM v_prev)::int]
                 || '. La existencia de antibióticos de ese mes no quedó cuadrada contra el sistema.',
               '/bitacoras',
               jsonb_build_object('periodo', to_char(v_prev, 'YYYY-MM'), 'sala', c.sala, 'clase', 'vencido'),
               c.branch_id
          FROM nuevos n JOIN casos c ON c.branch_id = n.branch_id
        RETURNING 1
    ), marca AS (
        INSERT INTO public.avisos_emitidos (clave, recipient_id)
        SELECT n.clave, n.employee_id FROM nuevos n
        ON CONFLICT DO NOTHING RETURNING 1
    )
    SELECT count(*) INTO v_k FROM nuevos;
    v_n := v_n + v_k;

    -- Supervisión: UN renglón con todas las salas sin conteo, al resumen de la
    -- mañana. Sólo cuando el conjunto de salas cambia, o una vez por semana.
    SELECT string_agg(b.name, ', ' ORDER BY b.name), count(*) INTO v_salas, v_cuantas
      FROM public.branches b
     WHERE b.type IN ('FARMACIA', 'BODEGA')
       AND NOT EXISTS (SELECT 1 FROM public.conteos_inventario c
                        WHERE c.branch_id = b.id AND c.scope_type IN ('BAJO_RECETA', 'CICLICO')
                          AND c.status IN ('FINALIZADO', 'CERRADO')
                          AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date >= v_prev
                          AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date < v_este);
    v_clave := 'CUADRE_ABX:supervision:' || to_char(v_prev, 'YYYY-MM');
    v_k := 0;
    IF coalesce(v_cuantas, 0) = 0 THEN
        PERFORM public.aviso_valor_olvidar(v_clave);
    ELSE
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
           AND 13 = ANY (public.roles_efectivos_de(e.id));
        IF coalesce(cardinality(v_dest), 0) > 0 AND public.aviso_cambio_o_semanal(v_clave, v_salas) THEN
            v_k := public.resumen_manana_agregar(
                v_dest, 'antibioticos', 30, 'CUADRE_ANTIBIOTICOS',
                CASE WHEN v_cuantas = 1
                     THEN v_salas || ': ' || v_mes[extract(month FROM v_prev)::int] || ' quedó sin conteo de antibióticos'
                     ELSE v_cuantas || ' salas quedaron sin conteo de antibióticos de ' || v_mes[extract(month FROM v_prev)::int] END,
                'Sin conteo: ' || v_salas || '. La existencia de antibióticos de ese mes no quedó cuadrada contra el sistema.',
                '/bitacoras',
                jsonb_build_object('periodo', to_char(v_prev, 'YYYY-MM'), 'salas', v_salas, 'clase', 'vencido_resumen'),
                false);
        END IF;
    END IF;
    RETURN v_n + v_k;
END;
$function$;

-- ── Generador 2: clientes sin reconocer (partido de la definición VIVA) ────
CREATE OR REPLACE FUNCTION public.avisar_clientes_sin_reconocer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_dest   uuid[];
  v_n      integer := 0;
  v_total  integer; v_sin integer;
  v_cuerpo text;
  r        record;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE erp_id IS NULL)
    INTO v_total, v_sin
    FROM public.customers
   WHERE created_at >= (v_hoy::timestamp AT TIME ZONE 'America/El_Salvador');

  FOR r IN
    SELECT * FROM (VALUES
      ('reconocimiento_caido',
       CASE WHEN v_total >= 4 AND v_sin * 4 >= v_total * 3 THEN v_sin ELSE 0 END,
       'Las ventas no están reconociendo a los clientes',
       v_sin || ' de ' || v_total || ' clientes nuevos de hoy quedaron sin número interno. '
         || 'Cada uno abre una ficha suelta y sus puntos se separan de su ficha real. '
         || 'Revisar el acceso de la sincronización de ventas al sistema de la caja.', 0),
      ('fusion_con_puntos',
       (SELECT count(*)::int FROM public.clientes_por_revisar
         WHERE motivo = 'fusion_con_puntos' AND descartado_at IS NULL
           AND created_at < now() - interval '2 days'),
       'Clientes con los puntos partidos en dos fichas',
       NULL, 40),
      ('puntos_en_otra_ficha',
       (SELECT count(*)::int FROM public.puntos_lote l
          JOIN public.sales_invoices s ON s.id = l.invoice_id
         WHERE l.origen = 'venta' AND l.ganado_el >= v_hoy - 7
           AND l.customer_id <> s.customer_id
           AND public.cliente_vigente(l.customer_id) IS DISTINCT FROM public.cliente_vigente(s.customer_id)),
       'Puntos en una ficha distinta a la de su factura',
       NULL, 60),
      ('sin_numero_viejas',
       (SELECT count(*)::int FROM public.customers c
         WHERE c.erp_id IS NULL AND c.deshabilitada_at IS NULL
           AND c.created_at < now() - interval '3 days'
           AND c.created_at > now() - interval '60 days'
           AND NOT public.es_cliente_mostrador(c.name, c.erp_id)
           AND EXISTS (SELECT 1 FROM public.sales_invoices s WHERE s.customer_id = c.id)),
       'Fichas de clientes sin número interno',
       NULL, 50)
    ) t(tipo, n, titulo, cuerpo, orden)
  LOOP
    -- Sin casos: si vuelve a haber, avisa aunque sea el mismo número.
    IF coalesce(r.n, 0) = 0 THEN
      IF r.tipo <> 'reconocimiento_caido' THEN
        PERFORM public.aviso_valor_olvidar('CLIENTES_SIN_RECONOCER:' || r.tipo);
      END IF;
      CONTINUE;
    END IF;
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.audit_logs
       WHERE action = 'CLIENTES_SIN_RECONOCER'
         AND details->>'tipo' = r.tipo AND details->>'dia' = v_hoy::text);
    -- Lo que no cambió no se repite: sólo con otro número, o una vez por semana
    -- (2026-11-14). «Reconocimiento caído» es crítico y sigue igual.
    CONTINUE WHEN r.tipo <> 'reconocimiento_caido'
              AND NOT public.aviso_cambio_o_semanal('CLIENTES_SIN_RECONOCER:' || r.tipo, r.n::text);

    IF v_dest IS NULL THEN
      SELECT array_agg(e.id) INTO v_dest
        FROM public.employees e
        JOIN public.roles ro ON ro.name = 'Sistema — Alertas Técnicas'
       WHERE e.status = 'ACTIVO'
         AND (e.role_id = ro.id OR e.secondary_role_id = ro.id);
    END IF;

    INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
    VALUES ('CLIENTES_SIN_RECONOCER', r.tipo, 'Vigilante', 'SYSTEM',
            CASE WHEN r.tipo = 'reconocimiento_caido' THEN 'CRITICAL' ELSE 'WARNING' END,
            jsonb_build_object('tipo', r.tipo, 'dia', v_hoy, 'casos', r.n,
                               'nuevas_hoy', v_total, 'sin_numero_hoy', v_sin,
                               'avisados', coalesce(array_length(v_dest, 1), 0)));

    IF coalesce(array_length(v_dest, 1), 0) > 0 THEN
      v_cuerpo := coalesce(r.cuerpo,
          CASE r.tipo
            WHEN 'fusion_con_puntos' THEN
              r.n || ' caso' || CASE WHEN r.n = 1 THEN '' ELSE 's' END
              || ' en «Por revisar» con más de 2 días: la unión automática no pudo hacerlos y el cliente ve sólo parte de su saldo.'
            WHEN 'puntos_en_otra_ficha' THEN
              r.n || ' venta' || CASE WHEN r.n = 1 THEN '' ELSE 's' END
              || ' de la última semana tiene' || CASE WHEN r.n = 1 THEN '' ELSE 'n' END
              || ' los puntos en una ficha y la factura en otra.'
            ELSE
              r.n || ' ficha' || CASE WHEN r.n = 1 THEN '' ELSE 's' END
              || ' con compras siguen sin número interno después de 3 días.'
          END);
      IF r.tipo = 'reconocimiento_caido' THEN
        PERFORM public.notify_employees(
          v_dest, 'SYSTEM', r.titulo, v_cuerpo, '/clientes?tab=revisar',
          jsonb_build_object('origen', 'clientes-sin-reconocer', 'tipo', r.tipo, 'casos', r.n),
          true, NULL);
      ELSE
        -- En el resumen el título lleva la cifra: el renglón se lee solo.
        PERFORM public.resumen_manana_agregar(
          v_dest, 'clientes_' || r.tipo, r.orden, 'SYSTEM',
          CASE r.tipo
            WHEN 'fusion_con_puntos' THEN
              r.n || CASE WHEN r.n = 1 THEN ' cliente con los puntos partidos en dos fichas'
                                       ELSE ' clientes con los puntos partidos en dos fichas' END
            WHEN 'puntos_en_otra_ficha' THEN
              r.n || CASE WHEN r.n = 1 THEN ' venta con los puntos en otra ficha'
                                       ELSE ' ventas con los puntos en otra ficha' END
            ELSE
              r.n || CASE WHEN r.n = 1 THEN ' ficha de cliente sin número interno'
                                       ELSE ' fichas de clientes sin número interno' END
          END,
          v_cuerpo, '/clientes?tab=revisar',
          jsonb_build_object('origen', 'clientes-sin-reconocer', 'tipo', r.tipo, 'casos', r.n),
          true);
      END IF;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- ── Generador 3: el envío a Hacienda de anoche (partido de la definición VIVA)
-- Único cambio: el aviso final va por `resumen_manana_agregar`.
CREATE OR REPLACE FUNCTION public.alertar_barrido_dte()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_corrida    public.audit_logs%ROWTYPE;
    v_hubo       boolean;
    v_fallidas   int;
    v_resueltas  int;
    v_restantes  int;
    v_esperando  int;
    v_dest       uuid[];
    v_titulo     text;
    v_cuerpo     text;
    v_facturas   jsonb;
BEGIN
    SELECT * INTO v_corrida
      FROM public.audit_logs
     WHERE action = 'DTE_REGULARIZADO'
       AND source = 'SYSTEM'
       AND target_id = 'todas'
       AND created_at >= now() - interval '12 hours'
     ORDER BY created_at DESC
     LIMIT 1;

    v_hubo := FOUND;

    IF v_hubo THEN
        v_fallidas  := coalesce((v_corrida.details->>'fallidas')::int, 0);
        v_resueltas := coalesce((v_corrida.details->>'resueltas')::int, 0);
        v_restantes := coalesce((v_corrida.details->>'restantes')::int, 0);
        IF v_fallidas = 0 THEN RETURN; END IF;
    END IF;

    SELECT array_agg(e.id) INTO v_dest
      FROM public.employees e
      JOIN public.roles r ON r.name = 'Sistema — Alertas Técnicas'
     WHERE e.status = 'ACTIVO'
       AND r.id = ANY (public.roles_efectivos_de(e.id));

    IF v_dest IS NULL OR array_length(v_dest, 1) IS NULL THEN
        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
        VALUES ('ALERTA_BARRIDO_DTE_SIN_DESTINATARIOS', 'regularizar-dte',
                'Vigilante', 'SYSTEM', 'CRITICAL',
                jsonb_build_object('motivo', 'nadie tiene el rol Sistema — Alertas Técnicas'));
        RETURN;
    END IF;

    IF NOT v_hubo THEN
        -- Las dos bolsas del barrido, contadas con su mismo criterio: anulada
        -- CON sello (hay algo que invalidar ante Hacienda) y no anulada SIN
        -- sello válido. El sello es texto de 40 caracteres, así que se compara
        -- por forma y no por «tiene algo» — ver la regla del tipo en CLAUDE.md.
        SELECT count(*) INTO v_esperando
          FROM public.sales_invoices
         WHERE (estado = 'NULA' AND recibido_mh LIKE repeat('_', 40))
            OR (estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
                AND (recibido_mh IS NULL OR recibido_mh NOT LIKE repeat('_', 40))
                AND NOT public.cof_no_se_envia_mh(tipo_documento, fecha, hora, customer_id));

        v_titulo := 'El envío a Hacienda no corrió anoche';
        v_cuerpo := 'No quedó registro del envío de las ' || public.hora_12('22:30'::time) || '. '
                 || CASE
                      WHEN v_esperando = 0
                        THEN 'Ahora mismo no hay ninguna factura esperando, '
                             || 'pero tiene que volver a correr antes de que entre la próxima. '
                      WHEN v_esperando = 1
                        THEN 'Hay 1 factura esperando y no se va a mandar hasta que vuelva a correr. '
                      ELSE 'Hay ' || v_esperando
                             || ' facturas esperando y no se van a mandar hasta que vuelva a correr. '
                    END
                 || 'Hay que revisar el envío automático de las ' || public.hora_12('22:30'::time) || '.';
    ELSE
        v_titulo := CASE WHEN v_fallidas = 1 THEN 'Una factura no entró a Hacienda anoche'
                         ELSE v_fallidas || ' facturas no entraron a Hacienda anoche' END;

        -- Cuáles son, para la tarjeta (24-sep): la venta —sala, documento,
        -- fecha, cliente, monto— y lo que dijo Hacienda. Hasta 5.
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'sala',    b.name,
                   'doc',     CASE WHEN x->>'correlativo' LIKE '%\_CCF' THEN 'Crédito fiscal' ELSE 'Consumidor final' END,
                   'fecha',   si.fecha,
                   'cliente', nullif(btrim(si.cliente), ''),
                   'monto',   si.total,
                   'motivo',  coalesce(x->'observaciones'->>0,
                                       regexp_replace(coalesce(x->>'error', ''), '^.*— ', ''))))
                 ORDER BY b.name)
          INTO v_facturas
          FROM (SELECT x FROM jsonb_array_elements(coalesce(v_corrida.details->'detalle', '[]'::jsonb)) x
                 WHERE (x->>'ok')::boolean IS NOT TRUE LIMIT 5) f
          LEFT JOIN public.sales_invoices si ON si.id = nullif(x->>'invoice_id', '')::bigint
          LEFT JOIN public.branches b ON b.id = nullif(x->>'branch_id', '')::integer;
        v_cuerpo := v_fallidas || ' factura' || CASE WHEN v_fallidas = 1 THEN '' ELSE 's' END
                 || ' no se pudo completar ante Hacienda'
                 || CASE WHEN v_resueltas > 0 THEN ', ' || v_resueltas || ' sí' ELSE '' END
                 || '. ' || CASE WHEN v_restantes > 0
                                 THEN 'Quedan ' || v_restantes || ' en cola. ' ELSE '' END
                 || 'Las que ya no se arreglan solas están en Facturación, en Observaciones.';
    END IF;

    -- Al resumen de la mañana (2026-11-14): con un solo renglón sale igual que
    -- antes, con su tarjeta de Hacienda; con más, va dentro del resumen.
    PERFORM public.resumen_manana_agregar(
        v_dest, 'hacienda', 10, 'SYSTEM', v_titulo, v_cuerpo, '/facturacion?tab=observaciones',
        jsonb_strip_nulls(jsonb_build_object('origen', 'regularizar-dte',
                           'corrida', v_corrida.id,
                           'fallidas', v_fallidas,
                           'esperando', v_esperando,
                           -- La tarjeta de la campana (24-sep).
                           'hacienda', jsonb_strip_nulls(jsonb_build_object(
                               'corrio',    v_hubo,
                               'fallidas',  v_fallidas,
                               'resueltas', v_resueltas,
                               'restantes', v_restantes,
                               'esperando', v_esperando,
                               'facturas',  v_facturas)))),
        true
    );
END;
$function$;

-- ── El cron del armado: 08:45 SV, y un reintento a las 09:15 ───────────────
-- Idempotente: sólo manda lo que no salió. Sin HTTP: es SQL puro.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'resumen-manana-0845-sv') THEN
    PERFORM cron.unschedule('resumen-manana-0845-sv');
  END IF;
  PERFORM cron.schedule('resumen-manana-0845-sv', '45 14 * * *', 'SELECT public.armar_resumen_manana()');
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'resumen-manana-reintento-0915-sv') THEN
    PERFORM cron.unschedule('resumen-manana-reintento-0915-sv');
  END IF;
  PERFORM cron.schedule('resumen-manana-reintento-0915-sv', '15 15 * * *', 'SELECT public.armar_resumen_manana()');
END $$;
