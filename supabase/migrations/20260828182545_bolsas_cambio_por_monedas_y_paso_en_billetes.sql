-- Sacar dinero de una bolsa para cambiarlo por monedas, sin romper las monedas
-- que ya tiene adentro.
--
-- Regla del usuario (2026-08-28), dictada mirando un retiro de $2,000 de las
-- cinco bolsas de La Popular: «no se debe tomar en cuenta los impares de 10,
-- porque no se entregan monedas». Y la otra mitad, que es la que evita que la
-- regla estorbe: «solo si la salida de dinero es 125.75 ahi si debe permitirlo
-- y decir de que bolsa sacarlo».
--
-- O sea que la regla la dispara el MONTO PEDIDO y no el motivo. El motivo sólo
-- declara EN CUÁNTO paga; si el monto es múltiplo de eso, cada bolsa aporta
-- múltiplos y su impar se queda adentro, y si el monto trae impar, sale exacto
-- como siempre. Escrito al revés —el motivo prohíbe el impar— «Cambio por
-- monedas» rechazaría justamente el caso que el usuario pidió permitir.
--
-- Va como dato del catálogo y no como `if` en la pantalla por lo mismo de
-- siempre en este módulo: un motivo nuevo aparecería en la base y no en el
-- formulario. Y el servidor revalida, porque que la pantalla reparta bien no
-- impide mandar otra cosa por la RPC.
SET lock_timeout = '5s';

ALTER TABLE public.bolsas_tipos_salida
    ADD COLUMN IF NOT EXISTS multiplo numeric,
    ADD COLUMN IF NOT EXISTS leyenda  text;

ALTER TABLE public.bolsas_tipos_salida
    DROP CONSTRAINT IF EXISTS bolsas_tipos_multiplo_positivo;
ALTER TABLE public.bolsas_tipos_salida
    ADD CONSTRAINT bolsas_tipos_multiplo_positivo CHECK (multiplo IS NULL OR multiplo > 0);

COMMENT ON COLUMN public.bolsas_tipos_salida.multiplo IS
    'En cuanto paga este motivo. NULL = exacto (los cinco de siempre). 10 = billetes de $10: '
    'cuando el monto pedido es multiplo de 10 cada bolsa aporta multiplos de 10 y sus monedas '
    'se quedan adentro; un monto con impar ($125.75) sale exacto igual.';
COMMENT ON COLUMN public.bolsas_tipos_salida.leyenda IS
    'Lo que hay que saber de este motivo. Se dice en la pantalla y se imprime en el vale que '
    'queda dentro de la bolsa: administracion cuenta contra ese papel.';

-- El motivo. Pide receptor: son billetes saliendo de una bolsa y alguien tiene
-- que quedar con el nombre puesto, aunque el dinero no salga de la sala.
INSERT INTO public.bolsas_tipos_salida
    (codigo, etiqueta, prefijo, signo, etiqueta_entidad, pide_boleta, pide_receptor,
     foto, orden, activo, multiplo, leyenda)
VALUES ('CAMBIO_MONEDAS', 'Cambio por monedas', 'CMB', -1, NULL, false, true,
        'OPCIONAL', 45, true, 10, 'El dinero queda en sala de ventas.')
ON CONFLICT (codigo) DO UPDATE
   SET etiqueta      = EXCLUDED.etiqueta,
       prefijo       = EXCLUDED.prefijo,
       signo         = EXCLUDED.signo,
       pide_boleta   = EXCLUDED.pide_boleta,
       pide_receptor = EXCLUDED.pide_receptor,
       foto          = EXCLUDED.foto,
       orden         = EXCLUDED.orden,
       activo        = EXCLUDED.activo,
       multiplo      = EXCLUDED.multiplo,
       leyenda       = EXCLUDED.leyenda;

-- ── El servidor revalida el paso ────────────────────────────────────────────
-- Lo unico que cambia respecto de la version anterior es `v_redondo` y el
-- chequeo dentro del bucle de repartos.
CREATE OR REPLACE FUNCTION public.registrar_salida_de_bolsa(
    p_tipo text, p_monto numeric, p_repartos jsonb, p_entidad text DEFAULT NULL::text,
    p_numero_boleta text DEFAULT NULL::text, p_foto_url text DEFAULT NULL::text,
    p_nota text DEFAULT NULL::text, p_recibido_por uuid DEFAULT NULL::uuid,
    p_metodo text DEFAULT NULL::text, p_vale uuid DEFAULT NULL::uuid)
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
    v_redondo boolean := false;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO t FROM public.bolsas_tipos_salida WHERE codigo = p_tipo AND activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese motivo no existe.'; END IF;
    IF p_monto IS NULL OR p_monto < 0 THEN RAISE EXCEPTION 'Hay que decir cuánto.'; END IF;
    IF t.signo <> 0 AND p_monto = 0 THEN RAISE EXCEPTION 'Hay que decir cuánto.'; END IF;
    IF t.etiqueta_entidad IS NOT NULL AND v_entidad IS NULL THEN
        RAISE EXCEPTION 'Falta el dato: %.', t.etiqueta_entidad; END IF;

    -- ── ¿Este monto se paga en billetes? ────────────────────────────────────
    -- Lo decide el MONTO y no el motivo: $2,000 sale redondo y las monedas se
    -- quedan en las bolsas; $125.75 sale exacto, que es lo que el usuario pidió
    -- expresamente que se permitiera.
    v_redondo := t.multiplo IS NOT NULL AND t.signo <> 0
                 AND mod(round(p_monto, 2), t.multiplo) = 0;

    -- El catálogo manda cuando existe. Se compara normalizado —sin espacios de
    -- sobra y sin distinguir mayúsculas— porque el valor viene de un
    -- desplegable, pero el nombre que se GUARDA es el de la fila: así el dato
    -- coincide con el catálogo por construcción y no por suerte.
    IF t.etiqueta_entidad IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.bolsas_entidades e WHERE e.tipo = t.codigo AND e.activo) THEN
        SELECT e.nombre INTO v_del_catalogo
          FROM public.bolsas_entidades e
         WHERE e.tipo = t.codigo AND e.activo
           AND upper(btrim(e.nombre)) = upper(v_entidad);
        IF v_del_catalogo IS NULL THEN
            RAISE EXCEPTION 'Ese/a % no está en la lista.', lower(t.etiqueta_entidad); END IF;
        v_entidad := v_del_catalogo;
    END IF;

    IF t.pide_boleta AND btrim(coalesce(p_numero_boleta,'')) = '' THEN
        RAISE EXCEPTION 'Falta el número de boleta.'; END IF;
    IF t.foto = 'OBLIGATORIA' AND btrim(coalesce(p_foto_url,'')) = '' THEN
        RAISE EXCEPTION 'Falta la foto del comprobante.'; END IF;

    IF t.pide_receptor THEN
        IF p_recibido_por IS NULL THEN RAISE EXCEPTION 'Falta quién se lleva el efectivo.'; END IF;
        IF p_vale IS NULL THEN
            RAISE EXCEPTION 'Falta comprobar la identidad de quien retira el efectivo.'; END IF;

        -- El vale lo emitió la comprobación de identidad y vale para UNA sola
        -- operación: se toma con FOR UPDATE y se marca usado en la misma
        -- transacción, así dos pestañas abiertas no pueden gastarlo dos veces.
        SELECT * INTO v_vale FROM public.identidad_vales
         WHERE token = p_vale FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Hay que comprobar la identidad de nuevo.'; END IF;
        IF v_vale.usado_at IS NOT NULL THEN
            RAISE EXCEPTION 'Esa comprobación ya se usó. Hay que hacerla de nuevo.'; END IF;
        IF v_vale.created_at < now() - interval '5 minutes' THEN
            RAISE EXCEPTION 'La comprobación de identidad vencio. Hay que hacerla de nuevo.'; END IF;
        IF v_vale.employee_id IS DISTINCT FROM p_recibido_por THEN
            RAISE EXCEPTION 'La identidad comprobada no es la de quien figura retirando el efectivo.'; END IF;

        UPDATE public.identidad_vales SET usado_at = now() WHERE token = p_vale;
    END IF;

    IF p_repartos IS NULL OR jsonb_array_length(p_repartos) = 0 THEN
        RAISE EXCEPTION 'Falta decir de qué bolsa sale.'; END IF;

    FOR r IN SELECT (x->>'bolsa_id')::bigint AS bolsa_id, round((x->>'monto')::numeric, 2) AS monto
               FROM jsonb_array_elements(p_repartos) x LOOP
        SELECT * INTO b FROM public.bolsas WHERE id = r.bolsa_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Esa bolsa no existe.'; END IF;
        IF v_scope IS DISTINCT FROM 'ALL' AND b.branch_id IS DISTINCT FROM v_mia THEN
            RAISE EXCEPTION 'FORBIDDEN'; END IF;
        IF b.estado <> 'ABIERTA' THEN RAISE EXCEPTION 'La bolsa % ya salió de la sala.', b.folio; END IF;
        IF v_branch IS NULL THEN v_branch := b.branch_id;
        ELSIF v_branch <> b.branch_id THEN
            RAISE EXCEPTION 'Las bolsas de una misma salida tienen que ser de la misma sala.'; END IF;

        -- Ninguna bolsa rompe sus monedas cuando el monto no lo exige.
        IF v_redondo AND mod(r.monto, t.multiplo) <> 0 THEN
            RAISE EXCEPTION 'De la bolsa % tienen que salir billetes de %: % no lo es.',
                b.folio, to_char(t.multiplo, 'FM999,999,990.00'),
                to_char(r.monto, 'FM999,999,990.00'); END IF;

        IF t.signo = -1 THEN
            IF r.monto <= 0 THEN RAISE EXCEPTION 'Cada monto tiene que ser mayor que cero.'; END IF;
            IF r.monto > public.bolsa_saldo(b.id) THEN
                RAISE EXCEPTION 'La bolsa % sólo tiene %.', b.folio,
                    to_char(public.bolsa_saldo(b.id), 'FM999,999,990.00'); END IF;
        ELSIF t.signo = 1 THEN
            IF r.monto <= 0 THEN RAISE EXCEPTION 'Cada monto tiene que ser mayor que cero.'; END IF;
            IF r.monto > public.bolsa_reintegro_maximo(b.id) THEN
                RAISE EXCEPTION 'A la bolsa % sólo le faltan %: una bolsa no puede tener más de lo que se guardó.',
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
                t.signo * r.monto, v_yo, t.etiqueta || ' · ' || v_oper.folio);
    END LOOP;

    RETURN v_oper;
END;
$function$;

-- ── La leyenda viaja al vale ────────────────────────────────────────────────
-- El papel que queda DENTRO de la bolsa es contra lo que administracion cuenta:
-- sin la leyenda, un vale de $2,000 se lee como dinero que salio de la empresa.
DROP FUNCTION IF EXISTS public.get_salidas_de_bolsa(bigint);
CREATE FUNCTION public.get_salidas_de_bolsa(p_bolsa_id bigint)
 RETURNS TABLE(movimiento_id bigint, vale_folio text, monto numeric,
               registrado_at timestamp with time zone, impreso_at timestamp with time zone,
               anulado_at timestamp with time zone, operacion_id bigint, operacion_folio text,
               tipo text, etiqueta text, etiqueta_entidad text, monto_operacion numeric,
               entidad text, numero_boleta text, foto_url text, nota text,
               recibido_nombre text, recibido_metodo text, registrado_nombre text,
               leyenda text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT m.id, m.vale_folio, m.monto, m.registrado_at, m.impreso_at, m.anulado_at,
           o.id, o.folio, o.tipo, t.etiqueta, t.etiqueta_entidad, o.monto, o.entidad,
           o.numero_boleta, o.foto_url, o.nota, er.name, o.recibido_metodo, eq.name,
           t.leyenda
      FROM public.bolsas_movimientos m
      JOIN public.bolsas_operaciones o ON o.id = m.operacion_id
      JOIN public.bolsas_tipos_salida t ON t.codigo = o.tipo
      LEFT JOIN public.employees er ON er.id = o.recibido_por
      LEFT JOIN public.employees eq ON eq.id = m.registrado_por
     WHERE m.bolsa_id = p_bolsa_id
       AND (SELECT auth_has_module_permission('bolsas','can_view'))
     ORDER BY m.registrado_at;
$function$;

-- El DROP se lleva los permisos: se reponen tal como estaban.
REVOKE EXECUTE ON FUNCTION public.get_salidas_de_bolsa(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_salidas_de_bolsa(bigint) TO authenticated, service_role;
