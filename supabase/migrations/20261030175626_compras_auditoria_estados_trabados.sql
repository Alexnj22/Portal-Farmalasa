SET lock_timeout = '5s';

-- Auditoría Cargar compra (2026-10-30): lo que queda a medio camino.
--
-- Cuando la función se corta entre «tomar» una fila y anotar el resultado
-- (límite de 150 s, fin del trabajo en segundo plano), la fila quedaba en
-- `enviando`/`recibiendo`/`saliendo` para siempre. Ahora tiene a dónde ir:
-- `sin_verificar` = «se mandó algo y no se sabe si entró» — nunca se reintenta
-- sola, se comprueba contra el sistema antes.
ALTER TABLE public.compra_reparto DROP CONSTRAINT compra_reparto_estado_check;
ALTER TABLE public.compra_reparto ADD CONSTRAINT compra_reparto_estado_check
  CHECK (estado IN ('por_enviar','enviando','enviado','recibiendo','recibido','fallido','sin_verificar'));
ALTER TABLE public.compra_renglon_erroneo DROP CONSTRAINT compra_renglon_erroneo_estado_check;
ALTER TABLE public.compra_renglon_erroneo ADD CONSTRAINT compra_renglon_erroneo_estado_check
  CHECK (estado IN ('por_mover','en_vencidos','con_nota','saliendo','salio','sin_verificar'));
ALTER TABLE public.compra_renglon_erroneo DROP CONSTRAINT compra_renglon_erroneo_con_nota_tiene_nota;
ALTER TABLE public.compra_renglon_erroneo ADD CONSTRAINT compra_renglon_erroneo_con_nota_tiene_nota
  CHECK (estado <> 'con_nota' OR nota_credito_document_id IS NOT NULL OR nota_papel_id IS NOT NULL);

-- Un erróneo sólo se descarga de vencidos si se COMPROBÓ que llegó ahí. El
-- número de traslado no lo dice: se anota antes de recibirlo.
ALTER TABLE public.compra_renglon_erroneo ADD COLUMN en_vencidos_at timestamptz;

CREATE OR REPLACE FUNCTION public.compra_soltar_trabados()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_corte timestamptz := now() - interval '15 minutes'; v jsonb := '{}'::jsonb; n int;
BEGIN
  UPDATE public.compra_carga SET estado = 'sin_verificar', updated_at = now(),
         error = coalesce(error || ' · ', '') || 'El envío se cortó sin respuesta: buscarla en Bodega antes de volver a mandarla.'
   WHERE estado = 'enviando' AND updated_at < v_corte;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('cargas', n);

  UPDATE public.compra_reparto SET estado = 'sin_verificar', updated_at = now(),
         nota = CASE estado WHEN 'enviando'
                  THEN 'El envío a la sala se cortó: buscar el traslado en el sistema antes de volver a enviar.'
                  ELSE 'La recepción se cortó: comprobar si entró.' END
   WHERE estado IN ('enviando','recibiendo') AND updated_at < v_corte;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('repartos', n);

  UPDATE public.compra_renglon_erroneo SET estado = 'sin_verificar', updated_at = now(),
         nota = 'La salida se cortó: comprobar si salió de vencidos.'
   WHERE estado = 'saliendo' AND updated_at < v_corte;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('erroneos', n);

  UPDATE public.compra_nota_credito_libro SET estado = 'sin_verificar', updated_at = now(),
         error = coalesce(error || ' · ', '') || 'El registro se cortó: revisar el libro.'
   WHERE estado = 'enviando' AND updated_at < v_corte;
  UPDATE public.compra_nota_credito_papel SET estado = 'sin_verificar', updated_at = now(),
         error = coalesce(error || ' · ', '') || 'El registro se cortó: revisar el libro.'
   WHERE estado = 'enviando' AND updated_at < v_corte;
  RETURN v;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.compra_soltar_trabados() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compra_soltar_trabados() TO service_role;

-- Pura base, sin llamadas afuera: cada 10 minutos.
SELECT cron.schedule('compra-soltar-trabados', '*/10 * * * *', $$SELECT public.compra_soltar_trabados()$$)
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compra-soltar-trabados');

-- Cargada la compra, el pedido de fechas de esa factura ya no hace falta.
CREATE OR REPLACE FUNCTION public.compra_cerrar_pedidos_de_vence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.document_id IS NOT NULL AND NEW.estado IN ('enviando','verificada','sin_verificar') THEN
    UPDATE public.compra_pedido_vence SET estado = 'cancelado', updated_at = now()
     WHERE document_id = NEW.document_id AND estado = 'pendiente';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.compra_cerrar_pedidos_de_vence() FROM PUBLIC, anon;
CREATE TRIGGER compra_carga_cierra_pedidos_de_vence
  AFTER UPDATE OF estado ON public.compra_carga
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION public.compra_cerrar_pedidos_de_vence();

-- Lo mismo al sacar la factura de la cola a mano.
CREATE OR REPLACE FUNCTION public.compra_cerrar_pedidos_al_resolver()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  UPDATE public.compra_pedido_vence SET estado = 'cancelado', updated_at = now()
   WHERE document_id = NEW.document_id AND estado = 'pendiente';
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.compra_cerrar_pedidos_al_resolver() FROM PUBLIC, anon;
CREATE TRIGGER compra_documento_resuelto_cierra_pedidos
  AFTER INSERT ON public.compra_documento_resuelto
  FOR EACH ROW EXECUTE FUNCTION public.compra_cerrar_pedidos_al_resolver();

-- La lista de erróneos lleva si se comprobó en vencidos.
CREATE OR REPLACE FUNCTION public.get_compra_erroneos()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.created_at DESC), '[]'::json) FROM (
    SELECT e.id, e.document_id, e.manual_id, e.emisor_nombre, e.descripcion, e.codigo_proveedor,
           e.product_id, e.es_generico, e.unidades, e.costo_unitario, e.erp_compra_id,
           e.estado, e.erp_traslado_id, e.en_vencidos_at, e.nota, e.marcado_por, em.name AS marcado_nombre, e.created_at,
           e.updated_at, e.nota_credito_document_id, e.nota_papel_id,
           coalesce(f.numero_control, m.numero) AS factura,
           coalesce(f.fecha_emision, m.fecha_emision) AS factura_fecha,
           (e.manual_id IS NOT NULL) AS factura_en_papel,
           coalesce(nc.numero_control, np.numero) AS nota_numero,
           coalesce(nc.fecha_emision, np.fecha) AS nota_fecha,
           coalesce(nc.monto_total, np.total) AS nota_total,
           CASE WHEN np.id IS NOT NULL THEN json_build_object(
             'id', np.id, 'numero', np.numero, 'serie', np.serie, 'fecha', np.fecha,
             'subtotal', np.subtotal, 'iva', np.iva, 'total', np.total, 'estado', np.estado, 'error', np.error)
           END AS nota_papel,
           (SELECT coalesce(json_agg(json_build_object(
                     'id', n.id, 'numero', n.numero_control, 'fecha', n.fecha_emision, 'total', n.monto_total,
                     'relacionada', n.documento_relacionado_id = e.document_id)
                   ORDER BY (n.documento_relacionado_id = e.document_id) DESC NULLS LAST, n.fecha_emision), '[]'::json)
              FROM public.purchase_dte_documents n
             WHERE n.tipo_dte = '05' AND NOT coalesce(n.invalidado, false)
               AND n.emisor_nit = e.emisor_nit AND n.fecha_emision >= coalesce(f.fecha_emision, m.fecha_emision)
           ) AS notas_candidatas
      FROM public.compra_renglon_erroneo e
      LEFT JOIN public.purchase_dte_documents f ON f.id = e.document_id
      LEFT JOIN public.compra_documento_manual m ON m.id = e.manual_id
      LEFT JOIN public.purchase_dte_documents nc ON nc.id = e.nota_credito_document_id
      LEFT JOIN public.compra_nota_credito_papel np ON np.id = e.nota_papel_id
      LEFT JOIN public.employees em ON em.id = e.marcado_por
     WHERE (SELECT auth_has_module_permission('compras','can_view'))
        OR (SELECT auth_has_module_permission('cargar_compra','can_view'))
  ) t;
$function$;
