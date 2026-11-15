-- Clientes: el alta nace en el portal y viaja a la caja en el momento.
-- Plan: docs/PLAN-CLIENTES-SOLO-DESDE-EL-PORTAL-2026-11-15.md (paso 4).
--
-- Tres piezas:
--  1. Permiso `clientes_crear` (sub-permiso de Clientes). Decisión del usuario
--     (2026-11-15): nace activo para TODO cargo que hoy ve Clientes. Se copia de
--     la tabla, no de una lista escrita a mano.
--  2. `cliente_crear(p_campos)`: crea la ficha del portal con la misma
--     validación que `update_customer_fiscal` y el mismo criterio de repetidos
--     que `crear_faltantes.py` (DUI, NIT y la clave sin tildes `search_name`,
--     porque el índice único de nombre NO quita acentos).
--  3. La cola de altas: `clientes_alta_erp` + `clientes_alta_erp_tomar` +
--     `clientes_alta_erp_resultado`. La edge function `alta-cliente-erp` la
--     trabaja: en el momento cuando la llama la pantalla, y cada 10 min el cron
--     para lo que falló y para las fichas que ya existían sin número.
--
-- Qué ficha necesita alta NO se guarda: se DERIVA (erp_id nulo, ni fusionada,
-- ni anonimizada, ni deshabilitada, ni de mostrador). Así las 93 que ya había
-- sin número entran solas, y también las que crea la caja con
-- `cliente_crear_de_mostrador`. La tabla sólo lleva los intentos, el error y
-- el candado contra dos altas a la vez.

SET lock_timeout = '5s';

-- ── 1 · Permiso ─────────────────────────────────────────────────────────────
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'clientes_crear', true, false, false, 'ALL'
  FROM public.role_permissions rp
 WHERE rp.module_key = 'clientes' AND rp.can_view
ON CONFLICT (role_id, module_key) DO NOTHING;

-- ── 2 · La tabla de altas ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clientes_alta_erp (
  customer_id        bigint PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  -- pendiente: falta (o falló y se reintenta) · hecha · revisar: necesita una
  -- persona (choca con otra ficha de la caja); el cron no la reintenta.
  estado             text NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('pendiente', 'hecha', 'revisar')),
  intentos           integer NOT NULL DEFAULT 0,
  ultimo_error       text,
  ultimo_intento_at  timestamptz,
  -- Candado: mientras `tomado_hasta > now()` nadie más la intenta. Sin esto, el
  -- guardado y el cron podían crear la misma ficha dos veces en la caja.
  tomado_hasta       timestamptz,
  erp_id             text,
  como               text CHECK (como IN ('creada', 'vinculada')),
  creado_por         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  resuelto_at        timestamptz
);

ALTER TABLE public.clientes_alta_erp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clientes_alta_erp_select ON public.clientes_alta_erp;
CREATE POLICY clientes_alta_erp_select ON public.clientes_alta_erp
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes', 'can_view')));
-- Sin policies de escritura: sólo las funciones DEFINER de abajo escriben.

CREATE INDEX IF NOT EXISTS idx_clientes_alta_erp_abiertas
  ON public.clientes_alta_erp (estado) WHERE estado <> 'hecha';

REVOKE ALL ON public.clientes_alta_erp FROM anon;
GRANT SELECT ON public.clientes_alta_erp TO authenticated;
GRANT ALL ON public.clientes_alta_erp TO service_role;

-- ── ¿Esta ficha necesita alta? (una sola definición) ────────────────────────
CREATE OR REPLACE FUNCTION public.cliente_necesita_alta_erp(c public.customers)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT c.erp_id IS NULL
     AND c.fusionada_en_id IS NULL
     AND c.anonimizada_at IS NULL
     AND c.deshabilitada_at IS NULL
     AND NOT public.es_cliente_mostrador(c.name, c.erp_id);
$$;
REVOKE EXECUTE ON FUNCTION public.cliente_necesita_alta_erp(public.customers) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_necesita_alta_erp(public.customers) TO authenticated, service_role;

-- ── 3 · Crear la ficha ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cliente_crear(p_campos jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  CATEGORIAS constant text[] := ARRAY[
    'Consumidor', 'Contribuyente', 'Gran Contribuyente',
    'Contribuyente Exento', 'Extranjero', 'Menor de edad'];
  v_emp   uuid := (SELECT public.auth_employee_id());
  v       jsonb := '{}'::jsonb;
  k       text;
  v_txt   text;
  v_nombre text;
  v_clave  text;
  v_dui_d  text;
  v_tel_d  text;
  v_nit_d  text;
  c public.customers%ROWTYPE;
BEGIN
  IF v_emp IS NULL OR NOT (SELECT public.auth_has_module_permission('clientes_crear', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Sólo los campos de la ficha; un texto vacío es «sin dato».
  FOREACH k IN ARRAY ARRAY['name', 'nit', 'dui', 'nrc', 'pasaporte', 'phone', 'telefono2',
                           'email', 'direccion', 'departamento', 'municipio', 'distrito',
                           'categoria', 'giro', 'retencion_pct', 'notes'] LOOP
    v_txt := nullif(btrim(coalesce(p_campos ->> k, '')), '');
    IF v_txt IS NOT NULL THEN v := v || jsonb_build_object(k, v_txt); END IF;
  END LOOP;

  -- Nombre: mayúscula y espacios simples (es lo que compara el índice único y
  -- lo que viaja crudo a la caja).
  v_nombre := upper(regexp_replace(coalesce(v ->> 'name', ''), '\s+', ' ', 'g'));
  IF v_nombre = '' THEN RAISE EXCEPTION 'NOMBRE_VACIO'; END IF;
  IF length(v_nombre) < 5 OR position(' ' IN v_nombre) = 0 THEN
    RAISE EXCEPTION 'NOMBRE_INCOMPLETO';
  END IF;
  IF public.es_cliente_mostrador(v_nombre, NULL)
     OR v_nombre ~ '^(CLIENTES? VARIOS|CLIENTE FRECUENTE|CONSUMIDOR FINAL)' THEN
    RAISE EXCEPTION 'ES_MOSTRADOR';
  END IF;

  v := v || jsonb_build_object('categoria', coalesce(v ->> 'categoria', 'Consumidor'));
  IF NOT (v ->> 'categoria' = ANY (CATEGORIAS)) THEN RAISE EXCEPTION 'CATEGORIA_INVALIDA'; END IF;

  IF v ->> 'retencion_pct' IS NOT NULL
     AND (v ->> 'retencion_pct' !~ '^\d{1,3}$' OR (v ->> 'retencion_pct')::int > 100) THEN
    RAISE EXCEPTION 'RETENCION_INVALIDA';
  END IF;

  IF v ->> 'distrito' IS NOT NULL AND v ->> 'municipio' IS NULL THEN
    RAISE EXCEPTION 'GEO_INCOHERENTE';
  END IF;
  IF v ->> 'municipio' IS NOT NULL
     AND (v ->> 'departamento' IS NULL
          OR v ->> 'municipio' NOT LIKE (v ->> 'departamento') || ' %') THEN
    RAISE EXCEPTION 'GEO_INCOHERENTE';
  END IF;

  -- DUI: 9 dígitos con su verificador, guardado como 00000000-0.
  v_dui_d := regexp_replace(coalesce(v ->> 'dui', ''), '\D', '', 'g');
  IF v_dui_d <> '' THEN
    IF length(v_dui_d) <> 9 OR NOT public.es_dui_valido(v_dui_d) THEN RAISE EXCEPTION 'DUI_INVALIDO'; END IF;
    v := v || jsonb_build_object('dui', left(v_dui_d, 8) || '-' || right(v_dui_d, 1));
  END IF;

  -- Teléfono: obligatorio. Sin él la persona no puede entrar a la app y el DTE
  -- no se transmite. Se guarda como 0000-0000.
  v_tel_d := regexp_replace(coalesce(v ->> 'phone', ''), '\D', '', 'g');
  IF v_tel_d ~ '^503\d{8}$' THEN v_tel_d := right(v_tel_d, 8); END IF;
  IF length(v_tel_d) <> 8 THEN RAISE EXCEPTION 'TELEFONO_INVALIDO'; END IF;
  v := v || jsonb_build_object('phone', left(v_tel_d, 4) || '-' || right(v_tel_d, 4));
  IF NOT public.es_telefono_sv_valido(v ->> 'telefono2') THEN RAISE EXCEPTION 'TELEFONO_INVALIDO'; END IF;

  -- Un documento que identifique a la persona, según la categoría.
  IF v ->> 'categoria' IN ('Contribuyente', 'Gran Contribuyente', 'Contribuyente Exento') THEN
    IF v ->> 'nit' IS NULL AND v ->> 'dui' IS NULL THEN RAISE EXCEPTION 'FALTA_DOCUMENTO'; END IF;
  ELSIF v ->> 'categoria' = 'Extranjero' THEN
    IF v ->> 'pasaporte' IS NULL THEN RAISE EXCEPTION 'FALTA_DOCUMENTO'; END IF;
  ELSIF v ->> 'categoria' <> 'Menor de edad' THEN
    IF v ->> 'dui' IS NULL AND v ->> 'nit' IS NULL THEN RAISE EXCEPTION 'FALTA_DOCUMENTO'; END IF;
  END IF;

  -- ── ¿Ya existe? DUI, NIT y la clave sin tildes, en ese orden. ───────────
  IF v ->> 'dui' IS NOT NULL THEN
    SELECT * INTO c FROM public.customers
     WHERE dui = v ->> 'dui' AND fusionada_en_id IS NULL AND anonimizada_at IS NULL
     ORDER BY id LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object('id', c.id, 'name', c.name, 'existente', true, 'por', 'dui');
    END IF;
  END IF;

  v_nit_d := regexp_replace(coalesce(v ->> 'nit', ''), '\D', '', 'g');
  IF v_nit_d <> '' THEN
    SELECT * INTO c FROM public.customers
     WHERE regexp_replace(coalesce(nit, ''), '\D', '', 'g') = v_nit_d
       AND fusionada_en_id IS NULL AND anonimizada_at IS NULL
     ORDER BY id LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object('id', c.id, 'name', c.name, 'existente', true, 'por', 'nit');
    END IF;
  END IF;

  v_clave := lower(translate(v_nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun'));
  SELECT * INTO c FROM public.customers WHERE search_name = v_clave ORDER BY id LIMIT 1;
  IF FOUND THEN
    -- Mismo nombre y OTRO DUI: son dos personas, y la base no deja dos fichas
    -- con el mismo nombre. Que lo escriban completo.
    IF c.dui IS NOT NULL AND v ->> 'dui' IS NOT NULL AND c.dui <> v ->> 'dui' THEN
      RAISE EXCEPTION 'NOMBRE_DE_OTRA_PERSONA';
    END IF;
    IF c.fusionada_en_id IS NOT NULL THEN
      SELECT * INTO c FROM public.customers WHERE id = public.cliente_vigente(c.id);
    END IF;
    RETURN json_build_object('id', c.id, 'name', c.name, 'existente', true, 'por', 'nombre');
  END IF;

  INSERT INTO public.customers
    (name, nit, dui, nrc, pasaporte, phone, telefono2, email, direccion,
     departamento, municipio, distrito, categoria, giro, retencion_pct, notes)
  VALUES
    (v_nombre, v ->> 'nit', v ->> 'dui', v ->> 'nrc', v ->> 'pasaporte', v ->> 'phone',
     v ->> 'telefono2', v ->> 'email', v ->> 'direccion', v ->> 'departamento',
     v ->> 'municipio', v ->> 'distrito', v ->> 'categoria', v ->> 'giro',
     (v ->> 'retencion_pct')::smallint, v ->> 'notes')
  RETURNING * INTO c;

  INSERT INTO public.clientes_alta_erp (customer_id, creado_por) VALUES (c.id, v_emp);

  RETURN json_build_object('id', c.id, 'name', c.name, 'existente', false);
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'NOMBRE_DUPLICADO';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cliente_crear(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_crear(jsonb) TO authenticated, service_role;

-- ── 4 · Tomar fichas para darlas de alta ────────────────────────────────────
-- Con `p_customer_id`: la pantalla, para la ficha que acaba de crear o que
-- quiere reintentar (exige crear o editar Clientes; sin espera entre intentos).
-- Sin él: el cron (sólo service_role), las más viejas, con espera creciente
-- entre intentos para no golpear la caja con una ficha que siempre falla.
-- Devuelve la ficha entera: la edge function no lee `customers` por su cuenta.
CREATE OR REPLACE FUNCTION public.clientes_alta_erp_tomar(
  p_customer_id bigint DEFAULT NULL, p_limite integer DEFAULT 5)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_rol text := coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '');
  v_ids bigint[];
  v_out json;
BEGIN
  IF v_rol <> 'service_role' THEN
    IF p_customer_id IS NULL
       OR NOT ((SELECT public.auth_has_module_permission('clientes_crear', 'can_view'))
               OR (SELECT public.auth_can_edit_any(ARRAY['clientes']))) THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Las candidatas, bloqueadas para que dos llamadas no tomen la misma.
  SELECT array_agg(c.id) INTO v_ids
  FROM (
    SELECT c.id
      FROM public.customers c
      LEFT JOIN public.clientes_alta_erp a ON a.customer_id = c.id
     WHERE c.erp_id IS NULL                       -- barato primero: ~100 de 29 mil
       AND public.cliente_necesita_alta_erp(c)
       AND (p_customer_id IS NULL OR c.id = p_customer_id)
       AND coalesce(a.estado, 'pendiente') <> 'hecha'
       AND (a.tomado_hasta IS NULL OR a.tomado_hasta < now())
       -- El cron no reintenta lo que necesita una persona, y espera entre
       -- intentos: 10 min, 20, 40… hasta 6 h.
       AND (p_customer_id IS NOT NULL OR (
             coalesce(a.estado, 'pendiente') = 'pendiente'
             AND (a.ultimo_intento_at IS NULL
                  OR a.ultimo_intento_at < now() - least(interval '6 hours',
                       interval '10 minutes' * power(2, greatest(a.intentos - 1, 0))))))
     ORDER BY c.id
     LIMIT CASE WHEN p_customer_id IS NULL THEN greatest(1, least(p_limite, 20)) ELSE 1 END
     FOR UPDATE OF c SKIP LOCKED
  ) c;

  IF v_ids IS NULL THEN RETURN '[]'::json; END IF;

  INSERT INTO public.clientes_alta_erp AS a (customer_id, intentos, ultimo_intento_at, tomado_hasta, estado)
  SELECT unnest(v_ids), 1, now(), now() + interval '3 minutes', 'pendiente'
  ON CONFLICT (customer_id) DO UPDATE
     SET intentos = a.intentos + 1, ultimo_intento_at = now(),
         tomado_hasta = now() + interval '3 minutes',
         estado = 'pendiente';

  SELECT coalesce(json_agg(json_build_object(
           'customer_id', c.id, 'name', c.name, 'nit', c.nit, 'dui', c.dui, 'nrc', c.nrc,
           'pasaporte', c.pasaporte, 'phone', c.phone, 'telefono2', c.telefono2,
           'email', c.email, 'direccion', c.direccion, 'departamento', c.departamento,
           'municipio', c.municipio, 'distrito', c.distrito, 'categoria', c.categoria,
           'giro', c.giro, 'retencion_pct', c.retencion_pct,
           'fecha_nacimiento', c.fecha_nacimiento) ORDER BY c.id), '[]'::json)
    INTO v_out
    FROM public.customers c WHERE c.id = ANY (v_ids);
  RETURN v_out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clientes_alta_erp_tomar(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clientes_alta_erp_tomar(bigint, integer) TO authenticated, service_role;

-- ── 5 · Anotar el resultado (sólo la edge function) ─────────────────────────
-- p_resultado: {ok, erp_id, como: 'creada'|'vinculada'} o {ok:false, error, revisar}.
CREATE OR REPLACE FUNCTION public.clientes_alta_erp_resultado(p_customer_id bigint, p_resultado jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_rol  text := coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '');
  v_erp  text := nullif(btrim(coalesce(p_resultado ->> 'erp_id', '')), '');
  v_como text := p_resultado ->> 'como';
  v_otra bigint;
  v_n    integer := 0;
BEGIN
  IF v_rol <> 'service_role' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;

  IF coalesce((p_resultado ->> 'ok')::boolean, false) AND v_erp IS NOT NULL THEN
    -- Ese número ya es de otra ficha del portal: no se pisa, lo decide una persona.
    SELECT id INTO v_otra FROM public.customers WHERE erp_id = v_erp AND id <> p_customer_id;
    IF v_otra IS NOT NULL THEN
      UPDATE public.clientes_alta_erp
         SET estado = 'revisar', tomado_hasta = NULL,
             ultimo_error = format('En la caja ya es la ficha %s del portal (cliente %s).', v_erp, v_otra)
       WHERE customer_id = p_customer_id;
      RETURN json_build_object('ok', false, 'motivo', 'numero_de_otra_ficha', 'otra', v_otra);
    END IF;

    UPDATE public.customers SET erp_id = v_erp, updated_at = now()
     WHERE id = p_customer_id AND erp_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    -- Creada con los datos de hoy: lo que estaba en la cola de cambios ya viajó
    -- en el alta. Vinculada a una ficha que ya existía: la cola queda, y el
    -- empuje de siempre pone la ficha de la caja igual a la del portal.
    IF v_como = 'creada' THEN
      UPDATE public.customers_changelog SET erp_synced_at = now()
       WHERE customer_id = p_customer_id AND erp_synced_at IS NULL AND descartado_at IS NULL
         AND campo <> 'notes';
    END IF;

    UPDATE public.clientes_alta_erp
       SET estado = 'hecha', erp_id = v_erp, como = v_como, ultimo_error = NULL,
           tomado_hasta = NULL, resuelto_at = now()
     WHERE customer_id = p_customer_id;
    RETURN json_build_object('ok', true, 'erp_id', v_erp, 'actualizada', v_n);
  END IF;

  UPDATE public.clientes_alta_erp
     SET estado = CASE WHEN coalesce((p_resultado ->> 'revisar')::boolean, false)
                       THEN 'revisar' ELSE 'pendiente' END,
         ultimo_error = left(coalesce(p_resultado ->> 'error', 'sin detalle'), 500),
         tomado_hasta = NULL
   WHERE customer_id = p_customer_id;
  RETURN json_build_object('ok', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clientes_alta_erp_resultado(bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clientes_alta_erp_resultado(bigint, jsonb) TO service_role;

-- ── 6 · Lo que la pantalla muestra ──────────────────────────────────────────
-- Cuántas fichas no tienen número todavía y cuáles necesitan a una persona.
CREATE OR REPLACE FUNCTION public.clientes_alta_erp_resumen()
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('clientes', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT json_build_object(
      'sin_numero', count(*),
      'revisar', count(*) FILTER (WHERE a.estado = 'revisar'),
      'por_revisar', coalesce(json_agg(json_build_object(
          'customer_id', c.id, 'name', c.name, 'error', a.ultimo_error,
          'intentos', a.intentos, 'ultimo_intento_at', a.ultimo_intento_at)
          ORDER BY c.id) FILTER (WHERE a.estado = 'revisar'), '[]'::json))
      FROM public.customers c
      LEFT JOIN public.clientes_alta_erp a ON a.customer_id = c.id
     WHERE c.erp_id IS NULL AND public.cliente_necesita_alta_erp(c));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clientes_alta_erp_resumen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clientes_alta_erp_resumen() TO authenticated, service_role;

-- Una persona resolvió el choque (o quiere volver a intentarlo): vuelve a la cola.
CREATE OR REPLACE FUNCTION public.clientes_alta_erp_reintentar(p_customer_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT ((SELECT public.auth_has_module_permission('clientes_crear', 'can_view'))
          OR (SELECT public.auth_can_edit_any(ARRAY['clientes']))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE public.clientes_alta_erp
     SET estado = 'pendiente', ultimo_intento_at = NULL, tomado_hasta = NULL
   WHERE customer_id = p_customer_id AND estado = 'revisar';
  RETURN json_build_object('ok', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clientes_alta_erp_reintentar(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clientes_alta_erp_reintentar(bigint) TO authenticated, service_role;
