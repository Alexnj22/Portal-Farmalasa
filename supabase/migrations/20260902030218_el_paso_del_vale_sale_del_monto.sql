SET lock_timeout = '5s';

/* ── EL PASO DE UN VALE SALE DEL MONTO, Y VALE PARA TODOS ──────────────────
 *
 * Regla del usuario (1-sep), mirando el reparto de `REM-1058`: $500 salieron
 * en $55.82 + $324.80 + $119.38, o sea monedas contadas a mano de tres bolsas
 * para completar un total redondo.
 *
 *   el monto es múltiplo de 10  →  cada bolsa aporta múltiplos de 10
 *   el monto es múltiplo de 5   →  cada bolsa aporta múltiplos de 5
 *   el monto trae centavos      →  sale exacto, como siempre
 *
 * «Así en un corte nunca salen monedas o billetes de 5.»
 *
 * ── Por qué DERIVADO y no un campo por motivo ─────────────────────────────
 *
 * Era `bolsas_tipos_salida.multiplo`, y sólo «Cambio por monedas» lo tenía: los
 * otros cinco motivos partían monedas y nada lo decía. Un campo por motivo
 * obliga a acertarle a cada uno, y el que se olvide vuelve a romper la bolsa en
 * silencio. Derivado del monto, la regla no se puede olvidar.
 *
 * El paso tiene que DIVIDIR al monto o la salida no puede cuadrar: por eso $55
 * va en pasos de 5 y no de 10, y por eso un monto que no es múltiplo de 5 —$7,
 * o cualquiera con centavos— sale exacto. Es la otra mitad de la regla del
 * 28-ago: «sólo si la salida de dinero es 125.75, ahí sí debe permitirlo».
 *
 * Se aplica sólo a las SALIDAS (`signo = -1`). Un reintegro devuelve a la bolsa
 * lo que sobró de un gasto, y ese monto es el que es.
 */

CREATE OR REPLACE FUNCTION public.paso_de_monto(p_monto numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE
SET search_path = public, extensions AS $$
    -- De mayor a menor: el de $10 primero, que es el que deja menos papeles
    -- sueltos. `null` cuando ninguno divide — ahí la salida va exacta.
    SELECT CASE
        WHEN p_monto IS NULL OR p_monto <= 0     THEN NULL
        WHEN mod(round(p_monto, 2), 10) = 0      THEN 10
        WHEN mod(round(p_monto, 2), 5)  = 0      THEN 5
        ELSE NULL
    END::numeric;
$$;

COMMENT ON FUNCTION public.paso_de_monto(numeric) IS
    'En cuánto se reparte un vale entre bolsas: 10 si el monto es múltiplo de 10, 5 si lo es de 5, NULL si trae centavos (sale exacto). Gemelo de pasoDeMonto en src/utils/bolsasReparto.js.';

REVOKE EXECUTE ON FUNCTION public.paso_de_monto(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paso_de_monto(numeric) TO authenticated, service_role;

COMMENT ON COLUMN public.bolsas_tipos_salida.multiplo IS
    'RETIRADO el 2026-09-01: el paso ya no se declara por motivo, se deriva del monto con paso_de_monto(). La columna queda por historia.';

-- `registrar_salida_de_bolsa` cambia SÓLO en cómo calcula el paso: donde antes
-- leía `t.multiplo`, ahora llama a `paso_de_monto(p_monto)` y sólo para las
-- salidas. El resto del cuerpo va idéntico — se reescribe entero porque
-- `CREATE OR REPLACE FUNCTION` no admite parches.
CREATE OR REPLACE FUNCTION public.registrar_salida_de_bolsa(p_tipo text, p_monto numeric, p_repartos jsonb, p_entidad text DEFAULT NULL::text, p_numero_boleta text DEFAULT NULL::text, p_foto_url text DEFAULT NULL::text, p_nota text DEFAULT NULL::text, p_recibido_por uuid DEFAULT NULL::uuid, p_metodo text DEFAULT NULL::text, p_vale uuid DEFAULT NULL::uuid)
 RETURNS bolsas_operaciones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    t public.bolsas_tipos_salida; v_oper public.bolsas_operaciones;
    v_yo uuid := (SELECT auth_employee_id());
    v_scope text := (SELECT auth_module_scope('bolsas'));
    v_mia bigint := (SELECT auth_employee_branch_id());
    v_branch bigint; v_suma numeric := 0; v_codigo text; r record; b public.bolsas;
    v_vale public.identidad_vales;
    v_entidad text := nullif(btrim(coalesce(p_entidad, '')), '');
    v_del_catalogo text;
    v_paso numeric;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO t FROM public.bolsas_tipos_salida WHERE codigo = p_tipo AND activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese motivo no existe.'; END IF;
    IF p_monto IS NULL OR p_monto < 0 THEN RAISE EXCEPTION 'Hay que decir cuanto.'; END IF;
    IF t.signo <> 0 AND p_monto = 0 THEN RAISE EXCEPTION 'Hay que decir cuanto.'; END IF;
    IF t.etiqueta_entidad IS NOT NULL AND v_entidad IS NULL THEN
        RAISE EXCEPTION 'Falta el dato: %.', t.etiqueta_entidad; END IF;

    -- ── ¿En cuánto se reparte? Lo decide el MONTO, para todos los vales ─────
    -- $500 sale en billetes de $10, $55 en billetes de $5, $125.75 exacto. Ya
    -- no depende del motivo: ver `paso_de_monto`.
    v_paso := CASE WHEN t.signo = -1 THEN public.paso_de_monto(p_monto) END;

    IF t.etiqueta_entidad IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.bolsas_entidades e WHERE e.tipo = t.codigo AND e.activo) THEN
        SELECT e.nombre INTO v_del_catalogo
          FROM public.bolsas_entidades e
         WHERE e.tipo = t.codigo AND e.activo
           AND upper(btrim(e.nombre)) = upper(v_entidad);
        IF v_del_catalogo IS NULL THEN
            RAISE EXCEPTION 'Ese/a % no esta en la lista.', lower(t.etiqueta_entidad); END IF;
        v_entidad := v_del_catalogo;
    END IF;

    IF t.pide_boleta AND btrim(coalesce(p_numero_boleta,'')) = '' THEN
        RAISE EXCEPTION 'Falta el numero de boleta.'; END IF;
    IF t.foto = 'OBLIGATORIA' AND btrim(coalesce(p_foto_url,'')) = '' THEN
        RAISE EXCEPTION 'Falta la foto del comprobante.'; END IF;

    IF t.pide_receptor THEN
        IF p_recibido_por IS NULL THEN RAISE EXCEPTION 'Falta quien se lleva el efectivo.'; END IF;
        IF p_vale IS NULL THEN
            RAISE EXCEPTION 'Falta comprobar la identidad de quien retira el efectivo.'; END IF;

        SELECT * INTO v_vale FROM public.identidad_vales
         WHERE token = p_vale FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Hay que comprobar la identidad de nuevo.'; END IF;
        IF v_vale.usado_at IS NOT NULL THEN
            RAISE EXCEPTION 'Esa comprobacion ya se uso. Hay que hacerla de nuevo.'; END IF;
        IF v_vale.created_at < now() - interval '5 minutes' THEN
            RAISE EXCEPTION 'La comprobacion de identidad vencio. Hay que hacerla de nuevo.'; END IF;
        IF v_vale.employee_id IS DISTINCT FROM p_recibido_por THEN
            RAISE EXCEPTION 'La identidad comprobada no es la de quien figura retirando el efectivo.'; END IF;

        UPDATE public.identidad_vales SET usado_at = now() WHERE token = p_vale;
    END IF;

    IF p_repartos IS NULL OR jsonb_array_length(p_repartos) = 0 THEN
        RAISE EXCEPTION 'Falta decir de que bolsa sale.'; END IF;

    FOR r IN SELECT (x->>'bolsa_id')::bigint AS bolsa_id, round((x->>'monto')::numeric, 2) AS monto
               FROM jsonb_array_elements(p_repartos) x LOOP
        SELECT * INTO b FROM public.bolsas WHERE id = r.bolsa_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Esa bolsa no existe.'; END IF;
        IF v_scope IS DISTINCT FROM 'ALL' AND b.branch_id IS DISTINCT FROM v_mia THEN
            RAISE EXCEPTION 'FORBIDDEN'; END IF;
        IF b.estado <> 'ABIERTA' THEN RAISE EXCEPTION 'La bolsa % ya salio de la sala.', b.folio; END IF;
        IF v_branch IS NULL THEN v_branch := b.branch_id;
        ELSIF v_branch <> b.branch_id THEN
            RAISE EXCEPTION 'Las bolsas de una misma salida tienen que ser de la misma sala.'; END IF;

        -- Ninguna bolsa rompe sus monedas cuando el monto no lo exige.
        IF v_paso IS NOT NULL AND mod(r.monto, v_paso) <> 0 THEN
            RAISE EXCEPTION 'De la bolsa % tienen que salir billetes de %: % no lo es.',
                b.folio, to_char(v_paso, 'FM999,999,990.00'),
                to_char(r.monto, 'FM999,999,990.00'); END IF;

        IF t.signo = -1 THEN
            IF r.monto <= 0 THEN RAISE EXCEPTION 'Cada monto tiene que ser mayor que cero.'; END IF;
            IF r.monto > public.bolsa_saldo(b.id) THEN
                RAISE EXCEPTION 'La bolsa % solo tiene %.', b.folio,
                    to_char(public.bolsa_saldo(b.id), 'FM999,999,990.00'); END IF;
        ELSIF t.signo = 1 THEN
            IF r.monto <= 0 THEN RAISE EXCEPTION 'Cada monto tiene que ser mayor que cero.'; END IF;
            IF r.monto > public.bolsa_reintegro_maximo(b.id) THEN
                RAISE EXCEPTION 'A la bolsa % solo le faltan %: una bolsa no puede tener mas de lo que se guardo.',
                    b.folio, to_char(public.bolsa_reintegro_maximo(b.id), 'FM999,999,990.00'); END IF;
        END IF;
        v_suma := v_suma + r.monto;
    END LOOP;

    IF t.signo <> 0 AND round(v_suma, 2) <> round(p_monto, 2) THEN
        RAISE EXCEPTION 'Lo que sale de las bolsas (%) no cuadra con el monto (%).',
            to_char(v_suma, 'FM999,999,990.00'), to_char(p_monto, 'FM999,999,990.00'); END IF;

    SELECT upper(btrim(coalesce(br.codigo, 'B'))) INTO v_codigo FROM public.branches br WHERE br.id = v_branch;

    INSERT INTO public.bolsas_operaciones
        (folio, branch_id, tipo, monto, entidad, numero_boleta, foto_url, nota,
         recibido_por, recibido_metodo, registrado_por)
    VALUES (t.prefijo || '-' || nextval('public.bolsas_operacion_folio_seq'),
         v_branch, t.codigo, round(p_monto, 2),
         v_entidad, nullif(btrim(coalesce(p_numero_boleta,'')), ''),
         nullif(btrim(coalesce(p_foto_url,'')), ''), nullif(btrim(coalesce(p_nota,'')), ''),
         CASE WHEN t.pide_receptor THEN p_recibido_por END,
         CASE WHEN t.pide_receptor THEN coalesce(v_vale.metodo, p_metodo) END, v_yo)
    RETURNING * INTO v_oper;

    FOR r IN SELECT (x->>'bolsa_id')::bigint AS bolsa_id, round((x->>'monto')::numeric, 2) AS monto
               FROM jsonb_array_elements(p_repartos) x LOOP
        INSERT INTO public.bolsas_movimientos (bolsa_id, operacion_id, vale_folio, monto, registrado_por)
        VALUES (r.bolsa_id, v_oper.id,
                'V-' || v_codigo || '-' || nextval('public.bolsas_vale_folio_seq'),
                t.signo * r.monto, v_yo);
        UPDATE public.bolsas SET updated_at = now() WHERE id = r.bolsa_id;
        INSERT INTO public.bolsas_eventos (bolsa_id, accion, monto, employee_id, nota)
        VALUES (r.bolsa_id,
                CASE WHEN t.signo = 0 THEN 'ABRIR' WHEN t.signo = 1 THEN 'REINTEGRO' ELSE 'SALIDA' END,
                t.signo * r.monto, v_yo, t.etiqueta || ' - ' || v_oper.folio);
    END LOOP;

    RETURN v_oper;
END;
$function$;
