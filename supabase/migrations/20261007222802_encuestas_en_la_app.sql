SET lock_timeout = '5s';
-- Encuestas en la app de clientes (2026-10-07). Un canal más, «app»: el cliente
-- ya inició sesión, así que la respuesta es de su ficha sin pedir teléfono, una
-- sola vez por encuesta, y el incentivo se acredita solo. Si la encuesta no
-- define puntos, la app paga 25 (decisión del usuario).
ALTER TABLE public.encuestas_cliente DROP CONSTRAINT encuestas_cliente_canales_check,
  ADD CONSTRAINT encuestas_cliente_canales_check CHECK (canales <@ ARRAY['qr','entrevista','kiosco','app']);
ALTER TABLE public.encuesta_cliente_respuestas DROP CONSTRAINT encuesta_cliente_respuestas_canal_check,
  ADD CONSTRAINT encuesta_cliente_respuestas_canal_check CHECK (canal = ANY (ARRAY['qr','entrevista','kiosco','app']));
CREATE UNIQUE INDEX IF NOT EXISTS encuesta_cliente_respuestas_app_una_por_cliente
  ON public.encuesta_cliente_respuestas (encuesta_id, customer_id) WHERE canal = 'app';

CREATE OR REPLACE FUNCTION public.encuesta_app_puntos(p_enc public.encuestas_cliente)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
  SELECT CASE WHEN p_enc.incentivo_tipo = 'puntos' AND p_enc.incentivo_puntos > 0 THEN p_enc.incentivo_puntos ELSE 25 END;
$$;

CREATE OR REPLACE FUNCTION public.encuesta_app_disponibles(p_customer bigint)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT coalesce(json_agg(json_build_object(
      'id', e.id, 'nombre', e.nombre, 'cuestionario', e.cuestionario,
      'bienvenida', e.mensaje_bienvenida, 'cierre', e.mensaje_cierre,
      'puntos', public.encuesta_app_puntos(e), 'hasta', e.fecha_fin) ORDER BY e.publicada_at DESC), '[]'::json)
    FROM public.encuestas_cliente e
   WHERE NOT e.es_plantilla AND e.estado = 'publicada' AND 'app' = ANY (e.canales)
     AND (e.fecha_inicio IS NULL OR e.fecha_inicio <= (now() AT TIME ZONE 'America/El_Salvador')::date)
     AND (e.fecha_fin IS NULL OR e.fecha_fin >= (now() AT TIME ZONE 'America/El_Salvador')::date)
     AND NOT EXISTS (SELECT 1 FROM public.encuesta_cliente_respuestas r
                      WHERE r.encuesta_id = e.id AND r.customer_id = p_customer AND r.canal = 'app');
$$;

CREATE OR REPLACE FUNCTION public.encuesta_app_responder(p_customer bigint, p_id uuid, p_respuestas jsonb, p_duracion integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_enc public.encuestas_cliente;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_limpias jsonb; v_nps smallint; v_branch integer; v_id uuid; v_inc uuid; v_estado text;
BEGIN
  SELECT * INTO v_enc FROM public.encuestas_cliente WHERE id = p_id;
  IF NOT FOUND OR v_enc.es_plantilla OR v_enc.estado <> 'publicada' OR NOT 'app' = ANY (v_enc.canales) THEN RAISE EXCEPTION 'Esta encuesta ya no está recibiendo respuestas'; END IF;
  IF v_enc.fecha_inicio IS NOT NULL AND v_hoy < v_enc.fecha_inicio THEN RAISE EXCEPTION 'Esta encuesta todavía no empieza'; END IF;
  IF v_enc.fecha_fin IS NOT NULL AND v_hoy > v_enc.fecha_fin THEN RAISE EXCEPTION 'Esta encuesta ya cerró'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('encuesta_app:' || p_id || ':' || p_customer));
  IF EXISTS (SELECT 1 FROM public.encuesta_cliente_respuestas WHERE encuesta_id = p_id AND customer_id = p_customer AND canal = 'app') THEN
    RAISE EXCEPTION 'Ya respondiste esta encuesta. ¡Gracias!';
  END IF;

  v_limpias := public.encuesta_cliente_limpiar(v_enc.cuestionario, p_respuestas);
  IF v_limpias = '{}'::jsonb THEN RAISE EXCEPTION 'La respuesta está vacía'; END IF;
  SELECT (v_limpias ->> (p ->> 'id'))::smallint INTO v_nps
    FROM jsonb_array_elements(coalesce(v_enc.cuestionario -> 'secciones', '[]')) s,
         jsonb_array_elements(coalesce(s -> 'preguntas', '[]')) p
   WHERE p ->> 'tipo' = 'nps' AND v_limpias ? (p ->> 'id') LIMIT 1;

  -- La sucursal: la de su última compra si la encuesta la incluye; si no, la primera de la encuesta.
  SELECT es.branch_id INTO v_branch
    FROM public.encuesta_cliente_sucursales es
    LEFT JOIN LATERAL (SELECT max(si.fecha) f FROM public.sales_invoices si
                        WHERE si.customer_id = p_customer AND si.branch_id = es.branch_id
                          AND si.fecha >= v_hoy - 365) u ON true
   WHERE es.encuesta_id = p_id
   ORDER BY u.f DESC NULLS LAST, es.branch_id LIMIT 1;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Esta encuesta no tiene sucursales'; END IF;

  INSERT INTO public.encuesta_cliente_respuestas (encuesta_id, branch_id, canal, respuestas, nps, consentimiento_at,
      customer_id, dispositivo, duracion_seg)
  VALUES (p_id, v_branch, 'app', v_limpias, v_nps, now(), p_customer, 'app',
      CASE WHEN p_duracion BETWEEN 0 AND 86400 THEN p_duracion END)
  RETURNING id INTO v_id;

  INSERT INTO public.encuesta_cliente_incentivos (respuesta_id, encuesta_id, tipo, estado, puntos)
  VALUES (v_id, p_id, 'puntos', 'pendiente', public.encuesta_app_puntos(v_enc))
  RETURNING id INTO v_inc;
  v_estado := public.encuesta_cliente_acreditar(v_inc, p_customer);
  PERFORM public.encuesta_cliente_cerrar_si_llego(p_id);
  RETURN json_build_object('ok', true, 'puntos', public.encuesta_app_puntos(v_enc), 'estado', v_estado, 'cierre', v_enc.mensaje_cierre);
END $$;

REVOKE EXECUTE ON FUNCTION public.encuesta_app_puntos(public.encuestas_cliente) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.encuesta_app_disponibles(bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encuesta_app_responder(bigint, uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encuesta_app_puntos(public.encuestas_cliente) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.encuesta_app_disponibles(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.encuesta_app_responder(bigint, uuid, jsonb, integer) TO service_role;
