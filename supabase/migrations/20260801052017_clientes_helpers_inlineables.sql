SET lock_timeout = '5s';

-- ── Los helpers de validación tienen que poder INLINEARSE ────────────────────
--
-- `get_customers_page` sin filtros tardaba **828ms**. El plan mostraba que el
-- scan con su join costaba 4ms: los otros 824 eran las funciones auxiliares,
-- llamadas una vez por fila sobre 24,502 filas.
--
-- Postgres INLINEA una función SQL —la funde como expresión dentro de la
-- consulta que la llama— sólo si cumple varias condiciones. Estas dos las
-- rompían, y cada una por su lado:
--
--   1. **`SET search_path` en la función.** Cualquier cláusula SET la vuelve
--      opaca. Medido con la misma función y el mismo cuerpo:
--      `customer_ficha_estado` sobre las 24,502 filas → **372ms con SET,
--      16ms sin SET** (23×).
--   2. **Un CTE en el cuerpo.** El cuerpo tiene que ser un único SELECT
--      plegable. Medido con `es_telefono_sv_valido`, ya sin SET:
--      **179ms con `WITH`, 13.8ms como una sola expresión** (13×).
--      Las dos formas se compararon fila por fila: 0 discrepancias en 24,502.
--
-- ── Por qué acá NO aplica la regla 4 de CLAUDE.md ────────────────────────────
-- Esa regla pide `SET search_path = public, extensions` en las funciones, y su
-- motivo es SECURITY DEFINER: sin search_path fijo, quien llama puede hacer que
-- un nombre sin calificar resuelva a un objeto suyo, que la función corre con
-- los privilegios del dueño. Estas tres son **INVOKER e IMMUTABLE**: resuelven
-- con los privilegios de quien llama, así que no hay nada que escalar. Y sus
-- cuerpos sólo usan funciones internas (`coalesce`, `upper`, `btrim`, `length`,
-- `regexp_replace`), que viven en `pg_catalog` — implícitamente primero en el
-- search_path y por lo tanto imposibles de tapar.
--
-- Las que sí son DEFINER (`get_customers_page`, `update_customer_fiscal`,
-- `refresh_customer_activity`, …) conservan su `SET search_path` intacto.

CREATE OR REPLACE FUNCTION public.customer_ficha_estado(
    p_categoria text, p_nit text, p_dui text, p_nrc text,
    p_pasaporte text, p_phone text, p_direccion text, p_giro text)
RETURNS text
LANGUAGE sql
IMMUTABLE
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

-- Sin `WITH`: `length(...) IN (0, 8)` cubre de una vez el vacío (0 dígitos, que
-- es "no lo juzgo") y los 8 dígitos nacionales; el regex cubre 503 + 8.
-- Verificado equivalente a la versión con CTE en las 24,502 filas.
CREATE OR REPLACE FUNCTION public.es_telefono_sv_valido(p_tel text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT length(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g')) IN (0, 8)
      OR regexp_replace(coalesce(p_tel, ''), '\D', '', 'g') ~ '^503\d{8}$';
$$;

CREATE OR REPLACE FUNCTION public.es_cliente_mostrador(p_name text, p_erp_id text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(btrim(coalesce(p_name, ''))) IN
           ('TODOS', 'CLIENTES VARIOS', 'CLIENTE FRECUENTE', 'CLIENTE FRECUENTE NUEVO')
      OR coalesce(p_erp_id, '') IN ('-1', '-2');
$$;

-- `es_dui_valido` se queda como está, CON su `SET search_path`: el verificador
-- necesita sumar 8 dígitos con pesos y eso no se escribe como una expresión
-- plegable sin repetir el `regexp_replace` nueve veces. No hace falta que
-- inlinee, porque **siempre se llama detrás de `dui IS NOT NULL`** y sólo 105
-- de las 24,502 fichas tienen DUI: son 105 llamadas, no 24,502.

-- Los grants se re-otorgan porque CREATE OR REPLACE no los altera, pero el
-- REVOKE explícito sí tiene que volver a declararse si alguna vez se recrea la
-- función desde cero.
REVOKE EXECUTE ON FUNCTION public.es_telefono_sv_valido(text)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.es_cliente_mostrador(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.customer_ficha_estado(text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.es_telefono_sv_valido(text)  TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.es_cliente_mostrador(text, text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.customer_ficha_estado(text, text, text, text, text, text, text, text) TO authenticated, service_role;
