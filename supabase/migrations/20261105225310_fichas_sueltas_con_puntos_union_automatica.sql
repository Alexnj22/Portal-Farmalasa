-- Fichas sueltas con puntos: unión automática cuando el sistema de la caja
-- confirma que son el mismo cliente (2026-11-05).
--
-- Hasta hoy `fusionar_cliente_duplicado` frenaba con TIENE_PUNTOS y la corrida
-- nocturna mandaba el caso a «Clientes por revisar». Nadie miraba esa cola: se
-- juntaron 47 clientes en un mes con el saldo partido en dos fichas (1,488
-- puntos), y el cliente veía sólo una mitad. Decisión del usuario: «unión
-- automática si se confirma que es el mismo cliente». La confirmación es la
-- misma que ya usa la corrida: el número de cliente que el sistema de la caja
-- le asigna a la factura de la ficha suelta ES el de la ficha buena, y los
-- nombres se parecen (`parecidos`); si no se parecen sigue yendo a revisión.
--
-- Tres piezas:
--   1. `puntos_unir_cuentas_sistema`: el movimiento del libro, escrito UNA vez.
--      `puntos_fusionar_cuentas` (la pantalla) pasa a llamarla después de sus
--      chequeos de permiso; antes el movimiento sólo vivía ahí adentro.
--   2. `fusionar_cliente_duplicado` deja de frenar por una cuenta que ya está
--      unida a otra y vacía — es justo el estado que deja la pieza 1.
--   3. `fusionar_cliente_duplicado_con_puntos`: une el libro y después la ficha,
--      en la misma transacción. Sólo el proceso automático (service_role).
SET lock_timeout = '5s';

-- ── 1 · El movimiento del libro ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_unir_cuentas_sistema(
  p_origen bigint, p_destino bigint, p_nota text DEFAULT NULL::text, p_por uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_o public.customers%ROWTYPE;
  v_d public.customers%ROWTYPE;
  v_co public.puntos_cuenta%ROWTYPE;
  v_cd public.puntos_cuenta%ROWTYPE;
  v_lotes integer; v_salidas integer; v_ren integer := 0; v_n integer;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
BEGIN
  -- Sin chequeo de permiso a propósito: lo hace quien la llama
  -- (`puntos_fusionar_cuentas` para la pantalla, service_role para la corrida).
  -- Por eso NO se le da EXECUTE a `authenticated`.
  IF public.puntos_fuente() <> 'portal' THEN
    RAISE EXCEPTION 'Unir cuentas se habilita cuando el programa funciona en el portal.';
  END IF;
  IF p_origen IS NULL OR p_destino IS NULL OR p_origen = p_destino THEN
    RAISE EXCEPTION 'Elige dos cuentas distintas.';
  END IF;

  SELECT * INTO v_o FROM public.customers WHERE id = p_origen;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el cliente %.', p_origen; END IF;
  SELECT * INTO v_d FROM public.customers WHERE id = p_destino;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el cliente %.', p_destino; END IF;

  -- Las dos cuentas tomadas, en orden de id: dos uniones cruzadas a la vez se
  -- ponen en fila en vez de trabarse.
  INSERT INTO public.puntos_cuenta (customer_id) VALUES (p_origen), (p_destino)
    ON CONFLICT (customer_id) DO NOTHING;
  PERFORM 1 FROM public.puntos_cuenta WHERE customer_id IN (p_origen, p_destino)
    ORDER BY customer_id FOR UPDATE;
  SELECT * INTO v_co FROM public.puntos_cuenta WHERE customer_id = p_origen;
  SELECT * INTO v_cd FROM public.puntos_cuenta WHERE customer_id = p_destino;

  IF v_co.fusionada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La cuenta de % ya se unió a otra.', v_o.name;
  END IF;
  IF v_cd.fusionada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La cuenta de % ya se unió a otra: elige esa como destino.', v_d.name;
  END IF;
  -- Los puntos que se pasan tienen que poder usarse donde caen.
  IF NOT coalesce(v_d.acumula_puntos, true) OR v_d.acepta_programa_puntos IS NOT DISTINCT FROM false THEN
    RAISE EXCEPTION 'La cuenta de % no participa en el programa: no puede recibir puntos.', v_d.name;
  END IF;

  SELECT count(*) INTO v_lotes   FROM public.puntos_lote   WHERE customer_id = p_origen;
  SELECT count(*) INTO v_salidas FROM public.puntos_salida WHERE customer_id = p_origen;

  -- Un cumpleaños por cuenta y año, un cupón por cuenta y mes (índices únicos).
  -- Si las dos tienen el suyo, el de la que se va pasa como ajuste: los puntos
  -- se conservan y el motivo dice qué fue.
  UPDATE public.puntos_lote o
     SET origen = 'ajuste',
         motivo = coalesce(o.motivo, CASE o.origen WHEN 'cumpleanos' THEN 'Cortesía Cumpleaños' ELSE 'Cupón del mes' END)
                  || ' · de la cuenta unida de ' || v_o.name
   WHERE o.customer_id = p_origen
     AND ((o.origen = 'cumpleanos' AND EXISTS (
            SELECT 1 FROM public.puntos_lote d WHERE d.customer_id = p_destino AND d.origen = 'cumpleanos'
               AND date_part('year', d.ganado_el) = date_part('year', o.ganado_el)))
       OR (o.origen = 'cupon' AND EXISTS (
            SELECT 1 FROM public.puntos_lote d WHERE d.customer_id = p_destino AND d.origen = 'cupon'
               AND date_trunc('month', d.ganado_el) = date_trunc('month', o.ganado_el))));
  GET DIAGNOSTICS v_ren = ROW_COUNT;

  UPDATE public.puntos_lote   SET customer_id = p_destino WHERE customer_id = p_origen;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_lotes THEN RAISE EXCEPTION 'El libro cambió mientras se unía; intenta de nuevo.'; END IF;
  UPDATE public.puntos_salida SET customer_id = p_destino WHERE customer_id = p_origen;

  UPDATE public.puntos_cuenta
     SET saldo = saldo + v_co.saldo, ganados = ganados + v_co.ganados, usados = usados + v_co.usados,
         updated_at = now()
   WHERE customer_id = p_destino;
  UPDATE public.puntos_cuenta
     SET saldo = 0, ganados = 0, usados = 0, fusionada_en = p_destino, updated_at = now()
   WHERE customer_id = p_origen;
  -- Las que antes se habían unido a la que ahora se va siguen a la que se queda:
  -- nunca hay más de un salto.
  UPDATE public.puntos_cuenta SET fusionada_en = p_destino WHERE fusionada_en = p_origen;

  INSERT INTO public.puntos_fusion
    (origen, destino, origen_nombre, destino_nombre, saldo_origen, ganados_origen, usados_origen,
     saldo_destino_antes, saldo_destino, lotes, salidas, renombrados, nota, por)
  VALUES (p_origen, p_destino, v_o.name, v_d.name, v_co.saldo, v_co.ganados, v_co.usados,
          v_cd.saldo, v_cd.saldo + v_co.saldo, v_lotes, v_salidas, v_ren, v_nota, p_por);

  RETURN json_build_object('ok', true, 'simulado', false,
    'origen',  json_build_object('id', p_origen,  'nombre', v_o.name, 'saldo', v_co.saldo, 'lotes', v_lotes, 'salidas', v_salidas),
    'destino', json_build_object('id', p_destino, 'nombre', v_d.name, 'saldo', v_cd.saldo),
    'saldo_final', v_cd.saldo + v_co.saldo);
END $function$;

REVOKE EXECUTE ON FUNCTION public.puntos_unir_cuentas_sistema(bigint, bigint, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_unir_cuentas_sistema(bigint, bigint, text, uuid) TO service_role;

-- La pantalla: mismos chequeos y misma simulación que antes; el movimiento real
-- ahora lo hace la función de arriba.
CREATE OR REPLACE FUNCTION public.puntos_fusionar_cuentas(p_origen bigint, p_destino bigint, p_nota text DEFAULT NULL::text, p_simular boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_o public.customers%ROWTYPE;
  v_d public.customers%ROWTYPE;
  v_co public.puntos_cuenta%ROWTYPE;
  v_cd public.puntos_cuenta%ROWTYPE;
  v_lotes integer; v_salidas integer;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_ajustar', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para unir cuentas de puntos.' USING ERRCODE = '42501';
  END IF;

  IF NOT p_simular THEN
    RETURN public.puntos_unir_cuentas_sistema(p_origen, p_destino, p_nota, public.auth_employee_id());
  END IF;

  IF public.puntos_fuente() <> 'portal' THEN
    RAISE EXCEPTION 'Unir cuentas se habilita cuando el programa funciona en el portal.';
  END IF;
  IF p_origen IS NULL OR p_destino IS NULL OR p_origen = p_destino THEN
    RAISE EXCEPTION 'Elige dos cuentas distintas.';
  END IF;
  SELECT * INTO v_o FROM public.customers WHERE id = p_origen;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el cliente %.', p_origen; END IF;
  SELECT * INTO v_d FROM public.customers WHERE id = p_destino;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el cliente %.', p_destino; END IF;
  SELECT * INTO v_co FROM public.puntos_cuenta WHERE customer_id = p_origen;
  SELECT * INTO v_cd FROM public.puntos_cuenta WHERE customer_id = p_destino;
  IF v_co.fusionada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La cuenta de % ya se unió a otra.', v_o.name;
  END IF;
  IF v_cd.fusionada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La cuenta de % ya se unió a otra: elige esa como destino.', v_d.name;
  END IF;
  IF NOT coalesce(v_d.acumula_puntos, true) OR v_d.acepta_programa_puntos IS NOT DISTINCT FROM false THEN
    RAISE EXCEPTION 'La cuenta de % no participa en el programa: no puede recibir puntos.', v_d.name;
  END IF;
  SELECT count(*) INTO v_lotes   FROM public.puntos_lote   WHERE customer_id = p_origen;
  SELECT count(*) INTO v_salidas FROM public.puntos_salida WHERE customer_id = p_origen;
  RETURN json_build_object('ok', true, 'simulado', true,
    'origen',  json_build_object('id', p_origen,  'nombre', v_o.name, 'saldo', coalesce(v_co.saldo, 0),
                                 'ganados', coalesce(v_co.ganados, 0), 'lotes', v_lotes, 'salidas', v_salidas),
    'destino', json_build_object('id', p_destino, 'nombre', v_d.name, 'saldo', coalesce(v_cd.saldo, 0)),
    'saldo_final', coalesce(v_cd.saldo, 0) + coalesce(v_co.saldo, 0));
END $function$;

-- ── 3 · Ficha suelta con puntos → libro + ficha, juntos ─────────────────
CREATE OR REPLACE FUNCTION public.fusionar_cliente_duplicado_con_puntos(p_huerfana bigint, p_erp_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_h public.customers%ROWTYPE;
  v_buena public.customers%ROWTYPE;
  v_p json;
  v_f json;
BEGIN
  -- Sólo la corrida nocturna. Una persona une cuentas desde la pantalla de
  -- puntos, que pide su permiso propio.
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_h FROM public.customers WHERE id = p_huerfana FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUERFANA_NO_EXISTE'; END IF;
  IF v_h.erp_id IS NOT NULL THEN RAISE EXCEPTION 'HUERFANA_YA_EMPAREJADA'; END IF;
  SELECT * INTO v_buena FROM public.customers
   WHERE erp_id = p_erp_id AND id <> p_huerfana FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESTINO_NO_EXISTE'; END IF;
  IF v_buena.deshabilitada_at IS NOT NULL THEN RAISE EXCEPTION 'DESTINO_DESHABILITADO'; END IF;

  -- Una cuenta que ya se unió a otra a mano (alguien decidió hacia dónde) no se
  -- deshace de noche: va a revisión con el motivo de siempre.
  IF EXISTS (SELECT 1 FROM public.puntos_cuenta
              WHERE customer_id IN (p_huerfana, v_buena.id) AND fusionada_en IS NOT NULL) THEN
    RAISE EXCEPTION 'TIENE_PUNTOS';
  END IF;

  v_p := public.puntos_unir_cuentas_sistema(p_huerfana, v_buena.id,
           'Unión automática: el sistema de la caja confirma por su factura que es el cliente '
           || p_erp_id || '.', NULL);
  v_f := public.fusionar_cliente_duplicado(p_huerfana, p_erp_id);

  RETURN json_build_object('ok', true, 'puntos', v_p, 'ficha', v_f,
                           'facturas_movidas', (v_f->>'facturas_movidas')::int);
END $function$;

REVOKE EXECUTE ON FUNCTION public.fusionar_cliente_duplicado_con_puntos(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fusionar_cliente_duplicado_con_puntos(bigint, text) TO service_role;

-- ── 2 · `fusionar_cliente_duplicado` acepta una cuenta ya unida y vacía ────
-- Se edita sobre la definición VIVA (regla del repo: nunca reescribir una
-- función desde un archivo viejo) cambiando sólo la condición del freno: una
-- cuenta con `fusionada_en` y en cero ya no tiene puntos — es la redirección
-- que deja `puntos_unir_cuentas_sistema`. Lotes y salidas siguen frenando.
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.fusionar_cliente_duplicado(bigint,text)'::regprocedure);
  v_new text;
BEGIN
  v_new := replace(v_def,
    'SELECT 1 FROM public.puntos_cuenta  WHERE customer_id = p_huerfana)',
    'SELECT 1 FROM public.puntos_cuenta  WHERE customer_id = p_huerfana'
    || ' AND (fusionada_en IS NULL OR saldo <> 0 OR ganados <> 0 OR usados <> 0))');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'fusionar_cliente_duplicado: no se encontró el freno TIENE_PUNTOS a editar';
  END IF;
  EXECUTE v_new;
END
$do$;
