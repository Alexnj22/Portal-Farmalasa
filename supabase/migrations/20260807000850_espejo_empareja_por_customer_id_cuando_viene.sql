-- `aplicar_espejo_erp` emparejaba SOLO por nombre.
--
-- `JOIN customers c ON c.search_name = e.match_name` alcanza a las fichas que
-- se llaman igual en los dos lados, que es el caso de la migración: el bloque
-- sale del catálogo del ERP y el portal tiene el mismo nombre.
--
-- No alcanza a las huérfanas. Esas las crea `upsert_customers` desde el nombre
-- tal como se escribió EN LA FACTURA —con espacios de más, encoding roto o
-- typos: `MIGUEL ANTONIO CALLES    1`, `JOSE RAFAEL PEÃ±A PINEDA`— así que su
-- `search_name` no coincide con nada y el JOIN devuelve cero. Medido el
-- 2026-08-06: 92 fichas quedaron sin `erp_id` después de espejar, aunque el
-- emparejamiento por factura YA había resuelto su id.
--
-- `fila_portal` (bloque.py) manda un campo `id` desde siempre; el RPC lo
-- ignoraba. Ahora, cuando viene, manda él: es un id exacto contra un nombre
-- normalizado, y no hay razón para preferir el segundo.
--
-- Probado en prod con BEGIN…ROLLBACK antes de dejarlo:
--   · por id, con match_name que no coincide con nada → actualizadas 1, por_id 1
--   · por nombre, sin id                              → actualizadas 1, por_id 0
--   · id inexistente                                  → actualizadas 0, sin_match 1

SET lock_timeout = '5s';

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

  -- Ediciones del portal que todavía no llegaron al ERP. `valor_base` es lo que
  -- el campo tenía ANTES de que la persona lo tocara —o sea lo que el ERP le
  -- había puesto—, y es la referencia para saber si el ERP se movió después.
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
      ON (e.customer_id IS NOT NULL AND c.id = e.customer_id)
      OR (e.customer_id IS NULL AND c.search_name = e.match_name)
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
                              WHERE (e.customer_id IS NOT NULL AND c.id = e.customer_id)
                                 OR (e.customer_id IS NULL AND c.search_name = e.match_name)))
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$function$;
