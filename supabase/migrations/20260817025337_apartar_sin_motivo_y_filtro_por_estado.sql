SET lock_timeout = '5s';

-- ── 1. Apartar ya no exige decir por qué ────────────────────────────────────
--
-- La pregunta «¿por qué no es un producto?» costaba un campo de texto y una
-- segunda decisión por cada flete y cada servicio de la lista, que son
-- justamente los renglones que uno quiere sacar de encima rápido. Decisión del
-- usuario (2026-08-16): apartar es un clic.
--
-- El parámetro NO se elimina —la firma es la misma, así que nada se rompe— y la
-- columna `ignorado_motivo` sigue existiendo: si algún día vuelve a haber un
-- lugar donde escribir el motivo, se guarda solo. Lo que se va es la exigencia.
--
-- Quién apartó y cuándo se sigue guardando (`ignorado_por`, `updated_at`), y
-- ahora además queda en la bitácora del portal desde el frontend. O sea que
-- «fue un error» sigue siendo contestable: se ve quién, se ve cuándo, y el
-- renglón se devuelve a la lista con un botón.

CREATE OR REPLACE FUNCTION public.ignorar_renglon_pendiente(
    p_id bigint, p_motivo text, p_deshacer boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_emp uuid;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['cargar_compra','compras']) THEN
    RAISE EXCEPTION 'No tenés permiso para apartar renglones.';
  END IF;
  -- (Acá vivía el RAISE que exigía un motivo. Se fue a propósito.)
  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';

  UPDATE public.compra_renglon_pendiente
     SET ignorado        = NOT coalesce(p_deshacer, false),
         ignorado_motivo = CASE WHEN coalesce(p_deshacer,false) THEN NULL
                                ELSE nullif(btrim(coalesce(p_motivo,'')), '') END,
         ignorado_por    = CASE WHEN coalesce(p_deshacer,false) THEN NULL ELSE v_emp END,
         updated_at      = now()
   WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese renglón ya no está en la lista.'; END IF;
END;
$function$;

COMMENT ON FUNCTION public.ignorar_renglon_pendiente(bigint, text, boolean) IS
  'Aparta (o devuelve) un renglón que no es un producto nuestro. El motivo es OPCIONAL '
  'desde 2026-08-16: apartar es un clic. Quién y cuándo se siguen guardando.';


-- ── 2. El filtro por estado se resuelve en la base, no en el navegador ──────
--
-- `p_solo_pendientes boolean` sólo sabía decir dos cosas, y la segunda no
-- funcionaba: «Todos» traía las primeras 500 filas ordenadas con las pendientes
-- adelante, y hay **3,016 pendientes**. O sea que un renglón apartado o
-- confirmado no entraba nunca en esas 500 y era INVISIBLE desde la pantalla —
-- incluido el botón «Es otro» que existe justamente para corregir una
-- confirmación equivocada. El filtro decía «Todos» y mostraba una sola cosa.
--
-- Un booleano no da para tres estados sin volverse un acertijo (¿NULL = qué?),
-- así que el parámetro pasa a ser el nombre del estado. Cuatro valores, y el
-- recorte se hace ANTES del LIMIT, que es lo que lo vuelve cierto.
--
-- La versión vieja `(boolean, integer)` queda viva a propósito hasta que el
-- frontend nuevo esté desplegado: quien tenga la pantalla abierta ahora mismo
-- la sigue llamando, y sacársela de abajo le daría un error en la cara. Se
-- borra en cuanto el despliegue esté confirmado.
-- Los nombres de parámetro son distintos (`p_estado` vs `p_solo_pendientes`),
-- así que PostgREST resuelve cada llamada sin ambigüedad; y esta firma nueva no
-- lleva DEFAULT justamente para que una llamada sin argumentos siga resolviendo
-- a una sola función.

CREATE OR REPLACE FUNCTION public.get_productos_por_confirmar(
    p_estado text, p_limite integer)
 RETURNS TABLE(id bigint, emisor_nit text, proveedor text, codigo_proveedor text,
               descripcion text, llave text, renglones integer, documentos integer,
               unidades numeric, ultima_fecha date, sugerido_product_id integer,
               sugerido_nombre text, sugerido_origen text, sugerido_similitud real,
               resuelto boolean, ignorado boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT r.id, r.emisor_nit,
         coalesce((SELECT m.nombre FROM public.proveedores_maestro m
                    WHERE m.nit = r.emisor_nit ORDER BY m.id LIMIT 1),
                  (SELECT d.emisor_nombre FROM public.purchase_dte_documents d
                    WHERE d.emisor_nit = r.emisor_nit ORDER BY d.id DESC LIMIT 1)),
         r.codigo_proveedor, r.descripcion, r.llave,
         r.renglones, r.documentos, r.unidades, r.ultima_fecha,
         coalesce(a.product_id, r.sugerido_product_id),
         (SELECT p.nombre FROM public.products p
           WHERE p.id = coalesce(a.product_id, r.sugerido_product_id)),
         CASE WHEN a.product_id IS NOT NULL THEN 'aprendido' ELSE r.sugerido_origen END,
         CASE WHEN a.product_id IS NOT NULL THEN 1.0::real ELSE r.sugerido_similitud END,
         a.product_id IS NOT NULL,
         r.ignorado
    FROM public.compra_renglon_pendiente r
    LEFT JOIN public.compra_producto_alias a
           ON a.emisor_nit = r.emisor_nit AND a.codigo_proveedor = r.llave
   WHERE (SELECT auth_has_module_permission('cargar_compra','can_view')
           OR auth_has_module_permission('compras','can_view'))
     AND CASE lower(coalesce(p_estado, 'pendientes'))
           -- Lo que todavía hay que contestar.
           WHEN 'pendientes' THEN a.product_id IS NULL AND NOT r.ignorado
           -- Lo que alguien marcó «no es un producto» — para revisar si fue un
           -- error o si desde entonces cambió algo.
           WHEN 'apartados'  THEN r.ignorado
           -- Lo ya contestado, que es donde vive el botón para corregirlo.
           WHEN 'resueltos'  THEN a.product_id IS NOT NULL AND NOT r.ignorado
           ELSE true          -- 'todos'
         END
   ORDER BY (a.product_id IS NOT NULL), r.ignorado, r.renglones DESC, r.id
   LIMIT greatest(1, least(coalesce(p_limite, 500), 2000));
$function$;

REVOKE EXECUTE ON FUNCTION public.get_productos_por_confirmar(text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_productos_por_confirmar(text, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_productos_por_confirmar(text, integer) IS
  'Preguntas distintas (proveedor, su código) ordenadas por cuánto destraba cada una. '
  'p_estado: pendientes | apartados | resueltos | todos — el recorte va ANTES del LIMIT, '
  'que es lo que la versión booleana no podía hacer (500 lugares llenos de pendientes).';
