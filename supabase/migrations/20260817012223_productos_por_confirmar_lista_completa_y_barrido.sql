-- La lista completa de productos por confirmar — para no entrar documento por
-- documento.
--
-- Por qué existe: el diccionario `(proveedor, código) → producto` arranca
-- vacío, y sembrarlo abriendo las 615 facturas que esperan carga es trabajo que
-- nadie va a hacer. Pero **el trabajo real es mucho menor que las facturas**:
-- medido, el 86.9% de los renglones usan un código que se repite (2,697 códigos
-- distintos en 6,920 renglones, 2.36 documentos cada uno). O sea que la lista
-- de preguntas distintas es varias veces más corta que la lista de renglones, y
-- **cada respuesta sirve para siempre** — para ese proveedor y para todas sus
-- facturas, las de hoy y las que vengan.
--
-- Entonces la pregunta se hace UNA vez por `(proveedor, código)`, en una sola
-- pantalla ordenada por cuánto pesa cada una, y no una vez por renglón.

SET lock_timeout = '5s';

-- ── 1. El renglón distinto, con cuánto pesa ─────────────────────────────────
--
-- `llave` es lo que identifica la pregunta: el código del proveedor cuando lo
-- manda (96% de los renglones) y, cuando no, un código sintético derivado del
-- nombre — `#` + el nombre normalizado. Los dos se guardan igual y el
-- emparejador busca por los dos, así que una confirmación sobre un renglón sin
-- código también queda aprendida. Sin eso, ese 4% se preguntaría para siempre.
CREATE TABLE IF NOT EXISTS public.compra_renglon_pendiente (
    id                  bigserial PRIMARY KEY,
    emisor_nit          text NOT NULL,
    llave               text NOT NULL,
    codigo_proveedor    text,                 -- NULL cuando el proveedor no lo manda
    descripcion         text NOT NULL,        -- la última que se vio
    nombre_limpio       text,
    renglones           integer NOT NULL DEFAULT 0,
    documentos          integer NOT NULL DEFAULT 0,
    unidades            numeric(14,3) NOT NULL DEFAULT 0,
    ultima_fecha        date,
    -- Lo que propuso el emparejador la primera vez que se vio esta llave. Se
    -- guarda para que la pantalla abra al instante: recalcular el parecido de
    -- ~1,200 llaves contra 18 mil productos en cada carga sería inusable.
    sugerido_product_id integer REFERENCES public.products(id) ON DELETE SET NULL,
    sugerido_origen     text,
    sugerido_similitud  real,
    -- Un renglón que no es un producto nuestro (un flete, un servicio) se
    -- aparta con su motivo. Sin esto la lista nunca se termina.
    ignorado            boolean NOT NULL DEFAULT false,
    ignorado_motivo     text,
    ignorado_por        uuid REFERENCES public.employees(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS compra_renglon_pendiente_llave
    ON public.compra_renglon_pendiente (emisor_nit, llave);
CREATE INDEX IF NOT EXISTS compra_renglon_pendiente_peso
    ON public.compra_renglon_pendiente (renglones DESC);
CREATE INDEX IF NOT EXISTS compra_renglon_pendiente_producto
    ON public.compra_renglon_pendiente (sugerido_product_id);

ALTER TABLE public.compra_renglon_pendiente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compra_renglon_pendiente_select ON public.compra_renglon_pendiente;
CREATE POLICY compra_renglon_pendiente_select ON public.compra_renglon_pendiente
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('cargar_compra', 'can_view'))
        OR (SELECT public.auth_has_module_permission('compras', 'can_view')));

COMMENT ON TABLE public.compra_renglon_pendiente IS
    'Una fila por pregunta distinta (proveedor, código) de los documentos que esperan carga, con cuánto pesa y qué propuso el emparejador. La escribe el barrido de leer-dte-json; se lee para la pantalla «Por confirmar».';

-- ── 2. Qué documentos ya se leyeron ─────────────────────────────────────────
-- El barrido es incremental y **los conteos se suman**, así que leer dos veces
-- el mismo documento inflaría el peso de sus renglones. Esta tabla es el freno,
-- y es también lo que hace que la segunda corrida sólo mire lo nuevo.
CREATE TABLE IF NOT EXISTS public.compra_documento_leido (
    document_id bigint PRIMARY KEY REFERENCES public.purchase_dte_documents(id) ON DELETE CASCADE,
    leido_at    timestamptz NOT NULL DEFAULT now(),
    renglones   integer NOT NULL DEFAULT 0
);

ALTER TABLE public.compra_documento_leido ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compra_documento_leido_select ON public.compra_documento_leido;
CREATE POLICY compra_documento_leido_select ON public.compra_documento_leido
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('cargar_compra', 'can_view'))
        OR (SELECT public.auth_has_module_permission('compras', 'can_view')));

-- ── 3. El emparejador también busca por el código sintético ─────────────────
-- Único cambio: el paso 2 prueba la llave real y, si no está, la del nombre.
CREATE OR REPLACE FUNCTION public.emparejar_producto_dte(
    p_emisor_nit  text,
    p_codigo_prov text,
    p_texto       text
)
RETURNS TABLE (product_id integer, nombre text, origen text, similitud real)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_id  integer;
  v_nom text;
BEGIN
  -- 1. Código de barras: cualquier corrida de 12 a 14 dígitos del texto que
  --    exista en el catálogo. Los 4,708 códigos de barras son únicos, así que
  --    no hay ambigüedad que resolver.
  SELECT p.id, p.nombre INTO v_id, v_nom
    FROM regexp_matches(coalesce(p_texto, ''), '(\d{12,14})', 'g') m
    JOIN public.products p ON p.codigo_barras = m[1]
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, v_nom, 'codigo_barras'::text, 1.0::real;
    RETURN;
  END IF;

  -- 2. El diccionario: por el código del proveedor y, si no lo manda, por el
  --    código sintético del nombre (`#`+nombre normalizado) — la misma llave
  --    que arma la lista de «Por confirmar», para que confirmar un renglón sin
  --    código también quede aprendido.
  IF p_emisor_nit IS NOT NULL THEN
    SELECT a.product_id, p.nombre INTO v_id, v_nom
      FROM public.compra_producto_alias a
      JOIN public.products p ON p.id = a.product_id
     WHERE a.emisor_nit = p_emisor_nit
       AND a.codigo_proveedor = coalesce(nullif(btrim(p_codigo_prov), ''),
                                         '#' || public.norm_search(p_texto));
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, v_nom, 'aprendido'::text, 1.0::real;
      RETURN;
    END IF;
  END IF;

  -- 3. El parecido, con su número. Sin `LIMIT 1` a ciegas: si el mejor no
  --    llega al piso del índice de trigramas, no hay candidato y se dice.
  RETURN QUERY
    SELECT p.id, p.nombre, 'parecido'::text,
           similarity(p.nombre_norm, public.norm_search(p_texto))
      FROM public.products p
     WHERE p.nombre_norm % public.norm_search(p_texto)
     ORDER BY similarity(p.nombre_norm, public.norm_search(p_texto)) DESC, p.id
     LIMIT 1;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.emparejar_producto_dte(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.emparejar_producto_dte(text, text, text) TO authenticated, service_role;

-- ── 4. El barrido escribe acá ───────────────────────────────────────────────
--
-- Recibe los renglones de UN documento ya parseados y los acumula. El
-- emparejamiento corre **adentro de Postgres**: son ~15 llamadas por documento
-- y desde la Edge Function serían 15 viajes de red por documento, o sea 9,000
-- para el barrido entero.
CREATE OR REPLACE FUNCTION public.registrar_renglones_pendientes(
    p_document_id bigint,
    p_emisor_nit  text,
    p_fecha       date,
    p_filas       jsonb
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_nuevas integer := 0;
BEGIN
  -- El freno de la doble lectura. Si el documento ya se leyó, no se suma nada.
  INSERT INTO public.compra_documento_leido (document_id, renglones)
  VALUES (p_document_id, coalesce(jsonb_array_length(p_filas), 0))
  ON CONFLICT (document_id) DO NOTHING;
  IF NOT FOUND THEN RETURN 0; END IF;

  WITH filas AS (
      SELECT nullif(btrim(x->>'codigo'), '')      AS codigo,
             btrim(coalesce(x->>'descripcion','')) AS descripcion,
             nullif(btrim(x->>'limpio'), '')       AS limpio,
             coalesce((x->>'cantidad')::numeric, 0) AS cantidad
        FROM jsonb_array_elements(p_filas) x
       WHERE btrim(coalesce(x->>'descripcion','')) <> ''
  ),
  -- Un documento puede repetir el mismo producto en dos renglones. Se agrupa
  -- ANTES de escribir: si no, el `ON CONFLICT` de la segunda fila pisaría a la
  -- primera dentro del mismo comando y la cuenta saldría corta.
  agrupadas AS (
      SELECT coalesce(codigo, '#' || public.norm_search(coalesce(limpio, descripcion))) AS llave,
             max(codigo)          AS codigo,
             max(descripcion)     AS descripcion,
             max(limpio)          AS limpio,
             count(*)::integer    AS renglones,
             sum(cantidad)        AS unidades
        FROM filas
       GROUP BY 1
  )
  INSERT INTO public.compra_renglon_pendiente AS r
        (emisor_nit, llave, codigo_proveedor, descripcion, nombre_limpio,
         renglones, documentos, unidades, ultima_fecha,
         sugerido_product_id, sugerido_origen, sugerido_similitud)
  SELECT p_emisor_nit, a.llave, a.codigo, a.descripcion, a.limpio,
         a.renglones, 1, a.unidades, p_fecha,
         m.product_id, m.origen, m.similitud
    FROM agrupadas a
    LEFT JOIN LATERAL public.emparejar_producto_dte(
         p_emisor_nit, a.codigo, coalesce(a.limpio, a.descripcion)) m ON true
  ON CONFLICT (emisor_nit, llave) DO UPDATE SET
        renglones    = r.renglones  + EXCLUDED.renglones,
        documentos   = r.documentos + 1,
        unidades     = r.unidades   + EXCLUDED.unidades,
        ultima_fecha = greatest(r.ultima_fecha, EXCLUDED.ultima_fecha),
        descripcion  = EXCLUDED.descripcion,
        updated_at   = now();

  GET DIAGNOSTICS v_nuevas = ROW_COUNT;
  RETURN v_nuevas;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_renglones_pendientes(bigint, text, date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.registrar_renglones_pendientes(bigint, text, date, jsonb) TO service_role;

-- ── 5. Los documentos que el barrido todavía no leyó ────────────────────────
CREATE OR REPLACE FUNCTION public.get_documentos_por_barrer(p_dias integer DEFAULT 90, p_limite integer DEFAULT 40)
RETURNS TABLE (document_id bigint, json_path text, emisor_nit text, fecha_emision date, restantes bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  WITH pend AS (
    SELECT d.id, d.json_path, d.emisor_nit, d.fecha_emision
      FROM public.purchase_dte_documents d
     WHERE NOT d.invalidado
       AND d.tipo_dte IN ('01','03')
       AND d.json_path IS NOT NULL
       AND d.fecha_emision >= current_date - coalesce(p_dias, 90)
       AND NOT EXISTS (SELECT 1 FROM public.compra_documento_leido l WHERE l.document_id = d.id)
  )
  SELECT p.id, p.json_path, p.emisor_nit, p.fecha_emision,
         (SELECT count(*) FROM pend)
    FROM pend p
   ORDER BY p.fecha_emision DESC, p.id DESC
   LIMIT greatest(1, least(coalesce(p_limite, 40), 200));
$function$;

REVOKE EXECUTE ON FUNCTION public.get_documentos_por_barrer(integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_documentos_por_barrer(integer, integer) TO authenticated, service_role;

-- ── 6. La lista ─────────────────────────────────────────────────────────────
-- Sale ordenada por peso: primero la pregunta que destraba más renglones.
CREATE OR REPLACE FUNCTION public.get_productos_por_confirmar(
    p_solo_pendientes boolean DEFAULT true,
    p_limite          integer DEFAULT 500
)
RETURNS TABLE (
    id                 bigint,
    emisor_nit         text,
    proveedor          text,
    codigo_proveedor   text,
    descripcion        text,
    llave              text,
    renglones          integer,
    documentos         integer,
    unidades           numeric,
    ultima_fecha       date,
    sugerido_product_id integer,
    sugerido_nombre    text,
    sugerido_origen    text,
    sugerido_similitud real,
    resuelto           boolean,
    ignorado           boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT r.id, r.emisor_nit,
         coalesce((SELECT m.nombre FROM public.proveedores_maestro m
                    WHERE m.nit = r.emisor_nit ORDER BY m.id LIMIT 1),
                  (SELECT d.emisor_nombre FROM public.purchase_dte_documents d
                    WHERE d.emisor_nit = r.emisor_nit ORDER BY d.id DESC LIMIT 1)),
         r.codigo_proveedor, r.descripcion, r.llave,
         r.renglones, r.documentos, r.unidades, r.ultima_fecha,
         coalesce(a.product_id, r.sugerido_product_id),
         (SELECT p.nombre FROM public.products p
           WHERE p.id = coalesce(a.product_id, r.sugerido_product_id)),
         CASE WHEN a.product_id IS NOT NULL THEN 'aprendido' ELSE r.sugerido_origen END,
         CASE WHEN a.product_id IS NOT NULL THEN 1.0::real ELSE r.sugerido_similitud END,
         a.product_id IS NOT NULL,
         r.ignorado
    FROM public.compra_renglon_pendiente r
    LEFT JOIN public.compra_producto_alias a
           ON a.emisor_nit = r.emisor_nit AND a.codigo_proveedor = r.llave
   WHERE (SELECT auth_has_module_permission('cargar_compra','can_view')
           OR auth_has_module_permission('compras','can_view'))
     AND (NOT coalesce(p_solo_pendientes, true)
          OR (a.product_id IS NULL AND NOT r.ignorado))
   ORDER BY (a.product_id IS NOT NULL), r.ignorado, r.renglones DESC, r.id
   LIMIT greatest(1, least(coalesce(p_limite, 500), 2000));
$function$;

REVOKE EXECUTE ON FUNCTION public.get_productos_por_confirmar(boolean, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_productos_por_confirmar(boolean, integer) TO authenticated, service_role;

-- ── 7. Apartar un renglón que no es un producto nuestro ─────────────────────
CREATE OR REPLACE FUNCTION public.ignorar_renglon_pendiente(
    p_id bigint, p_motivo text, p_deshacer boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_emp uuid;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['cargar_compra','compras']) THEN
    RAISE EXCEPTION 'No tenés permiso para apartar renglones.';
  END IF;
  IF NOT coalesce(p_deshacer, false) AND coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Apartar un renglón exige decir por qué.';
  END IF;
  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';

  UPDATE public.compra_renglon_pendiente
     SET ignorado        = NOT coalesce(p_deshacer, false),
         ignorado_motivo = CASE WHEN coalesce(p_deshacer,false) THEN NULL ELSE btrim(p_motivo) END,
         ignorado_por    = CASE WHEN coalesce(p_deshacer,false) THEN NULL ELSE v_emp END,
         updated_at      = now()
   WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese renglón ya no está en la lista.'; END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ignorar_renglon_pendiente(bigint, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ignorar_renglon_pendiente(bigint, text, boolean) TO authenticated, service_role;
