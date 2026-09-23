-- El valorizado del conteo sólo con «Ver el valorizado», también en la base
-- (paso 1 de 2). Regla 5 extendida, docs/PLAN-CERRAR-AUTORIZACION-2026-08-09.md.
--
-- El conteo ya tenía su permiso —`conteo_inventario_ver_montos`, «Ver el
-- valorizado»—, pero sólo lo miraba la pantalla: la base mandaba igual el costo
-- de cada renglón (`get_conteo_items_*`, con la guarda de «ver sistema», que es
-- otra pregunta) y la ficha del conteo salía con `*`, o sea con
-- `valor_faltante`/`valor_sobrante` adentro. Los cargos con ese permiso son
-- exactamente los mismos que tienen el de costos.
--
-- Postgres no puede esconder una columna según quién mira, y las funciones de
-- lectura del conteo son INVOKER (el RLS decide qué conteos ve cada sala).
-- Pasarlas a DEFINER obligaría a reescribir ese alcance a mano en siete
-- funciones, entre ellas la que ya tumbó el portal por lenta. La salida es
-- sacar el costo a una tabla aparte cuyo RLS es el permiso:
--
--   · `conteo_inventario_costos` (item_id, costo_unitario): sin el permiso no
--     devuelve filas, así que el costo llega NULL solo, sin tocar el alcance.
--     La mantiene un disparador sobre `conteo_inventario_items`; los que
--     escriben (DEFINER) no cambian.
--   · Las cuatro lecturas que usaban `ci.costo_unitario` lo toman de ahí, y las
--     dos que hacían `ci.*` enumeran columnas (paso 2 cierra la columna).
--   · `recalcular_totales_conteo` guarda el total con el costo completo: la
--     llaman sólo funciones DEFINER, que leen como dueño. Se le quita el
--     EXECUTE a `authenticated` para que nadie lo recalcule «a ciegas».
--   · `get_conteos_valor(ids)`: el faltante/sobrante guardado, sólo con el
--     permiso y con el alcance de sala del módulo.
--   · `finalizar_conteo_inventario` devuelve los montos sólo con el permiso.

SET lock_timeout = '5s';

-- ── 1 · La tabla del costo ─────────────────────────────────────────────────
CREATE TABLE public.conteo_inventario_costos (
    item_id        uuid PRIMARY KEY REFERENCES public.conteo_inventario_items(id) ON DELETE CASCADE,
    costo_unitario numeric,
    created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conteo_inventario_costos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conteo_inventario_costos FROM anon, authenticated;
GRANT SELECT ON public.conteo_inventario_costos TO authenticated;
CREATE POLICY bloqueo_global ON public.conteo_inventario_costos AS RESTRICTIVE
    FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));
CREATE POLICY conteo_inventario_costos_select ON public.conteo_inventario_costos
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('conteo_inventario_ver_montos', 'can_view')));

INSERT INTO public.conteo_inventario_costos (item_id, costo_unitario)
SELECT id, costo_unitario FROM public.conteo_inventario_items;

CREATE FUNCTION public.conteo_item_copiar_costo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    INSERT INTO public.conteo_inventario_costos (item_id, costo_unitario)
    VALUES (NEW.id, NEW.costo_unitario)
    ON CONFLICT (item_id) DO UPDATE SET costo_unitario = EXCLUDED.costo_unitario
     WHERE conteo_inventario_costos.costo_unitario IS DISTINCT FROM EXCLUDED.costo_unitario;
    RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.conteo_item_copiar_costo() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER conteo_item_copiar_costo
    AFTER INSERT OR UPDATE OF costo_unitario ON public.conteo_inventario_items
    FOR EACH ROW EXECUTE FUNCTION public.conteo_item_copiar_costo();

-- ── 2 · Las lecturas toman el costo de ahí ─────────────────────────────────
DO $mig$
DECLARE
    v_costo  constant text := '(SELECT cc.costo_unitario FROM public.conteo_inventario_costos cc WHERE cc.item_id = ci.id)';
    v_cols   constant text := 'ci.id, ci.conteo_id, ci.erp_product_id, ci.source_inventory_id, ci.presentacion, ci.detalle, ci.lote, ci.fecha_vencimiento, ci.is_vencidos, ci.sistema_cantidad, ci.fisico_cantidad, ci.diferencia, ci.estado_item, ci.nota, ci.contado_por, ci.contado_at, ci.es_agregado_manual, ci.source_sync_key, ci.sistema_inicial, ci.fisico_primer_conteo, ci.recontado_por, ci.recontado_at, ci.grupo_key';
    r record;
    v_def text; v_src text; v_nuevo text;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
          ('public.conteo_lineas_netas(uuid)'::regprocedure,
           E'           ci.costo_unitario,\n',
           E'           ' || v_costo || E' AS costo_unitario,\n', 1),
          ('public.get_conteo_items_jsonb(uuid)'::regprocedure,
           'CASE WHEN v_ver THEN ci.costo_unitario END AS costo_unitario',
           'CASE WHEN v_ver THEN ' || v_costo || ' END AS costo_unitario', 1),
          ('public.get_conteo_resumen(uuid)'::regprocedure,
           'CASE WHEN v_ver THEN COALESCE(SUM(GREATEST(-ci.diferencia, 0) * COALESCE(ci.costo_unitario, 0)), 0) END',
           'CASE WHEN v_ver AND (SELECT public.auth_has_module_permission(''conteo_inventario_ver_montos'', ''can_view'')) THEN COALESCE(SUM(GREATEST(-ci.diferencia, 0) * COALESCE(' || v_costo || ', 0)), 0) END', 1),
          ('public.get_conteo_resumen(uuid)'::regprocedure,
           'CASE WHEN v_ver THEN COALESCE(SUM(GREATEST( ci.diferencia, 0) * COALESCE(ci.costo_unitario, 0)), 0) END',
           'CASE WHEN v_ver AND (SELECT public.auth_has_module_permission(''conteo_inventario_ver_montos'', ''can_view'')) THEN COALESCE(SUM(GREATEST( ci.diferencia, 0) * COALESCE(' || v_costo || ', 0)), 0) END', 1),
          ('public.get_conteo_items_search(uuid,text,text,integer,integer,integer,integer[],text)'::regprocedure,
           'SELECT ci.*, p.nombre AS p_nombre',
           'SELECT ' || v_cols || ', ' || v_costo || ' AS costo_unitario, p.nombre AS p_nombre', 1),
          ('public.get_conteo_products_page(uuid,text,text,integer,integer,integer,text,text,text)'::regprocedure,
           'SELECT ci.*, p.nombre AS p_nombre',
           'SELECT ' || v_cols || ', p.nombre AS p_nombre', 1)
        ) AS t(fn, ancla, reemplazo, veces)
    LOOP
        SELECT prosrc INTO v_src FROM pg_proc WHERE oid = r.fn;
        IF (length(v_src) - length(replace(v_src, r.ancla, ''))) / length(r.ancla) <> r.veces THEN
            RAISE EXCEPTION 'CUERPO_INESPERADO: % (%)', r.fn, left(r.ancla, 60);
        END IF;
        v_def := pg_get_functiondef(r.fn);
        v_nuevo := replace(v_def, r.ancla, r.reemplazo);
        EXECUTE v_nuevo;
    END LOOP;
END
$mig$;

-- Nadie del navegador la llama; la llaman `finalizar_conteo_inventario` y
-- `recontar_conteo_item`, DEFINER. Llamada por un usuario sin el permiso,
-- guardaría el total con el costo en NULL.
REVOKE EXECUTE ON FUNCTION public.recalcular_totales_conteo(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3 · El faltante/sobrante guardado, sólo con el permiso ─────────────────
CREATE FUNCTION public.get_conteos_valor(p_ids uuid[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_sala bigint;
BEGIN
    IF NOT coalesce((SELECT public.auth_no_bloqueado()), false)
       OR NOT coalesce((SELECT public.auth_has_module_permission('conteo_inventario_ver_montos', 'can_view')), false)
       OR NOT coalesce((SELECT public.auth_has_module_permission('conteo_inventario', 'can_view')), false) THEN
        RETURN '[]'::json;
    END IF;
    -- El alcance del módulo, igual que el RLS de `conteos_inventario`.
    IF (SELECT public.auth_module_scope('conteo_inventario')) IS DISTINCT FROM 'ALL' THEN
        v_sala := (SELECT public.auth_employee_branch_id());
    END IF;
    RETURN coalesce((
        SELECT json_agg(json_build_object('id', c.id, 'valor_faltante', c.valor_faltante,
                                          'valor_sobrante', c.valor_sobrante))
          FROM public.conteos_inventario c
         WHERE c.id = ANY (p_ids)
           AND (v_sala IS NULL OR c.branch_id = v_sala)), '[]'::json);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_conteos_valor(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteos_valor(uuid[]) TO authenticated, service_role;

DO $mig$
DECLARE
    v_ancla constant text := $a$'valor_faltante', v_res.valor_faltante, 'valor_sobrante', v_res.valor_sobrante$a$;
    v_nuevo constant text := $a$'valor_faltante', CASE WHEN (SELECT public.auth_has_module_permission('conteo_inventario_ver_montos', 'can_view')) THEN v_res.valor_faltante END, 'valor_sobrante', CASE WHEN (SELECT public.auth_has_module_permission('conteo_inventario_ver_montos', 'can_view')) THEN v_res.valor_sobrante END$a$;
    v_fn regprocedure;
    v_src text;
BEGIN
    SELECT oid INTO v_fn FROM pg_proc WHERE proname = 'finalizar_conteo_inventario' AND pronamespace = 'public'::regnamespace;
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_fn;
    IF (length(v_src) - length(replace(v_src, v_ancla, ''))) / length(v_ancla) <> 1 THEN
        RAISE EXCEPTION 'CUERPO_INESPERADO: finalizar_conteo_inventario';
    END IF;
    EXECUTE replace(pg_get_functiondef(v_fn), v_ancla, v_nuevo);
END
$mig$;
