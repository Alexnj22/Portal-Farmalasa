SET lock_timeout = '5s';

-- ═══ El carné guarda POR DÓNDE salió el papel ═══════════════════════════════
--
-- Pedido del usuario el 2026-08-20: «que salga en la card dónde se imprimió y
-- quién autorizó».
--
-- Lo segundo ya estaba (`emitido_por`). Lo primero **no se guardaba**, y la
-- pantalla lo mostraba igual: pintaba `branch_id` bajo el rótulo «Salió en…»,
-- pero esa columna la escribe `emitir_carne_temporal` con
-- `v_emp.branch_id` — la sucursal de LA PERSONA, no la de la ticketera. O sea
-- que la tarjeta decía una cosa y mostraba otra, y en el caso más común
-- —administración imprimiendo para alguien de sala— decía exactamente lo
-- contrario de la verdad.
--
-- Es la misma familia que la regla del sello: un rótulo que promete un dato que
-- nadie midió. Se corrige guardando el dato de verdad, no cambiando el rótulo.
--
-- ── `impreso_en` es «a dónde se mandó», no «de dónde salió papel» ───────────
-- Lo elige una persona en el diálogo de impresión y se guarda ANTES de que el
-- papel salga, porque el carné se emite primero y se imprime después. Que la
-- cola de esa sala lo haya sacado no se puede saber desde acá — el acuse vive
-- en `cola_impresion`. NULL significa «la computadora de quien lo emitió», que
-- es la opción «Esta computadora» del diálogo.
ALTER TABLE public.carnes_temporales
    ADD COLUMN IF NOT EXISTS impreso_en bigint REFERENCES public.branches(id);

CREATE INDEX IF NOT EXISTS idx_carnes_temporales_impreso_en
    ON public.carnes_temporales(impreso_en);

COMMENT ON COLUMN public.carnes_temporales.impreso_en IS
 'La sucursal por cuya ticketera se mando el papel. NULL = la computadora de quien lo emitio. NO es la sucursal del empleado: esa es branch_id.';

COMMENT ON COLUMN public.carnes_temporales.branch_id IS
 'La sucursal del EMPLEADO al momento de emitirlo. Por donde salio el papel es impreso_en.';

-- La firma cambia, así que la vieja se cae primero: dejar las dos deja a
-- PostgREST con una sobrecarga y el llamador elige por accidente.
DROP FUNCTION IF EXISTS public.emitir_carne_temporal(uuid, text);

CREATE OR REPLACE FUNCTION public.emitir_carne_temporal(
    p_employee_id uuid,
    p_motivo      text   DEFAULT NULL,
    p_impreso_en  bigint DEFAULT NULL
)
 RETURNS json
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    -- Sin 0/O ni 1/I/L: aunque el valor no se imprime, alguien puede tener que
    -- leerlo de un registro y confundir esas letras cuesta una investigación.
    c_alfabeto constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    c_largo    constant int  := 10;
    v_yo        uuid := (SELECT auth_employee_id());
    v_emp       record;
    v_puede     boolean;
    v_bytes     bytea;
    v_secreto   text := '';
    v_vence     timestamptz;
    v_id        bigint;
    i           int;
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

    SELECT e.id, e.name, e.status, e.branch_id, e.carne_pendiente
      INTO v_emp
      FROM public.employees e WHERE e.id = p_employee_id;

    IF v_emp.id IS NULL THEN
        RAISE EXCEPTION 'No encontre a esa persona.';
    END IF;
    IF v_emp.status IS DISTINCT FROM 'ACTIVO' THEN
        RAISE EXCEPTION 'Esa persona no esta activa: no se le puede dar un carne.';
    END IF;

    v_puede := (SELECT auth_can_edit_any(ARRAY['carne_temporal']))
        OR (v_emp.carne_pendiente AND (SELECT auth_can_edit_any(ARRAY['staff_list'])));
    IF NOT v_puede THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

    -- El `::timestamp` NO es decorativo: sin él, `date AT TIME ZONE text`
    -- resuelve a la variante `timestamptz → timestamp` y devuelve el MEDIODÍA.
    v_vence := (((now() AT TIME ZONE 'America/El_Salvador')::date + 1)::timestamp
                AT TIME ZONE 'America/El_Salvador');

    v_bytes := extensions.gen_random_bytes(c_largo);
    FOR i IN 1..c_largo LOOP
        v_secreto := v_secreto
            || substr(c_alfabeto, 1 + (get_byte(v_bytes, i - 1) % length(c_alfabeto)), 1);
    END LOOP;

    -- El papel anterior de esa persona muere en el acto.
    UPDATE public.carnes_temporales
       SET anulado_el = now()
     WHERE employee_id = p_employee_id AND anulado_el IS NULL AND vence_el > now();

    INSERT INTO public.carnes_temporales
        (employee_id, secreto_hash, vence_el, emitido_por, branch_id, impreso_en, motivo)
    VALUES (
        p_employee_id,
        encode(extensions.digest(v_secreto, 'sha256'), 'hex'),
        v_vence, v_yo, v_emp.branch_id, p_impreso_en,
        nullif(btrim(coalesce(p_motivo,'')), '')
    )
    RETURNING id INTO v_id;

    RETURN json_build_object(
        'ok', true,
        'id', v_id,
        'secreto', v_secreto,
        'vence_el', v_vence,
        'employee_id', p_employee_id,
        'nombre', v_emp.name
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.emitir_carne_temporal(uuid, text, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.emitir_carne_temporal(uuid, text, bigint) TO authenticated, service_role;

COMMENT ON FUNCTION public.emitir_carne_temporal(uuid, text, bigint) IS
 'Emite un carne de papel que vale hasta medianoche (SV). Devuelve el secreto en claro una sola vez, anula el anterior de esa persona y guarda por que sucursal se mando a imprimir.';
