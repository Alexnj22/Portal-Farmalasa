-- Vigilante del barrido nocturno de DTE.
--
-- El barrido de las 22:30 deja su registro en `audit_logs`, pero nadie lo
-- mira. Si se rompe, uno se entera porque las bolsas dejan de bajar — que es
-- exactamente cómo un backup de este proyecto estuvo 17 días sin correr en
-- silencio. El silencio no es éxito.
--
-- ── Por qué en SQL y no en otra Edge Function ────────────────────────────
-- El barrido vive en una Edge Function con `--no-verify-jwt`, y uno de sus
-- modos de falla es justamente un redeploy que la deja devolviendo 401 antes
-- de ejecutar nada. Un vigilante desplegado igual se apagaría junto con lo que
-- vigila. Acá corre dentro de Postgres: sobrevive a los redeploys.
--
-- ── Por qué a las 8 y no a las 23 ────────────────────────────────────────
-- Decisión del usuario: el aviso sirve cuando hay alguien para leerlo. A las
-- 23:00 la alerta suena y se duerme; a las 8:00 llega con el día por delante.
--
-- ── Cuándo avisa ─────────────────────────────────────────────────────────
--   · no corrió           ← el caso más importante, y el único que el propio
--                            registro no puede contar
--   · corrió con fallas   ← `fallidas > 0`
--
-- Deliberadamente NO avisa por cola pendiente (`restantes > 0`): drenar un
-- atraso de 300 en tandas es el comportamiento correcto, y avisar diez días
-- seguidos de algo que va bien es cómo se entrena a la gente a ignorar las
-- alertas. La cola sí viaja en el cuerpo cuando ya hay algo que avisar.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.alertar_barrido_dte()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_corrida    public.audit_logs%ROWTYPE;
    v_hubo       boolean;
    v_fallidas   int;
    v_resueltas  int;
    v_restantes  int;
    v_dest       uuid[];
    v_titulo     text;
    v_cuerpo     text;
BEGIN
    -- La corrida de anoche. Ventana de 12 h: el barrido es a las 04:30 UTC y
    -- esto corre a las 14:00 UTC del mismo día.
    SELECT * INTO v_corrida
      FROM public.audit_logs
     WHERE action = 'DTE_REGULARIZADO'
       AND source = 'SYSTEM'
       AND created_at >= now() - interval '12 hours'
     ORDER BY created_at DESC
     LIMIT 1;

    v_hubo := FOUND;

    IF v_hubo THEN
        v_fallidas  := coalesce((v_corrida.details->>'fallidas')::int, 0);
        v_resueltas := coalesce((v_corrida.details->>'resueltas')::int, 0);
        v_restantes := coalesce((v_corrida.details->>'restantes')::int, 0);
        -- Corrió y no falló nada: no se avisa. Una alerta que llega todos los
        -- días deja de leerse.
        IF v_fallidas = 0 THEN RETURN; END IF;
    END IF;

    SELECT array_agg(e.id) INTO v_dest
      FROM public.employees e
      JOIN public.roles r ON r.name = 'Sistema — Alertas Técnicas'
     WHERE e.status = 'ACTIVO'
       AND (e.role_id = r.id OR e.secondary_role_id = r.id);

    IF v_dest IS NULL OR array_length(v_dest, 1) IS NULL THEN
        -- Sin destinatarios la alerta "se manda" a nadie y nada falla. Se deja
        -- constancia para que ese silencio sea visible.
        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
        VALUES ('ALERTA_BARRIDO_DTE_SIN_DESTINATARIOS', 'regularizar-dte',
                'Vigilante', 'SYSTEM', 'CRITICAL',
                jsonb_build_object('motivo', 'nadie tiene el rol Sistema — Alertas Técnicas'));
        RETURN;
    END IF;

    IF NOT v_hubo THEN
        v_titulo := '🚨 El barrido de Hacienda no corrió anoche';
        v_cuerpo := 'No quedó registro de la corrida de las 22:30. '
                 || 'Las facturas anuladas sin invalidar y las que están sin sello siguen esperando. '
                 || 'Revisá que la función `regularizar-dte` siga desplegada con --no-verify-jwt.';
    ELSE
        v_titulo := '⚠️ El barrido de Hacienda terminó con fallas';
        v_cuerpo := v_fallidas || ' factura' || CASE WHEN v_fallidas = 1 THEN '' ELSE 's' END
                 || ' no se pudo completar ante Hacienda'
                 || CASE WHEN v_resueltas > 0 THEN ', ' || v_resueltas || ' sí' ELSE '' END
                 || '. ' || CASE WHEN v_restantes > 0
                                 THEN 'Quedan ' || v_restantes || ' en cola. ' ELSE '' END
                 || 'El detalle de cada una está en la bitácora.';
    END IF;

    PERFORM public.notify_employees(
        v_dest, 'SYSTEM', v_titulo, v_cuerpo, '/audit',
        jsonb_build_object('origen', 'regularizar-dte',
                           'corrida', v_corrida.id,
                           'fallidas', v_fallidas),
        true, NULL
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.alertar_barrido_dte() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.alertar_barrido_dte() TO service_role;

-- 08:00 en El Salvador = 14:00 UTC (offset fijo -6, sin horario de verano).
SELECT cron.unschedule('alerta-barrido-dte-8am-sv')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alerta-barrido-dte-8am-sv');

SELECT cron.schedule(
  'alerta-barrido-dte-8am-sv',
  '0 14 * * *',
  $cron$ SELECT public.alertar_barrido_dte(); $cron$
);
