SET lock_timeout = '5s';

-- ══════════════════════════════════════════════════════════════════════════
-- El motivo de un rechazo llega en TRES formas distintas, y sólo se leía una
-- ══════════════════════════════════════════════════════════════════════════
-- Medido sobre los 4 rechazos vivos del 2026-08-09:
--
--   [receptor.direccion.distrito] VALOR NO ES PERMITIDO      ← en descripcion_msg
--   Campo #/receptor/numDocumento no cumple el formato...    ← en observaciones
--   [identificacion.fecEmi] DIFIERE DE LA FECHA DE ENVIO     ← en observaciones
--
-- `clasificar_observacion_mh` sólo sacaba la ruta de la forma con corchetes, así
-- que el ÚNICO rechazo accionable que había —el numDocumento de un DUI
-- `00000000-0`— quedaba archivado como «desconocida / no accionable», siendo que
-- `receptor.numDocumento` está en su propia lista de accionables.
--
-- Y peor: 3 de los 4 traían `observaciones` VACÍO, con el motivo en
-- `descripcion_msg`. La consulta que el documento del circuito da como oficial
-- —`unnest(i.observaciones)`— no los veía. La herramienta para mirar los
-- rechazos no mostraba tres cuartas partes de ellos.
CREATE OR REPLACE FUNCTION public.clasificar_observacion_mh(p_texto text)
RETURNS TABLE(familia text, ruta text, campo_ficha text, accionable boolean)
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  WITH x AS (
    SELECT coalesce(
      -- forma 1 · [receptor.direccion.distrito]
      substring(p_texto from '\[([^\]]+)\]'),
      -- forma 2 · el puntero de JSON Schema: #/receptor/numDocumento
      replace(substring(p_texto from '#/([A-Za-z0-9_/]+)'), '/', '.')
    ) AS r
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
    coalesce(x.r IN (
        'receptor.direccion.distrito', 'receptor.direccion.municipio',
        'receptor.direccion.departamento', 'receptor.direccion.complemento',
        'receptor.telefono', 'receptor.correo', 'receptor.nombre',
        'receptor.nrc', 'receptor.nit', 'receptor.numDocumento',
        'receptor.descActividad', 'receptor.codActividad'), false)
  FROM x;
$$;

REVOKE EXECUTE ON FUNCTION public.clasificar_observacion_mh(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.clasificar_observacion_mh(text) TO authenticated, service_role;


-- ══════════════════════════════════════════════════════════════════════════
-- El lugar donde se miran los rechazos — y de donde el lazo saca su trabajo
-- ══════════════════════════════════════════════════════════════════════════
-- Una sola definición para las dos cosas, a propósito: si la pantalla y el
-- proceso automático no leen exactamente lo mismo, se puede corregir algo que
-- nadie ve o mirar algo que nadie corrige.
--
-- Toma el ÚLTIMO intento de cada factura todavía sin sello, junta las dos
-- fuentes del motivo (`observaciones` y `descripcion_msg`) y las clasifica.
CREATE OR REPLACE VIEW public.dte_rechazos_vigentes
WITH (security_invoker = true) AS
WITH ultimo AS (
  SELECT DISTINCT ON (i.invoice_id) i.*
  FROM public.dte_mh_intentos i
  WHERE i.sello IS NULL
  ORDER BY i.invoice_id, i.created_at DESC
), con_motivo AS (
  SELECT u.invoice_id, u.correlativo, u.branch_id, u.codigo_msg, u.created_at,
         m.motivo
  FROM ultimo u
  CROSS JOIN LATERAL unnest(
    array_remove(
      coalesce(u.observaciones, '{}'::text[]) || coalesce(u.descripcion_msg, ''),
      ''
    )
  ) AS m(motivo)
)
SELECT
  cm.invoice_id, cm.correlativo, cm.branch_id, cm.codigo_msg,
  cm.created_at                             AS ultimo_intento,
  cm.motivo,
  c2.familia, c2.ruta, c2.campo_ficha, c2.accionable,
  cl.id                                     AS customer_id,
  cl.erp_id,
  cl.name                                   AS cliente,
  cl.categoria,
  cl.departamento, cl.municipio, cl.distrito, cl.dui
FROM con_motivo cm
CROSS JOIN LATERAL public.clasificar_observacion_mh(cm.motivo) c2
LEFT JOIN public.sales_invoices si ON si.id = cm.invoice_id
LEFT JOIN public.customers      cl ON cl.id = si.customer_id
WHERE (si.recibido_mh IS NULL OR si.recibido_mh = '')
  AND NOT EXISTS (
    SELECT 1 FROM public.dte_excluidas_del_barrido e WHERE e.invoice_id = cm.invoice_id
  );

REVOKE ALL ON public.dte_rechazos_vigentes FROM PUBLIC, anon;
GRANT  SELECT ON public.dte_rechazos_vigentes TO authenticated, service_role;

COMMENT ON VIEW public.dte_rechazos_vigentes IS
  'El último rechazo de cada factura sin sello, con su motivo clasificado y la '
  'ficha del cliente. Junta observaciones y descripcion_msg porque el motivo '
  'llega por cualquiera de las dos (medido: 3 de 4 sólo en descripcion_msg). '
  'La lee la pantalla Y el lazo que corrige — una sola definición para las dos.';
