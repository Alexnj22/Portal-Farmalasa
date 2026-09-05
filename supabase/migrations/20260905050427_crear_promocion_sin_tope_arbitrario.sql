SET lock_timeout = '5s';

-- ── El tope de 50 productos se va ────────────────────────────────────────
--
-- `crear_promocion` rechazaba más de 50 renglones con `DEMASIADOS_PRODUCTOS`, y
-- **ese número no tenía ningún motivo escrito**: ni en la función, ni en el
-- plan, ni en el changelog. Preguntado por el usuario el 2026-09-05 —«¿por qué
-- hay límite? si no es necesario quitalo»— y no hubo con qué defenderlo.
--
-- Medido antes de quitarlo, y el resultado desarma al propio tope:
--   ·  50 productos → `promocion_corte_del_lote` lee 47,174 bloques (369 MB), 3,889 ms
--   · 150 productos → 27,771 bloques (217 MB), 977 ms
-- **El caso que el tope PERMITÍA es más caro que el que prohibía.** No protegía
-- de nada, y el número no correspondía a ningún óptimo. (La diferencia es de
-- PLAN: con 50 ids el planificador elige peor que con 150.)
--
-- Se quita en vez de subirlo a otro número igual de arbitrario. Si algún día
-- medir demuestra que hace falta un tope, vuelve **con su número y su motivo**:
-- un límite que nadie puede explicar se termina saltando por la vía equivocada
-- —partir una campaña en dos promociones, que duplicaría lotes, tarjetas y
-- hojas de liquidación para lo que el laboratorio negoció como una sola.
--
-- Lo que SÍ se conserva es la guarda que importa: una promoción sin productos
-- no cuenta nada.
--
-- ⚠️ Queda ABIERTO: con muchos productos `promocion_corte_del_lote` lee entre
-- 217 y 369 MB por llamada, por encima del techo de 195 MB que vigila la
-- sección F de `gate:perf`. Hoy no lo ve porque no hay ninguna promoción viva.
CREATE OR REPLACE FUNCTION public.crear_promocion(p_nombre text, p_renglones jsonb, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor      uuid := public.auth_employee_id();
    v_promo_id   bigint;
    v_nombre     text := nullif(btrim(coalesce(p_nombre,'')), '');
    v_r          jsonb;
    v_rep        jsonb;
    v_renglon_id bigint;
    v_suma       integer;
    v_lote       integer;
    v_producto   integer;
    v_nombre_prod text;
    v_tiene      boolean;
    v_paga       text;
    v_prov       integer;
    v_n_renglones integer := 0;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;
    IF v_nombre IS NULL THEN
        RAISE EXCEPTION 'NOMBRE_REQUERIDO: la promoción necesita un nombre que la sala pueda reconocer';
    END IF;
    IF p_renglones IS NULL OR jsonb_array_length(p_renglones) = 0 THEN
        RAISE EXCEPTION 'SIN_PRODUCTOS: una promoción sin productos no cuenta nada';
    END IF;

    INSERT INTO public.promociones (nombre, nota, creado_por)
    VALUES (v_nombre, nullif(btrim(coalesce(p_nota,'')), ''), v_actor)
    RETURNING id INTO v_promo_id;

    FOR v_r IN SELECT * FROM jsonb_array_elements(p_renglones)
    LOOP
        v_producto := (v_r ->> 'erp_product_id')::integer;
        -- Vacío y ausente son lo mismo acá: «todavía no se sabe».
        v_lote     := nullif(v_r ->> 'lote_total', '')::integer;
        v_tiene    := coalesce((v_r ->> 'tiene_bono')::boolean, true);
        v_paga     := nullif(v_r ->> 'paga', '');
        v_prov     := nullif(v_r ->> 'supplier_id', '')::integer;

        SELECT p.nombre INTO v_nombre_prod FROM public.products p WHERE p.id = v_producto;
        IF v_nombre_prod IS NULL THEN
            RAISE EXCEPTION 'PRODUCTO_INEXISTENTE: el producto % no existe', v_producto;
        END IF;

        INSERT INTO public.promocion_renglon (
            promocion_id, erp_product_id, factor_unidades, inicio, fin,
            lote_total, tiene_bono, paga, supplier_id)
        VALUES (
            v_promo_id, v_producto,
            nullif(v_r ->> 'factor_unidades','')::smallint,
            (v_r ->> 'inicio')::date,
            nullif(v_r ->> 'fin','')::date,
            v_lote, v_tiene, v_paga, v_prov)
        RETURNING id INTO v_renglon_id;

        INSERT INTO public.promocion_renglon_tarifa (
            renglon_id, desde, bono_vendedor, bono_adm, bono_bodega, unidades_por_bono, creado_por)
        VALUES (
            v_renglon_id,
            (v_r ->> 'inicio')::date,
            coalesce((v_r ->> 'bono_vendedor')::numeric, 0),
            coalesce((v_r ->> 'bono_adm')::numeric, 0),
            coalesce((v_r ->> 'bono_bodega')::numeric, 0),
            greatest(coalesce((v_r ->> 'unidades_por_bono')::integer, 1), 1),
            v_actor);

        v_suma := 0;
        FOR v_rep IN SELECT * FROM jsonb_array_elements(coalesce(v_r -> 'reparto', '[]'::jsonb))
        LOOP
            INSERT INTO public.promocion_reparto (renglon_id, branch_id, asignado_original, asignado_vigente)
            VALUES (v_renglon_id,
                    (v_rep ->> 'branch_id')::bigint,
                    (v_rep ->> 'unidades')::numeric,
                    (v_rep ->> 'unidades')::numeric);
            v_suma := v_suma + coalesce((v_rep ->> 'unidades')::integer, 0);
        END LOOP;

        IF v_suma > 0 AND v_lote IS NULL THEN
            RAISE EXCEPTION 'REPARTO_SIN_LOTE: % reparte % unidades pero no dice de qué lote',
                v_nombre_prod, v_suma;
        END IF;
        IF v_suma > 0 AND v_suma <> v_lote THEN
            RAISE EXCEPTION 'REPARTO_NO_CUADRA: % reparte % de un lote de %',
                v_nombre_prod, v_suma, v_lote;
        END IF;

        v_n_renglones := v_n_renglones + 1;
    END LOOP;

    PERFORM public.promocion_log(
        v_promo_id, NULL, NULL, 'creada', NULL, v_nombre,
        v_n_renglones || ' producto(s)');

    RETURN json_build_object('id', v_promo_id, 'renglones', v_n_renglones);
END;
$function$;
