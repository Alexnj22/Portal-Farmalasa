SET lock_timeout = '5s';

-- Espejo del ERP al portal, en una sola llamada por bloque.
--
-- Existe porque `customers` no tiene policy de escritura: su única policy es
-- `customers_select` (SELECT, authenticated, USING true). Sin camino de UPDATE
-- desde la API, un script de migración solo podría escribir con la service-role
-- key. Esta función es la alternativa de menor privilegio: es el ÚNICO camino de
-- escritura, valida lo que entra, y se concede solo a `authenticated`.
--
-- Empareja por `search_name` (el nombre en minúsculas): los 24,502 son únicos,
-- así que no hay ambigüedad. NUNCA inserta: si un nombre del ERP no existe en el
-- portal, se reporta en `sin_match` y no se crea nada.
--
-- Un nombre que llega más de una vez en el payload es una ficha duplicada del
-- ERP; no se puede decidir cuál gana, así que se omite y se reporta.
CREATE OR REPLACE FUNCTION public.aplicar_espejo_erp(p_filas json)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
  ), upd AS (
    UPDATE public.customers c SET
        erp_id        = e.erp_id,
        nit           = e.nit,
        dui           = e.dui,
        nrc           = e.nrc,
        phone         = e.phone,
        telefono2     = e.telefono2,
        email         = e.email,
        direccion     = e.direccion,
        pasaporte     = e.pasaporte,
        departamento  = e.departamento,
        municipio     = e.municipio,
        distrito      = e.distrito,
        categoria     = e.categoria,
        giro          = e.giro,
        retencion_pct = e.retencion_pct,
        updated_at    = now()
    FROM unicas e
    WHERE c.search_name = e.match_name
    RETURNING 1
  )
  SELECT json_build_object(
    'recibidas',           (SELECT count(*) FROM filas),
    'duplicadas_omitidas', (SELECT coalesce(sum(n), 0) FROM conteo WHERE n > 1),
    'actualizadas',        (SELECT count(*) FROM upd),
    'sin_match',           (SELECT count(*) FROM unicas e
                            WHERE NOT EXISTS (SELECT 1 FROM public.customers c
                                              WHERE c.search_name = e.match_name))
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aplicar_espejo_erp(json) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.aplicar_espejo_erp(json) FROM anon;
GRANT  EXECUTE ON FUNCTION public.aplicar_espejo_erp(json) TO authenticated, service_role;
