SET lock_timeout = '5s';

-- Crea en `customers` las fichas del ERP que NO existen todavía.
--
-- El espejo (`aplicar_espejo_erp`) solo hace UPDATE: hace JOIN por
-- `search_name` y una ficha sin fila se queda afuera para siempre. Esta función
-- es la contraparte que crea, y su única responsabilidad delicada es NO crear
-- un duplicado.
--
-- El constraint no alcanza para eso, y conviene dejarlo escrito: el índice
-- único de nombre es `upper(btrim(name))`, que NO quita acentos, mientras que
-- `search_name` es una generada que SÍ los quita:
--
--     lower(translate(name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun'))
--
-- Insertar 'ABIGAIL MUÑOZ' teniendo ya 'ABIGAIL MUNOZ' NO falla —son distintas
-- para el índice e iguales para el match— y deja dos filas que el espejo ve
-- como la misma. Por eso el guard de acá compara por la clave de `search_name`,
-- no por el nombre crudo.
--
-- El cliente que llama ya filtra, pero el guard va igual del lado del servidor:
-- entre que el script lee el portal y escribe pasan minutos, y en el medio el
-- sync de ventas puede crear el mismo cliente con `upsert_customers`.
--
-- Probado con BEGIN…ROLLBACK antes de aplicarlo de verdad (2026-08-05): de 6
-- filas entraron 2 y se rechazaron 4 — una ya existente, su variante sin
-- acento, un balde de mostrador, y una variante con acento de otra fila DEL
-- MISMO LOTE. Esa última es justo la que el índice único no habría frenado.
CREATE OR REPLACE FUNCTION public.crear_clientes_faltantes(p_filas json)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_creadas integer;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['clientes'])) THEN
    RAISE EXCEPTION 'sin permiso para crear clientes';
  END IF;

  WITH filas AS (
    SELECT * FROM json_to_recordset(p_filas) AS x(
        name       text, erp_id text, nit text, dui text, nrc text,
        phone      text, telefono2 text, email text, direccion text,
        pasaporte  text, departamento text, municipio text, distrito text,
        categoria  text, giro text, retencion_pct smallint)
  ), limpias AS (
    SELECT upper(btrim(f.name)) AS nombre, f.*
    FROM filas f
    WHERE upper(btrim(f.name)) <> ''
      AND coalesce(btrim(f.erp_id), '') <> ''
  ), unicas AS (
    -- Dos filas del MISMO lote que normalizan igual son un duplicado que el
    -- índice no vería (difieren en acentos). Gana la de erp_id más bajo.
    SELECT DISTINCT ON (lower(translate(nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun')))
           *
    FROM limpias
    ORDER BY lower(translate(nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun')),
             (erp_id)::bigint
  )
  INSERT INTO public.customers (
      name, erp_id, nit, dui, nrc, phone, telefono2, email, direccion,
      pasaporte, departamento, municipio, distrito, categoria, giro, retencion_pct)
  SELECT u.nombre, u.erp_id, u.nit, u.dui, u.nrc, u.phone, u.telefono2, u.email,
         u.direccion, u.pasaporte, u.departamento, u.municipio, u.distrito,
         u.categoria, u.giro, u.retencion_pct
  FROM unicas u
  WHERE NOT EXISTS (
          SELECT 1 FROM public.customers c
          WHERE c.search_name =
                lower(translate(u.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun')))
    AND NOT EXISTS (
          SELECT 1 FROM public.customers c WHERE c.erp_id = u.erp_id)
    AND NOT public.es_cliente_mostrador(u.nombre, u.erp_id)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_creadas = ROW_COUNT;
  RETURN v_creadas;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_clientes_faltantes(json) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_clientes_faltantes(json) TO authenticated, service_role;
