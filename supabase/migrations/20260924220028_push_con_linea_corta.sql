SET lock_timeout = '5s';

-- El push al teléfono con una línea corta (usuario, 24-sep: «me parece»).
-- `texto_de_push` la arma desde el metadata que dibuja la tarjeta; la usan los
-- tres caminos generales (`notify_employees`, `notify_branch`,
-- `push_de_notificaciones`) y los cuatro disparadores de solicitudes,
-- traslados y envíos, que mandan su propio push. Sin datos, sale el cuerpo de
-- siempre.

CREATE OR REPLACE FUNCTION public.texto_de_push(p_type text, p_body text, p_meta jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
-- La línea que llega al TELÉFONO (usuario, 24-sep). El cuerpo largo de cada
-- aviso era para la campana cuando la campana era texto; hoy la campana dibuja
-- la tarjeta y el cuerpo sólo lo lee el push, que muestra dos renglones. Esta
-- función arma una línea corta con lo esencial desde el MISMO metadata que
-- dibuja la tarjeta: «AGUA CRISTAL ×24 y 2 más · Monica Estrada».
--
-- Los nombres van CORTOS (nombre y primer apellido), por el mismo canónico de
-- la base, y el documento como CCF/COF.
--
-- Si el aviso no trae los datos, o algo falla, devuelve el cuerpo de siempre:
-- un push nunca sale vacío por culpa de esta función.
DECLARE
    m   jsonb := coalesce(p_meta, '{}'::jsonb);
    s   jsonb;
    v   text;
    n   integer;
    mas integer;
    p0  jsonb;
    t   numeric;
BEGIN
    BEGIN
        IF jsonb_typeof(m->'solicitud') = 'object' THEN
            s   := m->'solicitud';
            n   := coalesce(jsonb_array_length(s->'productos'), 0);
            mas := greatest(n - 1, 0) + coalesce((s->>'mas')::integer, 0);
            p0  := s->'productos'->0;
            IF s->>'tipo' = 'INVENTORY_TRANSFER_PUSH' THEN
                v := (n + coalesce((s->>'mas')::integer, 0)) || CASE WHEN n + coalesce((s->>'mas')::integer, 0) = 1 THEN ' producto' ELSE ' productos' END
                  || coalesce(', ' || trim(to_char((s->>'unidades')::numeric, 'FM999,999,990.##')) || ' unidades', '')
                  || coalesce(' · ' || nullif(split_part(s->>'motivo', ':', 1), ''), '');
            ELSIF s ? 'doc' THEN
                v := concat_ws(' · ',
                        -- CCF/COF: los avisos anteriores al 24-sep traen el nombre largo.
                        nullif(concat_ws(' ', CASE WHEN s->>'doc' ILIKE 'cr%dito fiscal' THEN 'CCF'
                                                   WHEN s->>'doc' ILIKE 'consumidor final' OR s->>'doc' = 'Factura' THEN 'COF'
                                                   ELSE s->>'doc' END,
                               CASE WHEN s->>'monto' IS NOT NULL THEN '$' || to_char((s->>'monto')::numeric, 'FM999,999,990.00') END), ''),
                        CASE WHEN s ? 'antes' AND s ? 'despues' THEN (s->>'antes') || ' → ' || (s->>'despues') END,
                        s->>'cliente');
            ELSIF p0 IS NOT NULL THEN
                v := concat_ws(' · ',
                        (p0->>'nombre') || coalesce(' ×' || trim(to_char((p0->>'cantidad')::numeric, 'FM999,999,990.##')), '')
                          || CASE WHEN mas > 0 THEN ' y ' || mas || ' más' ELSE '' END,
                        public.nombre_corto_de_empleado(NULL, NULL, s->>'quien'));
            ELSIF s ? 'antes' AND s ? 'despues' THEN
                v := concat_ws(' · ', (s->>'antes') || ' → ' || (s->>'despues'), public.nombre_corto_de_empleado(NULL, NULL, s->>'quien'));
            ELSE
                v := concat_ws(' · ', public.nombre_corto_de_empleado(NULL, NULL, s->>'quien'), left(s->>'motivo', 90));
            END IF;

        ELSIF jsonb_typeof(m->'respuesta') = 'object' THEN
            s := m->'respuesta';
            IF s->>'tipo' = 'envio' THEN
                v := 'Se quedó con ' || coalesce(s->>'aceptados', '0')
                  || CASE WHEN coalesce(jsonb_array_length(s->'devueltos'), 0) > 0
                          THEN ' y te devuelve ' || jsonb_array_length(s->'devueltos') ELSE '' END
                  || CASE WHEN (s->>'no_llegaron')::integer > 0
                          THEN ' · ' || (s->>'no_llegaron') || ' no llegaron' ELSE '' END;
            ELSIF s->>'estado' = 'NO' THEN
                v := concat_ws(' · ', s->'productos'->0->>'nombre', s->>'motivo');
            ELSE
                n   := coalesce(jsonb_array_length(s->'productos'), 0);
                mas := greatest(n - 1, 0) + coalesce((s->>'mas')::integer, 0);
                p0  := s->'productos'->0;
                v := concat_ws(' · ',
                        (p0->>'nombre')
                          || CASE WHEN p0->>'enviada' IS NULL THEN ''
                                  WHEN (p0->>'enviada')::numeric < coalesce((p0->>'pedida')::numeric, 0)
                                    THEN ' ×' || (p0->>'enviada') || ' de ' || (p0->>'pedida')
                                  ELSE ' ×' || (p0->>'enviada') END
                          || CASE WHEN mas > 0 THEN ' y ' || mas || ' más' ELSE '' END,
                        public.nombre_corto_de_empleado(NULL, NULL, s->>'quien'));
            END IF;

        ELSIF jsonb_typeof(m->'decision') = 'object' THEN
            s := m->'decision';
            v := CASE WHEN s->>'estado' = 'APPROVED'
                      THEN concat_ws(' · ', 'La aprobó ' || (public.nombre_corto_de_empleado(NULL, NULL, s->>'quien')), left(s->>'instruccion', 90), left(s->>'nota', 90))
                      ELSE concat_ws(' · ', 'La rechazó ' || (public.nombre_corto_de_empleado(NULL, NULL, s->>'quien')), left(s->>'nota', 110)) END;

        ELSIF p_type = 'CORTE_NUEVO' AND m ? 'tramo' THEN
            t := (m->>'tramo')::numeric;
            v := concat_ws(' · ',
                    CASE WHEN t IS NULL THEN 'Sin conteo de efectivo'
                         WHEN t <= -0.01 THEN 'Faltaron $' || to_char(abs(t), 'FM999,999,990.00')
                         WHEN t >=  0.01 THEN 'Sobraron $' || to_char(t, 'FM999,999,990.00')
                         ELSE 'Cuadró' END,
                    public.nombre_corto_de_empleado(NULL, NULL, m->>'quien'));

        ELSIF jsonb_typeof(m->'hacienda') = 'object' THEN
            SELECT string_agg(concat_ws(' ', f->>'sala',
                                  CASE WHEN f->>'monto' IS NOT NULL THEN '$' || to_char((f->>'monto')::numeric, 'FM999,999,990.00') END), ' · ')
              INTO v
              FROM (SELECT f FROM jsonb_array_elements(coalesce(m->'hacienda'->'facturas', '[]'::jsonb)) f LIMIT 3) x;

        ELSIF jsonb_typeof(m->'diferencia') = 'object' THEN
            v := concat_ws(' · ', m->'diferencia'->>'producto', m->'diferencia'->>'salida');

        ELSIF p_type = 'MINMAX_PENDING' AND m ? 'min_nuevo' THEN
            v := concat_ws(' · ',
                    'MIN ' || coalesce(m->>'min_hoy', '—') || ' · MAX ' || coalesce(m->>'max_hoy', '—')
                      || ' → MIN ' || (m->>'min_nuevo') || ' · MAX ' || coalesce(m->>'max_nuevo', '—'),
                    m->>'producto');

        ELSIF p_type = 'CONTEO_CICLICO' AND m ? 'productos' THEN
            v := (m->>'productos') || ' productos por contar, a ciegas';

        ELSIF jsonb_typeof(m->'promo') = 'object' AND m->'promo'->>'tipo' = 'lote' THEN
            v := concat_ws(' · ', (m->'promo'->>'vendido') || ' de ' || (m->'promo'->>'asignado') || ' vendidas',
                           m->'promo'->>'producto');
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v := NULL;
    END;

    RETURN coalesce(nullif(btrim(v), ''), left(coalesce(p_body, ''), 180));
END;
$function$;

REVOKE ALL ON FUNCTION public.texto_de_push(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.texto_de_push(text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_employees(p_recipients uuid[], p_type text, p_title text, p_body text DEFAULT ''::text, p_link text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_push boolean DEFAULT false, p_branch_id integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor uuid := public.auth_employee_id();
  v_targets uuid[];
  v_count integer;
BEGIN
  SELECT array_agg(DISTINCT e.id) INTO v_targets
  FROM public.employees e
  WHERE e.id = ANY(p_recipients)
    AND (v_actor IS NULL OR e.id <> v_actor);

  IF v_targets IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
  SELECT t, p_type, p_title, COALESCE(p_body, ''), p_link, COALESCE(p_metadata, '{}'::jsonb), p_branch_id, v_actor
  FROM unnest(v_targets) t;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF p_push AND v_count > 0 THEN
    PERFORM net.http_post(
      url     := public.push_function_url(),
      headers := public.push_function_headers(),
      body    := jsonb_build_object(
        'title', p_title,
        -- La línea corta del teléfono (24-sep); sin datos, el cuerpo de siempre.
        'message', public.texto_de_push(p_type, COALESCE(p_body, ''), p_metadata),
        'url', COALESCE(p_link, '/home'),
        'target_type', 'EMPLOYEE',
        'target_value', to_jsonb(v_targets)
      )
    );
  END IF;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_branch(p_branch_id integer, p_type text, p_title text, p_body text DEFAULT ''::text, p_link text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_push boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor uuid := public.auth_employee_id();
  v_count integer;
BEGIN
  INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
  SELECT e.id, p_type, p_title, COALESCE(p_body, ''), p_link, COALESCE(p_metadata, '{}'::jsonb), p_branch_id, v_actor
  FROM public.employees e
  WHERE e.branch_id = p_branch_id
    AND e.status = 'ACTIVO'
    AND (v_actor IS NULL OR e.id <> v_actor);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF p_push AND v_count > 0 THEN
    PERFORM net.http_post(
      url     := public.push_function_url(),
      headers := public.push_function_headers(),
      body    := jsonb_build_object(
        'title', p_title,
        -- La línea corta del teléfono (24-sep); sin datos, el cuerpo de siempre.
        'message', public.texto_de_push(p_type, COALESCE(p_body, ''), p_metadata),
        'url', COALESCE(p_link, '/home'),
        'target_type', 'BRANCH',
        'target_value', jsonb_build_array(p_branch_id)
      )
    );
  END IF;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.push_de_notificaciones(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- Manda al teléfono avisos que YA están en la campana. Recibe los ids de las
-- filas de `notifications` y agrupa por (título, cuerpo, enlace): los que
-- dicen lo mismo salen en un solo envío, los distintos (p. ej. uno por sala)
-- en envíos separados. Existe para las funciones que escriben en
-- `notifications` directo en vez de pasar por `notify_employees`.
DECLARE
  g   record;
  v_n integer := 0;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN 0; END IF;
  FOR g IN
    -- Se agrupa por la LÍNEA que va al teléfono (24-sep) y no por el cuerpo:
    -- es lo que se manda, y dos avisos con el mismo texto salen en un envío.
    SELECT n.title, public.texto_de_push(n.type, n.body, n.metadata) AS body, n.link,
           array_agg(DISTINCT n.recipient_id) AS ids
      FROM public.notifications n
     WHERE n.id = ANY(p_ids)
     GROUP BY n.title, public.texto_de_push(n.type, n.body, n.metadata), n.link
  LOOP
    PERFORM net.http_post(
      url     := public.push_function_url(),
      headers := public.push_function_headers(),
      body    := jsonb_build_object(
        'title',        g.title,
        'message',      coalesce(g.body, ''),
        'url',          coalesce(g.link, '/home'),
        'target_type',  'EMPLOYEE',
        'target_value', to_jsonb(g.ids)));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;
