-- editar_renglon conserva las salas en 0 al reemplazar el reparto (2026-10-01).
--
-- El reparto se reemplazaba entero y sólo se reinsertaban las filas con más de
-- 0 unidades. Pero una fila en 0 significa «aplica en esta sala, sin lote
-- asignado» —y eran TODAS: 108 de 108 medidas ese día—, así que cambiar las
-- unidades de una sala borraba las demás marcas y el producto pasaba a contar
-- ventas en las 7 salas. Ahora se reinsertan también las de 0; quien llama
-- manda las salas marcadas, con o sin unidades.
--
-- Partido de la definición VIVA (md5 b37d47e58e7206ad0fee32460d9cea1b); el único
-- cambio es `> 0` → `>= 0` en el bucle del reparto. Probado en el branch de
-- pruebas: con reparto 100/0/0 quedan 3 filas; sin reparto no se toca.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.editar_renglon(p_renglon_id bigint, p_lote_total integer DEFAULT NULL::integer, p_factor_unidades smallint DEFAULT NULL::smallint, p_tiene_bono boolean DEFAULT NULL::boolean, p_paga text DEFAULT NULL::text, p_supplier_id integer DEFAULT NULL::integer, p_borrar_lote boolean DEFAULT false, p_cualquier_pres boolean DEFAULT false, p_reparto jsonb DEFAULT NULL::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_r     public.promocion_renglon%ROWTYPE;
    v_lote  integer;
    v_fac   smallint;
    v_tiene boolean;
    v_paga  text;
    v_prov  integer;
    v_suma  integer;
    v_rep   jsonb;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;

    SELECT * INTO v_r FROM public.promocion_renglon WHERE id = p_renglon_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: el renglón % no existe', p_renglon_id; END IF;

    v_lote  := CASE WHEN p_borrar_lote    THEN NULL
                    WHEN p_lote_total IS NOT NULL THEN p_lote_total
                    ELSE v_r.lote_total END;
    v_fac   := CASE WHEN p_cualquier_pres THEN NULL
                    WHEN p_factor_unidades IS NOT NULL THEN p_factor_unidades
                    ELSE v_r.factor_unidades END;
    v_tiene := coalesce(p_tiene_bono, v_r.tiene_bono);
    v_paga  := CASE WHEN NOT v_tiene THEN NULL ELSE coalesce(p_paga, v_r.paga) END;
    v_prov  := CASE WHEN v_paga IS DISTINCT FROM 'proveedor' THEN NULL
                    ELSE coalesce(p_supplier_id, v_r.supplier_id) END;

    IF v_lote IS NOT NULL AND v_lote <= 0 THEN
        RAISE EXCEPTION 'LOTE_INVALIDO: el lote es % — dejalo vacío si no se sabe', v_lote;
    END IF;
    IF v_tiene AND v_paga IS NULL THEN
        RAISE EXCEPTION 'FALTA_QUIEN_PAGA: si paga bono, hay que decir si lo cancela la empresa o un proveedor';
    END IF;
    IF v_paga = 'proveedor' AND v_prov IS NULL THEN
        RAISE EXCEPTION 'FALTA_EL_PROVEEDOR: lo paga un proveedor, hay que decir cuál';
    END IF;

    -- El reparto que va a quedar: el nuevo si vino, el de la tabla si no.
    IF p_reparto IS NOT NULL THEN
        SELECT coalesce(sum((x ->> 'unidades')::integer), 0) INTO v_suma
          FROM jsonb_array_elements(p_reparto) x;
    ELSE
        SELECT coalesce(sum(asignado_vigente), 0) INTO v_suma
          FROM public.promocion_reparto WHERE renglon_id = p_renglon_id;
    END IF;

    -- Se valida el estado FINAL, no el intermedio. Ésa es toda la diferencia.
    IF v_suma > 0 AND v_lote IS NULL THEN
        RAISE EXCEPTION 'REPARTO_SIN_LOTE: quedarían % unidades repartidas sin un lote que las respalde', v_suma;
    END IF;
    IF v_suma > 0 AND v_suma <> v_lote THEN
        RAISE EXCEPTION 'REPARTO_NO_CUADRA: el reparto sumaría % y el lote quedaría en %', v_suma, v_lote;
    END IF;

    UPDATE public.promocion_renglon
       SET lote_total      = v_lote,
           factor_unidades = v_fac,
           tiene_bono      = v_tiene,
           paga            = v_paga,
           supplier_id     = v_prov,
           updated_at      = now()
     WHERE id = p_renglon_id;

    IF p_reparto IS NOT NULL THEN
        DELETE FROM public.promocion_reparto WHERE renglon_id = p_renglon_id;
        FOR v_rep IN SELECT * FROM jsonb_array_elements(p_reparto)
        LOOP
            -- `>= 0` y no `> 0`: la fila en 0 es «aplica acá, sin lote».
            IF (v_rep ->> 'unidades')::integer >= 0 THEN
                INSERT INTO public.promocion_reparto
                    (renglon_id, branch_id, asignado_original, asignado_vigente)
                VALUES (p_renglon_id, (v_rep ->> 'branch_id')::bigint,
                        (v_rep ->> 'unidades')::integer, (v_rep ->> 'unidades')::integer);
            END IF;
        END LOOP;
    END IF;

    PERFORM public.promocion_log(
        v_r.promocion_id, p_renglon_id, NULL, 'renglon_editado',
        coalesce(v_r.lote_total::text, 'sin lote'),
        coalesce(v_lote::text, 'sin lote'),
        CASE WHEN v_tiene IS DISTINCT FROM v_r.tiene_bono
             THEN (CASE WHEN v_tiene THEN 'pasa a pagar bono' ELSE 'pasa a sólo medir' END)
             WHEN v_fac IS DISTINCT FROM v_r.factor_unidades THEN 'cambió la presentación'
             WHEN p_reparto IS NOT NULL THEN 'con reparto nuevo'
             ELSE NULL END);

    RETURN json_build_object('renglon_id', p_renglon_id, 'lote_total', v_lote, 'repartido', v_suma);
END;
$function$;
