-- Lo que salió mientras la sala estaba cerrada, contado a la mañana siguiente.
--
-- La otra mitad de `20260817205059_respaldo_de_sala_para_traslados_fuera_de_horario`.
-- Ahí Salud 3 quedó habilitada para despachar por Bodega mientras Bodega está
-- cerrada; acá Bodega se entera de qué salió. Decisión del usuario, 2026-08-17:
-- «sí, y queda marcado».
--
-- Es la diferencia con el usuario compartido que se usaba antes por fuera del
-- portal: ahí el movimiento no tenía nombre y nadie lo contaba. Acá el traslado
-- queda firmado con quién lo despachó y, al abrir, la sala del producto tiene
-- el aviso esperándola.
--
-- ── Por qué la marca de «ya avisado» NO va en la solicitud ─────────────────
-- `approval_requests` tiene el trigger `approval_requests_updated_at`, así que
-- CUALQUIER update le mueve `updated_at` — y en un traslado despachado
-- `updated_at` ES la hora de salida: es lo que muestra la tarjeta («Salió
-- 16:40») y sobre lo que se calcula si lleva demasiado en camino. Un aviso
-- diario que escribiera ahí haría que todos los traslados parecieran haber
-- salido a las 8 de la mañana.
--
-- Así que la marca es la notificación misma: `metadata.request_ids` guarda los
-- ids avisados y la consulta descarta los que ya figuran. Es idempotente sin
-- tocar el dato del negocio.
--
-- El caso que esto no cubre —y se acepta a propósito—: si la sala de origen no
-- tuviera ni una persona activa, `notify_branch` devuelve 0 y no queda
-- notificación, o sea que no queda marca. La ventana de siete días es lo que
-- evita que eso se repita para siempre: reintenta una semana y para. Un aviso
-- que no le llega a nadie no es un aviso.
--
-- Horario: 08:05 SV = 14:05 UTC. Bodega abre a las 8:00 y El Salvador no mueve
-- el reloj en todo el año, así que el mismo cron sirve siempre. Misma familia
-- que `alerta-barrido-dte-8am-sv` y `avisar-facturas-de-sala-0830-sv`.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.avisar_traslados_por_respaldo()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sala   record;
  v_n      integer;
  v_total  integer := 0;
  v_titulo text;
  v_cuerpo text;
BEGIN
  FOR v_sala IN
    WITH sin_avisar AS (
      SELECT ar.id,
             (ar.metadata->>'origen_branch_id')::integer AS origen,
             coalesce(nullif(ar.metadata->>'branch_name', ''), 'otra sala') AS destino,
             coalesce(nullif(ar.metadata->'erp_traslado'->>'by_name', ''), 'La sala de al lado') AS quien,
             ar.updated_at
        FROM public.approval_requests ar
       WHERE ar.type = 'INVENTORY_TRANSFER_REQUEST'
         AND ar.status = 'APPROVED'
         AND (ar.metadata->'erp_traslado'->>'por_respaldo')::boolean IS TRUE
         AND ar.updated_at >= now() - interval '7 days'
         AND NOT EXISTS (SELECT 1 FROM public.notifications n
                          WHERE n.type = 'TRASLADO_RESPALDO'
                            AND n.created_at >= now() - interval '30 days'
                            AND n.metadata->'request_ids' ? ar.id::text)
    )
    -- Agrupado por sala: tres traslados de un fin de semana son UN aviso, no
    -- tres campanazos seguidos a la misma hora.
    SELECT origen,
           count(*)                                        AS cuantos,
           to_jsonb(array_agg(id)::text[])                  AS ids,
           string_agg(DISTINCT quien, ', ')                 AS quienes,
           string_agg(destino, ', ' ORDER BY updated_at)    AS destinos
      FROM sin_avisar
     WHERE origen IS NOT NULL
     GROUP BY origen
  LOOP
    v_titulo := CASE WHEN v_sala.cuantos = 1
                     THEN 'Salio un traslado mientras estaban cerrados'
                     ELSE v_sala.cuantos || ' traslados salieron mientras estaban cerrados' END;
    v_cuerpo := v_sala.quienes
             || CASE WHEN v_sala.cuantos = 1 THEN ' lo despacho' ELSE ' los despacho' END
             || ' por ustedes hacia ' || v_sala.destinos || '. Revisen que la existencia cuadre.';

    v_n := public.notify_branch(
             v_sala.origen, 'TRASLADO_RESPALDO', v_titulo, v_cuerpo, '/traslados',
             jsonb_build_object('request_ids', v_sala.ids), true);

    v_total := v_total + coalesce(v_n, 0);
  END LOOP;

  RETURN v_total;
END;
$function$;

-- Ni `authenticated` ni `anon`: esto lo dispara el reloj, no una pantalla.
REVOKE EXECUTE ON FUNCTION public.avisar_traslados_por_respaldo() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_traslados_por_respaldo() TO service_role;

COMMENT ON FUNCTION public.avisar_traslados_por_respaldo() IS
  'A la manana: le cuenta a la sala que estuvo cerrada que su sala de respaldo despacho traslados por ella. La marca de "ya avisado" es la notificacion misma (metadata.request_ids), para no escribir en approval_requests: un UPDATE ahi mueve updated_at, que es la hora de salida del traslado y la que muestra la tarjeta.';

SELECT cron.schedule('avisar-traslados-por-respaldo-0805-sv', '5 14 * * *',
                     $cron$ SELECT public.avisar_traslados_por_respaldo(); $cron$);
