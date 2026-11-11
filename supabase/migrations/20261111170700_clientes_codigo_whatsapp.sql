-- App de clientes: código por WhatsApp al entrar desde un teléfono nuevo
-- (2026-11-11). Se instala APAGADO: el interruptor es la fila
-- `clientes_codigo_whatsapp` de security_config, en 'observar' (anota los
-- teléfonos de cada cliente, no pide nada). Con 'exigir' —y las llaves de
-- WhatsApp cargadas en la edge function— un teléfono que el cliente nunca usó
-- recibe un código antes de abrir la sesión. Lo usa sólo `app-clientes`
-- (service_role); el portal puede leerlo con el permiso de Clientes.
SET lock_timeout = '5s';

-- Los teléfonos desde los que ya entró cada cliente. `dispositivo_id` es el id
-- ALEATORIO que la app inventa la primera vez (apps/clientes/lib/dispositivo.js),
-- no un dato del aparato.
CREATE TABLE IF NOT EXISTS public.app_cliente_dispositivos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  dispositivo_id text NOT NULL CHECK (dispositivo_id ~ '^[a-z0-9]{16,64}$'),
  modelo text,
  plataforma text,
  verificado_por text NOT NULL DEFAULT 'conocido' CHECK (verificado_por IN ('conocido', 'whatsapp')),
  ultimo_uso_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, dispositivo_id)
);
-- La FK la cubre el UNIQUE (customer_id primero).

-- Los códigos enviados. Se guarda la huella, nunca el código. Vida corta: la
-- edge function borra los de más de un día cada vez que manda uno nuevo.
CREATE TABLE IF NOT EXISTS public.app_cliente_codigos_entrada (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  dispositivo_id text NOT NULL,
  codigo_hash text NOT NULL,
  intentos smallint NOT NULL DEFAULT 0,
  vence_at timestamptz NOT NULL,
  usado_at timestamptz,
  -- Lo que se hace al verificar (p. ej. los permisos de quien se registró con
  -- una ficha que ya existía): `{ "promociones": true|false }`.
  al_verificar jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_cliente_codigos_entrada_customer_idx
  ON public.app_cliente_codigos_entrada (customer_id, created_at);
CREATE INDEX IF NOT EXISTS app_cliente_codigos_entrada_created_idx
  ON public.app_cliente_codigos_entrada (created_at);

ALTER TABLE public.app_cliente_dispositivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_cliente_codigos_entrada ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.app_cliente_dispositivos FROM anon, authenticated;
REVOKE ALL ON public.app_cliente_codigos_entrada FROM anon, authenticated;
GRANT SELECT ON public.app_cliente_dispositivos TO authenticated;

DROP POLICY IF EXISTS app_cliente_dispositivos_select ON public.app_cliente_dispositivos;
CREATE POLICY app_cliente_dispositivos_select ON public.app_cliente_dispositivos
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('clientes', 'can_view')));

-- Los códigos no los lee nadie fuera de la edge function.
DROP POLICY IF EXISTS app_cliente_codigos_entrada_servicio ON public.app_cliente_codigos_entrada;
CREATE POLICY app_cliente_codigos_entrada_servicio ON public.app_cliente_codigos_entrada
  FOR SELECT TO service_role USING (true);

-- Un intento contra un código: lo cuenta ANTES de que la edge function
-- compare, y en una sola sentencia, así cinco intentos son cinco aunque
-- lleguen en paralelo. Sin fila = vencido, usado, agotado o de otro teléfono.
CREATE OR REPLACE FUNCTION public.app_cliente_codigo_intento(p_id uuid, p_dispositivo text)
RETURNS TABLE (customer_id bigint, codigo_hash text, intentos smallint, al_verificar jsonb)
LANGUAGE sql
SET search_path = public, extensions
AS $$
  UPDATE public.app_cliente_codigos_entrada c
     SET intentos = c.intentos + 1
   WHERE c.id = p_id
     AND c.dispositivo_id = p_dispositivo
     AND c.usado_at IS NULL
     AND c.vence_at > now()
     AND c.intentos < 5
  RETURNING c.customer_id, c.codigo_hash, c.intentos, c.al_verificar;
$$;
REVOKE EXECUTE ON FUNCTION public.app_cliente_codigo_intento(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_cliente_codigo_intento(uuid, text) TO service_role;

INSERT INTO public.security_config (key, estado, nota)
VALUES ('clientes_codigo_whatsapp', 'observar',
  'App de clientes: código por WhatsApp al entrar desde un teléfono nuevo. observar = sólo anota los teléfonos; exigir = pide el código (además hacen falta WHATSAPP_TOKEN, WHATSAPP_PHONE_ID y WHATSAPP_PLANTILLA en la edge function).')
ON CONFLICT (key) DO NOTHING;
