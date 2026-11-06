-- El aviso de un traslado lleva el lote de cada producto (2026-11-05).
--
-- «Debe salir el lote, por trazabilidad» (usuario, con captura del detalle de
-- una solicitud). El dato ya estaba en la metadata —el despacho guarda
-- `erp_traslado.detalle[].numero_lote`, el apartado `lotes_asignados[i]` y el
-- pedido `items[i].lotes`— y ningún aviso lo copiaba.
--
-- `lotes_de_renglon_de_traslado` es el gemelo de `lotesPorRenglon`
-- (src/utils/trasladoTexto.js) y toma el más firme que haya:
--   salio    → lo que movió el despacho (el vencimiento se cruza con el
--              apartado por id o número; si no coincide, no se inventa)
--   apartado → el que se asignó antes de salir
--   pedido   → el que eligió quien pidió
-- Cambiar uno exige cambiar el otro.
--
-- Los dos triggers se modifican con `replace()` sobre su definición VIVA, y
-- abortan si el fragmento no está: así no se pisa nada que otra sesión haya
-- cambiado en el resto de la función.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.lotes_de_renglon_de_traslado(meta jsonb, idx integer)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $fn$
DECLARE
    v_items   jsonb := CASE WHEN jsonb_typeof(meta->'items') = 'array' THEN meta->'items' ELSE '[]'::jsonb END;
    v_item    jsonb := v_items->idx;
    v_det     jsonb := CASE WHEN jsonb_typeof(meta->'erp_traslado'->'detalle') = 'array'
                            THEN meta->'erp_traslado'->'detalle' ELSE '[]'::jsonb END;
    v_asig    jsonb := CASE WHEN jsonb_typeof(meta->'lotes_asignados') = 'object'
                            THEN meta->'lotes_asignados'->(idx::text) END;
    v_pedidos jsonb;
    v_prod    text;
    r         jsonb;
BEGIN
    IF v_item IS NULL THEN RETURN NULL; END IF;
    v_pedidos := CASE WHEN jsonb_typeof(v_item->'lotes') = 'array' THEN v_item->'lotes' ELSE '[]'::jsonb END;
    v_prod := v_item->>'erp_product_id';

    -- 1. Lo que salió. El detalle guarda el producto y no la posición: con el
    --    mismo producto en dos renglones no se puede repartir y se cae al
    --    apartado (misma regla que `lineasDelRenglon`).
    IF jsonb_array_length(v_det) > 0
       AND (SELECT count(*) FROM jsonb_array_elements(v_items) x WHERE x->>'erp_product_id' = v_prod) = 1 THEN
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'lote', nullif(d->>'numero_lote', ''),
                   'vence', CASE
                       WHEN v_asig IS NOT NULL
                        AND ((nullif(d->>'id_lote_erp', '') IS NOT NULL AND v_asig->>'id_lote_erp' = d->>'id_lote_erp')
                          OR (nullif(d->>'numero_lote', '') IS NOT NULL AND v_asig->>'lote' = d->>'numero_lote'))
                       THEN nullif(v_asig->>'vence', '')
                       ELSE (SELECT nullif(p->>'vence', '') FROM jsonb_array_elements(v_pedidos) p
                              WHERE nullif(d->>'numero_lote', '') IS NOT NULL AND p->>'lote' = d->>'numero_lote' LIMIT 1)
                   END,
                   'unidades', CASE WHEN d->>'cantidad' ~ '^[0-9]+(\.[0-9]+)?$' THEN (d->>'cantidad')::numeric END,
                   'fuente', 'salio')))
          INTO r
          FROM jsonb_array_elements(v_det) d
         WHERE d->>'erp_product_id' = v_prod;
        IF r IS NOT NULL THEN RETURN r; END IF;
    END IF;

    -- 2. Lo que se apartó.
    IF v_asig IS NOT NULL AND coalesce(nullif(v_asig->>'lote', ''), nullif(v_asig->>'vence', '')) IS NOT NULL THEN
        RETURN jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'lote', nullif(v_asig->>'lote', ''), 'vence', nullif(v_asig->>'vence', ''), 'fuente', 'apartado')));
    END IF;

    -- 3. Lo que se pidió.
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'lote', nullif(p->>'lote', ''), 'vence', nullif(p->>'vence', ''), 'fuente', 'pedido')))
      INTO r
      FROM jsonb_array_elements(v_pedidos) p
     WHERE coalesce(nullif(p->>'lote', ''), nullif(p->>'vence', '')) IS NOT NULL;
    RETURN r;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.lotes_de_renglon_de_traslado(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lotes_de_renglon_de_traslado(jsonb, integer) TO authenticated, service_role;

DO $do$
DECLARE
    d text;
    n text;
BEGIN
    -- «Te pide un traslado»: el lote que se pidió.
    d := pg_get_functiondef('public.notificar_solicitud_creada'::regproc);
    n := replace(d,
$a$->>'existencia')::numeric END)))
          INTO v_productos
          FROM (SELECT i FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) i LIMIT v_tope) x;$a$,
$b$->>'existencia')::numeric END,
                   -- El lote de cada producto, por trazabilidad (2026-11-05).
                   'lotes', CASE WHEN NEW.type IN ('INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH')
                                 THEN public.lotes_de_renglon_de_traslado(m, (x.ord - 1)::integer) END)))
          INTO v_productos
          FROM (SELECT i, ord FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS e(i, ord) LIMIT v_tope) x;$b$);
    IF n = d THEN RAISE EXCEPTION 'notificar_solicitud_creada: no se encontró el fragmento a reemplazar'; END IF;
    EXECUTE n;

    -- «Te lo envía»: el lote que salió.
    d := pg_get_functiondef('public.notificar_resolucion_traslado'::regproc);
    n := replace(d,
$a$                              END)) ORDER BY t.ord)$a$,
$b$                              END,
                   -- El lote que salió, por trazabilidad (2026-11-05).
                   'lotes',   CASE WHEN v_estado <> 'NO'
                                   THEN public.lotes_de_renglon_de_traslado(m, (t.ord - 1)::integer) END)) ORDER BY t.ord)$b$);
    IF n = d THEN RAISE EXCEPTION 'notificar_resolucion_traslado: no se encontró el fragmento a reemplazar'; END IF;
    EXECUTE n;
END
$do$;
