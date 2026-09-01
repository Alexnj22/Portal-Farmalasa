-- Promociones — el lote sigue al producto cuando se traslada entre salas.
--
-- Decisión del usuario (2026-09-01): si una sala le manda producto de la
-- promoción a otra, el lote se mueve — baja en la que envía, sube en la que
-- recibe, AL CONFIRMAR LA LLEGADA. Sin eso las dos pantallas mienten: la que
-- recibió aparece pasada de su lote cuando en realidad recibió producto
-- legítimamente, y la que cedió aparece floja cuando lo que hizo fue ceder.
--
-- ── Por qué NO hay que marcar el traslado como «de la promoción» ────────────
-- El lote es una CUENTA, no un producto aparte: las cajas de la promoción y las
-- que ya estaban en la sala son físicamente idénticas. Cuando alguien vende
-- una, la factura dice «Orfenaflex, 1 unidad» y no de cuál montón salió — eso ya
-- se acepta al contar las ventas. Pedirle a alguien que distinga lo
-- indistinguible al despachar sería pedirle que adivine, y un olvido dejaría
-- mal los dos números sin que nadie se entere.
--
-- ── Bodega queda afuera SOLA, y eso es lo que conserva el total ─────────────
-- El movimiento se aplica sólo cuando LAS DOS PUNTAS tienen fila de reparto en
-- ese renglón. Bodega no la tiene —el reparto se declara entre las seis salas de
-- venta—, así que un despacho de Bodega a una sala no mueve nada: eso es el
-- suministro inicial, que ya está contado en el reparto. Y como sólo se mueve
-- entre dos filas existentes, el total de la promoción es invariante por
-- construcción y no por acordarse de restar.
--
-- Verificado en el metadata real: un traslado trae `origen_branch_id: 30`
-- (Bodega) o `origen_branch_id: 27` (Salud 3) en la misma forma, así que la
-- regla los distingue sin un caso especial.
--
-- ── Los tres circuitos, y cuál engancha ─────────────────────────────────────
--   A · Bodega despacha un pedido        `pedido_traslado_linea`  → NO engancha:
--       Bodega no tiene reparto, y su `cantidad` está en PAQUETES (medido: el
--       21% de las líneas recibidas tiene factor > 1, así que compararla cruda
--       subcontaría).
--   B · una sala PIDE a otra             `approval_requests.metadata`
--   C · una sala EMPUJA a otra           `envio_linea`
--
-- ── El trigger NO puede tumbar la escritura que observa ─────────────────────
-- Los dos van con su bloque EXCEPTION: si algo falla acá, el traslado se
-- confirma igual y el lote se queda como estaba. Un traslado que no se puede
-- recibir porque la contabilidad de una promoción falló sería mucho peor que un
-- lote desactualizado — es la lección del trigger de auditoría que abortaba el
-- UPDATE que auditaba.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- promocion_mover_lote — el movimiento, en un solo lugar
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.promocion_mover_lote(
    p_erp_product_id integer,
    p_origen         bigint,
    p_destino        bigint,
    p_unidades       numeric,
    p_circuito       text,
    p_ref            text DEFAULT NULL,
    p_actor          uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_renglon  bigint;
    v_promo    bigint;
    v_cuantos  integer;
    v_disp     integer;
    v_mueve    integer;
    v_movidos  integer := 0;
BEGIN
    IF p_unidades IS NULL OR p_unidades <= 0
       OR p_origen IS NULL OR p_destino IS NULL
       OR p_origen = p_destino THEN
        RETURN 0;
    END IF;

    -- ¿Hay UN renglón abierto de una promoción activa para este producto hoy?
    -- Si hay varios (el mismo producto con dos presentaciones distintas), no se
    -- adivina cuál: no se mueve nada y queda anotado. Repartir a ojo entre dos
    -- renglones sería inventar un dato.
    SELECT count(*), min(r.id), min(r.promocion_id)
      INTO v_cuantos, v_renglon, v_promo
      FROM public.promocion_renglon r
      JOIN public.promociones pm ON pm.id = r.promocion_id
     WHERE r.erp_product_id = p_erp_product_id
       AND r.estado = 'abierto' AND pm.estado = 'activa'
       AND v_hoy BETWEEN r.inicio AND r.fin;

    IF v_cuantos = 0 THEN RETURN 0; END IF;

    IF v_cuantos > 1 THEN
        PERFORM public.promocion_log(
            NULL, NULL, NULL, 'traslado_ambiguo', NULL, p_unidades::text,
            'el producto ' || p_erp_product_id || ' está en ' || v_cuantos ||
            ' renglones abiertos: no se movió el lote');
        RETURN 0;
    END IF;

    -- Las DOS puntas tienen que tener reparto en este renglón. Es lo que deja
    -- afuera a Bodega y lo que conserva el total.
    IF NOT EXISTS (SELECT 1 FROM public.promocion_reparto
                    WHERE renglon_id = v_renglon AND branch_id = p_origen)
       OR NOT EXISTS (SELECT 1 FROM public.promocion_reparto
                       WHERE renglon_id = v_renglon AND branch_id = p_destino) THEN
        RETURN 0;
    END IF;

    SELECT asignado_vigente INTO v_disp
      FROM public.promocion_reparto
     WHERE renglon_id = v_renglon AND branch_id = p_origen
       FOR UPDATE;

    -- No se puede ceder más de lo asignado: la columna no admite negativos, y un
    -- lote negativo no significa nada. Se mueve lo que hay y se anota el tope.
    v_mueve := least(floor(p_unidades)::integer, greatest(v_disp, 0));
    IF v_mueve <= 0 THEN RETURN 0; END IF;

    UPDATE public.promocion_reparto
       SET asignado_vigente = asignado_vigente - v_mueve, updated_at = now()
     WHERE renglon_id = v_renglon AND branch_id = p_origen;

    UPDATE public.promocion_reparto
       SET asignado_vigente = asignado_vigente + v_mueve,
           -- Recibir más lote vuelve a poner a la sala por debajo del umbral, así
           -- que el aviso tiene que poder volver a salir.
           avisado_80_at  = NULL,
           avisado_100_at = NULL,
           updated_at     = now()
     WHERE renglon_id = v_renglon AND branch_id = p_destino;

    INSERT INTO public.promocion_reparto_mov
        (renglon_id, branch_id_origen, branch_id_destino, unidades,
         circuito, origen_ref, movido_por)
    VALUES
        (v_renglon, p_origen, p_destino, v_mueve, p_circuito, p_ref, p_actor);

    PERFORM public.promocion_log(
        v_promo, v_renglon, p_destino, 'lote_movido',
        v_disp::text, (v_disp - v_mueve)::text,
        v_mueve || ' unidades por ' || p_circuito ||
        CASE WHEN v_mueve < floor(p_unidades)
             THEN ' (se pidieron ' || floor(p_unidades)::int || ', había ' || v_disp || ')'
             ELSE '' END);

    v_movidos := v_mueve;
    RETURN v_movidos;
END;
$function$;

COMMENT ON FUNCTION public.promocion_mover_lote(integer, bigint, bigint, numeric, text, text, uuid) IS
  'Mueve el lote de una promoción de una sala a otra. Sólo actúa si LAS DOS tienen reparto en ese renglón — eso deja afuera a Bodega y hace que el total sea invariante por construcción.';

REVOKE EXECUTE ON FUNCTION public.promocion_mover_lote(integer, bigint, bigint, numeric, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.promocion_mover_lote(integer, bigint, bigint, numeric, text, text, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Circuito C — una sala EMPUJA a otra (`envio_linea`)
-- ─────────────────────────────────────────────────────────────────────────────
-- `envio_linea.unidades` YA está en unidades base (la tabla guarda las dos
-- escalas y su COMMENT lo dice), así que acá no hay que convertir nada.
CREATE OR REPLACE FUNCTION public.promocion_trg_envio_recibido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_meta jsonb;
BEGIN
    BEGIN
        SELECT ar.metadata INTO v_meta
          FROM public.approval_requests ar
         WHERE ar.id = NEW.request_id;

        PERFORM public.promocion_mover_lote(
            NEW.erp_product_id,
            (v_meta ->> 'origen_branch_id')::bigint,
            (v_meta ->> 'branch_id')::bigint,
            NEW.unidades,
            'envio',
            NEW.request_id::text,
            NEW.decidido_por);
    EXCEPTION WHEN OTHERS THEN
        -- Nunca tumbar la recepción por la contabilidad de una promoción.
        RAISE WARNING 'promociones: no se movió el lote del envío % (%)',
              NEW.request_id, SQLERRM;
    END;
    RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_promocion_envio_recibido ON public.envio_linea;
CREATE TRIGGER trg_promocion_envio_recibido
    AFTER UPDATE OF recibido_at ON public.envio_linea
    FOR EACH ROW
    WHEN (NEW.recibido_at IS NOT NULL AND OLD.recibido_at IS NULL
          AND NEW.estado = 'aceptada')
    EXECUTE FUNCTION public.promocion_trg_envio_recibido();

-- ─────────────────────────────────────────────────────────────────────────────
-- Circuito B — una sala PIDE a otra (`approval_requests.metadata`)
-- ─────────────────────────────────────────────────────────────────────────────
-- Acá no hay tabla de renglones: los productos viven en `metadata.items`, y la
-- llegada se marca escribiendo `metadata.erp_recibido`. La cantidad de cada
-- ítem está en PAQUETES y el factor viaja al lado, así que se multiplica.
CREATE OR REPLACE FUNCTION public.promocion_trg_solicitud_recibida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_item jsonb;
BEGIN
    BEGIN
        FOR v_item IN
            SELECT * FROM jsonb_array_elements(coalesce(NEW.metadata -> 'items', '[]'::jsonb))
        LOOP
            PERFORM public.promocion_mover_lote(
                (v_item ->> 'erp_product_id')::integer,
                (NEW.metadata ->> 'origen_branch_id')::bigint,
                (NEW.metadata ->> 'branch_id')::bigint,
                (v_item ->> 'cantidad')::numeric
                    * greatest(coalesce((v_item ->> 'factor')::numeric, 1), 1),
                'solicitud',
                NEW.id::text,
                NEW.approver_id);
        END LOOP;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'promociones: no se movió el lote de la solicitud % (%)',
              NEW.id, SQLERRM;
    END;
    RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_promocion_solicitud_recibida ON public.approval_requests;
CREATE TRIGGER trg_promocion_solicitud_recibida
    AFTER UPDATE OF metadata ON public.approval_requests
    FOR EACH ROW
    WHEN (NEW.type = 'INVENTORY_TRANSFER_REQUEST'
          AND NEW.metadata ? 'erp_recibido'
          AND NOT (OLD.metadata ? 'erp_recibido'))
    EXECUTE FUNCTION public.promocion_trg_solicitud_recibida();
