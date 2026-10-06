-- Reservas de la app de clientes (2026-10-06, plan de la siguiente fase).
--
-- Por ahora SÓLO productos de ofertas activas (decisión del usuario); el
-- catálogo completo y la reserva en sucursal con anticipo vienen después, y
-- la tabla ya tiene sus columnas (`origen`, `anticipo`, `constancia_url`).
--
-- Reglas (las ve el cliente antes de su primera reserva y se guardan con la
-- versión que aceptó):
--   · 24 h para retirar desde que la sucursal la marca «lista»;
--   · máximo 3 reservas activas por cliente; hasta 5 unidades por producto;
--   · el precio de oferta vale si se retira dentro de las fechas de la oferta;
--   · bajo receta no se reserva;
--   · 3 reservas vencidas en 30 días bloquean reservar por 30 días.
--
-- Estados: pendiente (la pidió) → lista (la sucursal la apartó; empieza el
-- plazo y la app avisa) → retirada | vencida | cancelada.
--
-- La sucursal la maneja SOLO por las funciones de abajo (SECURITY DEFINER con
-- su propia guarda): cualquier dependiente de ESA sucursal, o quien tenga el
-- módulo de ofertas para clientes. Nada de UPDATE directo desde el portal.
SET lock_timeout = '5s';

CREATE TABLE public.app_reservas (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id       bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    branch_id         bigint NOT NULL REFERENCES public.branches(id),
    origen            text NOT NULL DEFAULT 'app' CHECK (origen IN ('app', 'sucursal')),
    oferta_id         uuid REFERENCES public.ofertas_clientes(id) ON DELETE SET NULL,
    oferta_titulo     text,
    oferta_fin        date,
    producto_id       bigint NOT NULL,
    producto_nombre   text NOT NULL,
    cantidad          integer NOT NULL CHECK (cantidad BETWEEN 1 AND 5),
    precio_unitario   numeric(10,2),
    precio_normal     numeric(10,2),
    estado            text NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente', 'lista', 'retirada', 'vencida', 'cancelada')),
    terminos_version  text NOT NULL,
    anticipo          numeric(10,2) NOT NULL DEFAULT 0,
    constancia_url    text,
    lista_at          timestamptz,
    vence_at          timestamptz,
    cerrada_at        timestamptz,
    cerrada_por       uuid,
    preparada_por     uuid,
    avisado_via       text CHECK (avisado_via IN ('app', 'whatsapp')),
    avisado_por       uuid,
    avisado_at        timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_reservas_sucursal_idx ON public.app_reservas (branch_id, estado);
CREATE INDEX app_reservas_cliente_idx ON public.app_reservas (customer_id, estado);
CREATE INDEX app_reservas_oferta_idx ON public.app_reservas (oferta_id);

ALTER TABLE public.app_reservas ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_reservas_select ON public.app_reservas
    FOR SELECT TO authenticated
    USING (branch_id = (SELECT public.auth_employee_branch_id())
           OR (SELECT public.auth_has_module_permission('ofertas_clientes', 'can_view')));
REVOKE ALL ON public.app_reservas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_reservas TO authenticated;
GRANT ALL ON public.app_reservas TO service_role;

-- ¿Puede esta persona del portal manejar las reservas de esa sucursal?
CREATE OR REPLACE FUNCTION public.reserva_puede_manejar(p_branch_id bigint)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $$
  SELECT p_branch_id = public.auth_employee_branch_id()
      OR public.auth_can_edit_any(ARRAY['ofertas_clientes']);
$$;
REVOKE EXECUTE ON FUNCTION public.reserva_puede_manejar(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_puede_manejar(bigint) TO authenticated, service_role;

-- Las reservas de una sucursal, con lo que el dependiente necesita para
-- apartar y avisar: nombre corto del cliente, teléfono y si tiene la app con
-- avisos (si no, el portal ofrece el mensaje de WhatsApp).
CREATE OR REPLACE FUNCTION public.reservas_de_sucursal(p_branch_id bigint, p_abiertas boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.reserva_puede_manejar(p_branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', r.id, 'estado', r.estado, 'origen', r.origen,
      'cliente', c.name, 'telefono', c.phone,
      'tiene_app', EXISTS (SELECT 1 FROM public.app_cliente_sesiones s
                            WHERE s.customer_id = r.customer_id AND s.revocada_at IS NULL
                              AND s.push_token IS NOT NULL AND s.acepta_avisos),
      'producto_id', r.producto_id, 'producto', r.producto_nombre, 'cantidad', r.cantidad,
      'precio', r.precio_unitario, 'precio_normal', r.precio_normal,
      'oferta', r.oferta_titulo, 'oferta_fin', r.oferta_fin,
      'creada', r.created_at, 'lista_at', r.lista_at, 'vence_at', r.vence_at,
      'avisado_via', r.avisado_via, 'avisado_at', r.avisado_at, 'cerrada_at', r.cerrada_at)
      ORDER BY (r.estado = 'pendiente') DESC, r.created_at)
      FROM public.app_reservas r
      JOIN public.customers c ON c.id = r.customer_id
     WHERE r.branch_id = p_branch_id
       AND (CASE WHEN p_abiertas THEN r.estado IN ('pendiente', 'lista')
                 ELSE r.created_at > now() - interval '30 days' END)
     LIMIT 300), '[]'::json);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reservas_de_sucursal(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservas_de_sucursal(bigint, boolean) TO authenticated, service_role;

-- Mover una reserva. Transiciones válidas:
--   pendiente → lista      (apartada: empieza el plazo de 24 h; la app avisa)
--   lista     → retirada   (la pagó y se la llevó)
--   pendiente | lista → cancelada (con motivo)
CREATE OR REPLACE FUNCTION public.reserva_cambiar_estado(p_id bigint, p_estado text, p_motivo text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  r public.app_reservas;
  v_emp uuid := public.auth_employee_id();
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_estado = 'lista' AND r.estado = 'pendiente' THEN
    UPDATE public.app_reservas SET estado = 'lista', lista_at = now(), vence_at = now() + interval '24 hours',
           preparada_por = v_emp, updated_at = now() WHERE id = p_id;
  ELSIF p_estado = 'retirada' AND r.estado = 'lista' THEN
    UPDATE public.app_reservas SET estado = 'retirada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now() WHERE id = p_id;
  ELSIF p_estado = 'cancelada' AND r.estado IN ('pendiente', 'lista') THEN
    UPDATE public.app_reservas SET estado = 'cancelada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', r.estado, p_estado;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'RESERVA_' || upper(p_estado), p_id::text,
          jsonb_build_object('antes', r.estado, 'motivo', p_motivo), r.branch_id, 'portal');
  RETURN json_build_object('ok', true, 'id', p_id, 'estado', p_estado);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserva_cambiar_estado(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_cambiar_estado(bigint, text, text) TO authenticated, service_role;

-- El dependiente avisó por WhatsApp (cliente sin la app): queda quién y cuándo.
CREATE OR REPLACE FUNCTION public.reserva_avisada_whatsapp(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE v_branch bigint;
BEGIN
  SELECT branch_id INTO v_branch FROM public.app_reservas WHERE id = p_id;
  IF v_branch IS NULL OR NOT public.reserva_puede_manejar(v_branch) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE public.app_reservas SET avisado_via = 'whatsapp', avisado_por = public.auth_employee_id(),
         avisado_at = now(), updated_at = now() WHERE id = p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserva_avisada_whatsapp(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_avisada_whatsapp(bigint) TO authenticated, service_role;

-- Vencer: lista con el plazo cumplido, o pendiente cuya oferta ya terminó.
CREATE OR REPLACE FUNCTION public.reservas_vencer()
 RETURNS integer
 LANGUAGE sql SECURITY DEFINER
 SET search_path = public, extensions
AS $$
  WITH v AS (
    UPDATE public.app_reservas SET estado = 'vencida', cerrada_at = now(), updated_at = now()
     WHERE (estado = 'lista' AND vence_at < now())
        OR (estado = 'pendiente' AND oferta_fin IS NOT NULL
            AND oferta_fin < (now() AT TIME ZONE 'America/El_Salvador')::date)
    RETURNING 1)
  SELECT count(*)::int FROM v;
$$;
REVOKE EXECUTE ON FUNCTION public.reservas_vencer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservas_vencer() TO service_role;

SELECT cron.schedule('reservas-vencer-15min', '*/15 * * * *', $$SELECT public.reservas_vencer()$$);
