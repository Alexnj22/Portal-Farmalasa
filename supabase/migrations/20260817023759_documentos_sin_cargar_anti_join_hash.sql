SET lock_timeout = '5s';

-- La lista de «Cargar compra» tardaba 18.9 SEGUNDOS. No era el volumen: son
-- 1,778 documentos y 5,260 recibos. Era la forma del `NOT EXISTS`.
--
-- El descarte «este documento ya está registrado» era un solo NOT EXISTS con un
-- OR adentro, y un OR no es una condición de igualdad: el planificador no puede
-- armar un hash, así que caía en Nested Loop Anti Join y comparaba **cada**
-- documento contra **cada** recibo, normalizando el número de documento con
-- cuatro `replace` en cada comparación. Medido: 5,126,419 comparaciones
-- descartadas para devolver 479 filas.
--
-- El arreglo es lógica, no un índice: NOT EXISTS(A OR B) ≡ NOT EXISTS(A) AND
-- NOT EXISTS(B). Partido en cuatro NOT EXISTS de igualdad simple, cada uno es
-- un Hash Anti Join, y la normalización del número se hace UNA vez por recibo
-- en un CTE materializado en vez de una vez por par.
--
-- Medido en producción, mismos parámetros (60 días):
--   antes  18,957 ms   ·   después  19.5 ms   (≈970×)
-- Y verificado sobre la ventana completa de 180 días —los 1,778 documentos—:
--   616 filas antes, 616 después, 0 sólo-antes, 0 sólo-después.
--
-- El default pasa de 60 a 30 días para acompañar a la pantalla, que abre en el
-- último mes. El único llamador (`src/data/cargarCompra.js`) lo pasa explícito.

CREATE OR REPLACE FUNCTION public.get_documentos_sin_cargar(p_dias integer DEFAULT 30)
 RETURNS TABLE(document_id bigint, fecha_emision date, emisor_nombre text, emisor_nit text,
               codigo_generacion text, numero_control text, monto_total numeric,
               renglones integer, tiene_pdf boolean, proveedor_ficha text, dias_desde integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH recibos AS MATERIALIZED (
    -- La normalización del número se paga UNA vez por recibo, no una vez por
    -- par documento×recibo. Es la mitad del arreglo.
    SELECT pr.sello_recibido,
           upper(replace(replace(replace(btrim(pr.documento_numero),' ',''),'.',''),'O','0')) AS num
      FROM public.purchase_receipts pr
     WHERE coalesce(pr.estado,'') <> 'anulada'
  )
  SELECT d.id, d.fecha_emision, d.emisor_nombre, d.emisor_nit,
         d.codigo_generacion::text, d.numero_control, d.monto_total,
         coalesce(array_length(string_to_array(d.items_text, ' | '), 1), 0)::integer,
         d.pdf_path IS NOT NULL,
         (SELECT m.nombre FROM public.proveedores_maestro m
           WHERE m.nit = d.emisor_nit ORDER BY m.id LIMIT 1),
         (current_date - d.fecha_emision)::integer
    FROM public.purchase_dte_documents d
   WHERE NOT d.invalidado
     AND d.tipo_dte IN ('01','03')
     AND d.json_path IS NOT NULL
     AND d.fecha_emision >= current_date - coalesce(p_dias, 30)
     AND (SELECT auth_has_module_permission('compras','can_view')
           OR auth_has_module_permission('facturas_compra','can_view'))
     -- Las cuatro ramas del OR original, una por NOT EXISTS. Cada una es una
     -- igualdad simple, o sea hasheable.
     AND NOT EXISTS (SELECT 1 FROM recibos r
                      WHERE d.sello_recibido IS NOT NULL AND r.sello_recibido = d.sello_recibido)
     AND NOT EXISTS (SELECT 1 FROM recibos r
                      WHERE r.num = left(upper(d.codigo_generacion::text), 20))
     AND NOT EXISTS (SELECT 1 FROM recibos r
                      WHERE r.num = left(replace(upper(d.codigo_generacion::text), '-', ''), 20))
     AND NOT EXISTS (SELECT 1 FROM recibos r
                      WHERE r.num = upper(d.codigo_generacion::text))
   ORDER BY d.fecha_emision DESC, d.id DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_documentos_sin_cargar(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_documentos_sin_cargar(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_documentos_sin_cargar(integer) IS
  'Documentos recibidos sin compra registrada. El descarte va en cuatro NOT EXISTS de igualdad '
  '(hash anti join) en vez de uno con OR (nested loop): 18,957ms -> 19.5ms, mismas filas.';
