-- El código de acceso a «Mis puntos», para quien no puede entrar con su DUI.
--
-- Nace de una cadena de mediciones, no de una idea: de los 25,113 clientes que
-- compran, **10,488 no tienen ningún documento** en su ficha y **0 tienen
-- pasaporte**. Y para el extranjero el teléfono tampoco sirve de llave: el
-- circuito de Hacienda exige OCHO dígitos exactos y reemplaza lo que no cumple
-- por el de la farmacia — hay 228 fichas que ya quedaron con `2301-0013`.
--
-- ── Por qué una tabla aparte y no una columna en `customers` ────────────────
-- Porque `customers` se lee con `clientes:can_view`, que tienen más de cuarenta
-- personas. Una columna ahí sería una llave de acceso visible para todas ellas
-- de un vistazo. Acá **nadie lee por la API**: sólo las funciones DEFINER de
-- abajo, y ver un código deja rastro en la bitácora.
--
-- El permiso por columna (`REVOKE SELECT (col)`) haría lo mismo, y se descartó:
-- con permiso por columna, una columna nueva nace sin permiso y rompe las
-- vistas que la incluyan sin decir por qué.
SET lock_timeout = '5s';

CREATE TABLE public.puntos_codigo_acceso (
  customer_id   bigint PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  -- SIETE caracteres de un alfabeto de 25 sin parecidos: fuera la O y el 0, la
  -- I y el 1 y la L, la S y el 5, la Z y el 2, la B y el 8. Son 6,100 millones
  -- de combinaciones — y el largo lo decide el ataque de «pegarle al de
  -- cualquiera», no el de «adivinar el de fulano»: por eso el código solo vale
  -- sin teléfono en las fichas extranjeras, que son pocas.
  codigo        text NOT NULL UNIQUE
                CHECK (codigo ~ '^[ACDEFGHJKMNPQRTUVWXY34679]{7}$'),
  emitido_at    timestamptz NOT NULL DEFAULT now(),
  emitido_por   uuid REFERENCES public.employees(id),
  veces_emitido integer NOT NULL DEFAULT 1 CHECK (veces_emitido > 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.puntos_codigo_acceso IS
  'La llave de «Mis puntos» para quien no entra con su documento. Nadie la lee por la API: sólo las funciones DEFINER, y ver un código queda anotado en audit_logs.';

CREATE INDEX puntos_codigo_emisor ON public.puntos_codigo_acceso (emitido_por)
  WHERE emitido_por IS NOT NULL;

-- RLS con policy explícita y NINGÚN grant de lectura. La tabla existe, está
-- protegida, y la API no la puede ver ni con permiso de clientes.
ALTER TABLE public.puntos_codigo_acceso ENABLE ROW LEVEL SECURITY;
CREATE POLICY nadie_lee ON public.puntos_codigo_acceso FOR SELECT TO authenticated USING (false);
REVOKE ALL ON public.puntos_codigo_acceso FROM anon, authenticated;

-- ── Emitir (y re-emitir) ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_codigo_emitir(p_customer_id bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  ALFABETO constant text := 'ACDEFGHJKMNPQRTUVWXY34679';
  v_emp uuid; v_nombre text; v_codigo text; v_veces int; i int;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = 'hace falta permiso de edición en Clientes';
  END IF;
  SELECT name INTO v_nombre FROM public.customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ese cliente no existe'; END IF;
  v_emp := (SELECT public.auth_employee_id());

  -- Se reintenta ante choque en vez de comprobar antes: entre el SELECT y el
  -- INSERT hay un hueco por el que entra otra sesión, y el índice único es lo
  -- único que de verdad decide.
  FOR i IN 1..20 LOOP
    v_codigo := '';
    FOR i IN 1..7 LOOP
      v_codigo := v_codigo || substr(ALFABETO, 1 + floor(random() * length(ALFABETO))::int, 1);
    END LOOP;
    BEGIN
      INSERT INTO public.puntos_codigo_acceso (customer_id, codigo, emitido_por)
      VALUES (p_customer_id, v_codigo, v_emp)
      ON CONFLICT (customer_id) DO UPDATE
        SET codigo = EXCLUDED.codigo, emitido_at = now(), emitido_por = EXCLUDED.emitido_por,
            veces_emitido = public.puntos_codigo_acceso.veces_emitido + 1
      RETURNING veces_emitido INTO v_veces;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_codigo := NULL;   -- chocó con otro código: se vuelve a tirar
    END;
  END LOOP;

  IF v_codigo IS NULL THEN RAISE EXCEPTION 'no se pudo generar un código libre'; END IF;

  -- Emitir es un acto sobre la identidad de un cliente: queda anotado siempre,
  -- y el código NO va en el detalle — la bitácora la leen los mismos que no
  -- deberían poder verlo sin pedirlo.
  INSERT INTO public.audit_logs (user_id, action, target_id, details, severity, source)
  VALUES (v_emp, CASE WHEN v_veces > 1 THEN 'PUNTOS_CODIGO_REEMITIDO' ELSE 'PUNTOS_CODIGO_EMITIDO' END,
          p_customer_id::text,
          jsonb_build_object('cliente', v_nombre, 'veces', v_veces), 'warning', 'portal');

  RETURN json_build_object('ok', true, 'codigo', v_codigo, 'veces_emitido', v_veces);
END;
$$;

-- ── Ver el que ya existe ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_codigo_ver(p_customer_id bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_emp uuid; v_nombre text; v_codigo text;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('clientes','can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = 'hace falta permiso de ver Clientes';
  END IF;
  SELECT name INTO v_nombre FROM public.customers WHERE id = p_customer_id;
  SELECT codigo INTO v_codigo FROM public.puntos_codigo_acceso WHERE customer_id = p_customer_id;
  IF v_codigo IS NULL THEN RETURN json_build_object('ok', true, 'codigo', NULL); END IF;

  v_emp := (SELECT public.auth_employee_id());
  -- Mirar la llave de otra persona deja rastro. Sin esto, la protección de la
  -- tabla sería sólo una molestia: cualquiera la abriría y nadie sabría nunca.
  INSERT INTO public.audit_logs (user_id, action, target_id, details, severity, source)
  VALUES (v_emp, 'PUNTOS_CODIGO_VISTO', p_customer_id::text,
          jsonb_build_object('cliente', v_nombre), 'warning', 'portal');

  RETURN json_build_object('ok', true, 'codigo', v_codigo);
END;
$$;

-- ── El estado, para la ficha ────────────────────────────────────────────────
-- Dice SI tiene y desde cuándo, nunca el código. Es lo que la pantalla muestra
-- sin que nadie tenga que pedir nada.
CREATE OR REPLACE FUNCTION public.puntos_codigo_estado(p_customer_id bigint)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT json_build_object(
    'tiene', EXISTS (SELECT 1 FROM public.puntos_codigo_acceso WHERE customer_id = p_customer_id),
    'emitido_at', (SELECT emitido_at FROM public.puntos_codigo_acceso WHERE customer_id = p_customer_id),
    'veces_emitido', (SELECT veces_emitido FROM public.puntos_codigo_acceso WHERE customer_id = p_customer_id));
$$;

-- ── La consulta del cliente ─────────────────────────────────────────────────
-- Reemplaza a `puntos_cliente_por_dui_y_telefono` sin borrarla: acepta DUI,
-- NIT, pasaporte o código, y el teléfono deja de ser obligatorio SÓLO cuando
-- se entró con un código y la ficha es de una persona extranjera.
--
-- Devuelve a lo sumo UNA fila y sólo si hay exactamente un candidato. Dos
-- fichas con el mismo documento es un problema de los datos, no algo que esta
-- pantalla pueda resolver eligiendo — elegir mal le muestra a alguien el saldo
-- de otra persona.
CREATE OR REPLACE FUNCTION public.puntos_cliente_por_documento(
  p_documento text, p_telefono text DEFAULT NULL
) RETURNS TABLE (id bigint, name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_doc  text := upper(regexp_replace(coalesce(p_documento,''), '[^A-Za-z0-9]', '', 'g'));
  v_num  text := regexp_replace(coalesce(p_documento,''), '\D', '', 'g');
  v_tel  text := right(regexp_replace(coalesce(p_telefono,''), '\D', '', 'g'), 8);
  v_hay_tel boolean := length(v_tel) = 8;
BEGIN
  IF length(v_doc) < 7 THEN RETURN; END IF;

  RETURN QUERY
  WITH cand AS (
    -- 1 · el código. Es nuestro y es único, así que no puede empatar consigo
    --     mismo; sí podría empatar con un pasaporte de 7 caracteres, y por eso
    --     el conteo final sigue exigiendo uno solo.
    SELECT c.id, c.name, true AS por_codigo,
           coalesce(c.categoria,'') = 'Extranjero' AS extranjera
      FROM public.puntos_codigo_acceso k
      JOIN public.customers c ON c.id = k.customer_id
     WHERE k.codigo = v_doc
    UNION ALL
    -- 2 · el DUI: nueve dígitos, mirando sólo los dígitos porque el portal lo
    --     guarda con guion y el otro sistema no
    SELECT c.id, c.name, false, coalesce(c.categoria,'') = 'Extranjero'
      FROM public.customers c
     WHERE length(v_num) = 9
       AND regexp_replace(coalesce(c.dui,''), '\D', '', 'g') = v_num
    UNION ALL
    -- 3 · el NIT
    SELECT c.id, c.name, false, coalesce(c.categoria,'') = 'Extranjero'
      FROM public.customers c
     WHERE length(v_num) >= 9
       AND regexp_replace(coalesce(c.nit,''), '\D', '', 'g') = v_num
    UNION ALL
    -- 4 · el pasaporte: alfanumérico, sin separadores y en mayúscula
    SELECT c.id, c.name, false, coalesce(c.categoria,'') = 'Extranjero'
      FROM public.customers c
     WHERE upper(regexp_replace(coalesce(c.pasaporte,''), '[^A-Za-z0-9]', '', 'g')) = v_doc
  ),
  ok AS (
    SELECT DISTINCT cand.id, cand.name
      FROM cand
      JOIN public.customers c ON c.id = cand.id
     WHERE
       -- El teléfono deja de pedirse SÓLO acá: código + ficha extranjera. En
       -- cualquier otro caso sigue haciendo falta, y es lo que permite que el
       -- código sea corto — sin él, el atacante busca «cualquiera»; con él,
       -- tiene que acertarle al de una persona.
       (cand.por_codigo AND cand.extranjera)
       OR (v_hay_tel AND (
             right(regexp_replace(coalesce(c.phone,''),     '\D', '', 'g'), 8) = v_tel
          OR right(regexp_replace(coalesce(c.telefono2,''), '\D', '', 'g'), 8) = v_tel))
  )
  SELECT ok.id, ok.name FROM ok WHERE (SELECT count(*) FROM ok) = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.puntos_codigo_emitir(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_codigo_emitir(bigint) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.puntos_codigo_ver(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_codigo_ver(bigint) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.puntos_codigo_estado(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_codigo_estado(bigint) TO authenticated, service_role;
-- La consulta la llama la edge function pública con service_role, nunca el
-- navegador: `anon` no la ejecuta.
REVOKE EXECUTE ON FUNCTION public.puntos_cliente_por_documento(text,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_cliente_por_documento(text,text) TO service_role;
