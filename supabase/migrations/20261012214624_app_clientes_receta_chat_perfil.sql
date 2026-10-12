-- App de clientes (2026-10-12): RECETA con foto, CHAT con la farmacia y FOTO
-- de perfil. Decisiones del usuario:
--   · Receta: la reserva de un producto bajo receta queda «en revisión» hasta
--     que la SUCURSAL donde se retira la aprueba, pide otra foto o la rechaza.
--     No se confirma ni se puede pagar antes. A las 4 h sin revisar, aviso a
--     supervisión con la sala que no la verificó.
--   · Chat: uno general «estilo Messenger»; contestan todos los que tengan el
--     permiso nuevo `chat_clientes`, y el cliente ve foto y nombre de quien
--     responde. El equipo ve el tipo de cliente, su nivel y su foto.
--   · Foto de perfil del cliente: opcional, privada, el equipo la puede quitar.
-- Los archivos viven en un bucket privado nuevo, `app-clientes-archivos`
-- (`recetas/<sala>/<reserva>/…`, `chat/<cliente>/…`, `perfil/<cliente>/…`).
-- La app sube con una URL firmada que le da `app-clientes`; el portal lee con
-- URL firmada, y la policy de lectura decide por la carpeta.
SET lock_timeout = '5s';

-- ── Bucket ───────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('app-clientes-archivos', 'app-clientes-archivos', false, 8388608,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO NOTHING;

-- ── Permiso nuevo: Chat con clientes ─────────────────────────────────────
-- Arranca con Gerente General (2), Administrador (3) y Supervisor/a de Ventas
-- (13); el resto se da desde Permisos en el portal.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve)
SELECT r.id, 'chat_clientes', true, true, false
  FROM public.roles r
 WHERE r.id IN (2, 3, 13)
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions x WHERE x.role_id = r.id AND x.module_key = 'chat_clientes');

-- ════════════════════════════════════════════════════════════════════════
-- RECETA
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.app_reservas DROP CONSTRAINT app_reservas_estado_check;
ALTER TABLE public.app_reservas ADD CONSTRAINT app_reservas_estado_check
  CHECK (estado = ANY (ARRAY['en_revision', 'pendiente', 'lista', 'retirada', 'vencida', 'cancelada']));
ALTER TABLE public.app_reservas
  ADD COLUMN IF NOT EXISTS receta_ruta text,
  ADD COLUMN IF NOT EXISTS receta_estado text,
  ADD COLUMN IF NOT EXISTS receta_motivo text,
  ADD COLUMN IF NOT EXISTS receta_subida_at timestamptz,
  ADD COLUMN IF NOT EXISTS receta_fotos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receta_revisada_por uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS receta_revisada_at timestamptz,
  ADD COLUMN IF NOT EXISTS receta_escalada_at timestamptz;
ALTER TABLE public.app_reservas ADD CONSTRAINT app_reservas_receta_estado_check
  CHECK (receta_estado IS NULL OR receta_estado = ANY (ARRAY['pendiente', 'otra_foto', 'aprobada', 'rechazada']));
ALTER TABLE public.app_reservas ADD CONSTRAINT app_reservas_receta_motivo_check
  CHECK (receta_motivo IS NULL OR length(receta_motivo) <= 300);
CREATE INDEX IF NOT EXISTS app_reservas_en_revision_idx
  ON public.app_reservas (receta_subida_at) WHERE estado = 'en_revision';

-- La sala decide. `aprobada` → la reserva pasa a pendiente (confirmada, ya se
-- puede pagar); `otra_foto` → sigue en revisión y el cliente sube otra;
-- `rechazada` → se cancela. En los tres casos el cliente recibe un aviso.
CREATE OR REPLACE FUNCTION public.reserva_receta_decidir(p_id bigint, p_decision text, p_motivo text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas;
  v_emp uuid := public.auth_employee_id();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_codigo text;
BEGIN
  IF p_decision NOT IN ('aprobada', 'otra_foto', 'rechazada') THEN RAISE EXCEPTION 'DECISION_INVALIDA'; END IF;
  IF p_decision <> 'aprobada' AND v_motivo IS NULL THEN RAISE EXCEPTION 'FALTA_MOTIVO'; END IF;
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF r.estado <> 'en_revision' OR r.receta_estado IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'YA_DECIDIDA';
  END IF;
  v_codigo := coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0'));
  UPDATE public.app_reservas
     SET receta_estado = p_decision, receta_motivo = v_motivo,
         receta_revisada_por = v_emp, receta_revisada_at = now(), updated_at = now(),
         estado = CASE p_decision WHEN 'aprobada' THEN 'pendiente' WHEN 'rechazada' THEN 'cancelada' ELSE estado END,
         cerrada_at = CASE WHEN p_decision = 'rechazada' THEN now() ELSE cerrada_at END,
         cerrada_por = CASE WHEN p_decision = 'rechazada' THEN v_emp ELSE cerrada_por END
   WHERE id = p_id;
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (r.customer_id, 'receta', 'receta:' || r.id || ':' || p_decision || ':' || r.receta_fotos,
          CASE p_decision WHEN 'aprobada' THEN 'Tu receta fue aprobada'
                          WHEN 'otra_foto' THEN 'Necesitamos otra foto de tu receta'
                          ELSE 'Tu reserva no se pudo confirmar' END,
          CASE p_decision WHEN 'aprobada' THEN 'Tu reserva ' || v_codigo || ' de ' || r.producto_nombre || ' ya está confirmada.'
                          WHEN 'otra_foto' THEN v_motivo || '. Sube otra foto desde Mis reservas.'
                          ELSE v_motivo || '.' END,
          '/reservas')
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'RECETA_' || upper(p_decision), p_id::text, jsonb_build_object('motivo', v_motivo), r.branch_id, 'portal');
  RETURN json_build_object('ok', true, 'id', p_id, 'decision', p_decision);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.reserva_receta_decidir(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_receta_decidir(bigint, text, text) TO authenticated, service_role;

-- Aviso a la sala cuando entra una receta (o una foto nueva).
CREATE OR REPLACE FUNCTION public.app_reservas_avisar_receta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_dest uuid[];
BEGIN
  IF NEW.estado = 'en_revision' AND NEW.receta_estado = 'pendiente'
     AND NEW.receta_subida_at IS DISTINCT FROM OLD.receta_subida_at THEN
    SELECT array_agg(e.id) INTO v_dest FROM public.employees e
     WHERE e.status = 'ACTIVO' AND e.branch_id = NEW.branch_id
       AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.module_key = 'dash_reservas'
                   AND rp.can_view AND rp.role_id IN (e.role_id, e.secondary_role_id));
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RECETA_APP', 'Receta por revisar',
        NEW.producto_nombre || ' · ' || coalesce(NEW.pedido, 'R-' || lpad(NEW.id::text, 6, '0')) || '. Revísala antes de confirmar la reserva.',
        '/', jsonb_build_object('check_key', 'receta:' || NEW.id || ':' || NEW.receta_fotos, 'reserva_id', NEW.id), true, NEW.branch_id::int);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_reservas_avisar_receta() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS app_reservas_avisar_receta ON public.app_reservas;
CREATE TRIGGER app_reservas_avisar_receta AFTER INSERT OR UPDATE OF receta_subida_at ON public.app_reservas
  FOR EACH ROW EXECUTE FUNCTION public.app_reservas_avisar_receta();

-- 4 horas sin revisar → supervisión (rango ≥ 3), una sola vez por foto.
CREATE OR REPLACE FUNCTION public.recetas_escalar()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r record; v_dest uuid[]; v_n integer := 0;
BEGIN
  SELECT array_agg(e.id) INTO v_dest FROM public.employees e
   WHERE e.status = 'ACTIVO' AND public.rango_de_empleado(e.id) >= 3;
  FOR r IN
    SELECT a.id, a.branch_id, a.pedido, a.producto_nombre, a.receta_fotos, b.name AS sala, c.name AS cliente
      FROM public.app_reservas a
      JOIN public.branches b ON b.id = a.branch_id
      JOIN public.customers c ON c.id = a.customer_id
     WHERE a.estado = 'en_revision' AND a.receta_estado = 'pendiente'
       AND a.receta_subida_at < now() - interval '4 hours'
       AND (a.receta_escalada_at IS NULL OR a.receta_escalada_at < a.receta_subida_at)
     LIMIT 50
  LOOP
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RECETA_SIN_REVISAR', 'Receta sin verificar',
        r.sala || ' no ha verificado la receta de ' || r.cliente || ' (' || r.producto_nombre || ') desde hace más de 4 horas.',
        '/', jsonb_build_object('check_key', 'receta-escalada:' || r.id || ':' || r.receta_fotos, 'reserva_id', r.id), true, r.branch_id::int);
    END IF;
    UPDATE public.app_reservas SET receta_escalada_at = now() WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.recetas_escalar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recetas_escalar() TO service_role;

SELECT cron.schedule('recetas-escalar-15min', '*/15 * * * *', $$SELECT public.recetas_escalar()$$)
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recetas-escalar-15min');

-- La lista de la sala trae la receta (estado nuevo `en_revision` incluido).
CREATE OR REPLACE FUNCTION public.reservas_de_sucursal(p_branch_id bigint, p_abiertas boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_branch_id IS NULL THEN
    IF NOT public.auth_can_edit_any(ARRAY['ofertas_clientes']) THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT (p_branch_id = public.auth_employee_branch_id() OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', r.id, 'estado', r.estado, 'origen', r.origen, 'pedido', r.pedido,
      'documento', r.documento, 'datos_fiscales', r.datos_fiscales,
      'branch_id', r.branch_id, 'sala', b.name,
      'cliente', c.name, 'telefono', c.phone,
      'tiene_app', EXISTS (SELECT 1 FROM public.app_cliente_sesiones s
                            WHERE s.customer_id = r.customer_id AND s.revocada_at IS NULL
                              AND s.push_token IS NOT NULL AND s.acepta_avisos),
      'producto_id', r.producto_id, 'producto', r.producto_nombre, 'cantidad', r.cantidad,
      'precio', r.precio_unitario, 'precio_normal', r.precio_normal,
      'oferta', r.oferta_titulo, 'oferta_fin', r.oferta_fin,
      'creada', r.created_at, 'lista_at', r.lista_at, 'vence_at', r.vence_at,
      'avisado_via', r.avisado_via, 'avisado_at', r.avisado_at, 'cerrada_at', r.cerrada_at,
      'pago_estado', r.pago_estado, 'pago_metodo', r.pago_metodo, 'entrega', r.entrega,
      'direccion_entrega', r.direccion_entrega, 'costo_envio', r.costo_envio, 'anticipo', r.anticipo,
      'saldo_favor', r.saldo_favor, 'saldo_favor_vence', r.saldo_favor_vence,
      'receta_ruta', r.receta_ruta, 'receta_estado', r.receta_estado, 'receta_motivo', r.receta_motivo,
      'receta_subida_at', r.receta_subida_at, 'receta_fotos', r.receta_fotos,
      'receta_revisada_at', r.receta_revisada_at)
      ORDER BY (r.estado = 'en_revision') DESC, (r.estado = 'pendiente') DESC, (r.estado = 'lista') DESC, r.created_at DESC)
      FROM public.app_reservas r
      JOIN public.customers c ON c.id = r.customer_id
      JOIN public.branches b ON b.id = r.branch_id
     WHERE (p_branch_id IS NULL OR r.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertas THEN r.estado IN ('en_revision', 'pendiente', 'lista')
                   OR (coalesce(r.saldo_favor, 0) > 0 AND r.saldo_favor_usado_at IS NULL
                       AND r.saldo_favor_vence >= (now() AT TIME ZONE 'America/El_Salvador')::date)
                 ELSE r.created_at > now() - interval '30 days' END)), '[]'::json);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════
-- FOTO DE PERFIL
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.app_cliente_fotos (
  customer_id bigint PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  ruta        text NOT NULL,
  subida_at   timestamptz NOT NULL DEFAULT now(),
  quitada_por uuid REFERENCES public.employees(id),
  quitada_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_cliente_fotos ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_cliente_fotos_select ON public.app_cliente_fotos FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('chat_clientes', 'can_view')));
REVOKE ALL ON public.app_cliente_fotos FROM anon;

-- El equipo quita una foto que no corresponde; el cliente puede subir otra.
CREATE OR REPLACE FUNCTION public.cliente_foto_quitar(p_customer bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.auth_has_module_permission('chat_clientes', 'can_edit') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE public.app_cliente_fotos SET quitada_por = public.auth_employee_id(), quitada_at = now()
   WHERE customer_id = p_customer AND quitada_at IS NULL;
  RETURN json_build_object('ok', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.cliente_foto_quitar(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_foto_quitar(bigint) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- CHAT
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.app_chat_conversaciones (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id       bigint NOT NULL UNIQUE REFERENCES public.customers(id) ON DELETE CASCADE,
  estado            text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'resuelta')),
  tomada_por        uuid REFERENCES public.employees(id),
  tomada_at         timestamptz,
  ultimo_mensaje_at timestamptz NOT NULL DEFAULT now(),
  ultimo_de         text CHECK (ultimo_de IN ('cliente', 'equipo')),
  ultimo_texto      text,
  sin_leer_equipo   integer NOT NULL DEFAULT 0,
  sin_leer_cliente  integer NOT NULL DEFAULT 0,
  resuelta_por      uuid REFERENCES public.employees(id),
  resuelta_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_chat_conversaciones_bandeja_idx
  ON public.app_chat_conversaciones (estado, ultimo_mensaje_at DESC);

CREATE TABLE IF NOT EXISTS public.app_chat_mensajes (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversacion_id bigint NOT NULL REFERENCES public.app_chat_conversaciones(id) ON DELETE CASCADE,
  autor           text NOT NULL CHECK (autor IN ('cliente', 'equipo', 'sistema')),
  employee_id     uuid REFERENCES public.employees(id),
  texto           text CHECK (texto IS NULL OR length(texto) <= 2000),
  foto_ruta       text,
  adjunto         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (texto IS NOT NULL OR foto_ruta IS NOT NULL OR adjunto IS NOT NULL),
  CHECK (autor <> 'equipo' OR employee_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS app_chat_mensajes_conv_idx ON public.app_chat_mensajes (conversacion_id, id DESC);
CREATE INDEX IF NOT EXISTS app_chat_mensajes_employee_idx ON public.app_chat_mensajes (employee_id) WHERE employee_id IS NOT NULL;

-- Respuestas rápidas guardadas, compartidas por todo el equipo.
CREATE TABLE IF NOT EXISTS public.app_chat_respuestas (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo     text NOT NULL CHECK (length(titulo) <= 60),
  texto      text NOT NULL CHECK (length(texto) <= 1000),
  creada_por uuid REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_chat_conversaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_chat_mensajes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_chat_respuestas ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_chat_conversaciones_select ON public.app_chat_conversaciones FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('chat_clientes', 'can_view')));
CREATE POLICY app_chat_mensajes_select ON public.app_chat_mensajes FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('chat_clientes', 'can_view')));
CREATE POLICY app_chat_respuestas_select ON public.app_chat_respuestas FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('chat_clientes', 'can_view')));
CREATE POLICY app_chat_respuestas_insert ON public.app_chat_respuestas FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.auth_has_module_permission('chat_clientes', 'can_edit')) AND creada_por = (SELECT public.auth_employee_id()));
CREATE POLICY app_chat_respuestas_delete ON public.app_chat_respuestas FOR DELETE TO authenticated
  USING ((SELECT public.auth_has_module_permission('chat_clientes', 'can_edit')));
REVOKE ALL ON public.app_chat_conversaciones, public.app_chat_mensajes, public.app_chat_respuestas FROM anon;

-- El portal escucha en vivo.
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_chat_conversaciones, public.app_chat_mensajes;

-- Cada mensaje actualiza la conversación y, si es del cliente, avisa al
-- equipo (sólo cuando pasa de leída a sin leer: no un push por mensaje).
CREATE OR REPLACE FUNCTION public.app_chat_mensaje_nuevo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_antes integer; v_cliente text; v_dest uuid[]; v_customer bigint;
BEGIN
  IF NEW.autor = 'cliente' THEN
    SELECT sin_leer_equipo, customer_id INTO v_antes, v_customer FROM public.app_chat_conversaciones WHERE id = NEW.conversacion_id;
    UPDATE public.app_chat_conversaciones
       SET ultimo_mensaje_at = NEW.created_at, ultimo_de = 'cliente',
           ultimo_texto = coalesce(left(NEW.texto, 140), 'Foto'),
           sin_leer_equipo = sin_leer_equipo + 1,
           estado = 'abierta', resuelta_at = NULL, resuelta_por = NULL
     WHERE id = NEW.conversacion_id;
    IF coalesce(v_antes, 0) = 0 THEN
      SELECT name INTO v_cliente FROM public.customers WHERE id = v_customer;
      SELECT array_agg(e.id) INTO v_dest FROM public.employees e
       WHERE e.status = 'ACTIVO'
         AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.module_key = 'chat_clientes'
                     AND rp.can_view AND rp.role_id IN (e.role_id, e.secondary_role_id));
      IF v_dest IS NOT NULL THEN
        PERFORM public.notify_employees(v_dest, 'CHAT_CLIENTE', 'Mensaje de ' || coalesce(v_cliente, 'un cliente'),
          coalesce(left(NEW.texto, 140), 'Envió una foto'), '/chat-clientes',
          jsonb_build_object('conversacion_id', NEW.conversacion_id), true, NULL);
      END IF;
    END IF;
  ELSIF NEW.autor = 'equipo' THEN
    UPDATE public.app_chat_conversaciones
       SET ultimo_mensaje_at = NEW.created_at, ultimo_de = 'equipo',
           ultimo_texto = coalesce(left(NEW.texto, 140), CASE WHEN NEW.adjunto IS NOT NULL THEN 'Producto' ELSE 'Foto' END),
           sin_leer_equipo = 0, sin_leer_cliente = sin_leer_cliente + 1,
           tomada_por = NEW.employee_id, tomada_at = NEW.created_at
     WHERE id = NEW.conversacion_id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_chat_mensaje_nuevo() FROM PUBLIC, anon;
CREATE TRIGGER app_chat_mensaje_nuevo AFTER INSERT ON public.app_chat_mensajes
  FOR EACH ROW EXECUTE FUNCTION public.app_chat_mensaje_nuevo();

-- La bandeja del portal: con tipo de cliente, nivel y foto.
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
REVOKE EXECUTE ON FUNCTION public.chat_conversaciones(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_conversaciones(text, timestamptz) TO authenticated, service_role;

-- Tomar (o soltar) una conversación: «Ana está respondiendo…». Vence a los 10 min.
CREATE OR REPLACE FUNCTION public.chat_tomar(p_conversacion bigint, p_soltar boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_emp uuid := public.auth_employee_id();
BEGIN
  IF NOT public.auth_has_module_permission('chat_clientes', 'can_edit') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_soltar THEN
    UPDATE public.app_chat_conversaciones SET tomada_por = NULL, tomada_at = NULL
     WHERE id = p_conversacion AND tomada_por = v_emp;
  ELSE
    UPDATE public.app_chat_conversaciones SET tomada_por = v_emp, tomada_at = now(), sin_leer_equipo = 0
     WHERE id = p_conversacion
       AND (tomada_por IS NULL OR tomada_por = v_emp OR tomada_at < now() - interval '10 minutes');
  END IF;
  RETURN json_build_object('ok', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chat_tomar(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_tomar(bigint, boolean) TO authenticated, service_role;

-- Responder: texto, foto (ruta ya subida al bucket) o un producto/oferta.
CREATE OR REPLACE FUNCTION public.chat_responder(p_conversacion bigint, p_texto text, p_foto_ruta text DEFAULT NULL, p_adjunto jsonb DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_emp uuid := public.auth_employee_id(); v_id bigint; v_customer bigint; v_nombre text;
BEGIN
  IF NOT public.auth_has_module_permission('chat_clientes', 'can_edit') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_foto_ruta IS NOT NULL AND p_foto_ruta !~ ('^chat/[0-9]+/') THEN RAISE EXCEPTION 'RUTA_INVALIDA'; END IF;
  SELECT customer_id INTO v_customer FROM public.app_chat_conversaciones WHERE id = p_conversacion;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  INSERT INTO public.app_chat_mensajes (conversacion_id, autor, employee_id, texto, foto_ruta, adjunto)
  VALUES (p_conversacion, 'equipo', v_emp, nullif(btrim(coalesce(p_texto, '')), ''), p_foto_ruta, p_adjunto)
  RETURNING id INTO v_id;
  SELECT split_part(name, ' ', 1) INTO v_nombre FROM public.employees WHERE id = v_emp;
  -- Push al cliente: pasa por la bandeja de avisos (tipo `chat`, la app no
  -- lo lista en Notificaciones).
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (v_customer, 'chat', 'chat:' || v_id, coalesce(v_nombre, 'Farmacia Salud') || ' te respondió',
          coalesce(left(nullif(btrim(coalesce(p_texto, '')), ''), 140), 'Te envió algo en el chat.'), '/chat')
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  RETURN json_build_object('ok', true, 'id', v_id);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chat_responder(bigint, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_responder(bigint, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_resolver(p_conversacion bigint)
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
     SET estado = 'resuelta', resuelta_por = public.auth_employee_id(), resuelta_at = now(),
         tomada_por = NULL, tomada_at = NULL, sin_leer_equipo = 0
   WHERE id = p_conversacion;
  RETURN json_build_object('ok', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chat_resolver(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_resolver(bigint) TO authenticated, service_role;

-- ── Storage: lectura del portal por carpeta; escribe sólo el servidor ─────
CREATE POLICY app_clientes_archivos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'app-clientes-archivos' AND (
    ((storage.foldername(name))[1] = 'recetas'
       AND (storage.foldername(name))[2] ~ '^[0-9]+$'
       AND public.reserva_puede_manejar(((storage.foldername(name))[2])::bigint))
    OR ((storage.foldername(name))[1] IN ('chat', 'perfil')
       AND (SELECT public.auth_has_module_permission('chat_clientes', 'can_view')))));
-- El equipo sube fotos al chat (carpeta `chat/<cliente>/equipo/…`).
CREATE POLICY app_clientes_archivos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'app-clientes-archivos'
    AND (storage.foldername(name))[1] = 'chat'
    AND (SELECT public.auth_has_module_permission('chat_clientes', 'can_edit')));
