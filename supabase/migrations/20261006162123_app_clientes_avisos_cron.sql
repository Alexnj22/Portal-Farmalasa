-- Avisos al teléfono de los clientes (2026-10-06): las inyecciones a recordar
-- y el cron que dispara `avisos-clientes` cada 15 min de 8:00 a 20:00 SV.
SET lock_timeout = '5s';

-- Pagadas hace entre 3 y 5 días y todavía sin aplicar (la ventana es más ancha
-- que un día por si una vuelta falla; la bitácora impide repetir).
CREATE OR REPLACE FUNCTION public.app_cliente_inyecciones_por_recordar(p_clientes bigint[])
 RETURNS TABLE (id bigint, customer_id bigint, producto text, sala text)
 LANGUAGE sql STABLE
 SET search_path = public, extensions
AS $$
  SELECT a.id, a.customer_id, a.producto, b.name
    FROM public.inyeccion_aplicaciones a
    JOIN public.caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
    JOIN public.branches b ON b.id = a.branch_id
   WHERE a.customer_id = ANY (p_clientes)
     AND a.confirmada AND a.aplicada_at IS NULL AND a.mezcla_de IS NULL
     AND c.registrado_at BETWEEN now() - interval '5 days' AND now() - interval '3 days'
   LIMIT 500;
$$;
REVOKE EXECUTE ON FUNCTION public.app_cliente_inyecciones_por_recordar(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_cliente_inyecciones_por_recordar(bigint[]) TO service_role;

SELECT cron.schedule('avisos-clientes-15min', '*/15 14-23,0-1 * * *', $cron$
  SELECT net.http_post(
    url := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/avisos-clientes',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_invoke_secret')),
    timeout_milliseconds := 60000)
$cron$);
