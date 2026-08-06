-- Lo que Hacienda contesta, guardado donde se pueda consultar.
--
-- Hasta hoy la respuesta del MH vivía en TRES lugares y ninguno servía para
-- actuar: el ERP (`save_response_mh`), la respuesta HTTP de `regularizar-dte`
-- —que se pierde al cerrar la pestaña— y un JSON enterrado en `audit_logs`.
-- `sales_invoices` solo guarda `recibido_mh` (el sello) y `codigo_generacion`:
-- una factura sellada CON observaciones se ve idéntica a una limpia.
--
-- Medido el 2026-08-06: 11 facturas entraron con "RECIBIDO CON OBSERVACIONES"
-- y no había forma de saber cuáles sin leer JSON a mano.
--
-- OJO: la pestaña «Observaciones» del portal NO es esto. Esa es
-- `get_invoice_observations`, siete anomalías que el portal deriva solo
-- (SELLO_INVALIDO, SUMA_NO_CUADRA…). Mismo nombre, otro dato: nunca mostró una
-- observación de Hacienda.
--
-- ── Por qué por INTENTO y no por factura ─────────────────────────────────
-- El caso que motivó la tabla: `0000063213_COF` rechazada por
-- `[receptor.direccion.distrito] VALOR NO ES PERMITIDO` con la ficha del
-- cliente correcta (Cabañas / Cabañas Este / SENSUNTEPEQUE, y Sensuntepeque
-- tenía 14 facturas selladas previas). Se resolvió cambiándole el
-- departamento a mano, entró, y **por qué funcionó se perdió con la persona
-- que lo hizo**. `correccion` guarda qué se tocó antes de cada intento, así
-- que la próxima observación igual llega con precedente en vez de arrancar
-- de cero.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dte_mh_intentos (
  id              bigserial PRIMARY KEY,
  invoice_id      bigint NOT NULL REFERENCES public.sales_invoices(id) ON DELETE CASCADE,

  -- Copia de identificación: la fila sobrevive para auditoría aunque el
  -- correlativo cambie, y evita un join para listar la bandeja.
  erp_invoice_id  text,
  correlativo     text,
  branch_id       bigint,
  bolsa           text NOT NULL CHECK (bolsa IN ('anuladas', 'sin_sello')),

  -- La respuesta del MH, tal como llega por `proxydte.php`.
  ok              boolean NOT NULL,
  sello           text,
  codigo_msg      text,
  descripcion_msg text,
  observaciones   text[] NOT NULL DEFAULT '{}',
  fh_procesamiento text,

  -- Cuando ni siquiera se llegó a hablar con el MH (el ERP rechazó armar el
  -- documento, la sesión se cayó, etc.). `ok=false` con esto lleno es un fallo
  -- ANTES de Hacienda; con `descripcion_msg` lleno es un rechazo DE Hacienda.
  -- Son cosas distintas y la bandeja las separa.
  error           text,

  -- Qué se cambió ANTES de este intento, y de dónde salió la decisión.
  --   {"campo":"distrito","de":null,"a":"CHALATENANGO",
  --    "origen":"deducido|manual","evidencia":"...","por":"..."}
  correccion      jsonb,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- FK cubierta (regla 2 del hardening) y los dos accesos reales de la bandeja.
CREATE INDEX IF NOT EXISTS dte_mh_intentos_invoice_idx
  ON public.dte_mh_intentos (invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dte_mh_intentos_pendientes_idx
  ON public.dte_mh_intentos (created_at DESC) WHERE NOT ok;
-- Para "¿qué facturas tienen esta observación?" sin escanear la tabla.
CREATE INDEX IF NOT EXISTS dte_mh_intentos_obs_idx
  ON public.dte_mh_intentos USING gin (observaciones);

ALTER TABLE public.dte_mh_intentos ENABLE ROW LEVEL SECURITY;

-- Append-only: sin UPDATE ni DELETE. La escritura es de las edge functions
-- (service_role, que no pasa por RLS), así que `authenticated` no inserta —
-- no hay policy de INSERT a propósito, es lo más restrictivo posible.
-- El `(SELECT ...)` alrededor de la función auth NO es opcional: sin él
-- Postgres la evalúa por fila (incidente 2026-07-08).
DROP POLICY IF EXISTS dte_mh_intentos_read ON public.dte_mh_intentos;
CREATE POLICY dte_mh_intentos_read ON public.dte_mh_intentos
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('facturacion', 'can_view')));

COMMENT ON TABLE public.dte_mh_intentos IS
  'Cada envio a Hacienda y su respuesta. Append-only; una fila por intento.';


-- ── El clasificador ────────────────────────────────────────────────────────
-- Traduce el texto crudo del MH a algo sobre lo que se pueda actuar.
--
-- La familia es lo que decide quién arregla:
--   receptor    → la ficha del cliente en el ERP. Accionable.
--   documento   → el DTE mismo. `[identificacion.fecEmi] DIFIERE DE LA FECHA
--                 DE ENVIO` es la más común y NO se arregla: aparece cuando se
--                 transmite hoy una factura emitida antes, y "corregirla"
--                 sería alterar un dato fiscal.
--   emisor      → configuración de la sucursal.
--   desconocida → catch-all. Una observación nueva aparece sola el día que
--                 aparece, en vez de quedar muda.
CREATE OR REPLACE FUNCTION public.clasificar_observacion_mh(p_texto text)
RETURNS TABLE (familia text, ruta text, campo_ficha text, accionable boolean)
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $fn$
  WITH x AS (
    -- El MH prefija la ruta del campo entre corchetes: "[receptor.nombre] ..."
    SELECT substring(p_texto from '^\[([^\]]+)\]') AS r
  )
  SELECT
    CASE
      WHEN x.r LIKE 'receptor.%'       THEN 'receptor'
      WHEN x.r LIKE 'identificacion.%' THEN 'documento'
      WHEN x.r LIKE 'emisor.%'         THEN 'emisor'
      WHEN x.r IS NULL                 THEN 'desconocida'
      ELSE 'otra'
    END,
    x.r,
    -- Nombre de la columna en `customers`, para que la bandeja sepa qué pedir.
    CASE x.r
      WHEN 'receptor.direccion.distrito'     THEN 'distrito'
      WHEN 'receptor.direccion.municipio'    THEN 'municipio'
      WHEN 'receptor.direccion.departamento' THEN 'departamento'
      WHEN 'receptor.direccion.complemento'  THEN 'direccion'
      WHEN 'receptor.telefono'               THEN 'phone'
      WHEN 'receptor.correo'                 THEN 'email'
      WHEN 'receptor.nombre'                 THEN 'name'
      WHEN 'receptor.nrc'                    THEN 'nrc'
      WHEN 'receptor.nit'                    THEN 'nit'
      WHEN 'receptor.numDocumento'           THEN 'dui'
      WHEN 'receptor.descActividad'          THEN 'giro'
      WHEN 'receptor.codActividad'           THEN 'giro'
      ELSE NULL
    END,
    -- Accionable = sabemos qué campo de la ficha mirar. Una observación de
    -- `receptor.*` que no esté en el mapa NO es accionable: es un hallazgo que
    -- hay que leer antes de agregarle una fila al CASE de arriba.
    --
    -- El coalesce NO es decorativo: sin él, un mensaje sin corchetes deja
    -- `x.r` en NULL y la comparación devuelve NULL, no false. Esa fila no
    -- aparecería NI en `WHERE accionable` NI en `WHERE NOT accionable` —
    -- invisible en las dos listas. Detectado probando en staging.
    coalesce(x.r LIKE 'receptor.%' AND x.r IN (
        'receptor.direccion.distrito', 'receptor.direccion.municipio',
        'receptor.direccion.departamento', 'receptor.direccion.complemento',
        'receptor.telefono', 'receptor.correo', 'receptor.nombre',
        'receptor.nrc', 'receptor.nit', 'receptor.numDocumento',
        'receptor.descActividad', 'receptor.codActividad'), false)
  FROM x;
$fn$;

REVOKE EXECUTE ON FUNCTION public.clasificar_observacion_mh(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.clasificar_observacion_mh(text) TO authenticated, service_role;
