SET lock_timeout = '5s';
-- Mis facturas por correo (app de clientes, 2026-10-09). Sin acceso directo del
-- cliente: todo pasa por la edge function `app-clientes` (service_role). La única
-- policy es de LECTURA para el personal con el módulo «clientes».
-- Retención de envíos: 365 días, la purga la hace la función al registrar uno nuevo.
CREATE TABLE IF NOT EXISTS public.app_cliente_correos (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  correo      text   NOT NULL CHECK (correo = lower(btrim(correo)) AND correo ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' AND length(correo) <= 254),
  usado_at    timestamptz NOT NULL DEFAULT now(),
  veces       integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, correo)
);
ALTER TABLE public.app_cliente_correos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_cliente_correos_select ON public.app_cliente_correos;
CREATE POLICY app_cliente_correos_select ON public.app_cliente_correos
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('clientes', 'can_view')));
REVOKE ALL ON public.app_cliente_correos FROM anon;

CREATE TABLE IF NOT EXISTS public.app_cliente_correo_envios (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id  bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  correo       text   NOT NULL,
  facturas     text[] NOT NULL,
  cantidad     integer NOT NULL,
  modo         text   NOT NULL CHECK (modo IN ('adjuntos', 'enlaces')),
  enviado      boolean NOT NULL DEFAULT false,
  error        text,
  proveedor_id text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_cliente_correo_envios_cliente_idx
  ON public.app_cliente_correo_envios (customer_id, created_at DESC);
ALTER TABLE public.app_cliente_correo_envios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_cliente_correo_envios_select ON public.app_cliente_correo_envios;
CREATE POLICY app_cliente_correo_envios_select ON public.app_cliente_correo_envios
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('clientes', 'can_view')));
REVOKE ALL ON public.app_cliente_correo_envios FROM anon;
