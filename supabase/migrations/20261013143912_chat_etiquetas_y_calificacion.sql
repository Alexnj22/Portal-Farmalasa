-- Chat (2026-10-13), pedidos del usuario:
--   · «¿le agregaste el poder ponerle estados a un cliente?» → etiquetas de la
--     conversación (una por cliente, así que son etiquetas DEL CLIENTE en el
--     chat): Consulta de medicamento, Receta, Reserva, Queja, Precio,
--     Seguimiento, Urgente, Cliente frecuente. Las pone el equipo.
--   · Mejor experiencia: al resolverse una conversación el cliente puede
--     calificar la atención (1–5 y un comentario).
SET lock_timeout = '5s';

ALTER TABLE public.app_chat_conversaciones
  ADD COLUMN IF NOT EXISTS etiquetas text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS calificacion smallint CHECK (calificacion IS NULL OR calificacion BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS calificacion_comentario text CHECK (calificacion_comentario IS NULL OR length(calificacion_comentario) <= 500),
  ADD COLUMN IF NOT EXISTS calificada_at timestamptz;
ALTER TABLE public.app_chat_conversaciones ADD CONSTRAINT app_chat_conversaciones_etiquetas_check
  CHECK (etiquetas <@ ARRAY['medicamento', 'receta', 'reserva', 'queja', 'precio', 'seguimiento', 'urgente', 'frecuente']::text[]);

CREATE OR REPLACE FUNCTION public.chat_etiquetar(p_conversacion bigint, p_etiquetas text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.auth_has_module_permission('chat_clientes', 'can_edit') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE public.app_chat_conversaciones
     SET etiquetas = coalesce((SELECT array_agg(DISTINCT e ORDER BY e) FROM unnest(p_etiquetas) e), '{}')
   WHERE id = p_conversacion;
  RETURN json_build_object('ok', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chat_etiquetar(bigint, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_etiquetar(bigint, text[]) TO authenticated, service_role;

-- La bandeja trae etiquetas y calificación.
CREATE OR REPLACE FUNCTION public.chat_conversaciones(p_estado text DEFAULT 'abierta', p_antes timestamptz DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.auth_has_module_permission('chat_clientes', 'can_view') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT json_agg(x ORDER BY x.ultimo_mensaje_at DESC) FROM (
      SELECT cv.id, cv.customer_id, cv.estado, cv.ultimo_mensaje_at, cv.ultimo_de, cv.ultimo_texto,
             cv.sin_leer_equipo, cv.tomada_por, cv.tomada_at,
             (cv.tomada_por IS NOT NULL AND cv.tomada_at > now() - interval '10 minutes') AS tomada_vigente,
             cv.etiquetas, cv.calificacion, cv.calificacion_comentario, cv.esperando_desde,
             c.name AS cliente, c.phone AS telefono,
             f.ruta AS foto_ruta,
             public.cliente_es_empleado(cv.customer_id) AS es_team,
             (public.mayorista_de(cv.customer_id) ->> 'estado') = 'aprobado' AS es_mayoreo,
             public.mayorista_de(cv.customer_id) ->> 'rango' AS rango,
             (public.puntos_nivel_de(public.puntos_compra_12m(cv.customer_id, (now() AT TIME ZONE 'America/El_Salvador')::date))).clave AS nivel
        FROM public.app_chat_conversaciones cv
        JOIN public.customers c ON c.id = cv.customer_id
        LEFT JOIN public.app_cliente_fotos f ON f.customer_id = cv.customer_id AND f.quitada_at IS NULL
       WHERE (p_estado IS NULL OR cv.estado = p_estado)
         AND (p_antes IS NULL OR cv.ultimo_mensaje_at < p_antes)
       ORDER BY cv.ultimo_mensaje_at DESC
       LIMIT 40) x), '[]'::json);
END;
$function$;
