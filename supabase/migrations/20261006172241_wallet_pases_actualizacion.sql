-- La tarjeta de Wallet que se actualiza sola (2026-10-06, pedido del usuario).
--
-- Al agregar la tarjeta, el iPhone se registra en `wallet-pases` (servicio web
-- de PassKit): una fila acá por teléfono y tarjeta. Cuando cambian los puntos
-- de esa ficha (`puntos_cuenta.updated_at`), `wallet-pases` le avisa a Apple y
-- el iPhone baja la tarjeta nueva. `notificado_at` es hasta dónde ya se avisó.
SET lock_timeout = '5s';

CREATE TABLE public.wallet_registros (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dispositivo         text NOT NULL,
    push_token          text NOT NULL,
    serial              text NOT NULL,
    customer_id         bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    notificado_at       timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (dispositivo, serial)
);
CREATE INDEX wallet_registros_customer_idx ON public.wallet_registros (customer_id);

ALTER TABLE public.wallet_registros ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_registros_select ON public.wallet_registros
    FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('clientes', 'can_view')));
REVOKE ALL ON public.wallet_registros FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wallet_registros TO authenticated;
GRANT ALL ON public.wallet_registros TO service_role;

-- Las tarjetas a avisar: su saldo cambió después del último aviso.
CREATE OR REPLACE FUNCTION public.wallet_registros_por_avisar()
 RETURNS TABLE (id bigint, push_token text, cambio_at timestamptz)
 LANGUAGE sql STABLE
 SET search_path = public, extensions
AS $$
  SELECT w.id, w.push_token, c.updated_at
    FROM public.wallet_registros w
    JOIN public.puntos_cuenta c ON c.customer_id = w.customer_id
   WHERE c.updated_at > w.notificado_at
   LIMIT 500;
$$;
REVOKE EXECUTE ON FUNCTION public.wallet_registros_por_avisar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_registros_por_avisar() TO service_role;

SELECT cron.schedule('wallet-pases-minuto', '* * * * *', $cron$
  SELECT net.http_post(
    url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/wallet-pases/avisar',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_invoke_secret')),
    timeout_milliseconds := 50000)
  WHERE EXISTS (SELECT 1 FROM public.wallet_registros)
$cron$);
