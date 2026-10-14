-- app_cliente_aceptaciones (2026-10-14): la aceptación del Reglamento de Puntos
-- Salud y del Aviso de privacidad que la app pide en el primer inicio
-- (apps/clientes/app/guia.js, página «Reglas y privacidad»; pedido del
-- usuario: no se puede continuar sin marcar como leído). Una fila por
-- documento aceptado, con su versión. La escribe SÓLO la edge function
-- app-clientes (service_role, acción `aceptar_documentos`); el portal la lee
-- con el módulo 'clientes'. Append-only: sin policies de escritura.
SET lock_timeout = '5s';

CREATE TABLE public.app_cliente_aceptaciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    bigint REFERENCES public.customers(id) ON DELETE CASCADE,
  preregistro_id uuid REFERENCES public.app_cliente_preregistros(id) ON DELETE CASCADE,
  sesion_id      uuid REFERENCES public.app_cliente_sesiones(id) ON DELETE SET NULL,
  documento      text NOT NULL CHECK (documento IN ('reglamento', 'aviso')),
  version        text NOT NULL,
  plataforma     text CHECK (plataforma IN ('ios', 'android', 'web')),
  version_app    text,
  aceptado_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_cliente_aceptaciones_quien CHECK (customer_id IS NOT NULL OR preregistro_id IS NOT NULL)
);

CREATE INDEX app_cliente_aceptaciones_customer_idx ON public.app_cliente_aceptaciones (customer_id, documento, version);
CREATE INDEX app_cliente_aceptaciones_preregistro_idx ON public.app_cliente_aceptaciones (preregistro_id);
CREATE INDEX app_cliente_aceptaciones_sesion_idx ON public.app_cliente_aceptaciones (sesion_id);

ALTER TABLE public.app_cliente_aceptaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_cliente_aceptaciones_select ON public.app_cliente_aceptaciones
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('clientes'::text, 'can_view'::text)));

REVOKE ALL ON public.app_cliente_aceptaciones FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.app_cliente_aceptaciones FROM authenticated;
GRANT SELECT ON public.app_cliente_aceptaciones TO authenticated;
GRANT ALL ON public.app_cliente_aceptaciones TO service_role;

COMMENT ON TABLE public.app_cliente_aceptaciones IS
  'Aceptación del Reglamento de Puntos Salud y del Aviso de privacidad desde la app (primer inicio). Una fila por documento y versión. Escribe sólo app-clientes.';
