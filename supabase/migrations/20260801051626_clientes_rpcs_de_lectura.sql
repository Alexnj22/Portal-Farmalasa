SET lock_timeout = '5s';

-- ── Lectura del módulo de Clientes ───────────────────────────────────────────
--
-- Las tres funciones devuelven `json` (Patrón C de CLAUDE.md) y no SETOF: con
-- 24,502 fichas, un SETOF quedaría cortado en 1000 por PostgREST sin avisar. Y
-- `json_agg`, nunca `jsonb_agg` — el binario se construye entero en memoria y
-- spillea (medido 402ms vs 1,963ms en un payload equivalente).

-- La página de la lista: filtra, ordena y pagina **en el servidor**. No hay
-- versión que traiga las 24,502 al navegador: son ~12MB y el cap de PostgREST
-- las cortaría en 1000 mucho antes.
CREATE OR REPLACE FUNCTION public.get_customers_page(
    p_search       text    DEFAULT NULL,
    p_categoria    text    DEFAULT NULL,   -- una de las 6, o '__sin__'
    p_departamento text    DEFAULT NULL,
    p_municipio    text    DEFAULT NULL,
    p_ficha        text    DEFAULT NULL,   -- 'vacia' | 'parcial' | 'completa'
    p_erp          text    DEFAULT NULL,   -- 'con' | 'sin'
    p_actividad    text    DEFAULT NULL,   -- 'con' | 'sin'
    p_revisar      text    DEFAULT NULL,   -- 'dui' | 'telefono' | 'nombre'
    p_mostrador    text    DEFAULT NULL,   -- 'sin' esconde los baldes del POS
    p_sort         text    DEFAULT 'nombre',
    p_dir          text    DEFAULT 'asc',
    p_limit        integer DEFAULT 25,
    p_offset       integer DEFAULT 0)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tokens text[];
  v_orden  text;
  v_res    json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('clientes', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- El query se normaliza EXACTAMENTE como la columna generada `search_name`
  -- (`lower(translate(name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun'))`). Si acá se
  -- usara `unaccent()` en su lugar, "MUÑOZ" no encontraría a "munoz": son dos
  -- normalizaciones parecidas y no idénticas.
  v_tokens := CASE
    WHEN nullif(btrim(coalesce(p_search, '')), '') IS NULL THEN NULL
    ELSE regexp_split_to_array(
           btrim(lower(translate(p_search, 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun'))), '\s+')
  END;

  -- Lista blanca: el orden se arma con `format`, así que la única forma de que
  -- no sea inyectable es que `p_sort`/`p_dir` no lleguen nunca crudos al SQL.
  v_orden := CASE p_sort
        WHEN 'facturas' THEN 'facturas'
        WHEN 'total'    THEN 'total'
        WHEN 'ultima'   THEN 'ultima_fecha'
        WHEN 'ficha'    THEN 'ficha'
        ELSE 'name'
      END
      || CASE WHEN upper(coalesce(p_dir, 'asc')) = 'DESC'
              THEN ' DESC NULLS LAST' ELSE ' ASC NULLS LAST' END
      -- Desempate estable: sin él, dos fichas con la misma facturación bailan
      -- de lugar entre páginas y la paginación repite o se salta filas.
      || ', name ASC';

  EXECUTE format($q$
    WITH filtrados AS MATERIALIZED (
      SELECT
        c.id, c.name, c.erp_id, c.nit, c.dui, c.nrc, c.pasaporte,
        c.phone, c.telefono2, c.email, c.direccion,
        c.departamento, c.municipio, c.distrito, c.categoria, c.giro,
        c.retencion_pct, c.updated_at,
        public.customer_ficha_estado(c.categoria, c.nit, c.dui, c.nrc,
            c.pasaporte, c.phone, c.direccion, c.giro)                    AS ficha,
        public.es_cliente_mostrador(c.name, c.erp_id)                     AS mostrador,
        (c.dui IS NOT NULL
         AND (length(regexp_replace(c.dui, '\D', '', 'g')) <> 9
              OR NOT public.es_dui_valido(c.dui)))                        AS dui_sospechoso,
        (NOT public.es_telefono_sv_valido(c.phone))                       AS tel_sospechoso,
        -- Mojibake: nombres importados con la codificación rota ("MUÃ±OZ" por
        -- "MUÑOZ"). Son 15 en prod y el ojo no los distingue en una lista larga.
        (c.name ~ '[ÃÂÄÅ]')                                               AS nombre_corrupto,
        coalesce(a.facturas, 0)                                           AS facturas,
        coalesce(a.facturas_ccf, 0)                                       AS facturas_ccf,
        coalesce(a.facturas_anuladas, 0)                                  AS facturas_anuladas,
        coalesce(a.total, 0)                                              AS total,
        a.primera_fecha, a.ultima_fecha
      FROM public.customers c
      LEFT JOIN public.customer_activity a ON a.customer_id = c.id
      WHERE
        -- Cada token tiene que aparecer en ALGÚN campo (AND entre tokens, OR
        -- entre campos) — la misma semántica que `tokenMatch` del front.
        ($1 IS NULL OR (SELECT bool_and(
              c.search_name                        LIKE '%%' || t || '%%'
           OR lower(coalesce(c.nit, ''))           LIKE '%%' || t || '%%'
           OR lower(coalesce(c.dui, ''))           LIKE '%%' || t || '%%'
           OR lower(coalesce(c.nrc, ''))           LIKE '%%' || t || '%%'
           OR lower(coalesce(c.phone, ''))         LIKE '%%' || t || '%%'
           OR lower(coalesce(c.telefono2, ''))     LIKE '%%' || t || '%%'
           OR lower(coalesce(c.email, ''))         LIKE '%%' || t || '%%'
           OR lower(coalesce(c.erp_id, ''))        LIKE '%%' || t || '%%')
          FROM unnest($1::text[]) AS t))
        AND ($2 IS NULL OR CASE WHEN $2 = '__sin__'
                                THEN c.categoria IS NULL
                                ELSE c.categoria = $2 END)
        AND ($3 IS NULL OR c.departamento = $3)
        AND ($4 IS NULL OR c.municipio    = $4)
        AND ($5 IS NULL OR public.customer_ficha_estado(c.categoria, c.nit, c.dui,
                c.nrc, c.pasaporte, c.phone, c.direccion, c.giro) = $5)
        AND ($6 IS NULL OR CASE WHEN $6 = 'con' THEN c.erp_id IS NOT NULL
                                ELSE c.erp_id IS NULL END)
        AND ($7 IS NULL OR CASE WHEN $7 = 'con' THEN coalesce(a.facturas, 0) > 0
                                ELSE coalesce(a.facturas, 0) = 0 END)
        AND ($8 IS NULL OR CASE $8
               WHEN 'dui'      THEN c.dui IS NOT NULL
                                AND (length(regexp_replace(c.dui, '\D', '', 'g')) <> 9
                                     OR NOT public.es_dui_valido(c.dui))
               WHEN 'telefono' THEN NOT public.es_telefono_sv_valido(c.phone)
               WHEN 'nombre'   THEN c.name ~ '[ÃÂÄÅ]'
               ELSE true END)
        AND ($9 IS DISTINCT FROM 'sin' OR NOT public.es_cliente_mostrador(c.name, c.erp_id))
    )
    SELECT json_build_object(
      'total', (SELECT count(*) FROM filtrados),
      'rows',  coalesce((
                 SELECT json_agg(to_json(p))
                 FROM (SELECT * FROM filtrados ORDER BY %s LIMIT $10 OFFSET $11) p
               ), '[]'::json))
  $q$, v_orden)
  INTO v_res
  USING v_tokens, p_categoria, p_departamento, p_municipio, p_ficha,
        p_erp, p_actividad, p_revisar, nullif(p_mostrador, ''),
        greatest(coalesce(p_limit, 25), 1), greatest(coalesce(p_offset, 0), 0);

  RETURN v_res;
END;
$$;

-- Las cinco tarjetas del carril. Son CINCO fijas y las decide la vista, no el
-- dato (§17.0 de DESIGN.md): un carril de largo variable es un desglose
-- disfrazado de métricas.
CREATE OR REPLACE FUNCTION public.get_customers_stats()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN NOT (SELECT public.auth_has_module_permission('clientes', 'can_view'))
      THEN json_build_object('error', 'FORBIDDEN')
    ELSE (
      SELECT json_build_object(
        'total',        count(*),
        'completas',    count(*) FILTER (WHERE f.estado = 'completa'),
        -- La cola de trabajo: fichas sin un solo dato que SÍ le compran a la
        -- empresa. Es la única de las cinco que ordena qué hacer primero.
        'por_completar',count(*) FILTER (WHERE f.estado = 'vacia'
                                          AND coalesce(a.facturas, 0) > 0
                                          AND NOT f.mostrador),
        'contribuyentes',count(*) FILTER (WHERE c.categoria IN
                            ('Contribuyente', 'Gran Contribuyente', 'Contribuyente Exento')),
        'a_revisar',    count(*) FILTER (WHERE f.dui_malo OR f.tel_malo OR f.nombre_malo))
      FROM public.customers c
      LEFT JOIN public.customer_activity a ON a.customer_id = c.id
      CROSS JOIN LATERAL (SELECT
          public.customer_ficha_estado(c.categoria, c.nit, c.dui, c.nrc,
              c.pasaporte, c.phone, c.direccion, c.giro)  AS estado,
          public.es_cliente_mostrador(c.name, c.erp_id)   AS mostrador,
          (c.dui IS NOT NULL
           AND (length(regexp_replace(c.dui, '\D', '', 'g')) <> 9
                OR NOT public.es_dui_valido(c.dui)))      AS dui_malo,
          (NOT public.es_telefono_sv_valido(c.phone))     AS tel_malo,
          (c.name ~ '[ÃÂÄÅ]')                             AS nombre_malo) f
    )
  END;
$$;

-- La ficha completa + su actividad + sus últimas facturas + su bitácora, en UNA
-- llamada. Cuatro consultas separadas desde el navegador serían cuatro viajes
-- para abrir un modal.
CREATE OR REPLACE FUNCTION public.get_customer_detail(p_id bigint)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN NOT (SELECT public.auth_has_module_permission('clientes', 'can_view'))
      THEN json_build_object('error', 'FORBIDDEN')
    ELSE (
      SELECT json_build_object(
        'cliente', (SELECT to_json(x) FROM (
            SELECT c.*,
                   public.customer_ficha_estado(c.categoria, c.nit, c.dui, c.nrc,
                       c.pasaporte, c.phone, c.direccion, c.giro) AS ficha,
                   public.es_cliente_mostrador(c.name, c.erp_id)  AS mostrador,
                   (c.name ~ '[ÃÂÄÅ]')                            AS nombre_corrupto
            FROM public.customers c WHERE c.id = p_id) x),
        'actividad', (SELECT to_json(a) FROM public.customer_activity a
                      WHERE a.customer_id = p_id),
        -- Las últimas 12: entran por `idx_sales_invoices_customer_id`, así que
        -- son un index scan corto y no un recorrido de las 338K.
        'facturas', coalesce((SELECT json_agg(to_json(f)) FROM (
            SELECT si.id, si.fecha, si.tipo_documento, si.correlativo,
                   si.estado, si.total, b.name AS sucursal
            FROM public.sales_invoices si
            LEFT JOIN public.branches b ON b.id = si.branch_id
            WHERE si.customer_id = p_id
            ORDER BY si.fecha DESC, si.id DESC
            LIMIT 12) f), '[]'::json),
        'bitacora', coalesce((SELECT json_agg(to_json(h)) FROM (
            SELECT cl.campo, cl.valor_anterior, cl.valor_nuevo,
                   cl.changed_by_nombre, cl.changed_at, cl.erp_synced_at
            FROM public.customers_changelog cl
            WHERE cl.customer_id = p_id
            ORDER BY cl.changed_at DESC, cl.id DESC
            LIMIT 30) h), '[]'::json))
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_customers_page(text, text, text, text, text, text, text, text, text, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_customers_stats()      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_customer_detail(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_customers_page(text, text, text, text, text, text, text, text, text, text, text, integer, integer) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_customers_stats()      TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_customer_detail(bigint) TO authenticated, service_role;
