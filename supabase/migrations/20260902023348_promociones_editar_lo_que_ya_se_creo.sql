-- Una promoción creada no se podía corregir.
--
-- `editar_tarifa_renglon` y `extender_renglon` existían desde el primer día y
-- ninguna pantalla las llamaba; y para el lote, la presentación, el reparto y
-- quitar un producto no había función. O sea que un error de dedo al crear
-- obligaba a rehacer la promoción entera — y borrarla tampoco se podía.
--
-- ── Qué se puede corregir y qué no ──────────────────────────────────────────
-- El lote, la presentación y el reparto son DECLARACIONES sobre un acuerdo: se
-- corrigen, y su corrección es retroactiva a propósito — el cálculo vuelve a
-- leer las ventas con el dato bueno. Los MONTOS no: ésos ya se ganaron, y por
-- eso siguen entrando por `editar_tarifa_renglon`, que agrega una fila con
-- fecha en vez de pisar la anterior.
--
-- Cambiar la presentación es el más delicado de los tres: cambia QUÉ ventas
-- cuentan, no cuánto vale cada una. Se permite porque un factor mal elegido al
-- crear deja la promoción midiendo el producto equivocado, y eso no se arregla
-- de ninguna otra forma.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- editar_renglon — lote, presentación y quién paga
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.editar_renglon(
    p_renglon_id      bigint,
    p_lote_total      integer  DEFAULT NULL,
    p_factor_unidades smallint DEFAULT NULL,
    p_tiene_bono      boolean  DEFAULT NULL,
    p_paga            text     DEFAULT NULL,
    p_supplier_id     integer  DEFAULT NULL,
    -- `NULL` en los campos de arriba significa «no lo toques». Para BORRAR el
    -- lote o la presentación hace falta decirlo aparte: si no, no habría forma
    -- de volver a «no se sabe» ni a «cualquier presentación».
    p_borrar_lote     boolean  DEFAULT false,
    p_cualquier_pres  boolean  DEFAULT false
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
    v_paga  := CASE WHEN NOT v_tiene THEN NULL
                    ELSE coalesce(p_paga, v_r.paga) END;
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

    -- Un lote que baja por debajo de lo ya repartido dejaría a las salas con más
    -- de lo que existe. Se avisa en vez de dejar el estado inconsistente.
    SELECT coalesce(sum(asignado_vigente), 0) INTO v_suma
      FROM public.promocion_reparto WHERE renglon_id = p_renglon_id;
    IF v_lote IS NOT NULL AND v_suma > 0 AND v_suma <> v_lote THEN
        RAISE EXCEPTION 'REPARTO_NO_CUADRA: las salas tienen % repartidas y el lote quedaría en % — corregí el reparto primero',
            v_suma, v_lote;
    END IF;
    IF v_lote IS NULL AND v_suma > 0 THEN
        RAISE EXCEPTION 'REPARTO_SIN_LOTE: hay % unidades repartidas; quitá el reparto antes de dejar el lote vacío', v_suma;
    END IF;

    UPDATE public.promocion_renglon
       SET lote_total      = v_lote,
           factor_unidades = v_fac,
           tiene_bono      = v_tiene,
           paga            = v_paga,
           supplier_id     = v_prov,
           updated_at      = now()
     WHERE id = p_renglon_id;

    PERFORM public.promocion_log(
        v_r.promocion_id, p_renglon_id, NULL, 'renglon_editado',
        coalesce(v_r.lote_total::text, 'sin lote'),
        coalesce(v_lote::text, 'sin lote'),
        CASE WHEN v_tiene IS DISTINCT FROM v_r.tiene_bono
             THEN (CASE WHEN v_tiene THEN 'pasa a pagar bono' ELSE 'pasa a sólo medir' END)
             WHEN v_fac IS DISTINCT FROM v_r.factor_unidades
             THEN 'cambió la presentación'
             ELSE NULL END);

    RETURN json_build_object('renglon_id', p_renglon_id, 'lote_total', v_lote);
END;
$function$;

COMMENT ON FUNCTION public.editar_renglon(bigint, integer, smallint, boolean, text, integer, boolean, boolean) IS
  'Corrige el lote, la presentación y quién paga. Su efecto es retroactivo a propósito: son declaraciones sobre el acuerdo, y el cálculo vuelve a leer las ventas con el dato bueno. Los MONTOS no pasan por acá — ésos van con fecha por editar_tarifa_renglon.';

-- ─────────────────────────────────────────────────────────────────────────────
-- editar_reparto — reemplaza el reparto de un renglón
-- ─────────────────────────────────────────────────────────────────────────────
-- Reemplaza en vez de parchear: un reparto es un conjunto que tiene que sumar el
-- lote, y aplicarlo sala por sala pasa por estados donde no cuadra.
CREATE OR REPLACE FUNCTION public.editar_reparto(
    p_renglon_id bigint,
    p_reparto    jsonb
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_r     public.promocion_renglon%ROWTYPE;
    v_rep   jsonb;
    v_suma  integer := 0;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;

    SELECT * INTO v_r FROM public.promocion_renglon WHERE id = p_renglon_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: el renglón % no existe', p_renglon_id; END IF;

    SELECT coalesce(sum((x ->> 'unidades')::integer), 0) INTO v_suma
      FROM jsonb_array_elements(coalesce(p_reparto, '[]'::jsonb)) x;

    IF v_suma > 0 AND v_r.lote_total IS NULL THEN
        RAISE EXCEPTION 'REPARTO_SIN_LOTE: no se puede repartir % unidades de un lote que no está declarado', v_suma;
    END IF;
    IF v_suma > 0 AND v_suma <> v_r.lote_total THEN
        RAISE EXCEPTION 'REPARTO_NO_CUADRA: reparte % de un lote de %', v_suma, v_r.lote_total;
    END IF;

    -- Se borra y se reescribe. Las marcas de aviso se pierden a propósito: con
    -- un reparto nuevo, el 80% de antes ya no significa lo mismo y la sala tiene
    -- derecho a que le vuelvan a avisar sobre su número nuevo.
    DELETE FROM public.promocion_reparto WHERE renglon_id = p_renglon_id;

    FOR v_rep IN SELECT * FROM jsonb_array_elements(coalesce(p_reparto, '[]'::jsonb))
    LOOP
        IF (v_rep ->> 'unidades')::integer > 0 THEN
            INSERT INTO public.promocion_reparto
                (renglon_id, branch_id, asignado_original, asignado_vigente)
            VALUES (p_renglon_id, (v_rep ->> 'branch_id')::bigint,
                    (v_rep ->> 'unidades')::integer, (v_rep ->> 'unidades')::integer);
        END IF;
    END LOOP;

    PERFORM public.promocion_log(
        v_r.promocion_id, p_renglon_id, NULL, 'reparto_editado',
        NULL, v_suma::text, 'se rehízo el reparto entre las salas');

    RETURN json_build_object('renglon_id', p_renglon_id, 'repartido', v_suma);
END;
$function$;

COMMENT ON FUNCTION public.editar_reparto(bigint, jsonb) IS
  'Reemplaza el reparto de un renglón. Reemplaza y no parchea porque un reparto es un conjunto que debe sumar el lote: aplicarlo sala por sala pasa por estados que no cuadran.';

-- ─────────────────────────────────────────────────────────────────────────────
-- quitar_renglon / borrar_promocion
-- ─────────────────────────────────────────────────────────────────────────────
-- Sólo mientras nadie haya decidido un excedente suyo: una decisión tomada es un
-- hecho del que alguien tiene que poder rendir cuentas, y borrar su renglón la
-- dejaría huérfana.
CREATE OR REPLACE FUNCTION public.quitar_renglon(p_renglon_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_r     public.promocion_renglon%ROWTYPE;
    v_prod  text;
    v_dec   integer;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;

    SELECT * INTO v_r FROM public.promocion_renglon WHERE id = p_renglon_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: el renglón % no existe', p_renglon_id; END IF;

    SELECT count(*) INTO v_dec FROM public.promocion_excedente
     WHERE renglon_id = p_renglon_id AND estado <> 'por_decidir';
    IF v_dec > 0 THEN
        RAISE EXCEPTION 'TIENE_DECISIONES: ya se decidieron % excedentes de este producto; no se puede quitar', v_dec;
    END IF;

    SELECT nombre INTO v_prod FROM public.products WHERE id = v_r.erp_product_id;

    PERFORM public.promocion_log(
        v_r.promocion_id, NULL, NULL, 'renglon_quitado',
        v_prod, NULL, 'se quitó de la promoción');

    DELETE FROM public.promocion_renglon WHERE id = p_renglon_id;

    RETURN json_build_object('quitado', p_renglon_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.borrar_promocion(p_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_pm    public.promociones%ROWTYPE;
    v_dec   integer;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;

    SELECT * INTO v_pm FROM public.promociones WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: la promoción % no existe', p_id; END IF;

    -- Una promoción que ya corrió es historia: se finaliza, no se borra. Sólo el
    -- borrador —lo que nunca contó para nadie— se puede eliminar.
    IF v_pm.estado <> 'borrador' THEN
        RAISE EXCEPTION 'YA_CORRIO: «%» no está en borrador; una promoción que ya contó no se borra', v_pm.nombre;
    END IF;

    SELECT count(*) INTO v_dec FROM public.promocion_excedente e
      JOIN public.promocion_renglon r ON r.id = e.renglon_id
     WHERE r.promocion_id = p_id AND e.estado <> 'por_decidir';
    IF v_dec > 0 THEN
        RAISE EXCEPTION 'TIENE_DECISIONES: ya se decidieron % excedentes; no se puede borrar', v_dec;
    END IF;

    PERFORM public.promocion_log(NULL, NULL, NULL, 'promocion_borrada',
        v_pm.nombre, NULL, 'estaba en borrador');

    DELETE FROM public.promociones WHERE id = p_id;

    RETURN json_build_object('borrada', p_id);
END;
$function$;

COMMENT ON FUNCTION public.borrar_promocion(bigint) IS
  'Borra una promoción que sigue en BORRADOR. Una que ya corrió es historia: se finaliza, no se borra.';

REVOKE EXECUTE ON FUNCTION public.editar_renglon(bigint, integer, smallint, boolean, text, integer, boolean, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.editar_reparto(bigint, jsonb)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.quitar_renglon(bigint)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.borrar_promocion(bigint)       FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.editar_renglon(bigint, integer, smallint, boolean, text, integer, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.editar_reparto(bigint, jsonb)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quitar_renglon(bigint)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.borrar_promocion(bigint)        TO authenticated, service_role;
