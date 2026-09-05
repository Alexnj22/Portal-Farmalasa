SET lock_timeout = '5s';

-- Agregar productos a una promoción que ya existe.
--
-- Pedido del usuario el 2026-09-05: «no se puede agregar nuevos productos».
-- Y era literal: `crear_promocion` los mete todos de una vez y después no había
-- ninguna función para sumar uno. Una campaña a la que el laboratorio le agrega
-- un producto a mitad de mes había que rehacerla entera —perdiendo su avance,
-- su lote repartido y su descuento— o dejarla incompleta.
--
-- ── Por qué es una función y no un INSERT desde el navegador ──────────────
-- Las tres reglas que `crear_promocion` cobra al crear valen igual acá, y
-- ninguna se puede cobrar desde el cliente: el producto tiene que existir, el
-- renglón nace con su tarifa (sin ella ninguna venta se puede pagar, porque el
-- cálculo entra por `promocion_renglon_tarifa`), y si se reparte por sala la
-- suma tiene que dar exactamente el lote.
--
-- ── Lo que NO hace, a propósito ───────────────────────────────────────────
-- No toca el descuento del sistema de ventas. Ese descuento se guardó allá con
-- una lista de productos y una ventana de fechas; agregarle uno acá y no allá
-- deja las dos mitades diciendo cosas distintas, así que la pantalla lo avisa y
-- el descuento se corrige desde su propia ficha. Escribir en el sistema ajeno
-- en silencio es justo lo que el módulo evita en todos lados.
--
-- Un producto que la promoción YA tiene se saltea en vez de fallar: agregar 20
-- de un laboratorio donde 3 ya estaban es el caso normal, no un error.
CREATE OR REPLACE FUNCTION public.agregar_renglones_a_promocion(
    p_id bigint,
    p_renglones jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor      uuid := public.auth_employee_id();
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
    v_nuevos     integer := 0;
    v_repetidos  integer := 0;
    v_estado     text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;

    SELECT estado INTO v_estado FROM public.promociones WHERE id = p_id;
    IF v_estado IS NULL THEN
        RAISE EXCEPTION 'PROMOCION_INEXISTENTE: esa promoción ya no existe';
    END IF;
    -- Una promoción terminada es historia: sumarle un producto cambiaría lo que
    -- ya se pagó, y eso no se corrige agregando sino abriendo una nueva.
    IF v_estado = 'finalizada' THEN
        RAISE EXCEPTION 'PROMOCION_FINALIZADA: una promoción terminada no admite productos nuevos';
    END IF;

    IF p_renglones IS NULL OR jsonb_array_length(p_renglones) = 0 THEN
        RAISE EXCEPTION 'SIN_PRODUCTOS: no viene ningún producto que agregar';
    END IF;

    FOR v_r IN SELECT * FROM jsonb_array_elements(p_renglones)
    LOOP
        v_producto := (v_r ->> 'erp_product_id')::integer;

        IF EXISTS (SELECT 1 FROM public.promocion_renglon r
                    WHERE r.promocion_id = p_id AND r.erp_product_id = v_producto) THEN
            v_repetidos := v_repetidos + 1;
            CONTINUE;
        END IF;

        -- Vacío y ausente son lo mismo acá: «todavía no se sabe».
        v_lote  := nullif(v_r ->> 'lote_total', '')::integer;
        v_tiene := coalesce((v_r ->> 'tiene_bono')::boolean, true);
        v_paga  := nullif(v_r ->> 'paga', '');
        v_prov  := nullif(v_r ->> 'supplier_id', '')::integer;

        SELECT p.nombre INTO v_nombre_prod FROM public.products p WHERE p.id = v_producto;
        IF v_nombre_prod IS NULL THEN
            RAISE EXCEPTION 'PRODUCTO_INEXISTENTE: el producto % no existe', v_producto;
        END IF;

        INSERT INTO public.promocion_renglon (
            promocion_id, erp_product_id, factor_unidades, inicio, fin,
            lote_total, tiene_bono, paga, supplier_id)
        VALUES (
            p_id, v_producto,
            nullif(v_r ->> 'factor_unidades','')::smallint,
            (v_r ->> 'inicio')::date,
            nullif(v_r ->> 'fin','')::date,
            v_lote, v_tiene, v_paga, v_prov)
        RETURNING id INTO v_renglon_id;

        -- Sin tarifa el renglón no paga nada y nadie lo puede notar: el cálculo
        -- entra por acá con un LATERAL, y sin fila no hay vuelta.
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

        v_nuevos := v_nuevos + 1;
    END LOOP;

    IF v_nuevos > 0 THEN
        PERFORM public.promocion_log(
            p_id, NULL, NULL, 'productos_agregados', NULL, v_nuevos::text,
            v_nuevos || ' producto(s) agregado(s)');
    END IF;

    RETURN json_build_object('agregados', v_nuevos, 'repetidos', v_repetidos);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.agregar_renglones_a_promocion(bigint, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agregar_renglones_a_promocion(bigint, jsonb) TO authenticated, service_role;
