-- Las tarjetas de Puntos Salud guardadas en GOOGLE WALLET (2026-11-24).
--
-- Antes `wallet-pases /avisar` le hacía PATCH a Google por CADA cuenta cuyo
-- saldo cambió en los últimos 2 minutos —con el cron cada minuto, dos veces por
-- cambio— aunque esa persona nunca hubiera guardado la tarjeta (Google contesta
-- 404). Medido: 1,436 llamadas/día, 987 ms de promedio, ~770 tarjetas armadas
-- al día casi todas para recibir un 404.
--
-- Ahora: una fila por ficha que tiene (o puede tener) la tarjeta en Google.
-- Entra cuando la app pide el enlace «Agregar a Google Wallet» y cuando el
-- barrido diario (`/reconciliar-google`) la encuentra en la lista de objetos
-- que Google tiene de este emisor —la verdad de quién la guardó—.
-- `notificado_at` es hasta dónde ya se avisó, como `wallet_registros` (Apple):
-- cada cambio se manda una sola vez.
SET lock_timeout = '5s';

CREATE TABLE public.wallet_google_tarjetas (
    customer_id    bigint PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
    created_at     timestamptz NOT NULL DEFAULT now(),
    notificado_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_google_tarjetas ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_google_tarjetas_select ON public.wallet_google_tarjetas
    FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('clientes', 'can_view')));
REVOKE ALL ON public.wallet_google_tarjetas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wallet_google_tarjetas TO authenticated;
GRANT ALL ON public.wallet_google_tarjetas TO service_role;

-- Las tarjetas a avisar: su saldo cambió después del último aviso. Recorre la
-- tabla chica y entra a puntos_cuenta por su llave (sin barrer las 15 mil).
CREATE OR REPLACE FUNCTION public.wallet_google_por_avisar()
 RETURNS TABLE (customer_id bigint, cambio_at timestamptz, created_at timestamptz)
 LANGUAGE sql STABLE
 SET search_path = public, extensions
AS $$
  SELECT g.customer_id, c.updated_at, g.created_at
    FROM public.wallet_google_tarjetas g
    JOIN public.puntos_cuenta c ON c.customer_id = g.customer_id
   WHERE c.updated_at > g.notificado_at
   ORDER BY c.updated_at
   LIMIT 500;
$$;
REVOKE EXECUTE ON FUNCTION public.wallet_google_por_avisar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_google_por_avisar() TO service_role;

-- El barrido: las fichas que Google dice tener. Entran las que faltan (las que
-- existen como ficha) con `notificado_at` 15 minutos atrás, para que el
-- próximo aviso repase lo que haya cambiado mientras no estaban (repetir el
-- PATCH no cambia nada). Con `p_completo`, la lista de Google es la verdad:
-- sale la fila de quien pidió el enlace hace más de un día y nunca la guardó.
CREATE OR REPLACE FUNCTION public.wallet_google_sembrar(p_ids bigint[], p_completo boolean)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path = public, extensions
AS $$
DECLARE
  v_nuevas int := 0;
  v_fuera int := 0;
BEGIN
  INSERT INTO public.wallet_google_tarjetas (customer_id, notificado_at)
  SELECT c.id, now() - interval '15 minutes'
    FROM public.customers c
   WHERE c.id = ANY (coalesce(p_ids, '{}'))
  ON CONFLICT (customer_id) DO NOTHING;
  GET DIAGNOSTICS v_nuevas = ROW_COUNT;

  IF p_completo THEN
    DELETE FROM public.wallet_google_tarjetas g
     WHERE g.created_at < now() - interval '1 day'
       AND NOT (g.customer_id = ANY (coalesce(p_ids, '{}')));
    GET DIAGNOSTICS v_fuera = ROW_COUNT;
  END IF;

  RETURN json_build_object('en_google', coalesce(cardinality(p_ids), 0), 'nuevas', v_nuevas, 'fuera', v_fuera,
                           'total', (SELECT count(*) FROM public.wallet_google_tarjetas));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.wallet_google_sembrar(bigint[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_google_sembrar(bigint[], boolean) TO service_role;
