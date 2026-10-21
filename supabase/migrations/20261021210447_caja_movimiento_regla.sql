-- El catálogo de movimientos de caja, dicho por la base (auditoría 2026-10-21)
--
-- `operar-caja` no leía `caja_tipos_movimiento`: boleta, foto obligatoria,
-- quién recibe, tipo apagado y sentido los cuidaba sólo la pantalla. Y «Otro»
-- se usaba para lo que tiene su propio tipo —anticipos, Mapfre, remesas,
-- pagos a proveedores, correcciones— sin comprobante y por cualquier monto.
--
-- Decisión del usuario (2026-10-21): si el concepto de «Otro» es algo que se
-- anota en otro lado, se BLOQUEA y se dice dónde; y «Otro», el pago a
-- proveedor y el gasto llevan comprobante, o quedan pendientes de autorización.
SET lock_timeout = '5s';

-- ── 1. Sin comprobante → autorización, como bandera del tipo ────────────────
ALTER TABLE public.caja_tipos_movimiento
  ADD COLUMN IF NOT EXISTS sin_comprobante_autoriza boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.caja_tipos_movimiento.sin_comprobante_autoriza IS
  'Sin foto del comprobante el movimiento igual se hace, pero queda pendiente de autorización (requests_caja). Desde una bolsa no hay esa salida: la foto es obligatoria.';

UPDATE public.caja_tipos_movimiento SET sin_comprobante_autoriza = true
 WHERE codigo IN ('OTRO_ENTRADA', 'OTRO_SALIDA', 'PAGO_PROVEEDOR', 'COMPRA');

-- La pantalla de salidas nunca pidió boleta para estos dos (su catálogo dice
-- `false`) y el de la caja decía `true`: 41 de 48 y 49 de 58 sin boleta. Lo que
-- prueba el pago es el COMPROBANTE, y eso ahora lo exige la bandera de arriba.
UPDATE public.caja_tipos_movimiento SET pide_boleta = false
 WHERE codigo IN ('PAGO_PROVEEDOR', 'COMPRA');

-- ── 2. Lo que NO va en «Otro», y dónde va ────────────────────────────────────
--
-- Una lista, en la base: la lee la pantalla para avisar al escribir y la lee
-- el juez para frenar. Los patrones se escriben para que valgan igual en
-- JavaScript y en Postgres —sin `\m`/`\y`, con `(^|[^a-z])` como borde— y se
-- comparan contra el texto en minúsculas y sin tildes.
CREATE TABLE IF NOT EXISTS public.caja_conceptos_de_otro_lado (
  id         bigserial PRIMARY KEY,
  sentido    text NOT NULL CHECK (sentido IN ('ENTRADA', 'SALIDA')),
  patron     text NOT NULL,
  va_en      text NOT NULL,
  orden      integer NOT NULL DEFAULT 100,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.caja_conceptos_de_otro_lado ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS caja_conceptos_de_otro_lado_select ON public.caja_conceptos_de_otro_lado;
CREATE POLICY caja_conceptos_de_otro_lado_select ON public.caja_conceptos_de_otro_lado
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.caja_conceptos_de_otro_lado (sentido, orden, patron, va_en)
SELECT * FROM (VALUES
  -- Entradas
  ('ENTRADA', 10, '(^|[^a-z])(por error|correcc|corregi|ajuste|se ingreso (dos|2) veces|anotad[oa] (mal|al reves)|era de [0-9.$ ]+ no de)', 'si es para arreglar un movimiento que quedó mal, ábrelo en la lista del día y usa «Corregir»'),
  ('ENTRADA', 20, '(^|[^a-z])credito', 'el abono a un crédito se cobra en «Créditos»'),
  ('ENTRADA', 30, 'mapfre|asegurad', 'anótalo en «Pago de asegurado Mapfre»'),
  ('ENTRADA', 40, '(^|[^a-z])(anticip|adelant|encarg|apart|reserv|abono (de|para|del|por) |mayoreo|cancelacion|se solicito|pedido)', 'anótalo en «Apartar o encargar»'),
  ('ENTRADA', 50, 'inyecc|(^|[^a-z])aplicacion', 'anótalo en «Aplicación de inyección»'),
  ('ENTRADA', 60, 'glucosa', 'anótalo en «Prueba de glucosa»'),
  ('ENTRADA', 70, 'domicilio', 'anótalo en «Servicio a domicilio»'),
  ('ENTRADA', 90, 'sobrante|faltante', 'un sobrante o un faltante se resuelve desde el corte, no se anota aparte'),
  ('ENTRADA', 80, 'caess|delsur|(^|[^a-z])(pos|remesa|promerica)([^a-z]|$)', 'anótalo en «POS Promerica»'),
  -- Salidas
  ('SALIDA', 10, '(^|[^a-z])(por error|correcc|corregi|ajuste|se (ingreso|realizo|hizo) (como )?entrada|era remesa|anotad[oa] (mal|al reves))', 'si es para arreglar un movimiento que quedó mal, ábrelo en la lista del día y usa «Corregir»'),
  ('SALIDA', 20, '(^|[^a-z])(remesa|pos|promerica|moneygram|western|transnetwork|ria)([^a-z]|$)', 'anótalo en «POS Promerica»'),
  ('SALIDA', 30, '(anticip|adelant|prestamo).{0,30}(emplead|salario|sueldo|planilla)|(emplead|salario|sueldo).{0,30}(anticip|adelant)', 'anótalo en «Anticipo a un empleado»'),
  ('SALIDA', 40, 'bonific|comision', 'anótalo en «Pago de bonificación»'),
  ('SALIDA', 50, 'moneda|sencillo|(^|[^a-z])feria', 'anótalo en «Cambio por monedas»'),
  ('SALIDA', 60, 'devoluc|devolv|reembols|(anticip|adelant|encarg|apartad|mayoreo)', 'si se le regresa dinero a un cliente, anótalo en «Devolución a un cliente»; si retira lo que apartó, usa «Retirar» en el apartado; si es un pago por un trabajo o una compra, en «Gasto o compra urgente»'),
  ('SALIDA', 70, 'proveedor|(^|[^a-z])(pepsi|dizasa|distribuidora|drogueria|laboratorio)', 'anótalo en «Pago a proveedor»'),
  ('SALIDA', 80, '(^|[^a-z])(agua|almuerzo|cena|desayuno|comida|refrigerio|pastel|cumple|insumo|papeleria|limpieza|impuesto|alcaldia|municipal|luz|energia|internet|telefono|plaga|fumigac|reparac|arreglo|mantenimiento|aire acondicionado|gasolina|combustible|pasaje|transporte)', 'anótalo en «Gasto o compra urgente»')
) v(sentido, orden, patron, va_en)
WHERE NOT EXISTS (SELECT 1 FROM public.caja_conceptos_de_otro_lado);

-- ── 3. EL juez ───────────────────────────────────────────────────────────────
--
-- Devuelve `{error, autoriza}`. `error` no nulo = no se escribe. `autoriza` =
-- se escribe pero queda pendiente de autorización.
--
-- La llaman `operar-caja` (todo lo que entra y sale del cajón) y
-- `registrar_salida_de_bolsa` (lo que sale de una bolsa, con `p_de_bolsa`: ahí
-- no hay autorización y el comprobante es obligatorio).
CREATE OR REPLACE FUNCTION public.caja_movimiento_regla(
    p_sentido text, p_tipo text, p_concepto text, p_tiene_foto boolean,
    p_forma_pago text DEFAULT 'EFECTIVO', p_tiene_receptor boolean DEFAULT false,
    p_de_bolsa boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  t        public.caja_tipos_movimiento%ROWTYPE;
  v_texto  text;
  v_va_en  text;
  -- Apagados en el menú pero escritos por un flujo propio: el retiro de lo
  -- apartado y el abono de un faltante desde el corte.
  v_de_un_flujo text[] := ARRAY['APLICA_ANTICIPO', 'ABONO_FALTANTE'];
BEGIN
  IF nullif(btrim(coalesce(p_tipo, '')), '') IS NULL THEN
    RETURN json_build_object('error', 'Falta elegir qué tipo de movimiento es.');
  END IF;
  SELECT * INTO t FROM public.caja_tipos_movimiento WHERE codigo = p_tipo;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Ese tipo de movimiento no existe.');
  END IF;
  IF NOT t.activo AND NOT (t.codigo = ANY (v_de_un_flujo)) THEN
    RETURN json_build_object('error', 'Ese tipo de movimiento ya no se usa: elige otro de la lista.');
  END IF;
  IF t.sentido <> p_sentido THEN
    RETURN json_build_object('error', CASE t.sentido WHEN 'ENTRADA'
      THEN '«' || t.etiqueta || '» es una entrada, no una salida.'
      ELSE '«' || t.etiqueta || '» es una salida, no una entrada.' END);
  END IF;
  IF t.foto = 'OBLIGATORIA' AND NOT coalesce(p_tiene_foto, false)
     AND coalesce(p_forma_pago, 'EFECTIVO') = 'EFECTIVO' THEN
    RETURN json_build_object('error', 'Falta la foto del comprobante.');
  END IF;
  IF p_sentido = 'SALIDA' AND t.identifica_receptor AND NOT coalesce(p_tiene_receptor, false) THEN
    RETURN json_build_object('error', 'Falta quién se lleva el efectivo.');
  END IF;

  IF t.codigo IN ('OTRO_ENTRADA', 'OTRO_SALIDA') THEN
    -- El concepto llega con el rótulo adelante («Otro · …»): se quita para
    -- medir lo que la persona escribió de verdad.
    v_texto := btrim(regexp_replace(lower(translate(coalesce(p_concepto, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
                                    '^\s*otro\s*([·:\-]\s*)?', ''));
    IF length(regexp_replace(v_texto, '[^a-z0-9]', '', 'g')) < 10 THEN
      RETURN json_build_object('error', 'En «Otro» escribe de qué fue, con detalle.');
    END IF;
    SELECT c.va_en INTO v_va_en
      FROM public.caja_conceptos_de_otro_lado c
     WHERE c.activo AND c.sentido = p_sentido AND v_texto ~ c.patron
     ORDER BY c.orden, c.id
     LIMIT 1;
    IF v_va_en IS NOT NULL THEN
      RETURN json_build_object('error', 'Esto no va en «Otro»: ' || v_va_en || '.', 'va_en', v_va_en);
    END IF;
  END IF;

  IF t.sin_comprobante_autoriza AND NOT coalesce(p_tiene_foto, false) THEN
    IF p_de_bolsa THEN
      RETURN json_build_object('error',
        'Lo que sale de una bolsa para «' || t.etiqueta || '» lleva la foto del comprobante.');
    END IF;
    RETURN json_build_object('error', NULL, 'autoriza', true);
  END IF;
  RETURN json_build_object('error', NULL, 'autoriza', false);
END $function$;
REVOKE ALL ON FUNCTION public.caja_movimiento_regla(text, text, text, boolean, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caja_movimiento_regla(text, text, text, boolean, text, boolean, boolean) TO authenticated, service_role;

-- ── 4. Pedir la autorización: ahora también para el efectivo ────────────────
-- Definición viva con dos cambios: el efectivo se acepta cuando su tipo lleva
-- `sin_comprobante_autoriza`, y los textos dicen «movimiento».
CREATE OR REPLACE FUNCTION public.caja_ingreso_pedir_autorizacion(p_movimiento bigint, p_pide uuid, p_nota text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_mov public.caja_movimientos_portal%ROWTYPE;
  v_sol uuid;
BEGIN
  SELECT * INTO v_mov FROM public.caja_movimientos_portal WHERE id = p_movimiento FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese movimiento no existe.'; END IF;
  IF v_mov.anulado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese movimiento está anulado.'; END IF;
  IF v_mov.forma_pago = 'EFECTIVO' AND NOT EXISTS (
       SELECT 1 FROM public.caja_tipos_movimiento t
        WHERE t.codigo = v_mov.tipo_codigo AND t.sin_comprobante_autoriza) THEN
    RAISE EXCEPTION 'Ese movimiento en efectivo no necesita autorización.';
  END IF;
  IF v_mov.autorizacion IN ('PENDIENTE', 'APROBADA') THEN
    RAISE EXCEPTION 'Ese movimiento ya está %.', CASE v_mov.autorizacion WHEN 'PENDIENTE' THEN 'esperando autorización' ELSE 'autorizado' END;
  END IF;

  INSERT INTO public.approval_requests (type, employee_id, status, note, metadata)
  VALUES ('CAJA_INGRESO_AUTORIZACION', p_pide, 'PENDING',
          nullif(btrim(coalesce(p_nota, '')), ''),
          jsonb_build_object(
            'movimiento_portal', v_mov.id, 'branch_id', v_mov.branch_id,
            'fecha', v_mov.fecha, 'monto', v_mov.monto, 'forma_pago', v_mov.forma_pago,
            'sentido', v_mov.tipo,
            'concepto', v_mov.concepto, 'detalle', v_mov.detalle,
            'tipo_codigo', v_mov.tipo_codigo, 'foto_url', v_mov.foto_url,
            'numero_boleta', v_mov.numero_boleta,
            'comprobante_total', v_mov.comprobante_total,
            'reenvio', v_mov.autorizacion = 'RECHAZADA',
            'rechazo_anterior', CASE WHEN v_mov.autorizacion = 'RECHAZADA' THEN v_mov.autorizacion_nota END))
  RETURNING id INTO v_sol;

  UPDATE public.caja_movimientos_portal
     SET autorizacion = 'PENDIENTE', autorizacion_solicitud = v_sol,
         autorizacion_por = NULL, autorizacion_at = NULL, updated_at = now()
   WHERE id = v_mov.id;
  RETURN v_sol;
END $function$;
REVOKE ALL ON FUNCTION public.caja_ingreso_pedir_autorizacion(bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caja_ingreso_pedir_autorizacion(bigint, uuid, text) TO service_role;

-- ── 5. Decidir: los textos ya no suponen tarjeta ────────────────────────────
-- Definición viva con un cambio: la forma y el sentido del aviso salen del
-- movimiento. Antes un efectivo se habría anunciado «por transferencia».
CREATE OR REPLACE FUNCTION public.caja_ingreso_resolver(p_solicitud uuid, p_aprobar boolean, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_yo     uuid := public.auth_employee_id();
  v_sol    public.approval_requests%ROWTYPE;
  v_mov    public.caja_movimientos_portal%ROWTYPE;
  v_nota   text := nullif(btrim(coalesce(p_nota, '')), '');
  v_titulo text;
  v_cuerpo text;
  v_forma  text;
  v_que    text;
BEGIN
  IF v_yo IS NULL OR NOT public.puede_aprobar_modulo(v_yo, 'requests_caja') THEN
    RAISE EXCEPTION 'No tienes permiso para autorizar movimientos de caja.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sol FROM public.approval_requests WHERE id = p_solicitud FOR UPDATE;
  IF NOT FOUND OR v_sol.type <> 'CAJA_INGRESO_AUTORIZACION' THEN
    RAISE EXCEPTION 'No existe esa solicitud de autorización.';
  END IF;
  IF v_sol.status <> 'PENDING' THEN RAISE EXCEPTION 'Esa solicitud ya está resuelta.'; END IF;
  IF v_sol.employee_id = v_yo THEN
    RAISE EXCEPTION 'No puedes autorizar un movimiento que anotaste tú.';
  END IF;
  IF NOT p_aprobar AND v_nota IS NULL THEN
    RAISE EXCEPTION 'Para rechazarlo escribe qué prueba hace falta.';
  END IF;

  SELECT * INTO v_mov FROM public.caja_movimientos_portal
   WHERE id = (v_sol.metadata ->> 'movimiento_portal')::bigint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El movimiento de esa solicitud ya no existe.'; END IF;
  -- Anulado (o pasado a efectivo con una corrección) ya no hay nada que autorizar.
  IF v_mov.anulado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese movimiento ya se anuló: no hay nada que autorizar.'; END IF;

  UPDATE public.approval_requests
     SET status = CASE WHEN p_aprobar THEN 'APPROVED' ELSE 'REJECTED' END,
         approver_id = v_yo, approver_note = v_nota, updated_at = now()
   WHERE id = p_solicitud;

  UPDATE public.caja_movimientos_portal
     SET autorizacion = CASE WHEN p_aprobar THEN 'APROBADA' ELSE 'RECHAZADA' END,
         autorizacion_por = v_yo, autorizacion_at = now(), autorizacion_nota = v_nota,
         updated_at = now()
   WHERE id = v_mov.id;

  v_forma := CASE v_mov.forma_pago WHEN 'TARJETA' THEN 'con tarjeta'
                                   WHEN 'TRANSFERENCIA' THEN 'por transferencia'
                                   ELSE 'en efectivo' END;
  v_que := CASE WHEN v_mov.tipo = 'SALIDA' THEN 'La salida' ELSE 'El ingreso' END;
  v_titulo := CASE WHEN v_mov.tipo = 'SALIDA'
                   THEN CASE WHEN p_aprobar THEN 'Salida autorizada' ELSE 'Salida sin autorizar' END
                   ELSE CASE WHEN p_aprobar THEN 'Ingreso autorizado' ELSE 'Ingreso sin autorizar' END END;
  v_cuerpo := v_que || ' de ' || to_char(v_mov.monto, 'FM$999,990.00') || ' ' || v_forma
           || ' (' || coalesce(v_mov.concepto, 'sin concepto') || ')'
           || CASE WHEN p_aprobar THEN ' quedó autorizad' || CASE WHEN v_mov.tipo = 'SALIDA' THEN 'a.' ELSE 'o.' END
                   ELSE ' no se autorizó: ' || v_nota || '. Puedes reenviarl' || CASE WHEN v_mov.tipo = 'SALIDA' THEN 'a' ELSE 'o' END || ' con más pruebas.' END;
  INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, created_by)
  VALUES (v_sol.employee_id, 'REQUEST_DECIDED', v_titulo, v_cuerpo, '/mi-caja',
          jsonb_build_object('request_id', p_solicitud, 'request_type', 'CAJA_INGRESO_AUTORIZACION',
                             'movimiento_portal', v_mov.id), v_yo);
  -- El push es un aviso: si falla, la decisión ya quedó escrita.
  BEGIN
    PERFORM net.http_post(
      url := public.push_function_url(), headers := public.push_function_headers(),
      body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', '/mi-caja',
                                 'target_type', 'EMPLOYEE', 'target_value', to_jsonb(ARRAY[v_sol.employee_id])));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'caja_ingreso_resolver: push no enviado: %', SQLERRM;
  END;

  RETURN json_build_object('movimiento', v_mov.id, 'aprobado', p_aprobar);
END $function$;
REVOKE ALL ON FUNCTION public.caja_ingreso_resolver(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caja_ingreso_resolver(uuid, boolean, text) TO authenticated, service_role;

-- ── 6. Lo que sale de una BOLSA pasa por el mismo juez ──────────────────────
-- Definición VIVA (pg_get_functiondef, 2026-10-21) con un solo agregado: el
-- bloque «El juez de los movimientos de caja». Desde una bolsa no hay
-- autorización: «Otro», el gasto y el pago a proveedor llevan el comprobante.
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
    v_regla json;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO t FROM public.bolsas_tipos_salida WHERE codigo = p_tipo AND activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese motivo no existe.'; END IF;
    IF p_monto IS NULL OR p_monto < 0 THEN RAISE EXCEPTION 'Hay que decir cuánto.'; END IF;
    IF t.signo <> 0 AND p_monto = 0 THEN RAISE EXCEPTION 'Hay que decir cuánto.'; END IF;

    -- La entidad se exige sólo cuando la contesta una PERSONA. Con
    -- `entidad_la_dice_el_papel` sale de la boleta y puede no haber ninguna —un
    -- retiro por token no tiene remesadora—, así que pedirla acá dejaba sin
    -- forma de registrar la salida. Es la MISMA condición que aplica
    -- `SalidaDeBolsa`; escrita en dos sitios porque no hay uno solo que valga
    -- para los dos runtimes, y por eso se mueven juntas.
    IF t.etiqueta_entidad IS NOT NULL
       AND NOT coalesce(t.entidad_la_dice_el_papel, false)
       AND v_entidad IS NULL THEN
        RAISE EXCEPTION 'Falta el dato: %.', t.etiqueta_entidad; END IF;

    -- ── ¿En cuánto se reparte? Lo decide el MONTO, para todos los vales ─────
    -- $500 sale en billetes de $10, $55 en billetes de $5, $125.75 exacto. Ya
    -- no depende del motivo: ver `paso_de_monto`.
    v_paso := CASE WHEN t.signo = -1 THEN public.paso_de_monto(p_monto) END;

    -- El catálogo manda cuando existe. Se compara normalizado —sin espacios de
    -- sobra y sin distinguir mayúsculas— porque el valor viene de un
    -- desplegable, pero el nombre que se GUARDA es el de la fila: así el dato
    -- coincide con el catálogo por construcción y no por suerte.
    --
    -- Sólo sobre una entidad que LLEGÓ: sin `v_entidad IS NOT NULL`, una salida
    -- que legítimamente no trae entidad no emparejaba con ninguna fila y caía
    -- en «no está en la lista», que es el mismo bloqueo con otro texto.
    IF v_entidad IS NOT NULL
       AND t.etiqueta_entidad IS NOT NULL
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

    -- ── El juez de los movimientos de caja (auditoría 2026-10-21) ──────────
    -- El MISMO que usa `operar-caja`: «Otro» no acepta lo que va en otro lado,
    -- y lo que pide comprobante lo exige — desde una bolsa sin la salida de la
    -- autorización (`p_de_bolsa`). La identidad de quien retira ya la cuida
    -- `pide_receptor` abajo, por eso `p_tiene_receptor` va en true.
    IF t.caja_tipo IS NOT NULL THEN
        v_regla := public.caja_movimiento_regla(
            'SALIDA', t.caja_tipo,
            concat_ws(' · ', t.etiqueta, v_entidad, nullif(btrim(coalesce(p_nota, '')), '')),
            nullif(btrim(coalesce(p_foto_url, '')), '') IS NOT NULL,
            'EFECTIVO', true, true);
        IF v_regla ->> 'error' IS NOT NULL THEN RAISE EXCEPTION '%', v_regla ->> 'error'; END IF;
    END IF;

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
        IF v_paso IS NOT NULL AND mod(r.monto, v_paso) <> 0 THEN
            RAISE EXCEPTION 'De la bolsa % tienen que salir billetes de %: % no lo es.',
                b.folio, to_char(v_paso, 'FM999,999,990.00'),
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
