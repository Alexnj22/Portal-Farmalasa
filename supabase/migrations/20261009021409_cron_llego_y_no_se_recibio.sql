-- 12 · «Llegó y no se recibió»: a la sala a las 2 h, a supervisión a las 6 h
--      (2026-10-08).
--
-- Medido: de la llegada a la sala a «recibido» (recibido_erp_at) el p90 es 11
-- horas. Mientras no se recibe, el producto está físicamente en la sala y
-- fuera del inventario de la sala: no se puede vender por el sistema ni se
-- puede detectar una diferencia. Nadie lo recordaba.
--
-- «Llegó» = la sala confirmó la llegada (`llegada_fisica_at`) o, si no la
-- confirmó, el conductor la marcó entregada (`ruta_pedidos.entregado_at`,
-- sólo paradas de despacho, no de reenvío). Lo primero que haya.
--
-- Umbrales, una sola vez cada uno por sala-pedido (marca en
-- `avisos_emitidos`, clave `PEDIDO_SIN_RECIBIR_2H:<id>` / `_6H:<id>` con
-- recipient NULL — índice único NULLS NOT DISTINCT):
--   · 2 h → la sala (quien tiene `pedidos` ver en esa sucursal, vía
--     notify_branch_como).
--   · 6 h → supervisión: Gerente General y Supervisor/a de Ventas, POR CARGO,
--     igual que `avisar_dias_sin_cierre` (precedente del proyecto). ⚠ Ese
--     cruce es por NOMBRE de cargo (`roles.name`): si se renombra el cargo,
--     el aviso se queda sin destinatarios sin error. Es la misma deuda que
--     ya tiene `avisar_dias_sin_cierre`.
--
-- Sólo lo que llegó en los ÚLTIMOS 3 DÍAS: lo de antes es limpieza, no aviso
-- (hay salas de agosto sin recibir — ver los borradores de limpieza) y la
-- primera corrida no puede mandar decenas de avisos viejos. Medido antes de
-- aplicar (2026-10-09): la primera corrida no tiene nada que avisar.
--
-- Cron: cada 30 minutos dentro de la ventana de crons del proyecto
-- (12-23,0-5 UTC = 6:00–23:30 en El Salvador). Pura base: 0 peticiones al
-- sistema de origen. Declarado en `scripts/eficiencia-gate.mjs` (CRONS).
-- El desprogramar lleva la guarda `WHERE EXISTS` (CLAUDE.md: un
-- `cron.unschedule` de un job que no existe rompe el próximo branch).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.avisar_pedidos_sin_recibir()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r     record;
  v_n   integer := 0;
  v_sup uuid[];
  v_h   text;
BEGIN
  FOR r IN
    WITH llegadas AS (
      SELECT s.id, s.pedido_id, s.erp_sucursal_id, p.numero,
             coalesce(s.llegada_fisica_at,
                      (SELECT min(rp.entregado_at) FROM public.ruta_pedidos rp
                        WHERE rp.pedido_id = s.pedido_id AND rp.erp_sucursal_id = s.erp_sucursal_id
                          AND rp.reenvio_ciclo IS NULL)) AS llego_at
        FROM public.pedido_sucursal_status s
        JOIN public.pedidos p ON p.id = s.pedido_id
       WHERE s.recibido_erp_at IS NULL
         AND p.status NOT IN ('anulado', 'completado')
    )
    SELECT l.*, m.branch_id, m.nombre AS sala,
           CASE WHEN l.llego_at <= now() - interval '6 hours' THEN 6 ELSE 2 END AS umbral
      FROM llegadas l
      JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = l.erp_sucursal_id
     WHERE l.llego_at IS NOT NULL
       AND l.llego_at >= now() - interval '3 days'
       AND l.llego_at <= now() - interval '2 hours'
  LOOP
    v_h := to_char(r.llego_at AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM');

    -- 2 h → la sala. La marca y el aviso van en el MISMO bloque: si el aviso
    -- falla, la marca se deshace con él y la próxima corrida lo reintenta.
    IF r.branch_id IS NOT NULL THEN
      BEGIN
        INSERT INTO public.avisos_emitidos (clave, recipient_id)
        VALUES ('PEDIDO_SIN_RECIBIR_2H:' || r.id, NULL) ON CONFLICT DO NOTHING;
        IF FOUND THEN
        PERFORM public.notify_branch_como(NULL::uuid, r.branch_id::integer, 'PEDIDO_TRACKING',
          'Pedido #' || r.numero || ' sin recibir',
          'El pedido #' || r.numero || ' llegó a las ' || v_h || ' y todavía no se recibió. '
            || 'Mientras no se reciba, ese producto no está en el inventario de la sala.',
          '/pedidos', public.meta_de_pedido(ARRAY[r.numero], r.sala, 'sin_recibir'), true);
        v_n := v_n + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('sin_recibir_2h', r.pedido_id, SQLERRM);
      END;
    END IF;

    -- 6 h → supervisión.
    IF r.umbral = 6 THEN
        BEGIN
          INSERT INTO public.avisos_emitidos (clave, recipient_id)
          VALUES ('PEDIDO_SIN_RECIBIR_6H:' || r.id, NULL) ON CONFLICT DO NOTHING;
          IF FOUND THEN
          SELECT array_agg(DISTINCT e.id) INTO v_sup
            FROM public.employees e
            JOIN public.roles ro ON ro.id IN (e.role_id, e.secondary_role_id)
           WHERE ro.name IN ('Gerente General', 'Supervisor/a de Ventas')
             AND e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado';
          IF v_sup IS NOT NULL THEN
            PERFORM public.notify_employees(v_sup, 'PEDIDO_PROBLEMA',
              coalesce(r.sala, 'Sucursal ' || r.erp_sucursal_id) || ': pedido #' || r.numero || ' sin recibir',
              'Llegó a las ' || v_h || ' y lleva más de 6 horas sin recibirse en la sala.',
              '/pedidos', public.meta_de_pedido(ARRAY[r.numero], r.sala, 'sin_recibir', NULL, NULL, NULL,
                                                'Más de 6 horas sin recibir.'), true, r.branch_id::integer);
            v_n := v_n + 1;
          END IF;
          END IF;
        EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('sin_recibir_6h', r.pedido_id, SQLERRM);
        END;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_pedidos_sin_recibir() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_pedidos_sin_recibir() TO service_role;

SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'avisar-pedidos-sin-recibir';
SELECT cron.schedule('avisar-pedidos-sin-recibir', '*/30 12-23,0-5 * * *',
                     $cron$ SELECT public.avisar_pedidos_sin_recibir(); $cron$);
