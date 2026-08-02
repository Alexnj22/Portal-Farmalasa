SET lock_timeout = '5s';

-- El espejo y el push se trancaban entre sí. Cuando el espejo decidía que una
-- edición del portal perdía contra el ERP, la anotaba en `espejo_conflictos` y
-- el push dejaba de mandar ese campo — las dos reglas correctas. Pero nadie
-- cerraba la entrada del changelog, y "pendiente" (`erp_synced_at IS NULL`) es
-- justamente lo que hace que el espejo la vuelva a detectar. Resultado: una
-- fila nueva en `espejo_conflictos` por corrida, para siempre, y el badge
-- "Sin enviar al ERP" encendido sobre un cambio que ya se decidió descartar.
-- Medido el 2026-08-02: 7 filas idénticas para el mismo changelog_id 10.
ALTER TABLE public.customers_changelog
  ADD COLUMN IF NOT EXISTS descartado_at timestamptz;

COMMENT ON COLUMN public.customers_changelog.descartado_at IS
  'Cuándo el espejo decidió que esta edición del portal perdió contra el ERP. '
  'Cierra la entrada: deja de estar pendiente sin mentir diciendo que se '
  'sincronizó (para eso está erp_synced_at, que sí significa que viajó).';

-- Las que ya estaban trabadas. Sin esto, quitar el candado de `bloqueados`
-- las volvería empujables de golpe y el ERP recibiría un valor superado.
UPDATE public.customers_changelog cl
   SET descartado_at = now()
 WHERE cl.erp_synced_at IS NULL
   AND cl.descartado_at IS NULL
   AND EXISTS (SELECT 1
                 FROM public.customers_changelog c2
                 JOIN public.espejo_conflictos k ON k.changelog_id = c2.id
                WHERE c2.customer_id = cl.customer_id
                  AND c2.campo = cl.campo);

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
    SELECT * FROM json_to_recordset(p_filas) AS x(
        match_name    text, erp_id text, nit text, dui text, nrc text,
        phone         text, telefono2 text, email text, direccion text,
        pasaporte     text, departamento text, municipio text, distrito text,
        categoria     text, giro text, retencion_pct smallint)
  ), conteo AS (
    SELECT match_name, count(*) AS n FROM filas GROUP BY 1
  ), unicas AS (
    SELECT f.* FROM filas f JOIN conteo c USING (match_name) WHERE c.n = 1

  -- Ediciones del portal que todavía no llegaron al ERP. `valor_base` es lo que
  -- el campo tenía ANTES de que la persona lo tocara —o sea lo que el ERP le
  -- había puesto—, y es la referencia para saber si el ERP se movió después.
  --
  -- `descartado_at IS NULL` es lo que corta el lazo: una edición que ya perdió
  -- una carrera está decidida, no pendiente. Sin este filtro la volvíamos a
  -- descartar en cada corrida y anotábamos el mismo conflicto de nuevo.
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
    SELECT c.id AS customer_id, e.*, coalesce(p.campos, '{}'::jsonb) AS prot
    FROM unicas e
    JOIN public.customers c ON c.search_name = e.match_name
    LEFT JOIN prot p ON p.customer_id = c.id

  -- El mismo valor entrante, en formato (campo, valor), para poder cruzarlo
  -- contra `pendientes` sin repetir un CASE de 14 ramas.
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

  -- Y se cierra la entrada en el mismo movimiento. Se marca el campo ENTERO,
  -- no solo la última entrada: las anteriores son eslabones de la misma cadena
  -- superada, y empujar una de ellas mandaría al ERP un valor que la persona
  -- ya había reemplazado. Es la misma regla que antes vivía en el candado
  -- `bloqueados` de `cola_espejo_portal_erp`, pero anotada en el dato en vez de
  -- recalculada para siempre: una edición NUEVA sobre ese campo vuelve a ser
  -- empujable, que es lo que corresponde — el candado viejo la bloqueaba de por
  -- vida.
  ), saldadas AS (
    UPDATE public.customers_changelog cl
       SET descartado_at = now()
      FROM conflictos k
     WHERE cl.customer_id = k.customer_id
       AND cl.campo = k.campo
       AND cl.erp_synced_at IS NULL
       AND cl.descartado_at IS NULL
    RETURNING 1

  -- El guard de IS DISTINCT FROM no es cosmético: sin él cada corrida del
  -- espejo reescribe las ~1,000 filas aunque no haya cambiado nada, que es
  -- exactamente el churn de WAL que el proyecto tiene prohibido en los syncs
  -- recurrentes.
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
    'campos_protegidos',   (SELECT count(*) FROM entrantes en
                            JOIN pendientes pe ON pe.customer_id = en.customer_id
                                              AND pe.campo = en.campo
                            WHERE en.valor IS NOT DISTINCT FROM pe.valor_base),
    'conflictos',          (SELECT count(*) FROM ins),
    'entradas_descartadas',(SELECT count(*) FROM saldadas),
    'sin_match',           (SELECT count(*) FROM unicas e
                            WHERE NOT EXISTS (SELECT 1 FROM public.customers c
                                              WHERE c.search_name = e.match_name))
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cola_espejo_portal_erp(p_limite integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- Pendiente = no viajó al ERP y no fue descartada. Lo segundo lo escribe el
-- espejo cuando el campo pierde una carrera (`aplicar_espejo_erp`), y antes se
-- recalculaba acá cruzando contra `espejo_conflictos`. El cruce tenía dos
-- defectos: dejaba la entrada "pendiente" para siempre —así que el espejo la
-- volvía a descartar en cada corrida y el badge de la bitácora no se apagaba
-- nunca— y bloqueaba el campo de por vida, incluso para una edición hecha
-- DESPUÉS de la carrera perdida, que es intención nueva y sí tiene que viajar.
WITH pend AS (
    SELECT cl.id, cl.customer_id, cl.campo, cl.valor_nuevo, cl.changed_at
    FROM public.customers_changelog cl
    WHERE cl.erp_synced_at IS NULL AND cl.descartado_at IS NULL
), listos AS (
    SELECT p.* FROM pend p
    JOIN public.customers c ON c.id = p.customer_id
    WHERE c.erp_id IS NOT NULL
), ultimo AS (
    SELECT DISTINCT ON (customer_id, campo) customer_id, campo, valor_nuevo
    FROM listos ORDER BY customer_id, campo, changed_at DESC, id DESC
), agrupado AS (
    SELECT u.customer_id, u.campo, u.valor_nuevo,
           (SELECT array_agg(l.id ORDER BY l.id) FROM listos l
            WHERE l.customer_id = u.customer_id AND l.campo = u.campo) AS changelog_ids
    FROM ultimo u
), por_cliente AS (
    SELECT a.customer_id, c.erp_id, c.name,
           json_agg(json_build_object(
               'campo', a.campo, 'valor', a.valor_nuevo,
               'changelog_ids', a.changelog_ids) ORDER BY a.campo) AS cambios
    FROM agrupado a JOIN public.customers c ON c.id = a.customer_id
    GROUP BY a.customer_id, c.erp_id, c.name
    ORDER BY a.customer_id
    LIMIT p_limite
)
SELECT json_build_object(
  'cola', coalesce((SELECT json_agg(to_json(t)) FROM por_cliente t), '[]'::json),
  -- Nada desaparece en silencio: lo que no se puede empujar se dice y por qué.
  -- Son dos motivos distintos y conviene no confundirlos: uno es una ficha sin
  -- emparejar (se arregla emparejándola), el otro es una decisión ya tomada.
  'excluidos', coalesce((
     SELECT json_agg(to_json(x)) FROM (
        SELECT p.customer_id, c.name, p.campo, count(*) AS entradas,
               'sin erp_id: la ficha del portal no está emparejada con el ERP' AS motivo
        FROM pend p
        JOIN public.customers c ON c.id = p.customer_id
        WHERE c.erp_id IS NULL
        GROUP BY p.customer_id, c.name, p.campo
        UNION ALL
        SELECT d.customer_id, c.name, d.campo, count(*),
               'descartado: el ERP ya se movió más allá de este campo'
        FROM public.customers_changelog d
        JOIN public.customers c ON c.id = d.customer_id
        WHERE d.erp_synced_at IS NULL AND d.descartado_at IS NOT NULL
        GROUP BY d.customer_id, c.name, d.campo
     ) x), '[]'::json)
);
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_detail(p_id bigint)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
                   (c.name ~ '[ÃÂÄÅ]'
                    OR c.name !~ '[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]')       AS nombre_corrupto
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
        -- `descartado_at` viaja para que la bitácora distinga "todavía no
        -- viajó" de "se decidió que no viaja". Sin él las dos se veían igual:
        -- "Sin enviar al ERP", encendido para siempre.
        'bitacora', coalesce((SELECT json_agg(to_json(h)) FROM (
            SELECT cl.campo, cl.valor_anterior, cl.valor_nuevo,
                   cl.changed_by_nombre, cl.changed_at, cl.erp_synced_at,
                   cl.descartado_at
            FROM public.customers_changelog cl
            WHERE cl.customer_id = p_id
            ORDER BY cl.changed_at DESC, cl.id DESC
            LIMIT 30) h), '[]'::json))
    )
  END;
$function$;
