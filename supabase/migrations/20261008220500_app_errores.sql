SET lock_timeout = '5s';
-- Errores de la app de clientes (2026-10-08): mientras no haya cuenta de
-- Sentry, la app manda sus errores aquí (por `app-clientes`, acción
-- `reportar_error`). El cierre de la compilación 28 se encontró
-- reproduciéndolo en el simulador; con esto habría llegado solo.
CREATE TABLE IF NOT EXISTS public.app_errores (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  customer_id bigint REFERENCES public.customers(id) ON DELETE SET NULL,
  fatal boolean NOT NULL DEFAULT false,
  mensaje text NOT NULL CHECK (length(mensaje) <= 1000),
  pila text CHECK (length(pila) <= 8000),
  pantalla text CHECK (length(pantalla) <= 200),
  version text CHECK (length(version) <= 40),
  compilacion text CHECK (length(compilacion) <= 40),
  plataforma text CHECK (length(plataforma) <= 20),
  dispositivo text CHECK (length(dispositivo) <= 120)
);
CREATE INDEX IF NOT EXISTS app_errores_fecha ON public.app_errores (created_at DESC);
CREATE INDEX IF NOT EXISTS app_errores_cliente ON public.app_errores (customer_id);
ALTER TABLE public.app_errores ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_errores_ver ON public.app_errores FOR SELECT TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])));

-- Retención: 90 días (regla 7 de tablas de log).
SELECT cron.schedule('purge-app-errores-diario', '20 9 * * *',
  $c$DELETE FROM public.app_errores WHERE created_at < now() - interval '90 days'$c$)
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-app-errores-diario');
