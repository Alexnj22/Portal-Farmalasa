SET lock_timeout = '5s';

-- Lo que cambia Mín·Máx de TODAS las salas exige alcance sobre todas las salas.
--
-- Pedido por el usuario el 2026-09-25, después de acotar a Compras a Bodega
-- (20260925163541). El alcance de sala cubría las filas de
-- `product_stock_params`, pero no lo que no es de ninguna sala:
--
--   · `stock_config` — los días de cobertura, de reorden, los cortes ABC/XYZ.
--     Un número acá recalcula el catálogo entero de las siete salas.
--   · `laboratorios` — ocultar un laboratorio lo saca de Mín·Máx en todas.
--
-- Las dos policies pedían `auth_can_edit_any(['minmax'])`: editar en CUALQUIER
-- alcance. Pasan a `auth_can_edit_scope_all(['minmax'])`.
ALTER POLICY stock_config_update ON public.stock_config
    USING      ((SELECT public.auth_can_edit_scope_all(ARRAY['minmax'])))
    WITH CHECK ((SELECT public.auth_can_edit_scope_all(ARRAY['minmax'])));

ALTER POLICY laboratorios_update ON public.laboratorios
    USING      ((SELECT public.auth_can_edit_scope_all(ARRAY['minmax'])))
    WITH CHECK ((SELECT public.auth_can_edit_scope_all(ARRAY['minmax'])));

-- Y cuatro funciones preguntaban «¿decide sobre todas las salas?» con
-- `auth_can_edit_scope_all(ARRAY['minmax','pedidos'])`: bastaba Pedidos con
-- alcance total. Compras lo tiene —despacha a todas las salas— así que podía
-- publicar Mín·Máx de otra sala, retirar un producto de las siete o marcar «ya
-- no rota». Quien corrige desde un pedido ya no pasa por acá
-- (`guardar_minmax_desde_pedido`), así que Pedidos deja de contar.
--
-- Medido antes de cambiarlo: todo cargo con Mín·Máx editable y alcance total
-- en Pedidos tiene también alcance total en Mín·Máx, salvo Compras. Nadie más
-- pierde nada.
--
-- Se reemplaza la condición dentro de la definición viva en vez de reescribir
-- los cuerpos: son cuatro funciones largas y el cambio es una sola expresión.
-- El `RAISE` de abajo impide que un reemplazo que no encontró nada pase por
-- aplicado.
DO $$
DECLARE
    f   regprocedure;
    def text;
    nuevo text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.discard_stock_drafts(integer)'::regprocedure,
        'public.zero_out_product_all_branches(integer,text)'::regprocedure,
        'public.publish_stock_params(integer,integer[],text)'::regprocedure,
        'public.marcar_ajuste_manual_minmax()'::regprocedure]
    LOOP
        def   := pg_get_functiondef(f);
        nuevo := regexp_replace(def,
                    'auth_can_edit_scope_all\(ARRAY\[''minmax'', ?''pedidos''\]\)',
                    'auth_can_edit_scope_all(ARRAY[''minmax''])', 'g');
        IF nuevo = def THEN
            RAISE EXCEPTION 'No se encontró la condición en %', f;
        END IF;
        EXECUTE nuevo;
    END LOOP;
END $$;

-- `calculate_stock_params` no miraba el alcance: con Mín·Máx de una sola sala
-- se podía recalcular el borrador de cualquier otra, y pisar el que alguien
-- estaba revisando. Mismo freno que `publish_stock_params`. El cron corre con
-- `service_role` y no pasa por acá.
DO $$
DECLARE
    f   regprocedure := 'public.calculate_stock_params(integer)'::regprocedure;
    def text := pg_get_functiondef(f);
    nuevo text;
BEGIN
    nuevo := regexp_replace(def,
        '(se requiere permiso de edición en Min/Max'';\s*END IF;)',
        E'\\1\n\n  IF (SELECT auth.role()) IS DISTINCT FROM ''service_role''\n     AND NOT (SELECT public.auth_can_edit_scope_all(ARRAY[''minmax'']))\n     AND p_erp_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN\n    RAISE EXCEPTION ''BRANCH_SCOPE_DENIED: tu permiso es solo para tu sucursal'';\n  END IF;');
    IF nuevo = def THEN
        RAISE EXCEPTION 'No se encontró dónde insertar el freno en %', f;
    END IF;
    EXECUTE nuevo;
END $$;
