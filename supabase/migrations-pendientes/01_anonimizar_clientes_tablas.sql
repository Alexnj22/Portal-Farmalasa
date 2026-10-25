-- ══════════════════════════════════════════════════════════════════════════
-- Anonimizar a un cliente A PEDIDO (derecho de cancelación) — 1/3: tablas.
--
-- Rige desde que se aplique (no depende de `reglas_v2_desde()`): no cambia
-- nada de lo que ya pasa, sólo agrega la capacidad. Nada se anonimiza solo:
-- la única puerta es `datos_anonimizar_cliente` (migración 2/3), y exige una
-- solicitud de datos de cancelación YA RESUELTA a favor.
--
-- Qué agrega:
--   · `customers.anonimizada_at`: la marca. ADD COLUMN sin default = sólo
--     metadatos, pero `customers` la escribe `sync-dte-sales` cada minuto, así
--     que va con lock_timeout y conviene aplicarla 06:00–11:59 UTC.
--   · La sal de las huellas, en Vault (`huella_datos_clientes`). Una huella es
--     un HMAC-SHA256 con esa sal: no se puede revertir y sólo sirve para
--     COMPARAR («¿este DUI es el de alguien que pidió anonimizarse?»). Sin la
--     sal, ni con la tabla entera se adivina un DUI probando los 10⁹.
--   · `clientes_anonimizados`: una fila por anonimización (y su reactivación).
--   · `clientes_anonimizados_huellas`: huellas de documento y de nombre.
--   · `clientes_resguardo`: TODO lo que se quitó, tal cual estaba. Cerrado:
--     RLS sin ninguna policy y sin GRANT para `authenticated`/`anon`. Sólo lo
--     lee `datos_resguardo_leer`, que exige permiso, motivo y deja constancia.
--   · `clientes_resguardo_lecturas`: la bitácora de cada lectura. Append-only.
--
-- Verificado en el entorno de pruebas (bbfotmyuvmrtmbuqxmhf) con execute_sql:
-- se aplicó, `authenticated` recibe «permission denied» al leer el resguardo y
-- las huellas, y la sal no sale por ninguna función expuesta.
-- ══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

-- ── La marca en la ficha ────────────────────────────────────────────────────
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS anonimizada_at timestamptz;
COMMENT ON COLUMN public.customers.anonimizada_at IS
  'Cuándo se anonimizó la ficha a pedido del titular (derecho de cancelación). NULL = ficha normal. '
  'Con valor: el espejo de la caja no la rellena, upsert_customers_v2 no la reabre y update_customer_fiscal no la edita. '
  'Lo quitado vive en clientes_resguardo.';

-- ── La sal de las huellas ───────────────────────────────────────────────────
-- Se crea una sola vez. Si alguien la borrara, las huellas existentes dejarían
-- de reconocer a nadie: por eso NO se rota ni se recrea en una migración.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'huella_datos_clientes') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
                                'huella_datos_clientes',
                                'Sal de las huellas (HMAC) de clientes anonimizados. NO rotar: las huellas dejarían de reconocer a nadie.');
  END IF;
END $$;

-- Normalización: documento = sólo letras y dígitos, en mayúscula (el DUI vive
-- con guion en unas fichas y sin él en otras). Nombre = upper(btrim()), que es
-- exactamente la clave de `customers_name_norm_idx` y de `upsert_customers_v2`.
CREATE OR REPLACE FUNCTION public.datos_huella(p_tipo text, p_texto text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_sal text;
  v_norm text;
BEGIN
  v_norm := CASE p_tipo
    WHEN 'documento' THEN upper(regexp_replace(coalesce(p_texto, ''), '[^0-9A-Za-z]', '', 'g'))
    WHEN 'nombre'    THEN upper(btrim(coalesce(p_texto, '')))
  END;
  IF v_norm IS NULL THEN RAISE EXCEPTION 'tipo de huella desconocido: %', p_tipo; END IF;
  IF v_norm = '' THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_sal FROM vault.decrypted_secrets WHERE name = 'huella_datos_clientes';
  IF v_sal IS NULL THEN RAISE EXCEPTION 'falta la sal de las huellas (vault: huella_datos_clientes)'; END IF;
  RETURN encode(extensions.hmac(p_tipo || ':' || v_norm, v_sal, 'sha256'), 'hex');
END $$;
-- Sólo el servidor: con EXECUTE, cualquiera con sesión podría calcular la
-- huella de un DUI y, si alguna vez se filtrara la tabla, compararla.
REVOKE EXECUTE ON FUNCTION public.datos_huella(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.datos_huella(text, text) TO service_role;

-- ── Una fila por anonimización ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clientes_anonimizados (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id          bigint NOT NULL REFERENCES public.customers(id),
  -- Las fichas fusionadas en la principal también se anonimizan: conservan su
  -- nombre a propósito (para ligar facturas), y ese nombre es el dato.
  fichas               bigint[] NOT NULL,
  solicitud_id         uuid NOT NULL REFERENCES public.solicitudes_datos(id),
  anonimizada_at       timestamptz NOT NULL DEFAULT now(),
  anonimizada_por      uuid,
  sin_documento_motivo text,
  puntos_perdidos      integer NOT NULL DEFAULT 0,
  resumen              jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- La escritura a la ficha de la caja va por la cola de siempre
  -- (`customers_changelog` → `push-cliente-erp`). Estos son SUS renglones: con
  -- ellos la pantalla dice si la caja ya quedó anónima.
  changelog_ids        bigint[] NOT NULL DEFAULT '{}',
  -- Archivos del almacenamiento (rutas y carpetas terminadas en '/') que la
  -- edge function `anonimizar-cliente` tiene que borrar. Vacío = hecho.
  archivos_pendientes  text[] NOT NULL DEFAULT '{}',
  archivos_borrados_at timestamptz,
  reactivada_at        timestamptz,
  reactivada_por       uuid,
  reactivacion_motivo  text,
  reactivacion_solicitud uuid REFERENCES public.solicitudes_datos(id),
  reactivacion_changelog_ids bigint[] NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clientes_anonimizados_customer_idx ON public.clientes_anonimizados (customer_id);
CREATE INDEX IF NOT EXISTS clientes_anonimizados_solicitud_idx ON public.clientes_anonimizados (solicitud_id);
CREATE INDEX IF NOT EXISTS clientes_anonimizados_reactivacion_solicitud_idx
  ON public.clientes_anonimizados (reactivacion_solicitud) WHERE reactivacion_solicitud IS NOT NULL;
-- A lo sumo UNA anonimización vigente por ficha.
CREATE UNIQUE INDEX IF NOT EXISTS clientes_anonimizados_vigente_uniq
  ON public.clientes_anonimizados (customer_id) WHERE reactivada_at IS NULL;
ALTER TABLE public.clientes_anonimizados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clientes_anonimizados_select ON public.clientes_anonimizados;
-- Lo lee quien ve el módulo de datos personales. No lleva datos de la persona:
-- ids, fechas, conteos y el estado de la caja y los archivos.
CREATE POLICY clientes_anonimizados_select ON public.clientes_anonimizados
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('datos_personales', 'can_view')));
REVOKE ALL ON public.clientes_anonimizados FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.clientes_anonimizados FROM authenticated;

-- ── Las huellas ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clientes_anonimizados_huellas (
  tipo             text NOT NULL CHECK (tipo IN ('documento', 'nombre')),
  huella           text NOT NULL,
  customer_id      bigint NOT NULL REFERENCES public.customers(id),
  anonimizacion_id bigint NOT NULL REFERENCES public.clientes_anonimizados(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tipo, huella)
);
CREATE INDEX IF NOT EXISTS clientes_anonimizados_huellas_customer_idx ON public.clientes_anonimizados_huellas (customer_id);
CREATE INDEX IF NOT EXISTS clientes_anonimizados_huellas_anon_idx ON public.clientes_anonimizados_huellas (anonimizacion_id);
ALTER TABLE public.clientes_anonimizados_huellas ENABLE ROW LEVEL SECURITY;
-- SIN policies a propósito: sólo las funciones DEFINER la consultan.
REVOKE ALL ON public.clientes_anonimizados_huellas FROM anon, authenticated;

-- ── El resguardo ────────────────────────────────────────────────────────────
-- «Por temas legales se debe poder saber» (decisión del usuario): lo quitado no
-- se pierde, se encierra. Una fila por renglón quitado, con la fila ENTERA en
-- `datos` (to_jsonb) para que lo resguardado sea lo que había y no una
-- selección hecha hoy.
CREATE TABLE IF NOT EXISTS public.clientes_resguardo (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anonimizacion_id bigint NOT NULL REFERENCES public.clientes_anonimizados(id),
  customer_id      bigint NOT NULL,
  tabla            text NOT NULL,
  fila_id          text,
  -- 'borrada' = la fila ya no existe; 'vaciada' = la fila sigue, sin los
  -- campos que identifican (los que están en `datos`).
  accion           text NOT NULL CHECK (accion IN ('borrada', 'vaciada')),
  datos            jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clientes_resguardo_anon_idx ON public.clientes_resguardo (anonimizacion_id);
CREATE INDEX IF NOT EXISTS clientes_resguardo_customer_idx ON public.clientes_resguardo (customer_id);
ALTER TABLE public.clientes_resguardo ENABLE ROW LEVEL SECURITY;
-- SIN policies y sin GRANT: ni con permiso de clientes ni con service_role
-- desde el navegador. La única lectura es `datos_resguardo_leer`.
REVOKE ALL ON public.clientes_resguardo FROM anon, authenticated;
COMMENT ON TABLE public.clientes_resguardo IS
  'Resguardo CERRADO de lo que se quitó al anonimizar un cliente. RLS sin policies. Sólo lo lee datos_resguardo_leer (permiso de datos_personales + motivo + bitácora). No se purga.';

-- ── La bitácora de lecturas del resguardo ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clientes_resguardo_lecturas (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anonimizacion_id bigint NOT NULL REFERENCES public.clientes_anonimizados(id),
  customer_id      bigint NOT NULL,
  employee_id      uuid,
  employee_nombre  text,
  motivo           text NOT NULL CHECK (length(btrim(motivo)) >= 10),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clientes_resguardo_lecturas_anon_idx ON public.clientes_resguardo_lecturas (anonimizacion_id);
ALTER TABLE public.clientes_resguardo_lecturas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clientes_resguardo_lecturas_select ON public.clientes_resguardo_lecturas;
-- Append-only: se lee con el permiso del módulo; nadie la escribe desde el
-- navegador (la escribe `datos_resguardo_leer`) y no hay UPDATE ni DELETE.
CREATE POLICY clientes_resguardo_lecturas_select ON public.clientes_resguardo_lecturas
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('datos_personales', 'can_view')));
REVOKE ALL ON public.clientes_resguardo_lecturas FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.clientes_resguardo_lecturas FROM authenticated;
