SET lock_timeout = '5s';

-- ── Módulo de Clientes, capa 1: búsqueda, validación y coherencia geográfica ──
--
-- `customers` la escribe el sync de DTE cada minuto (`upsert_customers`), así
-- que el DDL de acá va con lock_timeout: el único que la toca es el índice, y
-- sobre 24,502 filas se construye en menos de un segundo.

-- ── 1. Índice de búsqueda por nombre ─────────────────────────────────────────
-- La búsqueda del módulo es `search_name ILIKE '%algo%'` sobre 24,502 fichas, y
-- sin índice es seq scan: medido en 36ms por consulta, ×2 (la página y su
-- total) por cada tecleo. `search_name` es una columna GENERADA
-- (`lower(translate(name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'aeiouunaeiouun'))`), o sea que ya
-- viene normalizada sin tildes — el trigrama indexa exactamente lo que se busca.
CREATE INDEX IF NOT EXISTS idx_customers_search_name_trgm
    ON public.customers USING gin (search_name gin_trgm_ops);

-- ── 2. Validaciones, en el servidor y en el navegador con la MISMA regla ─────
-- Estas tres funciones existen para que el filtro "fichas a revisar" de la lista
-- y el aviso del formulario digan lo mismo. Si la regla vive solo en JS, el
-- servidor no puede contar cuántas fichas la incumplen sin traerse las 24,502.

-- Espejo exacto de `isValidDUIAlgorithm` (src/utils/duiUtils.js): módulo 10 con
-- pesos 9..2. Y como esa función, **lo que no tiene 9 dígitos no lo juzga** —
-- devuelve true. La lista usa una regla más estricta (ver `get_customers_page`),
-- pero el formulario tiene que decir lo mismo que el JS o el usuario ve un campo
-- marcado en rojo que al guardar pasa.
CREATE OR REPLACE FUNCTION public.es_dui_valido(p_dui text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  WITH d AS (SELECT regexp_replace(coalesce(p_dui, ''), '\D', '', 'g') AS s)
  SELECT CASE
    WHEN length(d.s) <> 9 THEN true
    ELSE ((10 - ((SELECT sum(substr(d.s, g.i, 1)::int * (10 - g.i))
                  FROM generate_series(1, 8) AS g(i)) % 10)) % 10)
         = substr(d.s, 9, 1)::int
  END
  FROM d;
$$;

-- Teléfono salvadoreño: 8 dígitos, o 503 + 8. Se cuentan DÍGITOS, no caracteres,
-- así que '7538-5899', '75385899' y '(503) 7538-5899' son los tres válidos.
-- Valida la FORMA, no la veracidad: '1111-1111' pasa, y hay bastante relleno de
-- ese tipo en el catálogo.
CREATE OR REPLACE FUNCTION public.es_telefono_sv_valido(p_tel text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  WITH d AS (SELECT regexp_replace(coalesce(p_tel, ''), '\D', '', 'g') AS s)
  SELECT CASE
    WHEN d.s = '' THEN true
    ELSE length(d.s) = 8 OR (length(d.s) = 11 AND d.s LIKE '503%')
  END
  FROM d;
$$;

-- Qué tan completa está la ficha. **Depende de la categoría**, y por eso no es
-- una casilla: a un Consumidor le falta el DUI, a un Contribuyente le falta el
-- NRC y el giro. Un "completa" plano diría que las 24,324 fichas sin categoría
-- están igual de mal que un Gran Contribuyente sin NRC, y no es lo mismo.
--
--   vacia    — solo tiene nombre. Son 24,3xx de 24,502 al escribir esto.
--   parcial  — algo tiene, le falta lo de su categoría.
--   completa — tiene lo que su categoría necesita para facturarle.
CREATE OR REPLACE FUNCTION public.customer_ficha_estado(
    p_categoria text, p_nit text, p_dui text, p_nrc text,
    p_pasaporte text, p_phone text, p_direccion text, p_giro text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN coalesce(p_nit, '') = '' AND coalesce(p_dui, '') = ''
     AND coalesce(p_nrc, '') = '' AND coalesce(p_pasaporte, '') = ''
     AND coalesce(p_phone, '') = '' AND coalesce(p_direccion, '') = ''
     AND coalesce(p_giro, '') = '' AND coalesce(p_categoria, '') = ''
      THEN 'vacia'
    WHEN p_categoria IN ('Contribuyente', 'Gran Contribuyente', 'Contribuyente Exento')
      THEN CASE WHEN coalesce(p_nit, '') <> '' AND coalesce(p_nrc, '') <> ''
                 AND coalesce(p_giro, '') <> '' AND coalesce(p_direccion, '') <> ''
                 AND coalesce(p_phone, '') <> ''
                THEN 'completa' ELSE 'parcial' END
    WHEN p_categoria = 'Extranjero'
      THEN CASE WHEN coalesce(p_pasaporte, '') <> '' AND coalesce(p_direccion, '') <> ''
                THEN 'completa' ELSE 'parcial' END
    ELSE
      CASE WHEN (coalesce(p_dui, '') <> '' OR coalesce(p_nit, '') <> '')
                 AND coalesce(p_phone, '') <> '' AND coalesce(p_direccion, '') <> ''
           THEN 'completa' ELSE 'parcial' END
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.es_dui_valido(text)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_telefono_sv_valido(text)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.customer_ficha_estado(text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.es_dui_valido(text)          TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.es_telefono_sv_valido(text)  TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.customer_ficha_estado(text, text, text, text, text, text, text, text) TO authenticated, service_role;

-- ── 3. Backfill: el departamento se DEDUCE del municipio ─────────────────────
-- 92 fichas llegaron del ERP con municipio y sin departamento, y quedaban fuera
-- de cualquier filtro por departamento sin que nada avisara.
--
-- No hace falta adivinar: desde la reestructuración de 2023 los 44 municipios se
-- llaman "<Departamento> <punto cardinal>", así que el municipio determina el
-- departamento. Los 14 nombres van literales (y no un recorte de la última
-- palabra) para que un municipio inventado no produzca un departamento inventado.
UPDATE public.customers c
SET    departamento = d.nombre
FROM  (VALUES ('Ahuachapán'), ('Santa Ana'), ('Sonsonate'), ('Chalatenango'),
              ('La Libertad'), ('San Salvador'), ('Cuscatlán'), ('La Paz'),
              ('Cabañas'), ('San Vicente'), ('Usulután'), ('San Miguel'),
              ('Morazán'), ('La Unión')) AS d(nombre)
WHERE  c.departamento IS NULL
  AND  c.municipio IS NOT NULL
  AND  c.municipio LIKE d.nombre || ' %';
