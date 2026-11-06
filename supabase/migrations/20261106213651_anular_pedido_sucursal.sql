-- Anular la parte de UNA sala de un pedido, sin tocar las demás (2026-11-06).
--
-- Pedido de Bodega: el pedido #243 iba a Salud 1 y Salud 2, y una de las dos ya
-- no se iba a hacer. `anular_pedido` anula el pedido ENTERO —todas las salas—
-- y además se niega en cuanto alguna sala está finalizada, así que no había
-- forma de quitar una sola sala.
--
-- Regla del usuario: «si un pedido a una sucursal no se ha iniciado, que se
-- pueda anular sin afectar lo demás». Por eso el freno es `iniciado_at`: una
-- sala que Bodega ya empezó a preparar tiene producto separado en la mano, y
-- eso no se deshace con un botón.
--
-- Piezas:
--   1. `pedido_sucursal_status` gana anulado_at / anulado_por / motivo_anulacion.
--   2. `anular_pedido_sucursal(pedido, sala, motivo)`: sólo Bodega (alcance de
--      toda la red), sólo sala sin iniciar y sin traslado hecho. Pasa sus
--      renglones pendientes a 'anulado'. Si era la última sala viva, anula el
--      pedido; si las demás ya cerraron, lo cierra como haría la recepción.
--   3. `update_pedido_sucursal_lifecycle` se niega a mover una sala anulada
--      (una pantalla vieja todavía puede tener el botón «Iniciar»).
--   4. `get_pedidos_en_curso` deja fuera la sala anulada: sale del tablero.
SET lock_timeout = '5s';

ALTER TABLE public.pedido_sucursal_status
    ADD COLUMN IF NOT EXISTS anulado_at       timestamptz,
    ADD COLUMN IF NOT EXISTS anulado_por      uuid,
    ADD COLUMN IF NOT EXISTS motivo_anulacion text;

COMMENT ON COLUMN public.pedido_sucursal_status.anulado_at IS
    'La parte de esta sala se anuló (anular_pedido_sucursal). Las demás salas del pedido siguen.';

CREATE OR REPLACE FUNCTION public.anular_pedido_sucursal(
    p_pedido_id   uuid,
    p_sucursal_id integer,
    p_motivo      text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor      uuid := auth_employee_id();
    v_status     text;
    v_pss        record;
    v_renglones  integer;
    v_quedan     integer;
    v_motivo     text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;
    -- Igual que anular el pedido entero: es de Bodega.
    IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
        RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: anular la parte de una sala es de Bodega';
    END IF;
    IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
        RAISE EXCEPTION 'Escribe el motivo (mínimo 5 caracteres).';
    END IF;

    SELECT status INTO v_status FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado.';
    END IF;
    IF v_status IN ('completado', 'anulado') THEN
        RAISE EXCEPTION 'El pedido está % y no se puede modificar.', v_status;
    END IF;

    SELECT * INTO v_pss FROM pedido_sucursal_status
     WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esa sala no está en este pedido.';
    END IF;
    IF v_pss.anulado_at IS NOT NULL THEN
        RAISE EXCEPTION 'La parte de esa sala ya estaba anulada.';
    END IF;
    IF v_pss.iniciado_at IS NOT NULL THEN
        RAISE EXCEPTION 'Bodega ya empezó a preparar esa sala: ya no se puede anular sola.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pedido_traslado_erp
         WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
           AND id_traslado IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Esa sala ya tiene un traslado hecho: no se puede anular sola.';
    END IF;

    UPDATE pedido_items
       SET status = 'anulado'
     WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
       AND status = 'pendiente';
    GET DIAGNOSTICS v_renglones = ROW_COUNT;

    UPDATE pedido_sucursal_status
       SET anulado_at = now(), anulado_por = v_actor, motivo_anulacion = v_motivo
     WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    SELECT count(*) INTO v_quedan FROM pedido_sucursal_status
     WHERE pedido_id = p_pedido_id AND anulado_at IS NULL;

    IF v_quedan = 0 THEN
        -- Era la última sala viva: el pedido entero queda anulado.
        UPDATE pedidos
           SET status = 'anulado', anulado_por = v_actor, anulado_at = now(),
               motivo_anulacion = v_motivo
         WHERE id = p_pedido_id;
    ELSIF NOT EXISTS (
        SELECT 1 FROM pedido_items WHERE pedido_id = p_pedido_id AND status = 'pendiente'
    ) AND NOT EXISTS (
        SELECT 1 FROM pedido_sucursal_status
         WHERE pedido_id = p_pedido_id AND anulado_at IS NULL AND recibido_erp_at IS NULL
    ) THEN
        -- Las demás salas ya terminaron: la anulada era lo único que lo
        -- tenía abierto. Mismo criterio que `cerrar_pedido_si_todo_resuelto`.
        IF EXISTS (
            SELECT 1 FROM pedido_items
             WHERE pedido_id = p_pedido_id AND status = 'con_diferencia'
               AND resolucion_status IS DISTINCT FROM 'confirmada'
        ) THEN
            UPDATE pedidos SET status = 'parcial' WHERE id = p_pedido_id;
        ELSE
            UPDATE pedidos SET status = 'completado' WHERE id = p_pedido_id;
        END IF;
    END IF;

    RETURN json_build_object(
        'renglones', v_renglones,
        'pedido_anulado', v_quedan = 0
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.anular_pedido_sucursal(uuid, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.anular_pedido_sucursal(uuid, integer, text) TO authenticated, service_role;

-- 3. Una sala anulada no se mueve más. Partido de la definición VIVA
--    (md5 e8851834020fa9b80ce7f45128391937); sólo se agrega el freno.
CREATE OR REPLACE FUNCTION public.update_pedido_sucursal_lifecycle(p_pedido_id uuid, p_sucursal_id integer, p_stage text, p_user_id uuid DEFAULT NULL::uuid, p_razon text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid;
BEGIN
    IF pg_trigger_depth() = 0 THEN
        v_actor := auth_employee_id();
        IF v_actor IS NULL THEN
            RAISE EXCEPTION 'UNAUTHENTICATED';
        END IF;
        IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
        END IF;
        -- Decisión 2026-10-02: preparar, pausar, finalizar y corregir son de
        -- Bodega; llegada, recepción y diferencias, de la sala, y sólo la suya.
        IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
            IF p_stage IN ('iniciar', 'pausar', 'reanudar', 'finalizar', 'corregir_bodega') THEN
                RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: ese paso del pedido es de Bodega';
            END IF;
            IF p_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
                RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: sólo puedes mover el pedido de tu sucursal';
            END IF;
        END IF;
    ELSE
        v_actor := p_user_id;
    END IF;

    -- La parte de esta sala se anuló (anular_pedido_sucursal, 2026-11-06):
    -- una pantalla que no recargó todavía puede ofrecer «Iniciar».
    IF EXISTS (
        SELECT 1 FROM pedido_sucursal_status
         WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
           AND anulado_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'La parte de esta sala fue anulada: ya no se puede mover.';
    END IF;

    INSERT INTO pedido_sucursal_status (pedido_id, erp_sucursal_id)
    VALUES (p_pedido_id, p_sucursal_id)
    ON CONFLICT (pedido_id, erp_sucursal_id) DO NOTHING;

    IF p_stage = 'iniciar' THEN
        UPDATE pedido_sucursal_status
        SET iniciado_at  = NOW(), iniciado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NULL;

    ELSIF p_stage = 'pausar' THEN
        IF EXISTS (
            SELECT 1 FROM pedido_pausa_historial
            WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
              AND reanudado_at IS NULL
        ) THEN RETURN; END IF;
        UPDATE pedido_sucursal_status
        SET pausado_at = NOW(), pausa_razon = p_razon, reanudado_at = NULL, reanudado_por = NULL
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NOT NULL AND finalizado_at IS NULL;
        INSERT INTO pedido_pausa_historial
            (pedido_id, erp_sucursal_id, pausado_at, razon, pausado_por)
        VALUES (p_pedido_id, p_sucursal_id, NOW(), p_razon, v_actor);

    ELSIF p_stage = 'reanudar' THEN
        UPDATE pedido_pausa_historial
        SET reanudado_at = NOW(), reanudado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND reanudado_at IS NULL;
        UPDATE pedido_sucursal_status
        SET reanudado_at = NOW(), reanudado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND pausado_at IS NOT NULL AND reanudado_at IS NULL AND finalizado_at IS NULL;

    ELSIF p_stage = 'finalizar' THEN
        IF EXISTS (
            SELECT 1 FROM pedido_pausa_historial
            WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
              AND reanudado_at IS NULL
        ) THEN
            RAISE EXCEPTION 'No se puede finalizar: hay una pausa activa sin reanudar.';
        END IF;
        UPDATE pedido_sucursal_status
        SET finalizado_at = NOW(), finalizado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NOT NULL AND finalizado_at IS NULL
          AND (pausado_at IS NULL OR reanudado_at IS NOT NULL);

    ELSIF p_stage = 'confirmar_llegada' THEN
        UPDATE pedido_sucursal_status
        SET llegada_fisica_at  = NOW(), llegada_fisica_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND llegada_fisica_at IS NULL;

    ELSIF p_stage = 'recibir_erp' THEN
        UPDATE pedido_sucursal_status
        SET recibido_erp_at  = NOW(), recibido_erp_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND recibido_erp_at IS NULL;

    ELSIF p_stage = 'reportar_diferencias' THEN
        UPDATE pedido_sucursal_status
        SET diferencias_reportadas_at  = NOW(),
            diferencias_reportadas_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSIF p_stage = 'corregir_bodega' THEN
        UPDATE pedido_sucursal_status
        SET corregido_bodega_at   = NOW(),
            corregido_bodega_por  = v_actor,
            corregido_bodega_nota = p_nota
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSIF p_stage = 'confirmar_correccion' THEN
        UPDATE pedido_sucursal_status
        SET confirmado_correccion_at  = NOW(),
            confirmado_correccion_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSE
        RAISE EXCEPTION 'stage desconocido: %', p_stage;
    END IF;
END;
$function$;

-- 4. La sala anulada sale del tablero. Partido de la definición VIVA
--    (md5 f92e6689bb54cda3ed4f346a2e9139eb); sólo se agrega `pss.anulado_at IS NULL`.
-- jsonb-agg: el `jsonb_agg` de `pauses` ya estaba en la definición viva y agrega las pausas de UNA sala (un puñado de filas).
CREATE OR REPLACE FUNCTION public.get_pedidos_en_curso(p_desde date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN (
    SELECT coalesce(json_agg(to_json(t)
                    ORDER BY CASE WHEN t.status IN ('completado', 'parcial') THEN 1 ELSE 0 END,
                             t.created_at DESC), '[]'::json)
    FROM (
      SELECT
        p.id                          AS pedido_id,
        p.numero                      AS numero,
        pss.codigo                    AS codigo,
        p.notes                       AS notes,
        p.status                      AS status,
        p.created_at                  AS created_at,
        salida.salio_at               AS enviado_at,
        pss.erp_sucursal_id           AS erp_sucursal_id,
        pss.iniciado_at               AS iniciado_at,
        pss.finalizado_at             AS finalizado_at,
        pss.pausado_at                AS pausado_at,
        pss.reanudado_at              AS reanudado_at,
        pss.llegada_fisica_at         AS llegada_fisica_at,
        pss.llegada_fisica_por        AS llegada_fisica_por,
        pss.recibido_erp_at           AS recibido_erp_at,
        pss.recibido_erp_por          AS recibido_erp_por,
        pss.diferencias_reportadas_at AS diferencias_reportadas_at,
        pss.diferencias_reportadas_por AS diferencias_reportadas_por,
        pss.corregido_bodega_at       AS corregido_bodega_at,
        pss.corregido_bodega_por      AS corregido_bodega_por,
        pss.corregido_bodega_nota     AS corregido_bodega_nota,
        pss.confirmado_correccion_at  AS confirmado_correccion_at,
        pss.confirmado_correccion_por AS confirmado_correccion_por,
        COALESCE(
          (SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(pph.reanudado_at, NOW()) - pph.pausado_at)) / 60)::INT
           FROM   pedido_pausa_historial pph
           WHERE  pph.pedido_id = p.id AND pph.erp_sucursal_id = pss.erp_sucursal_id), 0
        )::integer                    AS min_pausado_total,
        p.created_by                  AS created_by,
        pss.iniciado_por              AS iniciado_por,
        pss.finalizado_por            AS finalizado_por,
        salida.despacho_por           AS enviado_por,
        pss.llegada_tipo              AS llegada_tipo,
        pss.llegada_nota              AS llegada_nota,
        COALESCE(pss.falta_cajas,        '[]'::jsonb) AS falta_cajas,
        pss.falta_caja_at             AS falta_caja_at,
        COALESCE(pss.cajas_danadas,      '[]'::jsonb) AS cajas_danadas,
        COALESCE(pss.reenvios_historial, '[]'::jsonb) AS reenvios_historial,
        pss.reenvio_bodega_at         AS reenvio_bodega_at,
        pss.reenvio_por               AS reenvio_por,
        pss.segunda_llegada_at        AS segunda_llegada_at,
        pss.total_cajas               AS total_cajas,
        COALESCE(pss.caja_map, '{}'::jsonb) AS caja_map,
        COALESCE(pss.cajas_electrolit, 0)   AS cajas_electrolit,
        pss.electrolit_ok             AS electrolit_ok,
        pss.electrolit_faltantes      AS electrolit_faltantes,
        COALESCE(pss.cajas_especiales,          '[]'::jsonb) AS cajas_especiales,
        COALESCE(pss.cajas_especiales_llegadas, '{}'::jsonb) AS cajas_especiales_llegadas,
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
              'razon',         pph.razon,
              'pausado_at',    pph.pausado_at,
              'pausado_por',   pph.pausado_por,
              'reanudado_at',  pph.reanudado_at,
              'reanudado_por', pph.reanudado_por
            ) ORDER BY pph.pausado_at)
           FROM pedido_pausa_historial pph
           WHERE pph.pedido_id = p.id AND pph.erp_sucursal_id = pss.erp_sucursal_id),
          '[]'::jsonb
        )                             AS pauses,
        p.status                      AS pedido_status,
        pss.reanudado_por             AS reanudado_por,
        pss.entrega_programada_at     AS entrega_programada_at,
        COALESCE(pss.entrega_programada_historial, '[]'::jsonb) AS entrega_programada_historial
      FROM  pedidos p
      JOIN  pedido_sucursal_status pss ON pss.pedido_id = p.id
      LEFT JOIN LATERAL (
        SELECT r.created_at AS salio_at, r.created_by AS despacho_por
        FROM   ruta_pedidos rp
        JOIN   rutas r ON r.id = rp.ruta_id
        WHERE  rp.pedido_id = pss.pedido_id
          AND  rp.erp_sucursal_id = pss.erp_sucursal_id
        ORDER  BY r.created_at
        LIMIT  1
      ) salida ON TRUE
      WHERE p.status <> 'anulado'
        AND pss.anulado_at IS NULL
        AND (p_desde IS NULL
             OR p.created_at >= (p_desde::timestamp AT TIME ZONE 'UTC')
             OR pss.recibido_erp_at IS NULL
             OR (pss.diferencias_reportadas_at IS NOT NULL AND pss.confirmado_correccion_at IS NULL)
             OR coalesce(pss.llegada_tipo, '') NOT IN ('', 'completa')
             OR (jsonb_typeof(pss.falta_cajas) = 'array' AND jsonb_array_length(pss.falta_cajas) > 0)
             OR (jsonb_typeof(pss.cajas_danadas) = 'array' AND jsonb_array_length(pss.cajas_danadas) > 0)
             OR pss.electrolit_ok IS FALSE
             OR (coalesce(pss.electrolit_faltantes, 0) > 0 AND pss.electrolit_ok IS NOT TRUE)
             OR (jsonb_typeof(pss.cajas_especiales_llegadas) = 'object'
                 AND EXISTS (SELECT 1 FROM jsonb_each_text(pss.cajas_especiales_llegadas) e
                             WHERE e.value = 'faltante'))
             OR (jsonb_typeof(pss.reenvios_historial) = 'array'
                 AND EXISTS (SELECT 1 FROM jsonb_array_elements(pss.reenvios_historial) c
                             WHERE nullif(c->>'arrived_at', '') IS NULL)))
    ) t
  );
END;
$function$;
