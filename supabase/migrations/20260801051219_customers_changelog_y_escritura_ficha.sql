SET lock_timeout = '5s';

-- ── Los baldes del mostrador NO son fichas ───────────────────────────────────
--
-- El POS carga a un cliente genérico cuando no se identifica a nadie. En prod
-- son TRES filas de `customers` y entre ellas se llevan **95,393 de 337,784
-- facturas (28%)**:
--
--   CLIENTES VARIOS         (erp_id -1)  45,026
--   CLIENTE FRECUENTE                     40,234
--   CLIENTE FRECUENTE NUEVO               10,133
--
-- (El prompt del módulo mencionaba dos; `CLIENTE FRECUENTE` apareció al medir.)
--
-- Importan por dos motivos opuestos: **nunca** hay que escribirles una ficha
-- fiscal —no hay persona detrás—, y encabezan cualquier orden por actividad, así
-- que un ranking de clientes que los incluya no dice nada. Una sola definición
-- para los dos usos.
CREATE OR REPLACE FUNCTION public.es_cliente_mostrador(p_name text, p_erp_id text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT upper(btrim(coalesce(p_name, ''))) IN
           ('TODOS', 'CLIENTES VARIOS', 'CLIENTE FRECUENTE', 'CLIENTE FRECUENTE NUEVO')
      OR coalesce(p_erp_id, '') IN ('-1', '-2');
$$;

REVOKE EXECUTE ON FUNCTION public.es_cliente_mostrador(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.es_cliente_mostrador(text, text) TO authenticated, service_role;

-- ── Bitácora de la ficha — y la cola de la Fase 2 ────────────────────────────
--
-- Una fila por CAMPO cambiado, no por guardado. Sirve para dos cosas a la vez:
--
-- 1. Auditoría de negocio: quién le cambió el NIT a un contribuyente y cuándo.
--    Por eso no se purga (regla 7 de CLAUDE.md: el historial de negocio se queda).
-- 2. **La cola del espejo hacia el ERP.** La Fase 2 escribe de vuelta con una
--    edge function, y lo que tiene que empujar es exactamente esto: las filas
--    con `erp_synced_at IS NULL`. Sin bitácora, esa fase tendría que adivinar
--    qué cambió comparando fichas enteras contra el ERP.
--
-- `changed_by_nombre` es una FOTO del nombre, no un JOIN: una bitácora que
-- cambia de contenido cuando alguien se renombra o se da de baja no es bitácora.
CREATE TABLE IF NOT EXISTS public.customers_changelog (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id       bigint      NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    campo             text        NOT NULL,
    valor_anterior    text,
    valor_nuevo       text,
    changed_by        uuid,
    changed_by_nombre text,
    changed_at        timestamptz NOT NULL DEFAULT now(),
    erp_synced_at     timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_changelog_customer
    ON public.customers_changelog (customer_id, changed_at DESC);

-- La cola de la Fase 2: parcial, porque lo pendiente siempre va a ser una
-- fracción mínima de lo escrito.
CREATE INDEX IF NOT EXISTS idx_customers_changelog_pendiente_erp
    ON public.customers_changelog (changed_at) WHERE erp_synced_at IS NULL;

ALTER TABLE public.customers_changelog ENABLE ROW LEVEL SECURITY;

-- Lectura gateada por el módulo — el wrapper `(SELECT ...)` es obligatorio:
-- sin él Postgres evalúa la función POR FILA (incidente del 2026-07-08).
DROP POLICY IF EXISTS customers_changelog_select ON public.customers_changelog;
CREATE POLICY customers_changelog_select ON public.customers_changelog
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('clientes', 'can_view')));

-- Sin policy de INSERT/UPDATE/DELETE a propósito. No es un olvido: es una tabla
-- append-only cuyo único escritor es `update_customer_fiscal` (DEFINER). Un
-- `WITH CHECK (true)` acá sería poder fabricar bitácora, que es justo el agujero
-- que la auditoría del 2026-07-30 encontró en `audit_logs` y `attendance`.

COMMENT ON TABLE public.customers_changelog IS
  'Bitácora por campo de la ficha de cliente. Append-only, no se purga. erp_synced_at NULL = pendiente de empujar al ERP (Fase 2).';

-- ── El ÚNICO camino de escritura de la ficha ─────────────────────────────────
--
-- `customers` no tiene policy de UPDATE y no se le agrega una: se sigue el
-- precedente de `aplicar_espejo_erp` —función DEFINER que valida lo que entra—
-- en vez de abrir la tabla. Acá además es lo que hace posible el punto único de
-- guardado que la Fase 2 necesita.
--
-- Lo que NO se toca desde acá: `erp_id` (es la llave del espejo, no un dato
-- editable) y `search_name` (es una columna GENERADA — se recalcula sola al
-- cambiar el nombre; intentar asignarla sería un error).
CREATE OR REPLACE FUNCTION public.update_customer_fiscal(
    p_id bigint,
    p_campos jsonb,
    p_confirmar_fiscal boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
$$;

REVOKE EXECUTE ON FUNCTION public.update_customer_fiscal(bigint, jsonb, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_customer_fiscal(bigint, jsonb, boolean) TO authenticated, service_role;
