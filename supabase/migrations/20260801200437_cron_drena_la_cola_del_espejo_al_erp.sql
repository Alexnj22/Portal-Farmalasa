SET lock_timeout = '5s';

-- ══════════════════════════════════════════════════════════════════════════
-- La red bajo el empuje inmediato.
--
-- Desde v2.329.0 el portal manda la edición al ERP apenas se guarda. Pero eso
-- es una OPTIMIZACIÓN, no una garantía: si el ERP está caído en ese momento, la
-- entrada queda pendiente y —hasta ahora— se quedaba así para siempre si nadie
-- volvía a editar esa ficha. El cron es lo que cierra ese hueco.
-- ══════════════════════════════════════════════════════════════════════════

-- `marcar_empujado_al_erp` exigía permiso de módulo sobre clientes, que se
-- resuelve por el empleado detrás del uid. Un cron no tiene usuario, así que
-- hay que aceptar a service_role explícitamente. No se afloja nada más: sigue
-- siendo la única forma de saldar la cola, y solo la puede llamar quien tiene
-- permiso sobre clientes o el propio backend.
CREATE OR REPLACE FUNCTION public.marcar_empujado_al_erp(p_ids bigint[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_n integer;
  v_rol text := coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '');
BEGIN
  IF v_rol <> 'service_role'
     AND NOT (SELECT public.auth_can_edit_any(ARRAY['clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- Solo las que siguen pendientes: marcar dos veces no reescribe la fecha del
  -- primer empuje, que es el dato que dice cuándo llegó al ERP de verdad.
  UPDATE public.customers_changelog
     SET erp_synced_at = now()
   WHERE id = ANY(p_ids) AND erp_synced_at IS NULL;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN json_build_object('marcadas', v_n);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.marcar_empujado_al_erp(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_empujado_al_erp(bigint[]) TO authenticated, service_role;


-- ── El cron ───────────────────────────────────────────────────────────────
-- Cada 10 minutos. La cola normalmente está VACÍA, así que la corrida típica es
-- una sola consulta que no encuentra nada — barato. Cuando hay algo, drena de a
-- 5 fichas por pasada (el ERP tarda ~3 peticiones por ficha y la función tiene
-- techo de tiempo); a 6 pasadas por hora eso son 30 fichas/hora, de sobra para
-- una cola que se llena solo cuando el ERP estuvo caído.
--
-- Minuto 3 y no 0: a las en punto ya corren otros jobs, y 13 al mismo horario
-- agotaron los slots de conexión una vez.
SELECT cron.unschedule('drain-cliente-erp-queue')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drain-cliente-erp-queue');

SELECT cron.schedule(
  'drain-cliente-erp-queue',
  '3,13,23,33,43,53 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/push-cliente-erp',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || (SELECT decrypted_secret
                                               FROM vault.decrypted_secrets
                                               WHERE name='admin_invoke_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 240000
  );
  $cron$
);
