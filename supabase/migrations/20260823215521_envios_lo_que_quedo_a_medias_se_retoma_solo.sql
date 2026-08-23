SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- QUE NADA SE QUEDE COLGADO
--
-- Dos huecos que encontró la auditoría del 2026-08-23, y los dos tienen la
-- misma forma: **la única salida dependía de que alguien mirara**. Es
-- exactamente lo que costó los 6 renglones del pedido 120 el 19-ago — el
-- despacho se retomaba solo desde el 11-ago y la recepción no, y la asimetría
-- ERA el bug.
--
--   1. Un despacho que corta por tiempo deja renglones `por_enviar` y nadie los
--      vuelve a mirar salvo que entren a la tarjeta y aprieten. Mientras tanto
--      parte del envío ya salió: producto a medio camino.
--   2. Un envío que la sala de destino nunca contesta se queda `PENDING` para
--      siempre, con el producto EN TRÁNSITO: fuera de una sala, sin entrar a la
--      otra, y sin que nadie pueda venderlo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Qué envíos hay que retomar ─────────────────────────────────────────
-- Sólo dice QUÉ mirar. QUÉ despachar lo resuelve la Edge Function con su propia
-- lectura — la misma regla que hace seguro a `reintentar-ingreso-pedido`: un
-- renglón que nadie despachó no puede colarse por acá.
CREATE OR REPLACE FUNCTION public.envios_por_continuar(p_minutos integer DEFAULT 10)
 RETURNS TABLE(request_id uuid, faltan integer, desde timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT r.id,
           count(*) FILTER (WHERE l.estado = 'por_enviar')::integer,
           min(coalesce((r.metadata->>'despachado_at')::timestamptz, r.created_at))
      FROM public.approval_requests r
      JOIN public.envio_linea l ON l.request_id = r.id
     WHERE r.type = 'INVENTORY_TRANSFER_PUSH'
       AND r.status = 'PENDING'
       -- Con el candado vivo hay una corrida en curso: no se pisa.
       AND (r.metadata->>'despachando_at' IS NULL
            OR (r.metadata->>'despachando_at')::timestamptz < now() - interval '3 minutes')
       -- Y sólo lo que ya ESTUVO en marcha: un envío recién creado lo despacha
       -- la pantalla que lo armó, y adelantarse le quitaría a esa persona el
       -- resultado que está esperando en el modal.
       AND coalesce((r.metadata->>'despachado_at')::timestamptz, r.created_at) < now() - make_interval(mins => greatest(1, p_minutos))
     GROUP BY r.id
    -- `por_enviar` y NO `error`: una línea en error se cerró a propósito —un
    -- lote que no alcanza, una presentación que cambió— y reintentarla a ciegas
    -- cada diez minutos sería pelearse con el sistema para siempre. Ésas las
    -- retoma una persona desde la tarjeta.
    HAVING count(*) FILTER (WHERE l.estado = 'por_enviar') > 0
     ORDER BY 3
     LIMIT 20;
$function$;

-- ── 2 · Y el que nadie contesta ────────────────────────────────────────────
-- Avisa UNA vez por escalón (a los 2 días y a los 5) y no todos los días: un
-- aviso que se repite es un aviso que se aprende a ignorar. La marca queda en
-- el propio envío, así que dos corridas del cron no avisan dos veces.
CREATE OR REPLACE FUNCTION public.avisar_envios_sin_decidir(p_dias integer DEFAULT 2)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r        record;
    v_dest   uuid[];
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dias   integer;
    v_n      integer := 0;
BEGIN
    FOR r IN
        SELECT ar.id, ar.metadata, ar.employee_id,
               floor(extract(epoch FROM now() - ar.created_at) / 86400)::integer AS dias,
               (SELECT count(*) FROM public.envio_linea l
                 WHERE l.request_id = ar.id AND l.estado = 'enviada') AS esperando
          FROM public.approval_requests ar
         WHERE ar.type = 'INVENTORY_TRANSFER_PUSH'
           AND ar.status = 'PENDING'
           AND ar.created_at < now() - make_interval(days => greatest(1, p_dias))
    LOOP
        CONTINUE WHEN r.esperando = 0;   -- no hay nada esperando decisión
        -- Un escalón por umbral cruzado: se avisa al pasar 2 días y otra vez al
        -- pasar 5. Guardar el número evita repetirlo en cada corrida.
        v_dias := CASE WHEN r.dias >= 5 THEN 5 ELSE p_dias END;
        CONTINUE WHEN coalesce((r.metadata->>'avisado_sin_decidir')::integer, 0) >= v_dias;

        SELECT coalesce(
                 (SELECT array_agg((d)::uuid) FROM jsonb_array_elements_text(r.metadata->'destinatarios') d),
                 ARRAY[]::uuid[]) INTO v_dest;
        v_dest := (SELECT array_agg(DISTINCT x) FROM unnest(v_dest) x
                    WHERE x IS NOT NULL AND x <> r.employee_id);
        CONTINUE WHEN coalesce(array_length(v_dest, 1), 0) = 0;

        v_titulo := '⏳ Hay producto esperando tu respuesta';
        v_cuerpo := coalesce(nullif(r.metadata->>'origen_branch_name',''), 'Otra sala')
                 || ' te envió ' || r.esperando
                 || CASE WHEN r.esperando = 1 THEN ' producto' ELSE ' productos' END
                 || ' hace ' || r.dias || CASE WHEN r.dias = 1 THEN ' día' ELSE ' días' END
                 || ' y todavía no lo contestaste. Mientras tanto no está en ninguna de las dos salas: '
                 || 'no se puede vender ni en la tuya ni en la de ellos.';
        v_link := '/traslados?tab=envios&envio=' || r.id;

        INSERT INTO public.notifications
            (recipient_id, type, title, body, link, metadata, branch_id, created_by)
        SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
               jsonb_build_object('request_id', r.id, 'request_type', 'INVENTORY_TRANSFER_PUSH',
                                  'recordatorio', v_dias),
               nullif(r.metadata->>'branch_id','')::integer, r.employee_id
          FROM unnest(v_dest) d;

        UPDATE public.approval_requests
           SET metadata = coalesce(metadata, '{}'::jsonb)
                          || jsonb_build_object('avisado_sin_decidir', v_dias)
         WHERE id = r.id;

        PERFORM net.http_post(
            url := public.push_function_url(), headers := public.push_function_headers(),
            body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                    'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.envios_por_continuar(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.avisar_envios_sin_decidir(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.envios_por_continuar(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.avisar_envios_sin_decidir(integer) TO service_role;
