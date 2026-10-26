-- ══════════════════════════════════════════════════════════════════════════
-- Anonimizar a un cliente A PEDIDO — 3/3: que nada la vuelva a llenar.
--
-- Rige desde que se aplique. Requiere 01 (columna `anonimizada_at`, tabla de
-- huellas, `datos_huella`). Las tres funciones parten de su definición VIVA de
-- producción (pg_get_functiondef, 2026-10-24); el único cambio en cada una
-- está marcado con «ANONIMIZADA».
--
-- 1. aplicar_espejo_erp: una ficha anonimizada NO recibe el espejo de la caja.
--    Sin esto, mientras la ficha de la caja todavía no quedó anónima (la cola
--    corre cada 10 min, y puede rechazar), el espejo copiaría con coalesce el
--    DUI, el teléfono y la dirección de vuelta.
--
-- 2. upsert_customers_v2 (la llama sync-dte-sales cada minuto): una factura
--    escrita con el nombre VIEJO no abre otra ficha ni mueve el historial.
--      · El número de la caja manda, como siempre: si la factura trae el
--        erp_id de la ficha anónima, se liga a ella (no la re-identifica: la
--        ficha sigue sin datos, y el texto de la factura ya existía — la ley
--        obliga a conservarlo tal cual).
--      · Sin número (la caja no contestó a `resolverIdCliente`) y con un nombre
--        cuya huella es la de una ficha anonimizada: se liga a la anónima y NO
--        se crea una ficha nueva. Es el caso de una factura vieja que se vuelve
--        a leer (cambio de estado): sin esta regla abriría «JUAN PÉREZ» de
--        nuevo y le movería la factura.
--      · Con un número NUEVO de la caja y el nombre viejo: es un cliente nuevo
--        de la caja (alguien lo volvió a dar de alta en el mostrador). Se crea
--        la ficha como a cualquiera, con nombre y número y nada más. El portal,
--        al buscar su DUI, avisa que esa persona pidió anonimizarse y que se
--        puede reactivar; unir las dos fichas es decisión de una persona.
--    El costo: `datos_huella` sólo se calcula para los nombres que no existen
--    ni por número ni por nombre (~22 al día) y sólo si hay alguna anonimizada.
--
-- 3. update_customer_fiscal: una ficha anonimizada no se edita desde Clientes.
--    Volver a llenarla es reactivarla, y eso tiene su propia puerta.
--
-- Verificado en el entorno de pruebas (bbfotmyuvmrtmbuqxmhf) con execute_sql.
-- ══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

-- ── 1 · El espejo ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aplicar_espejo_erp(p_filas json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_resultado json;
BEGIN
  WITH filas AS (
    SELECT lower(translate(x.match_name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun')) AS match_name,
           -- 'portal:123' o '123'. Nulo cuando el llamador no sabe el id.
           nullif(regexp_replace(coalesce(x.id, ''), '^portal:', ''), '')::bigint AS customer_id,
           x.erp_id, x.nit, x.dui, x.nrc, x.phone, x.telefono2, x.email,
           x.direccion, x.pasaporte, x.departamento, x.municipio, x.distrito,
           x.categoria, x.giro, x.retencion_pct
    FROM json_to_recordset(p_filas) AS x(
        id            text,
        match_name    text, erp_id text, nit text, dui text, nrc text,
        phone         text, telefono2 text, email text, direccion text,
        pasaporte     text, departamento text, municipio text, distrito text,
        categoria     text, giro text, retencion_pct smallint)
  -- El control de ambigüedad sigue siendo por nombre, pero SOLO para las que
  -- se van a resolver por nombre: dos filas con el mismo nombre y distinto
  -- customer_id no son ambiguas, son dos clientes distintos ya identificados.
  ), conteo AS (
    SELECT match_name, count(*) AS n FROM filas WHERE customer_id IS NULL GROUP BY 1
  ), unicas AS (
    SELECT f.* FROM filas f
    LEFT JOIN conteo c USING (match_name)
    WHERE f.customer_id IS NOT NULL OR c.n = 1
  ), pendientes AS (
    SELECT customer_id, campo,
           (array_agg(valor_anterior ORDER BY changed_at,      id     ))[1] AS valor_base,
           (array_agg(valor_nuevo    ORDER BY changed_at DESC, id DESC))[1] AS valor_portal,
           (array_agg(id             ORDER BY changed_at DESC, id DESC))[1] AS changelog_id
    FROM public.customers_changelog
    WHERE erp_synced_at IS NULL AND descartado_at IS NULL
    GROUP BY customer_id, campo
  ), prot AS (
    SELECT customer_id,
           jsonb_object_agg(campo, jsonb_build_object(
               'base', valor_base, 'portal', valor_portal)) AS campos
    FROM pendientes GROUP BY customer_id
  ), objetivo AS (
    SELECT c.id AS customer_id, e.match_name, e.erp_id, e.nit, e.dui, e.nrc,
           e.phone, e.telefono2, e.email, e.direccion, e.pasaporte,
           e.departamento, e.municipio, e.distrito, e.categoria, e.giro,
           e.retencion_pct,
           coalesce(p.campos, '{}'::jsonb) AS prot
    FROM unicas e
    -- El id manda si vino; si no, el nombre normalizado, como siempre.
    JOIN public.customers c
      ON ((e.customer_id IS NOT NULL AND c.id = e.customer_id)
      OR (e.customer_id IS NULL AND c.search_name = e.match_name))
      -- Una ficha fusionada no recibe el espejo: le daría un número que ya
      -- tiene la principal.
     AND c.deshabilitada_at IS NULL
      -- ANONIMIZADA: tampoco una anonimizada a pedido del titular. El espejo
      -- copia con coalesce y le devolvería el DUI, el teléfono y la dirección.
     AND c.anonimizada_at IS NULL
    LEFT JOIN prot p ON p.customer_id = c.id
  ), entrantes AS (
    SELECT o.customer_id, v.campo, v.valor
    FROM objetivo o
    CROSS JOIN LATERAL (VALUES
        ('nit', o.nit), ('dui', o.dui), ('nrc', o.nrc), ('phone', o.phone),
        ('telefono2', o.telefono2), ('email', o.email),
        ('direccion', o.direccion), ('pasaporte', o.pasaporte),
        ('departamento', o.departamento), ('municipio', o.municipio),
        ('distrito', o.distrito), ('categoria', o.categoria),
        ('giro', o.giro), ('retencion_pct', o.retencion_pct::text)
    ) AS v(campo, valor)
  ), conflictos AS (
    SELECT en.customer_id, pe.changelog_id, en.campo,
           pe.valor_base, pe.valor_portal, en.valor AS valor_erp
    FROM entrantes en
    JOIN pendientes pe ON pe.customer_id = en.customer_id AND pe.campo = en.campo
    WHERE en.valor IS NOT NULL
      AND en.valor IS DISTINCT FROM pe.valor_base
  ), calculado AS (
    SELECT o.customer_id,
           coalesce(o.erp_id, c.erp_id) AS erp_id,
           public.espejo_valor(o.nit,          c.nit,          o.prot, 'nit')          AS nit,
           public.espejo_valor(o.dui,          c.dui,          o.prot, 'dui')          AS dui,
           public.espejo_valor(o.nrc,          c.nrc,          o.prot, 'nrc')          AS nrc,
           public.espejo_valor(o.phone,        c.phone,        o.prot, 'phone')        AS phone,
           public.espejo_valor(o.telefono2,    c.telefono2,    o.prot, 'telefono2')    AS telefono2,
           public.espejo_valor(o.email,        c.email,        o.prot, 'email')        AS email,
           public.espejo_valor(o.direccion,    c.direccion,    o.prot, 'direccion')    AS direccion,
           public.espejo_valor(o.pasaporte,    c.pasaporte,    o.prot, 'pasaporte')    AS pasaporte,
           public.espejo_valor(o.departamento, c.departamento, o.prot, 'departamento') AS departamento,
           public.espejo_valor(o.municipio,    c.municipio,    o.prot, 'municipio')    AS municipio,
           public.espejo_valor(o.distrito,     c.distrito,     o.prot, 'distrito')     AS distrito,
           public.espejo_valor(o.categoria,    c.categoria,    o.prot, 'categoria')    AS categoria,
           public.espejo_valor(o.giro,         c.giro,         o.prot, 'giro')         AS giro,
           public.espejo_valor(o.retencion_pct::text, c.retencion_pct::text,
                               o.prot, 'retencion_pct')::smallint                      AS retencion_pct
    FROM objetivo o
    JOIN public.customers c ON c.id = o.customer_id
  ), ins AS (
    INSERT INTO public.espejo_conflictos
        (customer_id, changelog_id, campo, valor_base, valor_portal, valor_erp)
    SELECT customer_id, changelog_id, campo, valor_base, valor_portal, valor_erp
    FROM conflictos
    RETURNING 1
  ), saldadas AS (
    UPDATE public.customers_changelog cl
       SET descartado_at = now()
      FROM conflictos k
     WHERE cl.customer_id = k.customer_id
       AND cl.campo = k.campo
       AND cl.erp_synced_at IS NULL
       AND cl.descartado_at IS NULL
    RETURNING 1
  ), upd AS (
    UPDATE public.customers c SET
        erp_id = k.erp_id, nit = k.nit, dui = k.dui, nrc = k.nrc,
        phone = k.phone, telefono2 = k.telefono2, email = k.email,
        direccion = k.direccion, pasaporte = k.pasaporte,
        departamento = k.departamento, municipio = k.municipio,
        distrito = k.distrito, categoria = k.categoria, giro = k.giro,
        retencion_pct = k.retencion_pct, updated_at = now()
    FROM calculado k
    WHERE c.id = k.customer_id
      AND (c.erp_id, c.nit, c.dui, c.nrc, c.phone, c.telefono2, c.email,
           c.direccion, c.pasaporte, c.departamento, c.municipio, c.distrito,
           c.categoria, c.giro, c.retencion_pct)
          IS DISTINCT FROM
          (k.erp_id, k.nit, k.dui, k.nrc, k.phone, k.telefono2, k.email,
           k.direccion, k.pasaporte, k.departamento, k.municipio, k.distrito,
           k.categoria, k.giro, k.retencion_pct)
    RETURNING 1
  )
  SELECT json_build_object(
    'recibidas',           (SELECT count(*) FROM filas),
    'duplicadas_omitidas', (SELECT coalesce(sum(n), 0) FROM conteo WHERE n > 1),
    'actualizadas',        (SELECT count(*) FROM upd),
    'sin_cambio',          (SELECT count(*) FROM objetivo) - (SELECT count(*) FROM upd),
    'por_id',              (SELECT count(*) FROM unicas WHERE customer_id IS NOT NULL),
    'campos_protegidos',   (SELECT count(*) FROM entrantes en
                            JOIN pendientes pe ON pe.customer_id = en.customer_id
                                              AND pe.campo = en.campo
                            WHERE en.valor IS NOT DISTINCT FROM pe.valor_base),
    'conflictos',          (SELECT count(*) FROM ins),
    'entradas_descartadas',(SELECT count(*) FROM saldadas),
    'sin_match',           (SELECT count(*) FROM unicas e
                            WHERE NOT EXISTS (
                              SELECT 1 FROM public.customers c
                              WHERE ((e.customer_id IS NOT NULL AND c.id = e.customer_id)
                                 OR (e.customer_id IS NULL AND c.search_name = e.match_name))
                                AND c.deshabilitada_at IS NULL
                                AND c.anonimizada_at IS NULL))   -- ANONIMIZADA
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$function$;

-- ── 2 · El alta de fichas desde las facturas ────────────────────────────────
-- Sin tabla temporal a propósito: corre cada minuto, y una tabla temporal por
-- llamada es churn de catálogo. La entrada se repite como CTE en las dos
-- sentencias, igual que en la versión viva.
CREATE OR REPLACE FUNCTION public.upsert_customers_v2(p_rows json)
 RETURNS TABLE(customer_name text, customer_id bigint)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  -- ANONIMIZADA: la huella del nombre sólo se calcula si hay alguna anonimizada.
  v_hay_anonimas boolean := EXISTS (SELECT 1 FROM public.clientes_anonimizados_huellas WHERE tipo = 'nombre');
BEGIN
  -- 1 · Crear solo lo que no existe ni por número ni por nombre.
  INSERT INTO public.customers (name, erp_id)
  SELECT e.nombre, e.erp_id
  FROM (
    SELECT DISTINCT upper(btrim(x.nombre)) AS nombre,
           nullif(btrim(coalesce(x.erp_id, '')), '') AS erp_id
    FROM json_to_recordset(p_rows) AS x(nombre text, erp_id text)
    WHERE upper(btrim(coalesce(x.nombre, ''))) <> ''
  ) e
  WHERE NOT EXISTS (SELECT 1 FROM public.customers c
                     WHERE e.erp_id IS NOT NULL AND c.erp_id = e.erp_id)
    AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.name = e.nombre)
    -- ANONIMIZADA: sin número de la caja y con el nombre de una ficha
    -- anonimizada, NO se abre otra: la factura va a la anónima (paso 2).
    AND NOT (v_hay_anonimas AND e.erp_id IS NULL AND EXISTS (
          SELECT 1 FROM public.clientes_anonimizados_huellas h
           WHERE h.tipo = 'nombre' AND h.huella = public.datos_huella('nombre', e.nombre)))
  ON CONFLICT DO NOTHING;

  -- 2 · Devolver el mapa ya resuelto. Se relee `customers` en vez de usar el
  -- RETURNING del insert: así una fila que perdió una carrera con otra
  -- invocación igual sale con su id, en lugar de dejar la factura sin cliente.
  RETURN QUERY
  SELECT e.nombre,
         -- Una ficha fusionada (deshabilitada) conserva su nombre a propósito:
         -- así la próxima factura escrita igual NO abre otra ficha suelta y se
         -- liga directo a la principal.
         public.cliente_vigente(coalesce(por_erp.id, por_nombre.id, anon.customer_id)) AS id
  FROM (
    SELECT DISTINCT upper(btrim(x.nombre)) AS nombre,
           nullif(btrim(coalesce(x.erp_id, '')), '') AS erp_id
    FROM json_to_recordset(p_rows) AS x(nombre text, erp_id text)
    WHERE upper(btrim(coalesce(x.nombre, ''))) <> ''
  ) e
  -- El número manda; el nombre es el respaldo; la huella, el último.
  LEFT JOIN public.customers por_erp    ON e.erp_id IS NOT NULL
                                       AND por_erp.erp_id = e.erp_id
  LEFT JOIN public.customers por_nombre ON por_nombre.name = e.nombre
  -- ANONIMIZADA: sólo para lo que no resolvió ni el número ni el nombre.
  LEFT JOIN LATERAL (
    SELECT h.customer_id FROM public.clientes_anonimizados_huellas h
     WHERE v_hay_anonimas AND e.erp_id IS NULL
       AND por_erp.id IS NULL AND por_nombre.id IS NULL
       AND h.tipo = 'nombre' AND h.huella = public.datos_huella('nombre', e.nombre)
  ) anon ON true
  WHERE coalesce(por_erp.id, por_nombre.id, anon.customer_id) IS NOT NULL;
END;
$function$;

-- ── 3 · Una ficha anonimizada no se edita ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_customer_fiscal(p_id bigint, p_campos jsonb, p_confirmar_fiscal boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  CAMPOS constant text[] := ARRAY[
    'name', 'nit', 'dui', 'nrc', 'pasaporte', 'phone', 'telefono2', 'email',
    'direccion', 'departamento', 'municipio', 'distrito', 'categoria', 'giro',
    'retencion_pct', 'notes'];
  CATEGORIAS constant text[] := ARRAY[
    'Consumidor', 'Contribuyente', 'Gran Contribuyente',
    'Contribuyente Exento', 'Extranjero', 'Menor de edad'];
  FISCALES constant text[] := ARRAY['nit', 'nrc', 'categoria', 'giro', 'name'];

  v_actual public.customers%ROWTYPE;
  v_old    jsonb;
  v_new    jsonb;
  v_campo  text;
  v_txt    text;
  v_emp    uuid;
  v_emp_nombre text;
  v_cambios integer := 0;
  v_toca_fiscal boolean := false;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_actual FROM public.customers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_EXISTE';
  END IF;

  -- ANONIMIZADA: volver a llenarla es reactivarla, y eso se hace desde la
  -- solicitud de datos, con el documento de la persona.
  IF v_actual.anonimizada_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLIENTE_ANONIMIZADO';
  END IF;

  IF public.es_cliente_mostrador(v_actual.name, v_actual.erp_id) THEN
    RAISE EXCEPTION 'ES_MOSTRADOR';
  END IF;

  v_old := to_jsonb(v_actual);
  v_new := v_old;

  -- Solo se mueve lo que vino en el payload. Un campo ausente conserva su valor:
  -- sin esto, guardar el teléfono desde un formulario parcial borraría el resto
  -- de la ficha — que es exactamente lo que hace el POST del ERP y por lo que
  -- hay que mandarle los 21 campos siempre.
  FOREACH v_campo IN ARRAY CAMPOS LOOP
    IF p_campos ? v_campo THEN
      v_txt := nullif(btrim(coalesce(p_campos ->> v_campo, '')), '');
      v_new := jsonb_set(v_new, ARRAY[v_campo], coalesce(to_jsonb(v_txt), 'null'::jsonb));
    END IF;
  END LOOP;

  -- El nombre en mayúscula: es el estándar de hecho del catálogo (91%), es lo
  -- que inserta `upsert_customers`, y es sobre `upper(trim(name))` que corre el
  -- índice único — guardarlo de otra forma haría chocar dos fichas que el
  -- usuario ve distintas.
  IF nullif(btrim(coalesce(v_new ->> 'name', '')), '') IS NULL THEN
    RAISE EXCEPTION 'NOMBRE_VACIO';
  END IF;
  v_new := jsonb_set(v_new, '{name}', to_jsonb(upper(btrim(v_new ->> 'name'))));

  IF v_new ->> 'categoria' IS NOT NULL AND NOT (v_new ->> 'categoria' = ANY (CATEGORIAS)) THEN
    RAISE EXCEPTION 'CATEGORIA_INVALIDA';
  END IF;

  IF v_new ->> 'retencion_pct' IS NOT NULL THEN
    IF v_new ->> 'retencion_pct' !~ '^\d{1,3}$'
       OR (v_new ->> 'retencion_pct')::integer > 100 THEN
      RAISE EXCEPTION 'RETENCION_INVALIDA';
    END IF;
  END IF;

  -- Coherencia de la terna geográfica. La misma regla que `normalizarGeo` del
  -- front, escrita del lado del servidor porque un cliente que arma el JSON a
  -- mano no pasa por el formulario. Los 44 municipios se llaman
  -- "<Departamento> <cardinal>", así que el prefijo ES la validación.
  IF v_new ->> 'distrito' IS NOT NULL AND v_new ->> 'municipio' IS NULL THEN
    RAISE EXCEPTION 'GEO_INCOHERENTE';
  END IF;
  IF v_new ->> 'municipio' IS NOT NULL THEN
    IF v_new ->> 'departamento' IS NULL
       OR v_new ->> 'municipio' NOT LIKE (v_new ->> 'departamento') || ' %' THEN
      RAISE EXCEPTION 'GEO_INCOHERENTE';
    END IF;
  END IF;

  -- DUI y teléfonos se validan SOLO si cambiaron. El catálogo ya trae datos
  -- malos de antes (2 DUI que no pasan el verificador), y bloquear el guardado
  -- por ellos dejaría esas fichas congeladas: no se podría arreglar el correo
  -- sin arreglar primero un DUI que a lo mejor nadie sabe cuál es.
  IF (v_new ->> 'dui') IS DISTINCT FROM (v_old ->> 'dui')
     AND v_new ->> 'dui' IS NOT NULL
     AND (length(regexp_replace(v_new ->> 'dui', '\D', '', 'g')) <> 9
          OR NOT public.es_dui_valido(v_new ->> 'dui')) THEN
    RAISE EXCEPTION 'DUI_INVALIDO';
  END IF;

  IF (v_new ->> 'phone') IS DISTINCT FROM (v_old ->> 'phone')
     AND NOT public.es_telefono_sv_valido(v_new ->> 'phone') THEN
    RAISE EXCEPTION 'TELEFONO_INVALIDO';
  END IF;

  IF (v_new ->> 'telefono2') IS DISTINCT FROM (v_old ->> 'telefono2')
     AND NOT public.es_telefono_sv_valido(v_new ->> 'telefono2') THEN
    RAISE EXCEPTION 'TELEFONO_INVALIDO';
  END IF;

  -- Los datos de un contribuyente se declaran a Hacienda. Tocarlos exige un sí
  -- explícito del usuario, y el candado vive acá y no solo en la pantalla: un
  -- guardado que llegue sin pasar por el formulario tiene que chocar igual.
  SELECT bool_or((v_new ->> f) IS DISTINCT FROM (v_old ->> f))
    INTO v_toca_fiscal
    FROM unnest(FISCALES) AS f;

  IF coalesce(v_toca_fiscal, false)
     AND coalesce(v_old ->> 'categoria', v_new ->> 'categoria') IN
         ('Contribuyente', 'Gran Contribuyente', 'Contribuyente Exento')
     AND NOT p_confirmar_fiscal THEN
    RAISE EXCEPTION 'REQUIERE_CONFIRMACION_FISCAL';
  END IF;

  UPDATE public.customers SET
    name          = v_new ->> 'name',
    nit           = v_new ->> 'nit',
    dui           = v_new ->> 'dui',
    nrc           = v_new ->> 'nrc',
    pasaporte     = v_new ->> 'pasaporte',
    phone         = v_new ->> 'phone',
    telefono2     = v_new ->> 'telefono2',
    email         = v_new ->> 'email',
    direccion     = v_new ->> 'direccion',
    departamento  = v_new ->> 'departamento',
    municipio     = v_new ->> 'municipio',
    distrito      = v_new ->> 'distrito',
    categoria     = v_new ->> 'categoria',
    giro          = v_new ->> 'giro',
    retencion_pct = (v_new ->> 'retencion_pct')::smallint,
    notes         = v_new ->> 'notes',
    updated_at    = now()
  WHERE id = p_id;

  v_emp := (SELECT public.auth_employee_id());
  SELECT e.name INTO v_emp_nombre FROM public.employees e WHERE e.id = v_emp;

  INSERT INTO public.customers_changelog
    (customer_id, campo, valor_anterior, valor_nuevo, changed_by, changed_by_nombre)
  SELECT p_id, f, v_old ->> f, v_new ->> f, v_emp, v_emp_nombre
  FROM   unnest(CAMPOS) AS f
  WHERE  (v_old ->> f) IS DISTINCT FROM (v_new ->> f);

  GET DIAGNOSTICS v_cambios = ROW_COUNT;

  RETURN json_build_object(
    'ok', true,
    'cambios', v_cambios,
    'cliente', (SELECT to_json(c) FROM public.customers c WHERE c.id = p_id));

EXCEPTION
  -- `customers_name_norm_idx` es único sobre upper(trim(name)): dos fichas no
  -- pueden llamarse igual. Se traduce a un código propio para que la vista
  -- muestre un mensaje y no el texto crudo del constraint.
  WHEN unique_violation THEN
    RAISE EXCEPTION 'NOMBRE_DUPLICADO';
END;
$function$;
