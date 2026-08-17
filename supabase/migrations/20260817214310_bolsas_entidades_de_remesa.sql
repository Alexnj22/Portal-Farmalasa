-- A quién se le entregó el dinero: un CATÁLOGO, no un campo libre.
--
-- Una remesa no se le entrega a un banco. El campo decía «Banco» y lo que la
-- sala escribía era la remesadora (las dos primeras salidas reales dicen
-- MONEYGRAM y RIA), así que el rótulo pedía un dato y recibía otro. Y escrito a
-- mano, la misma remesadora entra de tres formas distintas —«Ria», «RIA»,
-- «Ria Money»— y después no hay con qué agrupar.
--
-- La lista la dictó el usuario el 2026-08-17: MONEYGRAM, RIA, TRANSNETWORK,
-- INTERMEX, UNITELLER, BARRI, DOLEX, VIAMERICAS. En ese orden, que es el de uso.
--
-- Vive en una tabla y no en el `.jsx` por la regla del proyecto: una lista de
-- opciones que existe como tabla no se escribe a mano —escrita dos veces, una
-- remesadora nueva aparece en la base y no en la pantalla, o al revés—. Es por
-- tipo de salida a propósito: mañana «Pago a proveedor» puede tener su propia
-- lista sin tocar una línea del formulario, y hoy que no la tiene sigue siendo
-- un campo libre.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.bolsas_entidades (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo       text NOT NULL REFERENCES public.bolsas_tipos_salida(codigo) ON UPDATE CASCADE,
    nombre     text NOT NULL,
    orden      smallint NOT NULL DEFAULT 100,
    activo     boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bolsas_entidades_unica UNIQUE (tipo, nombre)
);

COMMENT ON TABLE public.bolsas_entidades IS
    'Opciones del campo «entidad» de cada tipo de salida de bolsa (las remesadoras de una remesa). Sin filas para un tipo, ese campo sigue siendo libre.';

CREATE INDEX IF NOT EXISTS bolsas_entidades_tipo_idx ON public.bolsas_entidades (tipo);

ALTER TABLE public.bolsas_entidades ENABLE ROW LEVEL SECURITY;

-- Mismas dos policies que su tabla hermana `bolsas_tipos_salida`: se lee con el
-- permiso del módulo y no se escribe desde el navegador — es un catálogo, se
-- toca por migración. `(SELECT ...)` alrededor de las `auth_*` es obligatorio:
-- sin el initplan, Postgres las evalúa por fila.
DROP POLICY IF EXISTS bolsas_entidades_select ON public.bolsas_entidades;
CREATE POLICY bolsas_entidades_select ON public.bolsas_entidades
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('bolsas', 'can_view')));

DROP POLICY IF EXISTS bloqueo_global ON public.bolsas_entidades;
CREATE POLICY bloqueo_global ON public.bolsas_entidades
    FOR ALL TO public
    USING ((SELECT auth_no_bloqueado()));

INSERT INTO public.bolsas_entidades (tipo, nombre, orden) VALUES
    ('REMESA', 'MONEYGRAM',   10),
    ('REMESA', 'RIA',         20),
    ('REMESA', 'TRANSNETWORK',30),
    ('REMESA', 'INTERMEX',    40),
    ('REMESA', 'UNITELLER',   50),
    ('REMESA', 'BARRI',       60),
    ('REMESA', 'DOLEX',       70),
    ('REMESA', 'VIAMERICAS',  80)
ON CONFLICT (tipo, nombre) DO NOTHING;

-- El rótulo del campo sale del catálogo de tipos, así que el formulario y los
-- dos papeles cambian con esta línea.
UPDATE public.bolsas_tipos_salida
   SET etiqueta_entidad = 'Remesadora'
 WHERE codigo = 'REMESA';

-- ── El servidor no confía en el desplegable ─────────────────────────────────
-- Que la pantalla ofrezca una lista no impide mandar cualquier cosa por la RPC.
-- Cuando el tipo TIENE catálogo, la entidad tiene que ser una de sus filas.
CREATE OR REPLACE FUNCTION public.registrar_salida_de_bolsa(
    p_tipo text, p_monto numeric, p_repartos jsonb,
    p_entidad text DEFAULT NULL::text, p_numero_boleta text DEFAULT NULL::text,
    p_foto_url text DEFAULT NULL::text, p_nota text DEFAULT NULL::text,
    p_recibido_por uuid DEFAULT NULL::uuid, p_metodo text DEFAULT NULL::text,
    p_vale uuid DEFAULT NULL::uuid)
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
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO t FROM public.bolsas_tipos_salida WHERE codigo = p_tipo AND activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese motivo no existe.'; END IF;
    IF p_monto IS NULL OR p_monto < 0 THEN RAISE EXCEPTION 'Hay que decir cuánto.'; END IF;
    IF t.signo <> 0 AND p_monto = 0 THEN RAISE EXCEPTION 'Hay que decir cuánto.'; END IF;
    IF t.etiqueta_entidad IS NOT NULL AND v_entidad IS NULL THEN
        RAISE EXCEPTION 'Falta el dato: %.', t.etiqueta_entidad; END IF;

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
    IF t.pide_foto AND btrim(coalesce(p_foto_url,'')) = '' THEN
        RAISE EXCEPTION 'Falta la foto del comprobante.'; END IF;

    IF t.pide_receptor THEN
        IF p_recibido_por IS NULL THEN RAISE EXCEPTION 'Falta quién se lleva el efectivo.'; END IF;
        IF p_vale IS NULL THEN
            RAISE EXCEPTION 'Falta comprobar la identidad de quien retira el efectivo.'; END IF;

        -- El vale lo emitió `probar_identidad` y vale para UNA sola operación:
        -- se toma con FOR UPDATE y se marca usado en la misma transacción, así
        -- dos pestañas abiertas no pueden gastarlo dos veces.
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

REVOKE EXECUTE ON FUNCTION public.registrar_salida_de_bolsa(text, numeric, jsonb, text, text, text, text, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_salida_de_bolsa(text, numeric, jsonb, text, text, text, text, uuid, text, uuid) TO authenticated, service_role;

-- ── El vale impreso tiene que decir el MISMO rótulo que el formulario ───────
-- El papel decía «Banco: MONEYGRAM». El rótulo sale del tipo de salida, así que
-- se devuelve junto con la salida en vez de escribirlo en el `.jsx`.
DROP FUNCTION IF EXISTS public.get_salidas_de_bolsa(bigint);
CREATE FUNCTION public.get_salidas_de_bolsa(p_bolsa_id bigint)
 RETURNS TABLE(movimiento_id bigint, vale_folio text, monto numeric,
               registrado_at timestamp with time zone, impreso_at timestamp with time zone,
               anulado_at timestamp with time zone, operacion_id bigint, operacion_folio text,
               tipo text, etiqueta text, etiqueta_entidad text, monto_operacion numeric,
               entidad text, numero_boleta text, foto_url text, nota text,
               recibido_nombre text, recibido_metodo text, registrado_nombre text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT m.id, m.vale_folio, m.monto, m.registrado_at, m.impreso_at, m.anulado_at,
           o.id, o.folio, o.tipo, t.etiqueta, t.etiqueta_entidad, o.monto, o.entidad,
           o.numero_boleta, o.foto_url, o.nota, er.name, o.recibido_metodo, eq.name
      FROM public.bolsas_movimientos m
      JOIN public.bolsas_operaciones o ON o.id = m.operacion_id
      JOIN public.bolsas_tipos_salida t ON t.codigo = o.tipo
      LEFT JOIN public.employees er ON er.id = o.recibido_por
      LEFT JOIN public.employees eq ON eq.id = m.registrado_por
     WHERE m.bolsa_id = p_bolsa_id
       AND (SELECT auth_has_module_permission('bolsas','can_view'))
     ORDER BY m.registrado_at;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_salidas_de_bolsa(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_salidas_de_bolsa(bigint) TO authenticated, service_role;
