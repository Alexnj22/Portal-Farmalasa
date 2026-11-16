-- Lenguaje del portal (docs/reglas/como-habla-el-portal.md) en los textos que
-- devuelven las funciones de Postgres: RAISE EXCEPTION, avisos y motivos.
-- Cada función parte de pg_get_functiondef VIVO (2026-11-16); sólo cambian literales de texto visible.
-- Aplicada el 2026-11-16.
-- venta-a-mano: copia literal de las definiciones vivas; sólo cambian textos visibles, ningún filtro.
-- jsonb-agg: los cuerpos son los vivos sin cambio (procesar_cambios_de_factor, puntos_vigilar_irregularidades, resolver_envio_aparecido); esta migración sólo cambia textos.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.actualizar_extra_de_pedido(p_item_id integer, p_cantidad integer, p_factor integer, p_tipo text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := auth_employee_id();
    v_it    record;
    v_tipo  text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    SELECT * INTO v_it FROM public.pedido_items WHERE id = p_item_id FOR UPDATE;
    IF v_it.id IS NULL THEN
        RAISE EXCEPTION 'ITEM_NO_EXISTE';
    END IF;
    IF NOT v_it.es_extra THEN
        RAISE EXCEPTION 'NO_ES_EXTRA: ese producto venía en el pedido';
    END IF;
    IF auth_module_scope('pedidos') <> 'ALL'
       AND auth_employee_erp_sucursal_id() IS DISTINCT FROM v_it.erp_sucursal_id THEN
        RAISE EXCEPTION 'OTRA_SALA: lo corrige la sucursal que lo anotó';
    END IF;
    IF v_it.resolucion_status IS NOT NULL THEN
        RAISE EXCEPTION 'YA_EN_CURSO: esta diferencia ya se está resolviendo; '
                        'la cantidad es la que aceptó la otra parte';
    END IF;
    IF coalesce(p_cantidad, 0) <= 0 THEN
        RAISE EXCEPTION 'CANTIDAD_EN_CERO: escribe cuántos llegaron';
    END IF;
    IF coalesce(p_factor, 0) <= 0 THEN
        RAISE EXCEPTION 'SIN_PRESENTACION: la presentación no trae su factor';
    END IF;

    -- El nombre viejo sólo vale si el factor no cambió: conservarlo con un
    -- factor nuevo guardaba «CAJA X 10» de 1, y el movimiento no lo encuentra.
    v_tipo := public.tipo_de_presentacion_de_extra(
        v_it.erp_product_id, p_factor,
        coalesce(nullif(btrim(coalesce(p_tipo, '')), ''),
                 CASE WHEN p_factor = v_it.factor THEN v_it.dispatch_tipo END));
    IF v_tipo IS NULL THEN
        RAISE EXCEPTION 'SIN_PRESENTACION: esa presentación no está en el catálogo del producto';
    END IF;

    UPDATE public.pedido_items SET
        cantidad_recibida = p_cantidad,
        factor            = p_factor,
        dispatch_factor   = p_factor,
        dispatch_tipo     = v_tipo,
        nota_diferencia   = nullif(btrim(coalesce(p_nota, '')), ''),
        -- Vuelve a quedar en pie por si se anuló y se está reponiendo.
        status            = 'con_diferencia',
        error_tipo        = 'sobrante'
    WHERE id = p_item_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agregar_extra_a_pedido(p_pedido_id uuid, p_sucursal_id integer, p_erp_product_id integer, p_cantidad integer, p_factor integer DEFAULT 1, p_tipo text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := auth_employee_id();
    v_nota  text := nullif(btrim(coalesce(p_nota, '')), '');
    v_id    integer;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    IF auth_module_scope('pedidos') <> 'ALL'
       AND auth_employee_erp_sucursal_id() IS DISTINCT FROM p_sucursal_id THEN
        RAISE EXCEPTION 'OTRA_SALA: lo que llegó de más lo anota la sucursal que recibe el pedido';
    END IF;

    IF coalesce(p_cantidad, 0) <= 0 THEN
        RAISE EXCEPTION 'CANTIDAD_EN_CERO: escribe cuántos llegaron';
    END IF;
    IF coalesce(p_factor, 0) <= 0 THEN
        RAISE EXCEPTION 'SIN_PRESENTACION: la presentación no trae su factor';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.pedidos WHERE id = p_pedido_id) THEN
        RAISE EXCEPTION 'PEDIDO_NO_EXISTE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_erp_product_id) THEN
        RAISE EXCEPTION 'PRODUCTO_NO_EXISTE';
    END IF;

    IF NOT public.recepcion_corregible(p_pedido_id, p_sucursal_id) THEN
        RAISE EXCEPTION 'PLAZO_VENCIDO: un error de la recepción se reporta hasta 2 días después '
                        'de cerrarla. Pasado ese plazo lo levanta un supervisor o administrador.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.pedido_items pi
                WHERE pi.pedido_id       = p_pedido_id
                  AND pi.erp_sucursal_id = p_sucursal_id
                  AND pi.erp_product_id  = p_erp_product_id
                  AND NOT pi.es_extra) THEN
        RAISE EXCEPTION 'YA_VENIA_EN_EL_PEDIDO: ese producto ya viene en el pedido; '
                        'escribí ahí la cantidad que contaste';
    END IF;
    IF EXISTS (SELECT 1 FROM public.pedido_items pi
                WHERE pi.pedido_id       = p_pedido_id
                  AND pi.erp_sucursal_id = p_sucursal_id
                  AND pi.erp_product_id  = p_erp_product_id
                  AND pi.es_extra
                  AND pi.status <> 'anulado') THEN
        RAISE EXCEPTION 'YA_ANOTADO: ese producto ya está anotado como llegado de más';
    END IF;

    INSERT INTO public.pedido_items (
        pedido_id, erp_sucursal_id, erp_product_id,
        cantidad_asignada, cantidad_enviada, cantidad_recibida,
        factor, dispatch_factor, dispatch_tipo,
        status, error_tipo, es_extra,
        received_at, received_by, nota_diferencia
    ) VALUES (
        p_pedido_id, p_sucursal_id, p_erp_product_id,
        0, 0, p_cantidad,
        p_factor, p_factor, public.tipo_de_presentacion_de_extra(p_erp_product_id, p_factor, p_tipo),
        'con_diferencia', 'sobrante', true,
        now(), v_actor, v_nota
    ) RETURNING id INTO v_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
    VALUES (v_id, p_pedido_id, p_sucursal_id, 'extra_anotado', v_nota, v_actor);

    PERFORM public.reabrir_diferencias_de_sala(p_pedido_id, p_sucursal_id, v_actor);

    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.alertar_barrido_dte()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_corrida    public.audit_logs%ROWTYPE;
    v_hubo       boolean;
    v_fallidas   int;
    v_resueltas  int;
    v_restantes  int;
    v_esperando  int;
    v_dest       uuid[];
    v_titulo     text;
    v_cuerpo     text;
    v_facturas   jsonb;
BEGIN
    SELECT * INTO v_corrida
      FROM public.audit_logs
     WHERE action = 'DTE_REGULARIZADO'
       AND source = 'SYSTEM'
       AND target_id = 'todas'
       AND created_at >= now() - interval '12 hours'
     ORDER BY created_at DESC
     LIMIT 1;

    v_hubo := FOUND;

    IF v_hubo THEN
        v_fallidas  := coalesce((v_corrida.details->>'fallidas')::int, 0);
        v_resueltas := coalesce((v_corrida.details->>'resueltas')::int, 0);
        v_restantes := coalesce((v_corrida.details->>'restantes')::int, 0);
        IF v_fallidas = 0 THEN RETURN; END IF;
    END IF;

    SELECT array_agg(e.id) INTO v_dest
      FROM public.employees e
      JOIN public.roles r ON r.name = 'Sistema — Alertas Técnicas'
     WHERE e.status = 'ACTIVO'
       AND r.id = ANY (public.roles_efectivos_de(e.id));

    IF v_dest IS NULL OR array_length(v_dest, 1) IS NULL THEN
        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
        VALUES ('ALERTA_BARRIDO_DTE_SIN_DESTINATARIOS', 'regularizar-dte',
                'Vigilante', 'SYSTEM', 'CRITICAL',
                jsonb_build_object('motivo', 'nadie tiene el rol Sistema — Alertas Técnicas'));
        RETURN;
    END IF;

    IF NOT v_hubo THEN
        -- Las dos bolsas del barrido, contadas con su mismo criterio: anulada
        -- CON sello (hay algo que invalidar ante Hacienda) y no anulada SIN
        -- sello válido. El sello es texto de 40 caracteres, así que se compara
        -- por forma y no por «tiene algo» — ver la regla del tipo en CLAUDE.md.
        SELECT count(*) INTO v_esperando
          FROM public.sales_invoices
         WHERE (estado = 'NULA' AND recibido_mh LIKE repeat('_', 40))
            OR (estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
                AND (recibido_mh IS NULL OR recibido_mh NOT LIKE repeat('_', 40))
                AND NOT public.cof_no_se_envia_mh(tipo_documento, fecha, hora, customer_id));

        v_titulo := 'El envío al MH no corrió anoche';
        v_cuerpo := 'No quedó registro del envío de las ' || public.hora_12('22:30'::time) || '. '
                 || CASE
                      WHEN v_esperando = 0
                        THEN 'Ahora mismo no hay ninguna factura esperando, '
                             || 'pero tiene que volver a correr antes de que entre la próxima. '
                      WHEN v_esperando = 1
                        THEN 'Hay 1 factura esperando y no se va a mandar hasta que vuelva a correr. '
                      ELSE 'Hay ' || v_esperando
                             || ' facturas esperando y no se van a mandar hasta que vuelva a correr. '
                    END
                 || 'Hay que revisar el envío automático de las ' || public.hora_12('22:30'::time) || '.';
    ELSE
        v_titulo := CASE WHEN v_fallidas = 1 THEN 'Una factura no entró al MH anoche'
                         ELSE v_fallidas || ' facturas no entraron al MH anoche' END;

        -- Cuáles son, para la tarjeta (24-sep): la venta —sala, documento,
        -- fecha, cliente, monto— y lo que dijo Hacienda. Hasta 5.
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'sala',    b.name,
                   'doc',     CASE WHEN x->>'correlativo' LIKE '%\_CCF' THEN 'Crédito fiscal' ELSE 'Consumidor final' END,
                   'fecha',   si.fecha,
                   'cliente', nullif(btrim(si.cliente), ''),
                   'monto',   si.total,
                   'motivo',  coalesce(x->'observaciones'->>0,
                                       regexp_replace(coalesce(x->>'error', ''), '^.*— ', ''))))
                 ORDER BY b.name)
          INTO v_facturas
          FROM (SELECT x FROM jsonb_array_elements(coalesce(v_corrida.details->'detalle', '[]'::jsonb)) x
                 WHERE (x->>'ok')::boolean IS NOT TRUE LIMIT 5) f
          LEFT JOIN public.sales_invoices si ON si.id = nullif(x->>'invoice_id', '')::bigint
          LEFT JOIN public.branches b ON b.id = nullif(x->>'branch_id', '')::integer;
        v_cuerpo := v_fallidas || ' factura' || CASE WHEN v_fallidas = 1 THEN '' ELSE 's' END
                 || ' no se pudo completar ante el MH'
                 || CASE WHEN v_resueltas > 0 THEN ', ' || v_resueltas || ' sí' ELSE '' END
                 || '. ' || CASE WHEN v_restantes > 0
                                 THEN 'Quedan ' || v_restantes || ' en cola. ' ELSE '' END
                 || 'Las que ya no se arreglan solas están en Facturación, en Observaciones.';
    END IF;

    -- Al resumen de la mañana (2026-11-14): con un solo renglón sale igual que
    -- antes, con su tarjeta de Hacienda; con más, va dentro del resumen.
    PERFORM public.resumen_manana_agregar(
        v_dest, 'hacienda', 10, 'SYSTEM', v_titulo, v_cuerpo, '/facturacion?tab=observaciones',
        jsonb_strip_nulls(jsonb_build_object('origen', 'regularizar-dte',
                           'corrida', v_corrida.id,
                           'fallidas', v_fallidas,
                           'esperando', v_esperando,
                           -- La tarjeta de la campana (24-sep).
                           'hacienda', jsonb_strip_nulls(jsonb_build_object(
                               'corrio',    v_hubo,
                               'fallidas',  v_fallidas,
                               'resueltas', v_resueltas,
                               'restantes', v_restantes,
                               'esperando', v_esperando,
                               'facturas',  v_facturas)))),
        true
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.anular_abono_diferencia(p_id bigint, p_motivo text)
 RETURNS cortes_caja_diferencia_abonos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_ab  public.cortes_caja_diferencia_abonos;
    v_cid bigint;
BEGIN
    IF NOT (SELECT auth_has_module_permission('cortes_caja_resolver', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Anular exige decir por que.';
    END IF;

    SELECT * INTO v_ab FROM public.cortes_caja_diferencia_abonos WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese abono no existe.'; END IF;

    IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
       AND v_ab.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF v_ab.anulada_at IS NOT NULL THEN
        RAISE EXCEPTION 'Ese abono ya estaba anulado.';
    END IF;
    IF v_ab.asentado_at IS NOT NULL THEN
        RAISE EXCEPTION 'Ese abono ya se registró. No se puede anular desde aquí.';
    END IF;

    UPDATE public.cortes_caja_diferencia_abonos SET
        anulada_at = now(), anulada_por = (SELECT auth_employee_id()),
        anulada_motivo = btrim(p_motivo)
    WHERE id = p_id RETURNING * INTO v_ab;

    SELECT d.corte_id INTO v_cid FROM public.cortes_caja_diferencias d WHERE d.id = v_ab.diferencia_id;
    INSERT INTO public.cortes_caja_eventos (corte_id, accion, motivo, nota, employee_id)
    VALUES (v_cid, 'ANULAR_ABONO', btrim(p_motivo),
            to_char(v_ab.monto, 'FM999999990.00'), (SELECT auth_employee_id()));

    RETURN v_ab;
END;
$function$;

CREATE OR REPLACE FUNCTION public.anular_bolsa(p_id bigint, p_motivo text)
 RETURNS bolsas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_bolsa public.bolsas;
    v_scope text;
    v_vales integer;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Anular una bolsa exige decir por qué.';
    END IF;

    SELECT * INTO v_bolsa FROM public.bolsas WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La bolsa no existe.'; END IF;

    v_scope := (SELECT auth_module_scope('bolsas'));
    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_bolsa.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_bolsa.estado <> 'ABIERTA' THEN
        RAISE EXCEPTION 'Esta bolsa ya salió de la sucursal: no se puede anular.';
    END IF;

    SELECT count(*) INTO v_vales FROM public.bolsas_movimientos m
     WHERE m.bolsa_id = p_id AND m.anulado_at IS NULL;
    IF v_vales > 0 THEN
        RAISE EXCEPTION 'Esta bolsa tiene % % adentro. Hay que anularlos primero: si no, quedan respaldando una bolsa que ya no cuenta.',
            v_vales, CASE WHEN v_vales = 1 THEN 'vale' ELSE 'vales' END;
    END IF;

    UPDATE public.bolsas
       SET estado = 'ANULADA', anulada_por = (SELECT auth_employee_id()),
           anulada_motivo = btrim(p_motivo), anulada_at = now(), updated_at = now()
     WHERE id = p_id
     RETURNING * INTO v_bolsa;

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, motivo, monto, employee_id)
    VALUES (p_id, 'ANULAR', 'ABIERTA', 'ANULADA', btrim(p_motivo), v_bolsa.monto_inicial,
            (SELECT auth_employee_id()));

    -- El efectivo que respaldaba esta bolsa vuelve a la caja y ahí se queda: no
    -- se le pasa a otra bolsa. La que quede abierta es una bolsa física con su
    -- etiqueta puesta, y sumarle este monto le haría prometer dinero que no
    -- tiene adentro. Si el día queda con menos guardado que lo declarado, lo
    -- muestra `get_bolsas_invariante` en la pantalla.
    RETURN v_bolsa;
END;
$function$;

CREATE OR REPLACE FUNCTION public.anular_diferencia_corte(p_id bigint, p_motivo text)
 RETURNS cortes_caja_diferencias
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dif public.cortes_caja_diferencias;
BEGIN
    IF NOT (SELECT auth_has_module_permission('cortes_caja_resolver', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Anular exige decir por que.';
    END IF;

    SELECT * INTO v_dif FROM public.cortes_caja_diferencias WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa resolucion no existe.'; END IF;

    IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
       AND v_dif.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_dif.anulada_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esa resolucion ya estaba anulada.';
    END IF;

    IF v_dif.asentado_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esta resolución ya se registró. No se puede anular desde aquí.';
    END IF;

    -- Anularla con abonos vivos borraría de la cuenta dinero que ya entró.
    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencia_abonos a
                WHERE a.diferencia_id = p_id AND a.anulada_at IS NULL) THEN
        RAISE EXCEPTION 'Este faltante ya tiene abonos: hay que anularlos primero.';
    END IF;

    -- Una causa parcial sostiene el monto de los responsables (o del retiro):
    -- esos cubren SÓLO lo que la causa no explicó. Quitarla dejaría un hueco
    -- que ninguna vía puede llenar. Se anula primero la de dinero.
    IF v_dif.via = 'JUSTIFICA' AND EXISTS (
        SELECT 1 FROM public.cortes_caja_diferencias d
         WHERE d.corte_id = v_dif.corte_id AND d.anulada_at IS NULL
           AND d.via <> 'JUSTIFICA' AND d.id <> p_id) THEN
        RAISE EXCEPTION 'Lo que esta causa no explico ya tiene responsables: hay que anular esa resolucion primero.';
    END IF;

    UPDATE public.cortes_caja_diferencias SET
        anulada_at = now(), anulada_por = (SELECT auth_employee_id()),
        anulada_motivo = btrim(p_motivo), updated_at = now()
    WHERE id = p_id RETURNING * INTO v_dif;

    INSERT INTO public.cortes_caja_eventos (corte_id, accion, motivo, employee_id)
    VALUES (v_dif.corte_id, 'ANULAR_DIFERENCIA', btrim(p_motivo), (SELECT auth_employee_id()));

    RETURN v_dif;
END;
$function$;

CREATE OR REPLACE FUNCTION public.anular_dispensacion(p_dispensacion_id bigint, p_motivo text, p_detalle text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_d       public.bitacora_dispensaciones%ROWTYPE;
    v_entregado numeric;
    v_prescrito numeric;
    v_receta_id bigint;
    v_estado_receta text;
BEGIN
    SELECT * INTO v_d FROM public.bitacora_dispensaciones WHERE id = p_dispensacion_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese folio no existe.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.bitacora_exigir_acceso(v_d.branch_id, 'can_edit');
    PERFORM public.bitacora_exigir_libro();

    IF v_d.estado = 'anulada' THEN
        RAISE EXCEPTION 'Ese folio ya está anulado.' USING ERRCODE = 'P0001';
    END IF;
    IF public.bitacora_periodo_cerrado(v_d.branch_id, to_char(v_d.fecha, 'YYYY-MM')) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado. Hay que reabrirlo para poder anular.' USING ERRCODE = 'P0001';
    END IF;
    IF p_motivo IS NULL OR p_motivo NOT IN ('devolucion', 'error_de_carga', 'otro') THEN
        RAISE EXCEPTION 'Hay que decir por que se anula: devolucion, error de carga u otro.' USING ERRCODE = 'P0001';
    END IF;
    IF p_motivo = 'otro' AND coalesce(btrim(p_detalle), '') = '' THEN
        RAISE EXCEPTION 'Si el motivo es «otro», hay que escribir cual.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.bitacora_dispensaciones
       SET estado = 'anulada',
           motivo_anulacion = p_motivo,
           detalle_anulacion = nullif(btrim(p_detalle), ''),
           anulada_por = public.auth_employee_id(),
           anulada_at = now()
     WHERE id = p_dispensacion_id;

    IF v_d.receta_item_id IS NOT NULL THEN
        SELECT coalesce(sum(d.cantidad), 0) INTO v_entregado
          FROM public.bitacora_dispensaciones d
         WHERE d.receta_item_id = v_d.receta_item_id AND d.estado <> 'anulada';
        SELECT cantidad_prescrita, receta_id INTO v_prescrito, v_receta_id
          FROM public.receta_items WHERE id = v_d.receta_item_id;

        -- H2: el estado es de la RECETA entera, no del renglón anulado.
        IF v_receta_id IS NOT NULL THEN
            v_estado_receta := public.recalcular_estado_receta(v_receta_id);
        END IF;
    END IF;

    RETURN json_build_object(
        'anulada', true,
        'entregado', coalesce(v_entregado, 0),
        'prescrito', v_prescrito,
        'receta_reabierta', v_estado_receta = 'abierta'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.anular_pedido_sucursal(p_pedido_id uuid, p_sucursal_id integer, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor      uuid := auth_employee_id();
    v_status     text;
    v_pss        record;
    v_renglones  integer;
    v_quedan     integer;
    v_motivo     text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;
    -- Igual que anular el pedido entero: es de Bodega.
    IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
        RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: anular la parte de una sucursal es de Bodega';
    END IF;
    IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
        RAISE EXCEPTION 'Escribe el motivo (mínimo 5 caracteres).';
    END IF;

    SELECT status INTO v_status FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado.';
    END IF;
    IF v_status IN ('completado', 'anulado') THEN
        RAISE EXCEPTION 'El pedido está % y no se puede modificar.', v_status;
    END IF;

    SELECT * INTO v_pss FROM pedido_sucursal_status
     WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esa sucursal no está en este pedido.';
    END IF;
    IF v_pss.anulado_at IS NOT NULL THEN
        RAISE EXCEPTION 'La parte de esa sucursal ya estaba anulada.';
    END IF;
    IF v_pss.iniciado_at IS NOT NULL THEN
        RAISE EXCEPTION 'Bodega ya empezó a preparar esa sucursal: ya no se puede anular sola.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pedido_traslado_erp
         WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
           AND id_traslado IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Esa sucursal ya tiene un traslado hecho: no se puede anular sola.';
    END IF;

    UPDATE pedido_items
       SET status = 'anulado'
     WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
       AND status = 'pendiente';
    GET DIAGNOSTICS v_renglones = ROW_COUNT;

    UPDATE pedido_sucursal_status
       SET anulado_at = now(), anulado_por = v_actor, motivo_anulacion = v_motivo
     WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    SELECT count(*) INTO v_quedan FROM pedido_sucursal_status
     WHERE pedido_id = p_pedido_id AND anulado_at IS NULL;

    IF v_quedan = 0 THEN
        -- Era la última sala viva: el pedido entero queda anulado.
        UPDATE pedidos
           SET status = 'anulado', anulado_por = v_actor, anulado_at = now(),
               motivo_anulacion = v_motivo
         WHERE id = p_pedido_id;
    ELSIF NOT EXISTS (
        SELECT 1 FROM pedido_items WHERE pedido_id = p_pedido_id AND status = 'pendiente'
    ) AND NOT EXISTS (
        SELECT 1 FROM pedido_sucursal_status
         WHERE pedido_id = p_pedido_id AND anulado_at IS NULL AND recibido_erp_at IS NULL
    ) THEN
        -- Las demás salas ya terminaron: la anulada era lo único que lo
        -- tenía abierto. Mismo criterio que `cerrar_pedido_si_todo_resuelto`.
        IF EXISTS (
            SELECT 1 FROM pedido_items
             WHERE pedido_id = p_pedido_id AND status = 'con_diferencia'
               AND resolucion_status IS DISTINCT FROM 'confirmada'
        ) THEN
            UPDATE pedidos SET status = 'parcial' WHERE id = p_pedido_id;
        ELSE
            UPDATE pedidos SET status = 'completado' WHERE id = p_pedido_id;
        END IF;
    END IF;

    RETURN json_build_object(
        'renglones', v_renglones,
        'pedido_anulado', v_quedan = 0
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apartado_cotizar(p_branch_id bigint, p_apartado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_modo text := p_apartado->>'modo';
  v_cant integer; v_factor integer; v_precio numeric; v_total numeric; v_disp numeric;
  v_desde bigint := nullif(p_apartado->>'traslado_desde', '')::bigint; v_desde_nombre text;
  v_reqs uuid[] := public.apartado_traslados_pedidos(p_apartado); v_viene json; v_vienen numeric := 0; v_falta integer;
  v_resto boolean := coalesce((p_apartado->>'encargar_resto')::boolean, false);
  r public.app_reservas; e public.app_encargos; v_cliente text; k record;
  l jsonb; v_c json; v_baja boolean := false; v_todos uuid[] := '{}';
BEGIN
  -- Un PEDIDO de sala (2026-10-22): varios productos, un solo cobro. Cada
  -- renglón es una reserva 'nueva' y se valida como tal; un traslado en camino
  -- no puede servir a dos renglones. Lo que se pide a otra sala va aparte.
  IF v_modo = 'pedido' THEN
    IF jsonb_typeof(p_apartado->'lineas') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_apartado->'lineas') NOT BETWEEN 2 AND 10 THEN
      RAISE EXCEPTION 'Un pedido lleva de 2 a 10 productos.';
    END IF;
    IF (SELECT count(DISTINCT x->>'producto_id') FROM jsonb_array_elements(p_apartado->'lineas') x)
       < jsonb_array_length(p_apartado->'lineas') THEN
      RAISE EXCEPTION 'Un producto va una sola vez en el pedido: súmale la cantidad.';
    END IF;
    v_total := 0;
    FOR l IN SELECT * FROM jsonb_array_elements(p_apartado->'lineas') LOOP
      IF nullif(l->>'traslado_desde', '') IS NOT NULL THEN
        RAISE EXCEPTION 'En un pedido, lo que se pide a otra sucursal se aparta aparte.';
      END IF;
      IF public.apartado_traslados_pedidos(l) && v_todos THEN
        RAISE EXCEPTION 'Un mismo traslado no puede apartarse para dos productos.';
      END IF;
      v_todos := v_todos || public.apartado_traslados_pedidos(l);
      v_c := public.apartado_cotizar(p_branch_id, l || jsonb_build_object('modo', 'nueva', 'customer_id', p_apartado->'customer_id'));
      v_total := v_total + (v_c->>'total')::numeric;
      v_baja := v_baja OR coalesce((v_c->>'baja_rotacion')::boolean, false);
      v_cliente := v_c->>'cliente';
      v_desde_nombre := CASE WHEN v_c->>'traslado_desde' IS NULL THEN v_desde_nombre
                             ELSE coalesce(v_desde_nombre || ' y ', '') || (v_c->>'traslado_desde') END;
    END LOOP;
    RETURN json_build_object('tipo', 'reserva', 'total', round(v_total, 2), 'minimo', 0.01, 'maximo', round(v_total, 2),
      'baja_rotacion', v_baja, 'cliente', v_cliente, 'traslado_desde', v_desde_nombre,
      'detalle', jsonb_array_length(p_apartado->'lineas') || ' productos');
  END IF;

  IF v_modo = 'nueva' THEN
    v_cant := (p_apartado->>'cantidad')::integer;
    v_factor := greatest(coalesce((p_apartado->>'factor')::integer, 1), 1);
    v_precio := round((p_apartado->>'precio')::numeric, 2);
    SELECT name INTO v_cliente FROM public.customers WHERE id = (p_apartado->>'customer_id')::bigint;
    IF v_cliente IS NULL THEN RAISE EXCEPTION 'Elige el cliente del listado.'; END IF;
    IF v_cant IS NULL OR v_cant < 1 OR v_cant > 999 THEN RAISE EXCEPTION 'La cantidad va de 1 a 999.'; END IF;
    -- El precio queda fijo sólo si es uno de la venta para esa presentación
    -- (viñeta a Mayoreo Plus, 2026-11-03): `precio_de_apartado_valido`.
    IF NOT public.precio_de_apartado_valido((p_apartado->>'producto_id')::bigint, v_factor, v_precio) THEN
      RAISE EXCEPTION 'Ese precio no es uno de la venta para esa presentación.';
    END IF;
    IF cardinality(v_reqs) > 0 THEN
      -- Ya viene en camino (2026-10-22): mandan esos traslados, que tienen que
      -- ser a esta sala, de este producto, seguir abiertos y no estar tomados
      -- por otra reserva. Lo que no alcanzan se encarga a Bodega con la reserva.
      FOR v_viene IN SELECT x FROM json_array_elements(public.traslados_en_camino_a_sala(p_branch_id, (p_apartado->>'producto_id')::bigint)) x
                      WHERE (x->>'id')::uuid = ANY (v_reqs) LOOP
        v_vienen := v_vienen + (v_viene->>'unidades')::numeric;
        v_desde_nombre := coalesce(v_desde_nombre || ' y ', '') || (v_viene->>'origen');
      END LOOP;
      IF (SELECT count(*) FROM json_array_elements(public.traslados_en_camino_a_sala(p_branch_id, (p_apartado->>'producto_id')::bigint)) x
           WHERE (x->>'id')::uuid = ANY (v_reqs)) <> cardinality(v_reqs) THEN
        RAISE EXCEPTION 'Uno de esos traslados ya no está en camino para apartar: vuelve a revisarlo.';
      END IF;
      v_falta := v_cant - floor(v_vienen / v_factor)::integer;
      IF v_falta > 0 AND NOT v_resto THEN
        RAISE EXCEPTION 'Vienen % y se piden %: encarga el resto a Bodega o pide menos.', floor(v_vienen / v_factor), v_cant;
      END IF;
      IF v_falta > 20 THEN RAISE EXCEPTION 'Bodega encarga hasta 20 por pedido y faltan %.', v_falta; END IF;
    ELSIF v_desde IS NOT NULL THEN
      -- Viene de otra sala: la existencia que manda es la de ESA sala.
      IF v_desde = p_branch_id THEN RAISE EXCEPTION 'El traslado tiene que venir de otra sucursal.'; END IF;
      SELECT name INTO v_desde_nombre FROM public.branches WHERE id = v_desde;
      IF v_desde_nombre IS NULL THEN RAISE EXCEPTION 'Esa sucursal no existe.'; END IF;
      SELECT coalesce(max((x->>'disponibles')::numeric), 0) INTO v_disp
        FROM json_array_elements(public.app_existencias_netas(ARRAY[(p_apartado->>'producto_id')::int])) x
       WHERE (x->>'branch_id')::bigint = v_desde;
      IF v_disp < v_cant * v_factor THEN
        RAISE EXCEPTION 'En % hay % unidades y se piden %.', v_desde_nombre, v_disp, v_cant * v_factor;
      END IF;
    ELSE
      SELECT coalesce(max((x->>'disponibles')::numeric), 0) INTO v_disp
        FROM json_array_elements(public.app_existencias_netas(ARRAY[(p_apartado->>'producto_id')::int])) x
       WHERE (x->>'branch_id')::bigint = p_branch_id;
      IF v_disp < v_cant * v_factor THEN
        RAISE EXCEPTION 'En esta sucursal hay % unidades y se piden %: se encarga, no se aparta.', v_disp, v_cant * v_factor;
      END IF;
    END IF;
    v_total := round(v_precio * v_cant, 2);
    -- Reglamento v2, cláusula 4.2 (2026-10-22): un apartado —con existencia en
    -- la sala o traído de otra— no tiene monto mínimo; la pantalla sugiere 50 %
    -- y 100 %, y con muy baja rotación propone el 100 %. Sólo el encargo se
    -- paga completo.
    RETURN json_build_object('tipo', 'reserva', 'total', v_total, 'minimo', 0.01, 'maximo', v_total,
      'baja_rotacion', public.producto_baja_rotacion((p_apartado->>'producto_id')::bigint, p_branch_id),
      'cliente', v_cliente, 'detalle', (p_apartado->>'producto_nombre'), 'traslado_desde', v_desde_nombre);

  ELSIF v_modo = 'reserva' THEN
    SELECT * INTO r FROM public.app_reservas WHERE id = (p_apartado->>'reserva_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
    IF r.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Esa reserva es de otra sucursal.'; END IF;
    -- Una reserva de la app se paga en la app o al retirarla, nunca con un
    -- anticipo de caja: mezclar las dos formas es lo que cobraba dos veces.
    IF r.origen IS DISTINCT FROM 'sucursal' THEN RAISE EXCEPTION 'Esa reserva es de la app: se paga en la app o al retirarla.'; END IF;
    IF r.estado NOT IN ('pendiente', 'lista') THEN RAISE EXCEPTION 'Esa reserva ya no está abierta.'; END IF;
    -- Cuánto falta: lo dice `reserva_cuenta` (descuenta anticipo y pago en línea).
    SELECT * INTO k FROM public.reserva_cuenta(r.id);
    IF k.falta_pagar <= 0.004 THEN RAISE EXCEPTION 'Esa reserva ya está pagada.'; END IF;
    SELECT name INTO v_cliente FROM public.customers WHERE id = r.customer_id;
    RETURN json_build_object('tipo', 'reserva', 'total', k.total, 'minimo', 0.01,
      'maximo', k.falta_pagar, 'cliente', v_cliente, 'detalle', r.producto_nombre,
      'codigo', 'R-' || lpad(r.id::text, 6, '0'));

  ELSIF v_modo = 'encargo' THEN
    SELECT * INTO e FROM public.app_encargos WHERE id = (p_apartado->>'encargo_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
    IF e.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Ese encargo es de otra sucursal.'; END IF;
    IF e.estado <> 'confirmado' THEN RAISE EXCEPTION 'Ese encargo todavía no tiene el precio confirmado.'; END IF;
    IF e.pago_estado <> 'pendiente' THEN RAISE EXCEPTION 'Ese encargo ya está pagado.'; END IF;
    -- El resto de una reserva (2026-10-22) se paga con la reserva: cobrarlo acá sería cobrar dos veces.
    IF e.reserva_id IS NOT NULL THEN
      RAISE EXCEPTION 'Ese encargo es el resto de la reserva R-%: se cobra con la reserva.', lpad(e.reserva_id::text, 6, '0');
    END IF;
    SELECT name INTO v_cliente FROM public.customers WHERE id = e.customer_id;
    -- El encargo se paga completo: lo que no tenemos se pide para esa persona.
    RETURN json_build_object('tipo', 'encargo', 'total', round(e.anticipo, 2), 'minimo', round(e.anticipo, 2),
      'maximo', round(e.anticipo, 2), 'cliente', v_cliente, 'detalle', e.producto_nombre,
      'codigo', 'E-' || lpad(e.id::text, 6, '0'));
  END IF;
  RAISE EXCEPTION 'No se sabe qué se está apartando.';
END $function$;

CREATE OR REPLACE FUNCTION public.apartado_para_retirar(p_branch_id bigint, p_apartado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tipo text; v_id bigint; v_branch bigint; v_estado text; v_listo boolean; v_customer bigint;
  v_producto text; v_total numeric; v_pagado numeric; v_codigo text; v_prueba boolean := false;
  v_efectivo numeric := 0; v_otras numeric := 0; v_cliente text; v_aplicado json;
  r public.app_reservas; e public.app_encargos; k record;
BEGIN
  -- Desde el navegador, sólo quien maneja las reservas de esa sala.
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT public.reserva_puede_manejar(p_branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_apartado ? 'reserva_id' THEN
    SELECT * INTO r FROM public.app_reservas WHERE id = (p_apartado->>'reserva_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
    v_tipo := 'reserva'; v_id := r.id; v_branch := r.branch_id; v_estado := r.estado; v_listo := r.estado = 'lista';
    v_customer := r.customer_id; v_producto := r.producto_nombre; v_codigo := 'R-' || lpad(r.id::text, 6, '0');
    SELECT * INTO k FROM public.reserva_cuenta(r.id);
    v_total := k.total; v_pagado := k.pagado;
    v_prueba := coalesce(r.pago_prueba, false);
    -- Un cobro de PEDIDO (2026-10-22) se reparte entre sus renglones: lo de
    -- esta reserva es su parte del reparto, no el movimiento entero.
    SELECT coalesce(sum(t.monto) FILTER (WHERE t.forma_pago = 'EFECTIVO'), 0), coalesce(sum(t.monto) FILTER (WHERE t.forma_pago <> 'EFECTIVO'), 0)
      INTO v_efectivo, v_otras
      FROM (SELECT m.forma_pago, m.monto FROM public.caja_movimientos_portal m
             WHERE m.reserva_id = r.id AND m.tipo_codigo = 'APARTADO' AND m.anulado_at IS NULL
               AND coalesce(m.apartado_previo->>'modo', '') <> 'pedido'
            UNION ALL
            SELECT m.forma_pago, (x->>'monto')::numeric FROM public.caja_movimientos_portal m
              CROSS JOIN LATERAL jsonb_array_elements(m.apartado_previo->'reparto') x
             WHERE r.pedido IS NOT NULL AND m.apartado_previo->>'modo' = 'pedido' AND m.apartado_previo->>'pedido' = r.pedido
               AND m.tipo_codigo = 'APARTADO' AND m.anulado_at IS NULL AND (x->>'reserva_id')::bigint = r.id) t;
    SELECT to_json(a) INTO v_aplicado FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id;
  ELSE
    SELECT * INTO e FROM public.app_encargos WHERE id = (p_apartado->>'encargo_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
    v_tipo := 'encargo'; v_id := e.id; v_branch := e.branch_id; v_estado := e.estado; v_listo := e.estado = 'listo';
    v_customer := e.customer_id; v_producto := e.producto_nombre; v_codigo := 'E-' || lpad(e.id::text, 6, '0');
    v_total := round(coalesce(e.anticipo, e.precio_unitario * e.cantidad, 0), 2);
    v_pagado := CASE WHEN e.pago_estado = 'pagado' THEN v_total ELSE 0 END;
    SELECT coalesce(sum(monto) FILTER (WHERE forma_pago = 'EFECTIVO'), 0), coalesce(sum(monto) FILTER (WHERE forma_pago <> 'EFECTIVO'), 0)
      INTO v_efectivo, v_otras
      FROM public.caja_movimientos_portal WHERE encargo_id = e.id AND tipo_codigo = 'APARTADO' AND anulado_at IS NULL;
    SELECT to_json(a) INTO v_aplicado FROM public.apartado_aplicaciones a WHERE a.encargo_id = e.id;
  END IF;
  IF v_branch <> p_branch_id THEN RAISE EXCEPTION 'Eso se retira en otra sucursal.'; END IF;
  SELECT name INTO v_cliente FROM public.customers WHERE id = v_customer;
  RETURN json_build_object(
    'tipo', v_tipo, 'id', v_id, 'codigo', v_codigo, 'estado', v_estado, 'listo', v_listo, 'prueba', v_prueba,
    'customer_id', v_customer, 'cliente', v_cliente, 'producto', v_producto,
    'total', v_total, 'pagado', round(v_pagado, 2), 'saldo', round(greatest(v_total - v_pagado, 0), 2),
    'efectivo', round(v_efectivo, 2), 'otras_formas', round(v_otras, 2),
    'en_linea', round(greatest(v_pagado - v_efectivo - v_otras, 0), 2),
    'aplicado', v_aplicado);
END $function$;

CREATE OR REPLACE FUNCTION public.apartado_sin_anticipo(p_branch_id bigint, p_apartado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp uuid := public.auth_employee_id();
  v_modo text := p_apartado->>'modo';
  v_cliente bigint := nullif(p_apartado->>'customer_id', '')::bigint;
  v_desde bigint := nullif(p_apartado->>'traslado_desde', '')::bigint;
  v_cot json; v_pedido text; v_id bigint; v_ids bigint[] := '{}'; l jsonb;
  v_vence timestamptz; v_pend boolean; v_codigo text; c record;
BEGIN
  IF v_emp IS NULL OR NOT (SELECT public.auth_can_edit_any(ARRAY['reservas']))
     OR NOT public.reserva_puede_manejar(p_branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND coalesce(b.type, 'FARMACIA') = 'FARMACIA') THEN
    RAISE EXCEPTION 'Se aparta en una sucursal de venta.';
  END IF;
  IF v_modo IS DISTINCT FROM 'nueva' AND v_modo IS DISTINCT FROM 'pedido' THEN
    RAISE EXCEPTION 'Sin anticipo se aparta un producto o un pedido nuevo.';
  END IF;

  -- Las mismas validaciones que con anticipo: cliente, precio, existencia, traslados en camino.
  v_cot := public.apartado_cotizar(p_branch_id, p_apartado);

  IF v_modo = 'pedido' THEN
    v_pedido := public.apartado_codigo_de_pedido();
    FOR l IN SELECT * FROM jsonb_array_elements(p_apartado->'lineas') LOOP
      v_ids := v_ids || public.apartado_crear_reserva(p_branch_id, v_cliente, l, 0, NULL, v_emp, v_pedido, true);
    END LOOP;
    v_codigo := v_pedido;
  ELSIF v_desde IS NOT NULL THEN
    INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
        precio_unitario, precio_normal, estado, terminos_version, anticipo, pendiente_at, traslado_desde,
        pago_estado, pago_metodo)
    VALUES (v_cliente, p_branch_id, 'sucursal', (p_apartado->>'producto_id')::bigint,
        left(btrim(p_apartado->>'producto_nombre'), 200), (p_apartado->>'cantidad')::integer,
        greatest(coalesce((p_apartado->>'factor')::integer, 1), 1),
        round((p_apartado->>'precio')::numeric, 2), round((p_apartado->>'precio')::numeric, 2),
        'pendiente', 'sucursal-v3', 0, now(), v_desde, 'pendiente', 'al_retirar')
    RETURNING id INTO v_id;
    v_ids := ARRAY[v_id];
    v_codigo := 'R-' || lpad(v_id::text, 6, '0');
  ELSE
    v_id := public.apartado_crear_reserva(p_branch_id, v_cliente, p_apartado, 0, NULL, v_emp, NULL, true);
    v_ids := ARRAY[v_id];
    v_codigo := 'R-' || lpad(v_id::text, 6, '0');
  END IF;

  UPDATE public.app_reservas SET responsable_id = v_emp, responsable_at = now() WHERE id = ANY (v_ids);
  SELECT min(vence_at), bool_or(estado = 'pendiente') INTO v_vence, v_pend FROM public.app_reservas WHERE id = ANY (v_ids);
  SELECT name, phone INTO c FROM public.customers WHERE id = v_cliente;

  INSERT INTO public.audit_logs (action, target_id, details, branch_id, user_id, source)
  VALUES ('RESERVA_SIN_ANTICIPO', v_codigo,
          jsonb_build_object('reservas', to_jsonb(v_ids), 'total', (v_cot->>'total')::numeric, 'responsable', v_emp,
                             'traslado_desde', v_desde),
          p_branch_id, v_emp, 'ADMIN_PANEL');

  RETURN json_build_object('codigo', v_codigo, 'id', v_ids[1], 'ids', to_json(v_ids), 'pedido', v_pedido,
    'total', (v_cot->>'total')::numeric, 'vence_at', CASE WHEN v_pend THEN NULL ELSE v_vence END,
    'cliente', c.name, 'telefono', c.phone, 'detalle', v_cot->>'detalle', 'traslado_desde', v_desde);
END $function$;

CREATE OR REPLACE FUNCTION public.aplicar_horarios_bitacora(p_branch_id bigint, p_franjas jsonb DEFAULT '[]'::jsonb, p_limpiezas jsonb DEFAULT '[]'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_tocadas integer;
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras_configurar', 'can_edit') THEN
        RAISE EXCEPTION 'Tu cargo no puede configurar las bitacoras.' USING ERRCODE = '42501';
    END IF;
    IF public.auth_module_scope('bitacoras_configurar') <> 'ALL'
       AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
        RAISE EXCEPTION 'Solo puedes configurar tu sucursal.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.bitacora_areas a
       SET franjas = (
               SELECT coalesce(jsonb_agg(
                          CASE WHEN n.clave IS NULL THEN f
                               ELSE f || jsonb_build_object('desde', n.desde, 'hasta', n.hasta) END
                          ORDER BY t.ord), '[]'::jsonb)
                 FROM jsonb_array_elements(a.franjas) WITH ORDINALITY AS t(f, ord)
                 LEFT JOIN LATERAL (
                     SELECT x->>'clave' AS clave, x->>'desde' AS desde, x->>'hasta' AS hasta
                       FROM jsonb_array_elements(coalesce(p_franjas, '[]'::jsonb)) x
                      WHERE x->>'clave' = f->>'clave'
                      LIMIT 1
                 ) n ON true
           ),
           limpiezas = (
               SELECT coalesce(jsonb_agg(
                          CASE WHEN n.clave IS NULL THEN f
                               ELSE f || jsonb_build_object('desde', n.desde, 'hasta', n.hasta) END
                          ORDER BY t.ord), '[]'::jsonb)
                 FROM jsonb_array_elements(a.limpiezas) WITH ORDINALITY AS t(f, ord)
                 LEFT JOIN LATERAL (
                     SELECT x->>'clave' AS clave, x->>'desde' AS desde, x->>'hasta' AS hasta
                       FROM jsonb_array_elements(coalesce(p_limpiezas, '[]'::jsonb)) x
                      WHERE x->>'clave' = f->>'clave'
                      LIMIT 1
                 ) n ON true
           ),
           updated_at = now()
     WHERE a.branch_id = p_branch_id;

    GET DIAGNOSTICS v_tocadas = ROW_COUNT;
    RETURN v_tocadas;
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_encargos_avisar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_dest uuid[]; v_cliente text;
BEGIN
  SELECT array_agg(e.id) INTO v_dest FROM public.employees e
   WHERE e.status = 'ACTIVO' AND (coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = NEW.branch_id OR e.branch_id IN (SELECT id FROM public.branches WHERE type = 'BODEGA'));
  SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = NEW.customer_id;
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'ENCARGO_APP',
      CASE WHEN NEW.producto_nuevo THEN 'Producto que no tenemos · E-'
           WHEN NEW.reserva_id IS NOT NULL THEN 'El resto de una reserva · E-'
           ELSE 'Encargo · E-' END || lpad(NEW.id::text, 6, '0'),
      CASE WHEN NEW.producto_nuevo
        THEN format('%s pide %s × %s, que no está en el catálogo%s. Consulten si se puede conseguir, el precio y para cuándo.',
                    coalesce(v_cliente, 'Un cliente'), NEW.cantidad, NEW.producto_nombre,
                    CASE WHEN NEW.srs IS NULL THEN ' ni en el SRS' ELSE '' END)
        WHEN NEW.reserva_id IS NOT NULL
        THEN format('%s tiene apartado %s × %s y no hay en las sucursales. Confirmen el precio y para cuándo; si es el mismo precio, sigue solo.',
                    coalesce(v_cliente, 'Un cliente'), NEW.cantidad, NEW.producto_nombre)
        ELSE format('%s pide %s × %s. Confirmen si se puede conseguir, el precio y para cuándo.', coalesce(v_cliente, 'Un cliente'), NEW.cantidad, NEW.producto_nombre)
      END,
      '/', jsonb_build_object('encargo', NEW.id, 'check_key', 'encargo_app:' || NEW.id), true, NEW.branch_id::integer);
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.aprobar_meta_gerente(p_id bigint, p_monto numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_row public.metas_sucursal%ROWTYPE;
  v_pendientes integer;
  v_sala text;
  v_cambio boolean := false;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_approve') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere aprobación en Metas';
  END IF;
  SELECT * INTO v_row FROM public.metas_sucursal WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'META_NO_EXISTE'; END IF;
  IF v_row.estado <> 'confirmada_supervisor' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: la meta está en %', v_row.estado;
  END IF;
  IF p_monto IS NOT NULL AND p_monto <= 0 THEN RAISE EXCEPTION 'MONTO_INVALIDO'; END IF;

  v_cambio := p_monto IS NOT NULL AND p_monto <> v_row.monto_base;

  UPDATE public.metas_sucursal
  SET estado      = 'oficial',
      monto_base  = COALESCE(p_monto, monto_base),
      monto_meta  = COALESCE(p_monto, monto_base) + monto_recuperacion,
      gerente_por = public.auth_employee_id(),
      gerente_at  = now()
  WHERE id = p_id;

  PERFORM public.metas_log(p_id,
    CASE WHEN v_cambio THEN 'aprobada_con_ajuste' ELSE 'aprobada' END,
    v_row.estado, 'oficial',
    v_row.monto_base, COALESCE(p_monto, v_row.monto_base), NULL);

  -- El supervisor confirmó un número; si el gerente lo movió, se entera.
  IF v_cambio THEN
    SELECT b.name INTO v_sala FROM public.branches b WHERE b.id = v_row.branch_id;
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_AJUSTADA',
      'El gerente ajustó una meta — ' || COALESCE(v_sala, 'sala'),
      public.metas_mes_label(v_row.year_month) || ': quedó en '
        || to_char(p_monto, 'FM999,999,990.00') || ' en vez de '
        || to_char(v_row.monto_base, 'FM999,999,990.00') || '.');
  END IF;

  SELECT count(*) INTO v_pendientes FROM public.metas_sucursal
  WHERE year_month = v_row.year_month AND estado <> 'oficial';
  IF v_pendientes = 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_APROBADAS',
      'Metas aprobadas',
      'Las metas de ' || public.metas_mes_label(v_row.year_month) || ' quedaron oficiales. Cada sucursal verá la suya.');
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aprobar_meta_por_autorizacion(p_id bigint, p_autorizo uuid, p_nota text DEFAULT NULL::text, p_monto numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_row public.metas_sucursal%ROWTYPE;
  v_yo uuid;
  v_autoriza_nombre text;
  v_yo_nombre text;
  v_pendientes integer;
  v_sala text;
  v_cambio boolean := false;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere edición en Metas';
  END IF;

  v_yo := public.auth_employee_id();
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_EMPLEADO: no se pudo resolver quién registra'; END IF;

  SELECT * INTO v_row FROM public.metas_sucursal WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'META_NO_EXISTE'; END IF;
  IF v_row.estado <> 'confirmada_supervisor' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: la meta está en %', v_row.estado;
  END IF;
  IF p_monto IS NOT NULL AND p_monto <= 0 THEN RAISE EXCEPTION 'MONTO_INVALIDO'; END IF;

  SELECT a.name INTO v_autoriza_nombre FROM public.get_metas_autorizadores() a WHERE a.id = p_autorizo;
  IF v_autoriza_nombre IS NULL THEN
    RAISE EXCEPTION 'AUTORIZANTE_INVALIDO: quien autoriza debe ser un gerente activo';
  END IF;
  IF p_autorizo = v_yo THEN
    RAISE EXCEPTION 'AUTORIZANTE_INVALIDO: no puedes registrarte a ti mismo como quien autoriza';
  END IF;
  IF p_nota IS NULL OR btrim(p_nota) = '' THEN
    RAISE EXCEPTION 'NOTA_REQUERIDA: hay que dejar dicho cómo se dio la autorización';
  END IF;

  v_cambio := p_monto IS NOT NULL AND p_monto <> v_row.monto_base;

  UPDATE public.metas_sucursal
  SET estado          = 'oficial',
      monto_base      = COALESCE(p_monto, monto_base),
      monto_meta      = COALESCE(p_monto, monto_base) + monto_recuperacion,
      gerente_por     = v_yo,
      gerente_at      = now(),
      autorizado_por  = p_autorizo,
      autorizado_nota = btrim(p_nota)
  WHERE id = p_id;

  PERFORM public.metas_log(p_id,
    CASE WHEN v_cambio THEN 'aprobada_por_autorizacion_con_ajuste' ELSE 'aprobada_por_autorizacion' END,
    v_row.estado, 'oficial', v_row.monto_base, COALESCE(p_monto, v_row.monto_base),
    'autorizó ' || v_autoriza_nombre || ' — ' || btrim(p_nota));

  SELECT e.name INTO v_yo_nombre FROM public.employees e WHERE e.id = v_yo;

  PERFORM public.notify_employees(
    ARRAY[p_autorizo], 'METAS_AUTORIZACION_REGISTRADA',
    'Se registró tu autorización',
    COALESCE(v_yo_nombre, 'Un supervisor') || ' dejó oficial la meta de '
      || public.metas_mes_label(v_row.year_month)
      || ' diciendo que tú la autorizaste. Si no fue así, avisa.',
    '/metas?tab=confirmacion');

  IF v_cambio THEN
    SELECT b.name INTO v_sala FROM public.branches b WHERE b.id = v_row.branch_id;
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_AJUSTADA',
      'La meta se ajustó al aprobarla — ' || COALESCE(v_sala, 'sala'),
      public.metas_mes_label(v_row.year_month) || ': quedó en '
        || to_char(p_monto, 'FM999,999,990.00') || ' en vez de '
        || to_char(v_row.monto_base, 'FM999,999,990.00') || '.');
  END IF;

  SELECT count(*) INTO v_pendientes FROM public.metas_sucursal
  WHERE year_month = v_row.year_month AND estado <> 'oficial';
  IF v_pendientes = 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_APROBADAS',
      'Metas aprobadas',
      'Las metas de ' || public.metas_mes_label(v_row.year_month) || ' quedaron oficiales. Cada sucursal verá la suya.');
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.asentar_diferencias_corte(p_ids bigint[], p_ref text, p_abono_ids bigint[] DEFAULT '{}'::bigint[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_ids    bigint[] := coalesce(p_ids, '{}');
    v_abs    bigint[] := coalesce(p_abono_ids, '{}');
    v_signos integer;
    v_salas  integer;
    v_scope  text := (SELECT auth_module_scope('cortes_caja'));
    v_rama   bigint := (SELECT auth_employee_branch_id());
BEGIN
    IF NOT (SELECT auth_has_module_permission('cortes_caja_resolver', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF cardinality(v_ids) = 0 AND cardinality(v_abs) = 0 THEN
        RAISE EXCEPTION 'No hay nada que registrar.';
    END IF;
    IF p_ref IS NULL OR btrim(p_ref) = '' THEN
        RAISE EXCEPTION 'Falta el numero con que quedo el ingreso o el vale.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.id = ANY(v_ids) AND v_scope IS DISTINCT FROM 'ALL'
                  AND d.branch_id IS DISTINCT FROM v_rama)
       OR EXISTS (SELECT 1 FROM public.cortes_caja_diferencia_abonos a
                   WHERE a.id = ANY(v_abs) AND v_scope IS DISTINCT FROM 'ALL'
                     AND a.branch_id IS DISTINCT FROM v_rama) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.id = ANY(v_ids) AND (d.anulada_at IS NOT NULL OR d.asentado_at IS NOT NULL))
       OR EXISTS (SELECT 1 FROM public.cortes_caja_diferencia_abonos a
                   WHERE a.id = ANY(v_abs) AND (a.anulada_at IS NOT NULL OR a.asentado_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'Alguna ya estaba registrada o anulada. Hay que cargar la lista de nuevo.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.id = ANY(v_ids) AND d.via = 'JUSTIFICA') THEN
        RAISE EXCEPTION 'Una diferencia justificada no mueve dinero: no va en el ingreso.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.id = ANY(v_ids) AND d.via = 'REPONE') THEN
        RAISE EXCEPTION 'Un faltante con responsables se registra por sus abonos, no entero.';
    END IF;

    -- Un abono ENTRA (signo -1, como el faltante que repone); un retiro SALE.
    SELECT count(DISTINCT s), count(DISTINCT b) INTO v_signos, v_salas FROM (
        SELECT sign(d.monto) s, d.branch_id b FROM public.cortes_caja_diferencias d WHERE d.id = ANY(v_ids)
        UNION ALL
        SELECT -1, a.branch_id FROM public.cortes_caja_diferencia_abonos a WHERE a.id = ANY(v_abs)
    ) x;

    IF v_signos > 1 THEN
        RAISE EXCEPTION 'No se pueden juntar faltantes y sobrantes: son dos documentos distintos.';
    END IF;
    IF v_salas > 1 THEN
        RAISE EXCEPTION 'No se pueden juntar diferencias de dos sucursales: cada caja lleva su propio movimiento.';
    END IF;

    UPDATE public.cortes_caja_diferencias d SET
        asentado_at = now(), asentado_por = (SELECT auth_employee_id()),
        asentado_ref = btrim(p_ref), updated_at = now()
    WHERE d.id = ANY(v_ids);

    UPDATE public.cortes_caja_diferencia_abonos a SET
        asentado_at = now(), asentado_por = (SELECT auth_employee_id()),
        asentado_ref = btrim(p_ref)
    WHERE a.id = ANY(v_abs);

    INSERT INTO public.cortes_caja_eventos (corte_id, accion, motivo, employee_id)
    SELECT DISTINCT x.corte_id, 'ASENTAR', btrim(p_ref), (SELECT auth_employee_id())
      FROM (SELECT d.corte_id FROM public.cortes_caja_diferencias d WHERE d.id = ANY(v_ids)
            UNION
            SELECT d.corte_id FROM public.cortes_caja_diferencia_abonos a
              JOIN public.cortes_caja_diferencias d ON d.id = a.diferencia_id
             WHERE a.id = ANY(v_abs)) x;

    RETURN json_build_object('diferencias', cardinality(v_ids), 'abonos', cardinality(v_abs));
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_apertura_tardia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_tarde  text := 'APERTURA_TARDE:' || NEW.abierta_el::text || ':' || NEW.branch_id;
  v_sala   text;
  v_quien  text;
  v_estado jsonb;
  v_dest   uuid[];
  v_es_tarde boolean;
  v_titulo text;
BEGIN
  -- Sólo hoy y sólo la sala que el aviso de la mañana acusó.
  IF NEW.abierta_el <> v_hoy OR NEW.abierta_a IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                  WHERE a.clave = 'APERTURA_FALTO:' || NEW.abierta_el::text || ':' || NEW.branch_id
                    AND a.recipient_id IS NULL) THEN
    RETURN NULL;
  END IF;
  -- Una vez por sala y día. La marca va ANTES del aviso: si el sync inserta
  -- dos aperturas de la misma sala en la misma corrida, la segunda la encuentra.
  INSERT INTO public.avisos_emitidos (clave, recipient_id)
  VALUES (v_tarde, NULL)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_dest := public.destinatarios_de_aperturas();
  IF v_dest IS NULL THEN RETURN NULL; END IF;

  SELECT name INTO v_sala FROM public.branches WHERE id = NEW.branch_id;
  SELECT public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name)
    INTO v_quien
    FROM public.caja_aperturas_del_portal pp
    JOIN public.employees e ON e.id = pp.abierta_por
   WHERE pp.branch_id = NEW.branch_id AND pp.erp_apertura_id = NEW.erp_apertura_id
   LIMIT 1;

  -- La tarjeta pinta el estado del día completo: se recalcula con esta fila.
  v_estado := public.aperturas_de_la_manana(NEW.abierta_el);
  v_es_tarde := NEW.abierta_a > time '07:00';

  v_titulo := coalesce(v_sala, 'La sucursal') || ' hizo su apertura a las '
              || public.hora_12(NEW.abierta_a)
              || CASE WHEN v_es_tarde THEN ' (tarde)' ELSE '' END;

  PERFORM public.notify_employees(
    v_dest,
    'APERTURAS_DE_LA_MANANA',
    v_titulo,
    'Esta mañana ' || coalesce(v_sala, 'la sucursal') || ' no había hecho su apertura a la hora del aviso. '
      || 'La hizo a las ' || public.hora_12(NEW.abierta_a)
      || coalesce(' (' || v_quien || ')', ' desde la caja') || '.',
    '/caja?pestana=cortes',
    jsonb_build_object(
      'fecha',         NEW.abierta_el,
      'hora_aviso',    to_char(now() AT TIME ZONE 'America/El_Salvador', 'HH24:MI'),
      'forzado',       false,
      'seguimiento',   true,
      'branch_id',     NEW.branch_id,
      'total',         (v_estado->>'total')::int,
      'abiertas',      (v_estado->>'abiertas')::int,
      'salas',         v_estado->'salas',
      'no_abrieron',   v_estado->'faltan',
      'sin_respuesta', '[]'::jsonb),
    true,
    NULL
  );

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_aperturas_de_la_manana(p_fecha date DEFAULT NULL::date, p_forzado boolean DEFAULT false, p_sin_respuesta integer[] DEFAULT NULL::integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_fecha    date    := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_clave    text    := 'APERTURAS_MANANA:' || v_fecha::text;
  v_estado   jsonb;
  v_hora     text    := to_char(now() AT TIME ZONE 'America/El_Salvador', 'HH24:MI');
  v_abiertas integer;
  v_sin_resp text[];
  v_no_abrio text[];
  v_no_abrio_ids integer[];
  v_asueto   text    := public.asueto_nacional(v_fecha);
  v_lista    text;
  v_primera  text;
  v_ultima   text;
  v_titulo   text;
  v_cuerpo   text;
  v_dest     uuid[];
  v_n        integer;
BEGIN
  -- La marca es global (`recipient_id IS NULL`) y vive en `avisos_emitidos`,
  -- no en la campana: un `NOT EXISTS … FROM notifications` pregunta «¿todavía
  -- la tiene?», así que quien vacía su campana lo recibiría de nuevo.
  IF EXISTS (SELECT 1 FROM public.avisos_emitidos a
              WHERE a.clave = v_clave AND a.recipient_id IS NULL) THEN
    RETURN 0;
  END IF;

  v_estado   := public.aperturas_de_la_manana(v_fecha);
  v_abiertas := (v_estado->>'abiertas')::int;

  -- Lo que no contestó el origen se separa de lo que no abrió: no distinguirlos
  -- convierte un rato de origen caído en seis salas acusadas de no abrir.
  SELECT coalesce(array_agg(x.sala ORDER BY x.sala) FILTER (WHERE     x.muda), '{}'::text[]),
         coalesce(array_agg(x.sala ORDER BY x.sala) FILTER (WHERE NOT x.muda), '{}'::text[]),
         coalesce(array_agg(x.bid  ORDER BY x.sala) FILTER (WHERE NOT x.muda), '{}'::integer[])
    INTO v_sin_resp, v_no_abrio, v_no_abrio_ids
    FROM (SELECT f.value #>> '{}' AS sala,
                 (i.value::text)::int AS bid,
                 (i.value::text)::int = ANY (coalesce(p_sin_respuesta, '{}'::integer[])) AS muda
            FROM jsonb_array_elements(v_estado->'faltan')     WITH ORDINALITY f(value, n)
            JOIN jsonb_array_elements(v_estado->'faltan_ids') WITH ORDINALITY i(value, n)
              ON i.n = f.n) x;

  -- Todavía puede abrir: no es el momento. El cron de la hora tope vuelve con
  -- `p_forzado` y entonces sí sale, diciendo cuáles faltaron.
  IF NOT p_forzado AND (coalesce(array_length(v_no_abrio, 1), 0) > 0 OR coalesce(array_length(v_sin_resp, 1), 0) > 0) THEN
    RETURN 0;
  END IF;

  -- Ni una sala abierta y sin forzar: es demasiado temprano, no es una noticia.
  IF NOT p_forzado AND v_abiertas = 0 THEN
    RETURN 0;
  END IF;

  -- Asueto (2026-11-14): no se acusa a nadie. Si no abrió ninguna, no hay
  -- noticia; si abrió alguna, el aviso lo dice como asueto.
  IF v_asueto IS NOT NULL AND v_abiertas = 0 THEN
    RETURN 0;
  END IF;

  -- La lista: sala, hora y quién. Ya viene ordenada por hora desde el estado,
  -- así que la primera del renglón es la que abrió primero y la última la que
  -- cerró la mañana — que es la que se busca cuando se mira esto.
  SELECT string_agg(
           (s.value->>'sala') || ' ' || public.hora_12((s.value->>'hora')::time) || ' ' ||
           coalesce(s.value->>'quien', 'desde la caja'), ' · ' ORDER BY s.n),
         min(s.value->>'hora'), max(s.value->>'hora')
    INTO v_lista, v_primera, v_ultima
    FROM jsonb_array_elements(v_estado->'salas') WITH ORDINALITY s(value, n);

  IF v_asueto IS NOT NULL AND coalesce(array_length(v_no_abrio, 1), 0) > 0 THEN
    v_titulo := 'Asueto (' || v_asueto || '): ' || v_abiertas || ' de '
                || (v_estado->>'total') || ' sucursales hicieron su apertura de caja';
    v_cuerpo := 'Hoy es asueto, así que no se espera que abran todas. '
             || CASE WHEN coalesce(array_length(v_sin_resp, 1), 0) > 0
                     THEN 'No se pudo comprobar ' || array_to_string(v_sin_resp, ', ') || '. '
                     ELSE '' END
             || 'Abrieron: ' || v_lista;
    -- Nadie quedó acusado: no hay seguimiento de «abrió tarde».
    v_no_abrio := '{}'::text[];
    v_no_abrio_ids := '{}'::integer[];
  ELSE
  /* «apertura» y no «abrieron caja»: es la palabra con la que la pantalla de
   * cajas nombra este acto y con la que el usuario lo busca. Ver el encabezado
   * — el título y el cuerpo son las DOS únicas columnas que mira el buscador
   * de /notificaciones, así que la palabra que no está acá no existe. */
  v_titulo := CASE
    WHEN coalesce(array_length(v_no_abrio, 1), 0) = 1
      THEN '⚠️ ' || v_no_abrio[1] || ' no ha hecho su apertura de caja'
    WHEN coalesce(array_length(v_no_abrio, 1), 0) > 1
      THEN '⚠️ ' || coalesce(array_length(v_no_abrio, 1), 0) || ' sucursales no han hecho su apertura de caja'
    WHEN coalesce(array_length(v_sin_resp, 1), 0) > 0
      THEN '⚠️ No se pudo comprobar la apertura de caja de ' || array_to_string(v_sin_resp, ', ')
    ELSE 'Las ' || v_abiertas || ' sucursales hicieron su apertura de caja'
  END;

  v_cuerpo :=
       CASE WHEN coalesce(array_length(v_no_abrio, 1), 0) = 1
            THEN 'A las ' || public.hora_12(v_hora::time) || ' todavía no abría ' || v_no_abrio[1] || '. '
            WHEN coalesce(array_length(v_no_abrio, 1), 0) > 1
            THEN 'A las ' || public.hora_12(v_hora::time) || ' todavía no abrían ' ||
                 array_to_string(v_no_abrio, ', ') || '. '
            -- Con todas abiertas el cuerpo tiene que decir algo por sí solo:
            -- es lo que se lee donde la tarjeta no se sabe pintar. Y el rango
            -- va sólo con dos o más, porque «entre las 06:53 y las 06:53» es
            -- una frase que se delata sola.
            WHEN v_abiertas >= 2 AND v_primera IS NOT NULL
            -- Sin punto detrás: «7:06 a. m.» ya cierra la frase con el suyo.
            THEN 'La apertura de caja fue entre las ' || public.hora_12(v_primera::time) || ' y las ' || public.hora_12(v_ultima::time) || ' '
            ELSE '' END
    || CASE WHEN coalesce(array_length(v_sin_resp, 1), 0) > 0
            THEN 'No se pudo comprobar ' || array_to_string(v_sin_resp, ', ') || '. '
            ELSE '' END
    || CASE WHEN v_abiertas = 0 THEN 'Ninguna sucursal había hecho su apertura.'
            WHEN coalesce(array_length(v_no_abrio, 1), 0) > 0 OR coalesce(array_length(v_sin_resp, 1), 0) > 0
            THEN 'Abrieron: ' || v_lista
            ELSE v_lista END;
  END IF;

  -- SÓLO Supervisor/a de Ventas: lo pidió en primera persona, y es una
  -- vigilancia de operación, no el informe de gerencia que es el cierre del día.
  v_dest := public.destinatarios_de_aperturas();
  IF v_dest IS NULL THEN RETURN 0; END IF;

  v_n := public.notify_employees(
    v_dest,
    'APERTURAS_DE_LA_MANANA',
    v_titulo,
    v_cuerpo,
    '/caja?pestana=cortes',
    jsonb_build_object(
      'fecha',         v_fecha,
      'hora_aviso',    v_hora,
      'forzado',       p_forzado,
      'total',         (v_estado->>'total')::int,
      'abiertas',      v_abiertas,
      'salas',         v_estado->'salas',
      'no_abrieron',   to_jsonb(v_no_abrio),
      'sin_respuesta', to_jsonb(v_sin_resp),
      'asueto',        v_asueto),
    -- Push SIEMPRE (2026-09-23): «si no entro no me entero». Uno por mañana.
    true,
    NULL
  );

  -- La marca sólo si algo se mandó de verdad. Escribirla igual dejaría el aviso
  -- del día apagado para siempre por una corrida que no llegó a nadie.
  IF coalesce(v_n, 0) > 0 THEN
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    VALUES (v_clave, NULL)
    ON CONFLICT DO NOTHING;

    -- Una marca por sala acusada: es lo que despierta el seguimiento
    -- (`avisar_apertura_tardia`) cuando esa sala abra.
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    SELECT 'APERTURA_FALTO:' || v_fecha::text || ':' || b, NULL
      FROM unnest(v_no_abrio_ids) b
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN coalesce(v_n, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_bolsas_entregadas_sin_recibir()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r   record;
  v_n integer := 0;
BEGIN
  -- Un envío se recibe aceptando sus renglones (no con `erp_recibido`): el
  -- reporte de sala equivocada de una bolsa que ya no está en camino se cierra acá.
  UPDATE public.bolsa_en_sala_equivocada x SET resuelto_at = now()
   WHERE x.resuelto_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.approval_requests a, public._bolsa_por_codigo(
                       coalesce(a.metadata->'erp_traslado'->>'id_traslado', a.metadata->>'codigo_bolsa')) b
                      WHERE a.id = x.request_id AND b.request_id = x.request_id AND b.en_camino);

  FOR r IN
    SELECT rb.id, rb.request_id, rb.codigo, rb.entregada_at, rb.destino_branch_id,
           coalesce(rb.entregada_por, rb.recogida_por) AS entrego,
           bo.name AS origen, bd.name AS destino, e.name AS nentr
      FROM public.ruta_bolsas rb
      LEFT JOIN public.branches bo ON bo.id = rb.origen_branch_id
      LEFT JOIN public.branches bd ON bd.id = rb.destino_branch_id
      LEFT JOIN public.employees e ON e.id = coalesce(rb.entregada_por, rb.recogida_por)
     WHERE rb.entregada_at < now() - interval '24 hours'
       AND rb.entregada_at > now() - interval '30 days'
       AND rb.avisada_sin_recibir_at IS NULL
       AND rb.soltada_at IS NULL
       AND EXISTS (SELECT 1 FROM public._bolsa_por_codigo(rb.codigo) b
                    WHERE b.request_id = rb.request_id AND b.en_camino)
       AND NOT EXISTS (SELECT 1 FROM public.bolsa_en_sala_equivocada x
                        WHERE x.request_id = rb.request_id AND x.resuelto_at IS NULL)
     FOR UPDATE OF rb SKIP LOCKED
  LOOP
    PERFORM public._avisar_bolsa(public._destinatarios_bodega_y(r.entrego),
      'Paquete entregado y sin recibir',
      'El paquete ' || coalesce(r.codigo, '') || ' de ' || coalesce(r.origen, '¿?') || ' para '
        || coalesce(r.destino, '¿?') || ' se entregó'
        || coalesce(' (' || r.nentr || ')', '') || ' el '
        || to_char(r.entregada_at AT TIME ZONE 'America/El_Salvador', 'DD/MM "a las" FMHH12:MI AM')
        || ' y ' || coalesce(r.destino, 'la sucursal') || ' todavía no la recibe.',
      r.request_id, 'ENTREGADA_SIN_RECIBIR', r.destino_branch_id);
    UPDATE public.ruta_bolsas SET avisada_sin_recibir_at = now() WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_cambios_que_no_se_quedaron(p_horas integer DEFAULT 2)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r          record;
    v_dest     uuid[];
    v_titulo   text;
    v_cuerpo   text;
    v_link     text;
    v_esperado text;
    v_actual   text;
    v_que      text;
    v_n        integer := 0;
BEGIN
    FOR r IN
        SELECT ar.id, ar.type, ar.employee_id, ar.approver_id,
               ar.metadata->'erp_aplicado'->>'campo' AS campo,
               ar.metadata->'erp_aplicado'->>'a'     AS aplicado,
               si.correlativo, si.cod_vendedor, si.tipo_pago, si.fecha,
               b.name AS sala
          FROM public.approval_requests ar
          JOIN public.sales_invoices si
            ON si.id = (ar.metadata->>'invoice_id')::bigint
          LEFT JOIN public.branches b ON b.id = si.branch_id
         WHERE ar.status = 'APPROVED'
           AND ar.metadata ? 'erp_aplicado'
           AND ar.metadata->'erp_aplicado'->>'campo' IN ('cod_vendedor', 'tipo_pago')
           AND coalesce((ar.metadata->>'avisado_no_se_quedo')::boolean, false) = false
           AND (ar.metadata->'erp_aplicado'->>'at')::timestamptz
                 < now() - make_interval(hours => greatest(1, p_horas))
           AND (ar.metadata->'erp_aplicado'->>'at')::timestamptz
                 >= now() - interval '10 days'
           AND public.venta_valida(si.estado)
    LOOP
        IF r.campo = 'cod_vendedor' THEN
            CONTINUE WHEN btrim(coalesce(r.aplicado, '')) = '';
            CONTINUE WHEN btrim(coalesce(r.cod_vendedor, '')) = btrim(r.aplicado);
            v_esperado := public.nombre_de_vendedor(r.aplicado);
            v_actual   := public.nombre_de_vendedor(r.cod_vendedor);
            v_que      := 'el vendedor';
        ELSE
            CONTINUE WHEN btrim(coalesce(r.aplicado, '')) = '';
            CONTINUE WHEN lower(btrim(coalesce(r.tipo_pago, ''))) = lower(btrim(r.aplicado));
            v_esperado := public.nombre_de_pago(r.aplicado);
            v_actual   := public.nombre_de_pago(r.tipo_pago);
            v_que      := 'la forma de pago';
        END IF;

        v_dest := (SELECT array_agg(DISTINCT x) FROM unnest(
                     ARRAY[r.approver_id, r.employee_id]) x WHERE x IS NOT NULL);
        v_dest := coalesce(v_dest, ARRAY[]::uuid[]);
        CONTINUE WHEN coalesce(array_length(v_dest, 1), 0) = 0;

        v_titulo := '⚠️ Un cambio de venta no se quedó';
        v_cuerpo := 'La venta ' || coalesce(r.correlativo, 'sin número')
                 || ' de ' || coalesce(r.sala, 'una sucursal')
                 || ' se cambió a ' || v_esperado || ', pero hoy vuelve a decir '
                 || v_actual || '. El cambio de ' || v_que
                 || ' no se quedó: hay que revisarla.';
        v_link := CASE WHEN public.es_solicitud_operativa(r.type)
                       THEN '/solicitudes' ELSE '/solicitudes-personales' END
               || '?solicitud=' || r.id;

        INSERT INTO public.notifications
            (recipient_id, type, title, body, link, metadata, created_by)
        SELECT d, 'REQUEST_DECIDED', v_titulo, v_cuerpo, v_link,
               jsonb_build_object('request_id', r.id, 'request_type', r.type,
                                  'campo', r.campo,
                                  'esperado', r.aplicado,
                                  'en_el_portal', CASE WHEN r.campo = 'cod_vendedor'
                                                       THEN r.cod_vendedor ELSE r.tipo_pago END),
               r.employee_id
          FROM unnest(v_dest) d;

        UPDATE public.approval_requests
           SET metadata = coalesce(metadata, '{}'::jsonb)
                          || jsonb_build_object('avisado_no_se_quedo', true)
         WHERE id = r.id;

        PERFORM net.http_post(
            url     := public.push_function_url(),
            headers := public.push_function_headers(),
            body    := jsonb_build_object('title', v_titulo, 'message', v_cuerpo,
                                          'url', v_link, 'target_type', 'EMPLOYEE',
                                          'target_value', to_jsonb(v_dest)));
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_cuadre_antibioticos(p_hoy date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_mes  text[] := ARRAY['enero','febrero','marzo','abril','mayo','junio','julio',
                           'agosto','septiembre','octubre','noviembre','diciembre'];
    v_n integer := 0; v_k integer;
    v_salas text; v_cuantas integer; v_clave text; v_dest uuid[];
    v_este date := date_trunc('month', p_hoy)::date;
    v_prev date := (date_trunc('month', p_hoy) - interval '1 month')::date;
BEGIN
    -- La marca se escribe sobre los DESTINATARIOS calculados y no sobre el
    -- RETURNING del INSERT: el trigger `avisos_horario` difiere el aviso
    -- (devuelve NULL) si la ventana de la persona no abrió, y entonces el
    -- RETURNING sale vacío, la marca no se escribía y el aviso se repetía cada
    -- mañana (2026-11-14).

    -- Recordatorio del mes en curso.
    IF extract(day FROM p_hoy) >= 20 THEN
        WITH casos AS (
            SELECT b.id AS branch_id, b.name AS sala, ((SELECT e.datos->'legal'->>'regentEmployeeId' FROM public.sucursal_expediente e WHERE e.branch_id = b.id)) AS regente
              FROM public.branches b
             WHERE b.type IN ('FARMACIA', 'BODEGA')
               AND NOT EXISTS (SELECT 1 FROM public.conteos_inventario c
                                WHERE c.branch_id = b.id AND c.scope_type IN ('BAJO_RECETA', 'CICLICO')
                                  AND c.status IN ('FINALIZADO', 'CERRADO')
                                  AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date >= v_este)
        ), destinatarios AS (
            SELECT c.branch_id, e.id AS employee_id FROM casos c
              JOIN public.employees e ON e.branch_id = c.branch_id
             WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
            UNION
            SELECT c.branch_id, e.id FROM casos c JOIN public.employees e ON e.id::text = c.regente
             WHERE e.status = 'ACTIVO'
        ), nuevos AS (
            SELECT d.branch_id, d.employee_id,
                   'CUADRE_ABX:' || d.branch_id || ':' || to_char(v_este, 'YYYY-MM') || ':recordatorio' AS clave
              FROM destinatarios d
             WHERE NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                                WHERE a.recipient_id = d.employee_id
                                  AND a.clave = 'CUADRE_ABX:' || d.branch_id || ':' || to_char(v_este, 'YYYY-MM') || ':recordatorio')
        ), ins AS (
            INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id)
            SELECT n.employee_id, 'CUADRE_ANTIBIOTICOS',
                   c.sala || ': falta el conteo de antibióticos de ' || v_mes[extract(month FROM p_hoy)::int],
                   'Cada mes se cuentan todos los antibióticos y se cuadran contra el sistema. '
                     || CASE WHEN c.sala = 'Bodega' THEN 'En Conteo de inventario, «Nuevo conteo» → «Bajo receta».'
                             ELSE 'Van dentro del conteo cíclico del día 15: terminen ese conteo.' END
                     || ' Hay tiempo hasta fin de mes.',
                   '/conteo-inventario',
                   jsonb_build_object('periodo', to_char(v_este, 'YYYY-MM'), 'sala', c.sala, 'clase', 'recordatorio'),
                   c.branch_id
              FROM nuevos n JOIN casos c ON c.branch_id = n.branch_id
            RETURNING 1
        ), marca AS (
            INSERT INTO public.avisos_emitidos (clave, recipient_id)
            SELECT n.clave, n.employee_id FROM nuevos n
            ON CONFLICT DO NOTHING RETURNING 1
        )
        SELECT count(*) INTO v_k FROM nuevos;
        v_n := v_n + v_k;
    END IF;

    -- El mes anterior que quedó sin conteo: a la gente de cada sala, una vez.
    WITH casos AS (
        SELECT b.id AS branch_id, b.name AS sala, ((SELECT e.datos->'legal'->>'regentEmployeeId' FROM public.sucursal_expediente e WHERE e.branch_id = b.id)) AS regente
          FROM public.branches b
         WHERE b.type IN ('FARMACIA', 'BODEGA')
           AND NOT EXISTS (SELECT 1 FROM public.conteos_inventario c
                            WHERE c.branch_id = b.id AND c.scope_type IN ('BAJO_RECETA', 'CICLICO')
                              AND c.status IN ('FINALIZADO', 'CERRADO')
                              AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date >= v_prev
                              AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date < v_este)
    ), destinatarios AS (
        SELECT c.branch_id, e.id AS employee_id FROM casos c
          JOIN public.employees e ON e.branch_id = c.branch_id
         WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
        UNION
        SELECT c.branch_id, e.id FROM casos c JOIN public.employees e ON e.id::text = c.regente
         WHERE e.status = 'ACTIVO'
    ), nuevos AS (
        SELECT d.branch_id, d.employee_id,
               'CUADRE_ABX:' || d.branch_id || ':' || to_char(v_prev, 'YYYY-MM') || ':vencido' AS clave
          FROM destinatarios d
         WHERE NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                            WHERE a.recipient_id = d.employee_id
                              AND a.clave = 'CUADRE_ABX:' || d.branch_id || ':' || to_char(v_prev, 'YYYY-MM') || ':vencido')
    ), ins AS (
        INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id)
        SELECT n.employee_id, 'CUADRE_ANTIBIOTICOS',
               c.sala || ': ' || v_mes[extract(month FROM v_prev)::int] || ' quedó sin conteo de antibióticos',
               'No se terminó el conteo de antibióticos de ' || v_mes[extract(month FROM v_prev)::int]
                 || '. La existencia de antibióticos de ese mes no quedó cuadrada contra el sistema.',
               '/bitacoras',
               jsonb_build_object('periodo', to_char(v_prev, 'YYYY-MM'), 'sala', c.sala, 'clase', 'vencido'),
               c.branch_id
          FROM nuevos n JOIN casos c ON c.branch_id = n.branch_id
        RETURNING 1
    ), marca AS (
        INSERT INTO public.avisos_emitidos (clave, recipient_id)
        SELECT n.clave, n.employee_id FROM nuevos n
        ON CONFLICT DO NOTHING RETURNING 1
    )
    SELECT count(*) INTO v_k FROM nuevos;
    v_n := v_n + v_k;

    -- Supervisión: UN renglón con todas las salas sin conteo, al resumen de la
    -- mañana. Sólo cuando el conjunto de salas cambia, o una vez por semana.
    SELECT string_agg(b.name, ', ' ORDER BY b.name), count(*) INTO v_salas, v_cuantas
      FROM public.branches b
     WHERE b.type IN ('FARMACIA', 'BODEGA')
       AND NOT EXISTS (SELECT 1 FROM public.conteos_inventario c
                        WHERE c.branch_id = b.id AND c.scope_type IN ('BAJO_RECETA', 'CICLICO')
                          AND c.status IN ('FINALIZADO', 'CERRADO')
                          AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date >= v_prev
                          AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date < v_este);
    v_clave := 'CUADRE_ABX:supervision:' || to_char(v_prev, 'YYYY-MM');
    v_k := 0;
    IF coalesce(v_cuantas, 0) = 0 THEN
        PERFORM public.aviso_valor_olvidar(v_clave);
    ELSE
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
           AND 13 = ANY (public.roles_efectivos_de(e.id));
        IF coalesce(cardinality(v_dest), 0) > 0 AND public.aviso_cambio_o_semanal(v_clave, v_salas) THEN
            v_k := public.resumen_manana_agregar(
                v_dest, 'antibioticos', 30, 'CUADRE_ANTIBIOTICOS',
                CASE WHEN v_cuantas = 1
                     THEN v_salas || ': ' || v_mes[extract(month FROM v_prev)::int] || ' quedó sin conteo de antibióticos'
                     ELSE v_cuantas || ' sucursales quedaron sin conteo de antibióticos de ' || v_mes[extract(month FROM v_prev)::int] END,
                'Sin conteo: ' || v_salas || '. La existencia de antibióticos de ese mes no quedó cuadrada contra el sistema.',
                '/bitacoras',
                jsonb_build_object('periodo', to_char(v_prev, 'YYYY-MM'), 'salas', v_salas, 'clase', 'vencido_resumen'),
                false);
        END IF;
    END IF;
    RETURN v_n + v_k;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_dias_sin_cierre(p_fecha date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dow  text[] := ARRAY['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  v_mes  text[] := ARRAY['enero','febrero','marzo','abril','mayo','junio','julio',
                         'agosto','septiembre','octubre','noviembre','diciembre'];
  v_fecha_texto text := v_dow[EXTRACT(dow FROM p_fecha)::int + 1] || ' '
                        || EXTRACT(day FROM p_fecha)::int || ' de '
                        || v_mes[EXTRACT(month FROM p_fecha)::int];
  v_n integer;
BEGIN
  WITH salas AS (
    SELECT DISTINCT a.branch_id FROM public.cortes_caja_aperturas a WHERE a.abierta_el = p_fecha
  ),
  casos AS (
    SELECT s.branch_id, b.name AS sala, ca.resultado, ca.motivo, ca.falta,
           ca.corte_hora, (ca.detalle->>'z_hora') AS z_hora
      FROM salas s
      JOIN public.branches b ON b.id = s.branch_id
      LEFT JOIN public.caja_cierres_automaticos ca
             ON ca.branch_id = s.branch_id AND ca.fecha = p_fecha
     WHERE ca.resultado = 'cerrado'
        OR NOT EXISTS (SELECT 1 FROM public.cortes_caja c
                        WHERE c.branch_id = s.branch_id AND c.fecha = p_fecha AND c.tipo = 'Z')
  ),
  destinatarios AS (
    -- La gente de la sala…
    SELECT c.branch_id, e.id AS employee_id
      FROM casos c
      JOIN public.employees e ON e.branch_id = c.branch_id
     WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
    UNION
    -- …y supervisión, por cargo y no por lista de ids.
    SELECT c.branch_id, e.id
      FROM casos c
      CROSS JOIN public.employees e
      JOIN public.roles r ON r.name IN ('Gerente General', 'Supervisor/a de Ventas')
     WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
       AND e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
  ),
  ins AS (
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id)
    SELECT d.employee_id,
           'DIA_SIN_CIERRE',
           CASE WHEN c.resultado = 'cerrado'
                THEN c.sala || ': el portal cerró el día solo'
                ELSE c.sala || ': el día quedó sin cierre' END,
           'Nadie hizo el cierre del día del ' || v_fecha_texto || '. '
             || CASE WHEN c.resultado = 'cerrado'
                     THEN 'El portal lo hizo solo'
                          || coalesce(' a las ' || CASE WHEN c.z_hora ~ '^\d{1,2}:\d{2}' THEN public.hora_12(c.z_hora::time) ELSE c.z_hora END, '')
                          || coalesce(', con el corte de las ' || public.hora_12(c.corte_hora)
                                      || ' como último conteo', '')
                          || '. La próxima vez, cierren el día antes de irse.'
                     ELSE 'El portal no pudo hacerlo solo porque '
                          || CASE c.motivo
                               WHEN 'sin_corte_al_cierre'
                                 THEN 'no hubo un corte de caja cerca de la hora de cierre'
                               WHEN 'efectivo_sin_contar'
                                 THEN 'entraron $' || to_char(c.falta, 'FM999,990.00')
                                      || ' después del último corte y nadie los contó'
                               WHEN 'preventas_sin_finalizar'
                                 THEN 'quedaron preventas guardadas sin finalizar'
                               WHEN 'turno_parado' THEN 'el turno estaba cerrado'
                               ELSE 'no se pudo comprobar la caja' END
                          || '. Avisa a un supervisor o administrador.' END,
           '/cortes',
           jsonb_build_object('fecha', p_fecha, 'fecha_texto', v_fecha_texto,
                              'sala', c.sala, 'resultado', coalesce(c.resultado, 'no_cerrado'),
                              'motivo', c.motivo),
           c.branch_id
      FROM destinatarios d
      JOIN casos c ON c.branch_id = d.branch_id
     WHERE NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                        WHERE a.recipient_id = d.employee_id
                          AND a.clave = 'DIA_SIN_CIERRE:' || c.branch_id || ':' || p_fecha)
    RETURNING recipient_id, branch_id
  ),
  marca AS (
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    SELECT 'DIA_SIN_CIERRE:' || i.branch_id || ':' || p_fecha, i.recipient_id FROM ins i
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  RETURN v_n;
END $function$;

CREATE OR REPLACE FUNCTION public.avisar_diferencias_vencidas()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_bodega  integer;
    v_avisos  integer := 0;
    v_items   integer := 0;
    r         record;
    v_dest    uuid[];
    v_titulo  text;
    v_cuerpo  text;
    v_dias    integer;
BEGIN
    SELECT m.branch_id INTO v_bodega FROM public.erp_sucursal_map m WHERE m.es_bodega;

    FOR r IN
        SELECT pi.id, pi.pedido_id, pi.erp_sucursal_id, pi.resolucion_vence_at,
               pi.error_tipo, pi.resolucion_tipo,
               o.cierra_con, o.rotulo,
               p.numero      AS pedido_numero,
               pr.nombre     AS producto,
               m.nombre      AS sala,
               m.branch_id   AS sala_branch
          FROM public.pedido_items pi
          JOIN public.diferencia_opcion o
            ON o.error_tipo = pi.error_tipo AND o.valor = pi.resolucion_tipo
          LEFT JOIN public.pedidos p          ON p.id = pi.pedido_id
          LEFT JOIN public.products pr        ON pr.id = pi.erp_product_id
          LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = pi.erp_sucursal_id
         WHERE pi.resolucion_status = 'acordada'
           AND pi.resolucion_vence_at IS NOT NULL
           AND pi.resolucion_vence_at < now()
           AND o.cierra_con IN ('llegada_sala', 'llegada_bodega')
           -- Ya se avisó de este renglón en las últimas 20 horas.
           AND NOT EXISTS (
                SELECT 1 FROM public.notifications n
                 WHERE n.type = 'PEDIDO_DIFERENCIA_VENCIDA'
                   AND n.created_at > now() - interval '20 hours'
                   AND (n.metadata->>'pedido_item_id')::bigint = pi.id)
    LOOP
        v_items := v_items + 1;
        v_dias  := greatest(1, (now()::date - r.resolucion_vence_at::date));

        -- El que DEBE el movimiento. La sala espera en el faltante; bodega
        -- espera en el sobrante.
        IF r.cierra_con = 'llegada_sala' THEN
            v_titulo := 'Un producto que bodega quedó de mandar';
            v_cuerpo := coalesce(r.producto, 'Un producto') || ' del pedido #'
                     || coalesce(r.pedido_numero::text, '?') || ' para '
                     || coalesce(r.sala, 'una sucursal') || ' — acordado «'
                     || coalesce(r.rotulo, '—') || '» y sin llegar hace '
                     || v_dias || ' día' || CASE WHEN v_dias = 1 THEN '' ELSE 's' END || '.';
            SELECT array_agg(e.id) INTO v_dest FROM public.employees e
             WHERE e.status = 'ACTIVO' AND coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = v_bodega
               AND coalesce(e.tipo_ficha, 'empleado') = 'empleado';
        ELSE
            v_titulo := 'Un producto que la sucursal quedó de devolver';
            v_cuerpo := coalesce(r.producto, 'Un producto') || ' del pedido #'
                     || coalesce(r.pedido_numero::text, '?') || ' — '
                     || coalesce(r.sala, 'una sucursal') || ' acordó «'
                     || coalesce(r.rotulo, '—') || '» y no ha vuelto hace '
                     || v_dias || ' día' || CASE WHEN v_dias = 1 THEN '' ELSE 's' END || '.';
            SELECT array_agg(e.id) INTO v_dest FROM public.employees e
             WHERE e.status = 'ACTIVO' AND coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = r.sala_branch
               AND coalesce(e.tipo_ficha, 'empleado') = 'empleado';
        END IF;

        -- Y supervisión siempre: es quien puede destrabarlo cuando el lado que
        -- debe no responde, que es exactamente el caso que llegó hasta acá.
        SELECT coalesce(v_dest, '{}'::uuid[]) || coalesce(array_agg(e.id), '{}'::uuid[])
          INTO v_dest
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
           AND public.rango_de_empleado(e.id) >= 3;

        IF coalesce(array_length(v_dest, 1), 0) = 0 THEN
            CONTINUE;
        END IF;

        INSERT INTO public.notifications
            (recipient_id, type, title, body, link, metadata, branch_id)
        SELECT DISTINCT d, 'PEDIDO_DIFERENCIA_VENCIDA', v_titulo, v_cuerpo, '/pedidos',
               jsonb_build_object('pedido_id', r.pedido_id, 'pedido_item_id', r.id,
                                  'erp_sucursal_id', r.erp_sucursal_id,
                                  'vencio_at', r.resolucion_vence_at, 'dias', v_dias),
               r.sala_branch
          FROM unnest(v_dest) d;

        v_avisos := v_avisos + coalesce(array_length(v_dest, 1), 0);
    END LOOP;

    RETURN jsonb_build_object('renglones', v_items, 'avisos', v_avisos);
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_envios_sin_decidir(p_dias integer DEFAULT 2)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r        record;
    v_dest   uuid[];
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dias   integer;
    v_n      integer := 0;
BEGIN
    FOR r IN
        SELECT ar.id, ar.metadata, ar.employee_id,
               floor(extract(epoch FROM now() - ar.created_at) / 86400)::integer AS dias,
               (SELECT count(*) FROM public.envio_linea l
                 WHERE l.request_id = ar.id AND l.estado = 'enviada') AS esperando
          FROM public.approval_requests ar
         WHERE ar.type = 'INVENTORY_TRANSFER_PUSH'
           AND ar.status = 'PENDING'
           AND ar.created_at < now() - make_interval(days => greatest(1, p_dias))
    LOOP
        CONTINUE WHEN r.esperando = 0;   -- no hay nada esperando decisión
        -- Un escalón por umbral cruzado: se avisa al pasar 2 días y otra vez al
        -- pasar 5. Guardar el número evita repetirlo en cada corrida.
        v_dias := CASE WHEN r.dias >= 5 THEN 5 ELSE p_dias END;
        CONTINUE WHEN coalesce((r.metadata->>'avisado_sin_decidir')::integer, 0) >= v_dias;

        SELECT coalesce(
                 (SELECT array_agg((d)::uuid) FROM jsonb_array_elements_text(r.metadata->'destinatarios') d),
                 ARRAY[]::uuid[]) INTO v_dest;
        v_dest := (SELECT array_agg(DISTINCT x) FROM unnest(v_dest) x
                    WHERE x IS NOT NULL AND x <> r.employee_id);
        CONTINUE WHEN coalesce(array_length(v_dest, 1), 0) = 0;

        v_titulo := '⏳ Hay producto esperando tu respuesta';
        v_cuerpo := coalesce(nullif(r.metadata->>'origen_branch_name',''), 'Otra sucursal')
                 || ' te envió ' || r.esperando
                 || CASE WHEN r.esperando = 1 THEN ' producto' ELSE ' productos' END
                 || ' hace ' || r.dias || CASE WHEN r.dias = 1 THEN ' día' ELSE ' días' END
                 || ' y todavía no lo contestaste. Mientras tanto no está en ninguna de las dos sucursales: '
                 || 'no se puede vender ni en la tuya ni en la de ellos.';
        v_link := '/traslados?tab=envios&envio=' || r.id;

        INSERT INTO public.notifications
            (recipient_id, type, title, body, link, metadata, branch_id, created_by)
        SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
               jsonb_build_object('request_id', r.id, 'request_type', 'INVENTORY_TRANSFER_PUSH',
                                  'recordatorio', v_dias),
               nullif(r.metadata->>'branch_id','')::integer, r.employee_id
          FROM unnest(v_dest) d;

        UPDATE public.approval_requests
           SET metadata = coalesce(metadata, '{}'::jsonb)
                          || jsonb_build_object('avisado_sin_decidir', v_dias)
         WHERE id = r.id;

        PERFORM net.http_post(
            url := public.push_function_url(), headers := public.push_function_headers(),
            body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                    'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_facturas_de_sala()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sala     record;
  v_destinos uuid[];
  v_n        integer;
  v_titulo   text;
  v_cuerpo   text;
  v_total    integer := 0;
BEGIN
  FOR v_sala IN
    WITH nuevas AS (
      -- `DISTINCT ON (d.id)`: si dos reglas por línea llegaran a casar con el
      -- mismo documento, avisarlo dos veces sería avisar de más — y la marca
      -- es por documento, no por regla.
      SELECT DISTINCT ON (d.id)
             d.id, d.monto_total, d.fecha_emision, r.etiqueta, l.branch_id
        FROM public.purchase_dte_documents d
        JOIN public.purchase_claim_rules r
          ON r.activo AND r.asignacion = 'linea'
         AND (r.emisor_nit  IS NULL OR d.emisor_nit = r.emisor_nit)
         AND (r.item_patron IS NULL OR d.items_norm ILIKE '%' || r.item_patron || '%')
        JOIN public.purchase_claim_lines l
          ON l.rule_id = r.id
         AND l.linea   = public.linea_telefonica_de(d.items_text)
       WHERE NOT d.invalidado
         -- Ventana corta: la marca evita repetir, pero sin ventana el PRIMER
         -- barrido avisaría toda la historia de una vez.
         AND d.created_at >= now() - interval '7 days'
         -- Si alguien ya la tomó, no hay nada que avisar.
         AND NOT EXISTS (SELECT 1 FROM public.purchase_dte_claims c
                          WHERE c.document_id = d.id AND c.released_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.purchase_claim_avisos a
                          WHERE a.document_id = d.id)
       ORDER BY d.id, r.orden, r.id
    )
    -- Agrupado por sala: dos facturas el mismo día son UN aviso, no dos pings.
    SELECT n.branch_id,
           (SELECT b.name FROM public.branches b WHERE b.id = n.branch_id) AS sala,
           count(*)            AS cuantas,
           sum(monto_total)    AS total,
           -- Cada factura, para la tarjeta (24-sep): qué, de qué fecha y cuánto.
           jsonb_agg(jsonb_build_object('etiqueta', etiqueta, 'monto', monto_total,
                                        'fecha', fecha_emision) ORDER BY fecha_emision DESC) AS lista,
           -- El cuerpo agrupa las iguales: «2 × Recarga Movistar · $199.98», y
           -- no la misma línea repetida.
           (SELECT string_agg(CASE WHEN g.n > 1 THEN g.n || ' × ' ELSE '' END
                              || g.etiqueta || ' · $' || to_char(g.monto, 'FM999,999,990.00'), '  ·  ')
              FROM (SELECT x.etiqueta, count(*) AS n, sum(x.monto_total) AS monto
                      FROM nuevas x WHERE x.branch_id = n.branch_id GROUP BY x.etiqueta) g) AS agrupado,
           array_agg(id)       AS ids,
           string_agg(etiqueta || ' · $' || to_char(monto_total, 'FM999999990.00'),
                      '  ·  ' ORDER BY fecha_emision DESC) AS detalle
      FROM nuevas n
     GROUP BY n.branch_id
  LOOP
    SELECT array_agg(t.employee_id) INTO v_destinos
      FROM public.empleados_en_turno(v_sala.branch_id::integer) t;

    v_titulo := coalesce(v_sala.sala || ' · ', '')
             || CASE WHEN v_sala.cuantas = 1
                     THEN 'Llegó una factura para cargar'
                     ELSE v_sala.cuantas || ' facturas llegaron para cargar' END;
    v_cuerpo := v_sala.agrupado || '. Tómala desde el tablero.';

    IF v_destinos IS NULL THEN
      -- Nadie en turno (feriado, antes de abrir, roster sin publicar). Va a la
      -- sala entera: un aviso que no le llega a nadie es peor que no mandarlo.
      v_n := public.notify_branch(
        v_sala.branch_id::integer, 'FACTURA_SALA', v_titulo, v_cuerpo, '/home',
        jsonb_build_object('document_ids', v_sala.ids, 'en_turno', false,
                           'sala', v_sala.sala, 'total', v_sala.total, 'lista', v_sala.lista), true);
    ELSE
      v_n := public.notify_employees(
        v_destinos, 'FACTURA_SALA', v_titulo, v_cuerpo, '/home',
        jsonb_build_object('document_ids', v_sala.ids, 'en_turno', true,
                           'sala', v_sala.sala, 'total', v_sala.total, 'lista', v_sala.lista), true,
        v_sala.branch_id::integer);
    END IF;

    -- La marca se escribe SIEMPRE, aunque no le haya llegado a nadie: si no,
    -- una sala sin personal activo haría reintentar el mismo aviso cada día
    -- para siempre. Cuántos lo recibieron queda guardado, que es lo que permite
    -- notar el caso en vez de suponerlo.
    INSERT INTO public.purchase_claim_avisos (document_id, branch_id, destinatarios)
    SELECT t.id, v_sala.branch_id, COALESCE(v_n, 0)
      FROM unnest(v_sala.ids) AS t(id)
    ON CONFLICT (document_id) DO NOTHING;

    v_total := v_total + COALESCE(v_n, 0);
  END LOOP;

  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_falla_del_consejo(p_detalle text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dest uuid[];
    v_yo   uuid := public.auth_employee_id();
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras', 'can_edit') THEN
        RETURN false;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.type = 'CSSP_CAIDO'
           AND n.created_at >= now() - interval '1 hour'
    ) THEN
        RETURN false;
    END IF;

    SELECT array_agg(id) INTO v_dest
      FROM public.employees
     WHERE username = 'edwin.nunez' AND status = 'ACTIVO';

    IF v_dest IS NULL THEN RETURN false; END IF;

    PERFORM public.notify_employees(
        v_dest,
        'CSSP_CAIDO',
        'El registro del Consejo no responde',
        coalesce(nullif(btrim(p_detalle), ''),
                 'La consulta de profesionales del CSSP falló. Mientras no responda, la sucursal no puede '
                 || 'completar folios del libro bajo receta. El médico solo se puede tomar del registro.'),
        '/bitacoras',
        jsonb_build_object('reportado_por', v_yo),
        true,
        NULL
    );
    RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_faltante_resuelto(p_id uuid, p_actor uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    bf       public.bolsa_faltante%ROWTYPE;
    m        jsonb;
    v_dest   uuid[];
    v_quien  text;
    v_resp   text;
    v_prod   text;
    v_sala   text;
    v_sala_quien text;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
BEGIN
    SELECT * INTO bf FROM public.bolsa_faltante WHERE id = p_id;
    IF bf.id IS NULL OR bf.estado = 'abierto' THEN RETURN 0; END IF;
    SELECT coalesce(metadata, '{}'::jsonb) INTO m FROM public.approval_requests WHERE id = bf.request_id;

    IF bf.estado = 'aparecio' AND bf.familia = 'envio' THEN
        SELECT array_agg(e.id) INTO v_dest
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND public.rango_de_empleado(e.id) >= 3
           AND public.puede_confirmar_traslado(e.id)
           AND e.id <> p_actor;
    ELSE
        v_dest := public.destinatarios_de_faltante(bf.origen_branch_id, p_actor);
        IF bf.estado = 'no_aparecio' THEN
            SELECT array_agg(DISTINCT x) INTO v_dest
              FROM unnest(coalesce(v_dest, ARRAY[]::uuid[])
                          || coalesce((SELECT destinatarios FROM public.resolver_destinatarios_traslado(bf.destino_branch_id) LIMIT 1),
                                      ARRAY[]::uuid[])) x
             WHERE x IS NOT NULL AND x <> p_actor;
        END IF;
    END IF;

    -- El «faltó» que se avisó, apagado con su desenlace (la campana lo pinta).
    UPDATE public.notifications
       SET metadata = coalesce(metadata, '{}'::jsonb)
                      || jsonb_build_object('resuelta', CASE bf.estado WHEN 'aparecio' THEN 'APARECIO' ELSE 'NO_APARECIO' END),
           read_at  = coalesce(read_at, now())
     WHERE type = 'REQUEST_PENDING'
       AND metadata->>'request_id' = bf.request_id::text
       AND metadata->'faltantes' ? bf.id::text;

    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;
    -- Una sola vez por faltante: un reintento de «apareció» vuelve a pasar por acá.
    IF EXISTS (SELECT 1 FROM public.notifications
                WHERE type = 'REQUEST_RESOLVED' AND metadata->>'faltante_id' = bf.id::text) THEN
        RETURN 0;
    END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = p_actor;
    v_quien := coalesce(v_quien, 'Alguien');
    v_prod  := coalesce(bf.descripcion, 'el producto #' || bf.erp_product_id);
    SELECT name INTO v_sala FROM public.branches WHERE id = bf.destino_branch_id;
    v_sala  := coalesce(v_sala, 'la sucursal que recibió');

    IF bf.estado = 'aparecio' THEN
        -- La sala de QUIEN lo encontró: puede ser la que envió.
        SELECT coalesce(b.name, v_sala) INTO v_sala_quien
          FROM public.employees e LEFT JOIN public.branches b ON b.id = e.branch_id WHERE e.id = p_actor;
        v_titulo := 'Apareció lo que faltaba de un traslado';
        v_cuerpo := v_quien || ' (' || coalesce(v_sala_quien, v_sala) || ') encontró ' || v_prod
                 || ', que se había declarado como faltante. Ya no hay que buscarlo.';
    ELSE
        v_resp := CASE bf.responsable
            WHEN 'origen'  THEN coalesce((SELECT name FROM public.branches WHERE id = bf.origen_branch_id), 'la sucursal que envió')
            WHEN 'destino' THEN v_sala
            WHEN 'persona' THEN coalesce((SELECT name FROM public.employees WHERE id = bf.responsable_employee_id), 'una persona')
            ELSE 'sin asignar' END;
        v_titulo := 'Faltante de traslado cerrado: no apareció';
        v_cuerpo := v_quien || ' cerró como no aparecido ' || trim(to_char(bf.cantidad, 'FM999999990.##')) || ' de ' || v_prod
                 || '. Queda a cargo de ' || v_resp || ', y se descontó del inventario de ' || v_sala || '.';
    END IF;
    v_link := '/traslados?tab=faltantes&bolsa=' || bf.request_id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', bf.request_id, 'faltante_id', bf.id,
                              'resuelta', CASE bf.estado WHEN 'aparecio' THEN 'APARECIO' ELSE 'NO_APARECIO' END),
           bf.destino_branch_id, p_actor
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                                      'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)));

    RETURN array_length(v_dest, 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_faltantes(p_request_id uuid, p_ids uuid[], p_actor uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r        public.approval_requests%ROWTYPE;
    m        jsonb;
    v_n      integer;
    v_que    text;
    v_quien  text;
    v_sala   text;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
BEGIN
    SELECT * INTO r FROM public.approval_requests WHERE id = p_request_id;
    IF r.id IS NULL THEN RETURN 0; END IF;
    m := coalesce(r.metadata, '{}'::jsonb);

    SELECT count(*),
           CASE WHEN count(*) = 1
                THEN max(coalesce(bf.descripcion, 'el producto #' || bf.erp_product_id))
                ELSE NULL END
      INTO v_n, v_que
      FROM public.bolsa_faltante bf
     WHERE bf.id = ANY(p_ids);
    IF coalesce(v_n, 0) = 0 THEN RETURN 0; END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = p_actor;
    v_quien := coalesce(v_quien, 'La sucursal que recibió');
    v_sala  := coalesce(nullif(m->>'branch_name', ''), 'la otra sucursal');

    -- Sólo la sala que despachó: es la única que puede ir a buscarlo. Supervisión
    -- se entera por el recordatorio (`avisar_faltantes_sin_resolver`), cuando el
    -- faltante ya lleva un día abierto — decisión del usuario del 2026-09-25.
    SELECT array_agg(DISTINCT x) INTO v_dest
      FROM unnest((SELECT destinatarios
                     FROM public.resolver_destinatarios_traslado(
                              nullif(m->>'origen_branch_id','')::integer) LIMIT 1)) x
     WHERE x IS NOT NULL AND x <> p_actor;
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;

    v_titulo := CASE WHEN v_n = 1 THEN '⚠️ Faltó un producto en un traslado'
                     ELSE '⚠️ Faltaron productos en un traslado' END;
    v_cuerpo := v_quien || ' (' || v_sala || ') recibió el traslado que mandó '
             || coalesce(nullif(m->>'origen_branch_name',''), 'tu sucursal')
             || CASE WHEN v_n = 1 THEN ' y no venía ' ELSE ' y no venían ' END
             || coalesce(v_que, v_n || ' productos')
             || '. Revisa si quedó en tu sucursal y responde en Traslados.';

    v_link := '/traslados?tab=faltantes&bolsa=' || r.id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', r.id, 'request_type', r.type, 'faltantes', to_jsonb(p_ids)),
           -- La sala de quien firma, no la de origen: la tarjeta la pinta al lado
           -- de su nombre.
           coalesce(nullif(m->>'branch_id','')::integer,
                    nullif(m->>'origen_branch_id','')::integer),
           p_actor
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                                      'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)));

    RETURN coalesce(array_length(v_dest, 1), 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_faltantes_sin_resolver(p_dias integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r        record;
    v_dest   uuid[];
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dias   integer;
    v_n      integer := 0;
BEGIN
    FOR r IN
        SELECT bf.id, bf.request_id, bf.descripcion, bf.erp_product_id, bf.cantidad,
               bf.origen_branch_id, bf.recordado_dias,
               bo.name AS origen, bd.name AS destino,
               floor(extract(epoch FROM now() - bf.declarado_at) / 86400)::integer AS dias
          FROM public.bolsa_faltante bf
          LEFT JOIN public.branches bo ON bo.id = bf.origen_branch_id
          LEFT JOIN public.branches bd ON bd.id = bf.destino_branch_id
         WHERE bf.estado = 'abierto'
           AND bf.declarado_at < now() - make_interval(days => greatest(1, p_dias))
    LOOP
        v_dias := CASE WHEN r.dias >= 3 THEN 3 ELSE p_dias END;
        CONTINUE WHEN coalesce(r.recordado_dias, 0) >= v_dias;

        v_dest := public.destinatarios_de_faltante(r.origen_branch_id, NULL);
        CONTINUE WHEN coalesce(array_length(v_dest, 1), 0) = 0;

        v_titulo := '⚠️ Un faltante lleva ' || r.dias
                 || CASE WHEN r.dias = 1 THEN ' día sin resolver' ELSE ' días sin resolver' END;
        -- Se nombra el PRODUCTO y el recorrido, no el número del traslado: quien
        -- lo lee tiene que saber qué ir a buscar, que es lo único accionable.
        v_cuerpo := coalesce(r.descripcion, 'El producto #' || r.erp_product_id)
                 || ' — faltaron ' || trim(to_char(r.cantidad, 'FM999,999,990.####'))
                 || ' en el traslado de ' || coalesce(r.origen, 'una sucursal')
                 || ' a ' || coalesce(r.destino, 'otra sucursal')
                 || '. Si apareció, ciérralo; si no, di qué se hizo.';
        v_link := '/traslados?tab=faltantes&bolsa=' || r.request_id;

        -- Se anota ANTES de mandar: `pg_net` es transaccional, así que si algo de
        -- acá para abajo revienta, la anotación se va con él y el recordatorio se
        -- puede volver a intentar mañana.
        UPDATE public.bolsa_faltante SET recordado_dias = v_dias WHERE id = r.id;

        INSERT INTO public.notifications
            (recipient_id, type, title, body, link, metadata, branch_id, created_by)
        SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
               jsonb_build_object('request_id', r.request_id, 'faltante_id', r.id,
                                  'recordatorio', v_dias),
               r.origen_branch_id, NULL
          FROM unnest(v_dest) d;

        PERFORM net.http_post(
            url := public.push_function_url(), headers := public.push_function_headers(),
            body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                    'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_lotes_del_libro_atrasados()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dest uuid[] := public.libro_lote_regentes();
    v_ids bigint[];
    v_n integer;
    v_salas text;
BEGIN
    SELECT array_agg(r.id), count(*), string_agg(DISTINCT b.name, ', ')
      INTO v_ids, v_n, v_salas
      FROM public.libro_lote_revisiones r JOIN public.branches b ON b.id = r.branch_id
     WHERE r.estado IN ('pendiente', 'devuelta') AND r.escalada_at IS NULL
       AND coalesce(r.corregida_at, r.created_at) < now() - interval '3 days';
    IF coalesce(v_n, 0) = 0 OR coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;

    PERFORM public.notify_employees(
        v_dest, 'LIBRO_LOTE_ATRASADO',
        v_n || CASE WHEN v_n = 1 THEN ' lote del libro lleva' ELSE ' lotes del libro llevan' END
            || ' más de 3 días sin corregir',
        'Sucursales: ' || v_salas || '. El encargado de la sucursal tiene que escribir el lote real.',
        '/bitacoras?tab=revision',
        jsonb_build_object('revisiones', to_jsonb(v_ids)), true, NULL);
    UPDATE public.libro_lote_revisiones SET escalada_at = now() WHERE id = ANY(v_ids);
    RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_paquete_en_camino()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dest   uuid[];
  v_esc    text;
  v_quien  text;
  v_origen text;
BEGIN
  IF NEW.destino_branch_id IS NULL THEN RETURN NEW; END IF;
  SELECT d.destinatarios, d.escalon INTO v_dest, v_esc
    FROM public.resolver_destinatarios_traslado(NEW.destino_branch_id::integer) d;
  IF v_esc NOT IN ('SALA', 'SALA_Y_RESPALDO') OR coalesce(array_length(v_dest, 1), 0) = 0 THEN
    RETURN NEW;
  END IF;
  SELECT public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name) INTO v_quien
    FROM public.employees e WHERE e.id = NEW.recogida_por;
  SELECT name INTO v_origen FROM public.branches WHERE id = NEW.origen_branch_id;
  PERFORM public.notify_employees(v_dest, 'REQUEST_RESOLVED', 'Tu paquete viene en camino',
    coalesce(v_quien, 'La ruta de reparto') || ' lleva el paquete '
      || coalesce(NEW.codigo, '') || ' de ' || coalesce(v_origen, 'otra sucursal')
      || '. Llega con la ruta de hoy: revísalo y recíbelo al llegar.',
    '/traslados', jsonb_build_object('request_id', NEW.request_id, 'resuelta', 'EN_CAMINO'),
    true, NEW.destino_branch_id::integer);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_pedidos_sin_recibir()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r     record;
  v_n   integer := 0;
  v_sup uuid[];
  v_h   text;
BEGIN
  FOR r IN
    WITH llegadas AS (
      SELECT s.id, s.pedido_id, s.erp_sucursal_id, p.numero,
             coalesce(s.llegada_fisica_at,
                      (SELECT min(rp.entregado_at) FROM public.ruta_pedidos rp
                        WHERE rp.pedido_id = s.pedido_id AND rp.erp_sucursal_id = s.erp_sucursal_id
                          AND rp.reenvio_ciclo IS NULL)) AS llego_at
        FROM public.pedido_sucursal_status s
        JOIN public.pedidos p ON p.id = s.pedido_id
       WHERE s.recibido_erp_at IS NULL
         AND p.status NOT IN ('anulado', 'completado')
    )
    SELECT l.*, m.branch_id, m.nombre AS sala,
           CASE WHEN l.llego_at <= now() - interval '6 hours' THEN 6 ELSE 2 END AS umbral
      FROM llegadas l
      JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = l.erp_sucursal_id
     WHERE l.llego_at IS NOT NULL
       AND l.llego_at >= now() - interval '3 days'
       AND l.llego_at <= now() - interval '2 hours'
  LOOP
    v_h := to_char(r.llego_at AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM');

    -- 2 h → la sala. La marca y el aviso van en el MISMO bloque: si el aviso
    -- falla, la marca se deshace con él y la próxima corrida lo reintenta.
    IF r.branch_id IS NOT NULL THEN
      BEGIN
        INSERT INTO public.avisos_emitidos (clave, recipient_id)
        VALUES ('PEDIDO_SIN_RECIBIR_2H:' || r.id, NULL) ON CONFLICT DO NOTHING;
        IF FOUND THEN
        PERFORM public.notify_branch_como(NULL::uuid, r.branch_id::integer, 'PEDIDO_TRACKING',
          'Pedido #' || r.numero || ' sin recibir',
          'El pedido #' || r.numero || ' llegó a las ' || v_h || ' y todavía no se recibió. '
            || 'Mientras no se reciba, ese producto no está en la existencia de la sucursal.',
          '/pedidos', public.meta_de_pedido(ARRAY[r.numero], r.sala, 'sin_recibir'), true);
        v_n := v_n + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('sin_recibir_2h', r.pedido_id, SQLERRM);
      END;
    END IF;

    -- 6 h → otra vez la sala (2026-11-10, usuario: «pedido sin recibir, sólo a la sala»).
    IF r.umbral = 6 THEN
        BEGIN
          INSERT INTO public.avisos_emitidos (clave, recipient_id)
          VALUES ('PEDIDO_SIN_RECIBIR_6H:' || r.id, NULL) ON CONFLICT DO NOTHING;
          IF FOUND THEN
          SELECT array_agg(DISTINCT e.id) INTO v_sup
            FROM public.employees e
            WHERE coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = r.branch_id
             AND e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado';
          IF v_sup IS NOT NULL THEN
            PERFORM public.notify_employees(v_sup, 'PEDIDO_PROBLEMA',
              coalesce(r.sala, 'Sucursal ' || r.erp_sucursal_id) || ': pedido #' || r.numero || ' sin recibir',
              'Llegó a las ' || v_h || ' y lleva más de 6 horas sin recibirse en la sucursal.',
              '/pedidos', public.meta_de_pedido(ARRAY[r.numero], r.sala, 'sin_recibir', NULL, NULL, NULL,
                                                'Más de 6 horas sin recibir.'), true, r.branch_id::integer);
            v_n := v_n + 1;
          END IF;
          END IF;
        EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('sin_recibir_6h', r.pedido_id, SQLERRM);
        END;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_rechazos_sin_arreglo()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dest   uuid[];
  v_ids    bigint[];
  v_lista  text;
  v_cuantos integer;
  v_n      integer := 0;
  v_titulo text;
BEGIN
  -- Retención de la marca (regla 7 de CLAUDE.md).
  DELETE FROM public.dte_rechazos_avisados
   WHERE created_at < now() - interval '180 days';

  -- Quien lo puede resolver: edita Facturación y ve Pendiente MH, que es
  -- adonde lleva el aviso. Cargo principal o secundario.
  SELECT array_agg(DISTINCT e.id) INTO v_dest
    FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))
                    AND rp.module_key = 'facturacion' AND rp.can_edit)
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))
                    AND rp.module_key = 'facturacion_tab_pendiente_mh' AND rp.can_view);

  -- Los documentos: rechazo vigente, sin sello VÁLIDO (40 caracteres: ver la
  -- regla del tipo en CLAUDE.md), no anulados, con más de 2 días, sin avisar.
  WITH nuevos AS (
    SELECT DISTINCT ON (si.id)
           si.id, b.name AS sala, si.tipo_documento, si.correlativo, si.fecha, si.total
      FROM public.dte_rechazos_vigentes r
      JOIN public.sales_invoices si ON si.id = r.invoice_id
      JOIN public.branches b ON b.id = si.branch_id
     WHERE si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
       AND length(si.recibido_mh) IS DISTINCT FROM 40
       AND si.fecha <= current_date - 2
       AND NOT EXISTS (SELECT 1 FROM public.dte_rechazos_avisados a WHERE a.invoice_id = si.id)
     ORDER BY si.id
  )
  SELECT count(*),
         array_agg(id ORDER BY fecha, id),
         string_agg(sala || ' · '
                    || CASE WHEN tipo_documento = 'CCF' THEN 'crédito fiscal ' ELSE 'factura ' END
                    || coalesce(nullif(ltrim(split_part(correlativo, '_', 1), '0'), ''), correlativo)
                    || ' · $' || to_char(total, 'FM999999990.00')
                    || ' (' || to_char(fecha, 'DD/MM') || ')',
                    '  ·  ' ORDER BY fecha, id)
    INTO v_cuantos, v_ids, v_lista
    FROM nuevos;

  IF coalesce(v_cuantos, 0) = 0 THEN RETURN 0; END IF;

  v_titulo := CASE WHEN v_cuantos = 1
                   THEN 'El MH rechaza una factura que no se corrige sola'
                   ELSE 'El MH rechaza ' || v_cuantos || ' documentos que no se corrigen solos' END;

  IF v_dest IS NOT NULL AND array_length(v_dest, 1) > 0 THEN
    v_n := public.notify_employees(
      v_dest, 'DTE_RECHAZO', v_titulo,
      v_lista || '. El envío automático ya lo intentó y no puede corregirlos: '
              || 'hay que resolverlos en Facturación, Pendiente MH.',
      '/facturacion?tab=pendiente_mh',
      jsonb_build_object('invoice_ids', v_ids), true, NULL);
  ELSE
    -- Nadie con el permiso: queda en la bitácora como crítico en vez de perderse.
    INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
    VALUES ('DTE_RECHAZO_SIN_DESTINATARIOS', 'avisar_rechazos_sin_arreglo', 'Vigilante', 'SYSTEM',
            'CRITICAL', jsonb_build_object('invoice_ids', v_ids));
  END IF;

  -- La marca se escribe SIEMPRE, aunque no le haya llegado a nadie: si no, el
  -- mismo aviso se reintentaría cada día para siempre. Cuántos lo recibieron
  -- queda guardado.
  INSERT INTO public.dte_rechazos_avisados (invoice_id, destinatarios)
  SELECT unnest(v_ids), coalesce(v_n, 0)
  ON CONFLICT (invoice_id) DO NOTHING;

  RETURN coalesce(v_n, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_sobrante(p_envio uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r        public.approval_requests%ROWTYPE;
    m        jsonb;
    v_org    integer;
    v_dest   uuid[];
    v_lista  text;
    v_n      integer;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_sala   text;
    v_osala  text;
    v_bolsa  text;
BEGIN
    SELECT * INTO r FROM public.approval_requests WHERE id = p_envio;
    m := coalesce(r.metadata, '{}'::jsonb);
    IF r.id IS NULL OR NOT (m ? 'sobrante_de') THEN RETURN 0; END IF;
    v_org := nullif(m->>'origen_branch_id', '')::integer;

    SELECT count(*)::integer,
           string_agg(trim(to_char(cantidad, 'FM999999990.##')) || ' de '
                      || coalesce(descripcion, 'el producto #' || erp_product_id)
                      || coalesce(' (' || lower(nullif(presentacion_tipo, '')) || ')', ''), '; ' ORDER BY posicion)
      INTO v_n, v_lista
      FROM public.envio_linea WHERE request_id = r.id AND estado = 'aceptada';
    IF coalesce(v_n, 0) = 0 THEN RETURN 0; END IF;

    v_dest := public.destinatarios_de_faltante(v_org, r.employee_id);
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;

    v_sala  := coalesce(nullif(m->>'branch_name', ''), 'La sucursal que recibió');
    v_osala := coalesce(nullif(m->>'origen_branch_name', ''), 'la sucursal que envió');
    SELECT nullif(metadata->>'codigo_bolsa', '') INTO v_bolsa
      FROM public.approval_requests WHERE id = (m->>'sobrante_de')::uuid;

    v_titulo := 'Llegó producto de más en un traslado';
    v_cuerpo := v_sala || ' recibió de más ' || v_lista
             || coalesce(' (paquete ' || v_bolsa || ')', '')
             || '. Se descontó del inventario de ' || v_osala || ' y se sumó al de ' || v_sala || '.';
    v_link := '/traslados?tab=envios&envio=' || r.id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', r.id, 'request_type', r.type, 'resuelta', 'SOBRANTE',
                              'sobrante_de', m->>'sobrante_de'),
           v_org, r.employee_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                                      'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)));

    RETURN array_length(v_dest, 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_traslados_por_respaldo()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sala   record;
  v_n      integer;
  v_total  integer := 0;
  v_titulo text;
  v_cuerpo text;
BEGIN
  FOR v_sala IN
    WITH sin_avisar AS (
      SELECT ar.id,
             (ar.metadata->>'origen_branch_id')::integer AS origen,
             coalesce(nullif(ar.metadata->>'branch_name', ''), 'otra sucursal') AS destino,
             coalesce(nullif(ar.metadata->'erp_traslado'->>'by_name', ''), 'La sucursal de al lado') AS quien,
             nullif(ar.metadata->'erp_traslado'->>'by', '') AS quien_id,
             -- El cast sólo si tiene forma de uuid: un valor raro no puede tumbar el aviso.
             CASE WHEN ar.metadata->'erp_traslado'->>'by' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  THEN public.foto_de_empleado((ar.metadata->'erp_traslado'->>'by')::uuid) END AS quien_foto,
             ar.metadata->'erp_traslado'->>'at' AS hora,
             coalesce((ar.metadata->>'total_unidades')::numeric,
                      (ar.metadata->'erp_traslado'->>'unidades')::numeric) AS unidades,
             (ar.metadata->'erp_traslado'->>'total')::numeric AS total,
             ar.metadata->'items'->0->>'descripcion' AS producto,
             greatest(jsonb_array_length(coalesce(ar.metadata->'items', '[]'::jsonb)) - 1, 0) AS mas,
             ar.updated_at
        FROM public.approval_requests ar
       WHERE ar.type = 'INVENTORY_TRANSFER_REQUEST'
         AND ar.status = 'APPROVED'
         AND (ar.metadata->'erp_traslado'->>'por_respaldo')::boolean IS TRUE
         AND ar.updated_at >= now() - interval '7 days'
         AND NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                          WHERE a.clave = 'TRASLADO_RESPALDO:' || ar.id::text)
    )
    SELECT origen,
           count(*)                                        AS cuantos,
           to_jsonb(array_agg(id)::text[])                 AS ids,
           count(DISTINCT quien)                           AS n_quienes,
           min(quien)                                      AS un_quien,
           coalesce(sum(unidades), 0)                      AS unidades,
           jsonb_agg(jsonb_build_object(
             'id',       id,
             'destino',  destino,
             'producto', producto,
             'mas',      mas,
             'unidades', unidades,
             'total',    total,
             'quien',    quien,
             'quien_id', quien_id,
             'quien_foto', quien_foto,
             'hora',     hora) ORDER BY updated_at)      AS traslados
      FROM sin_avisar
     WHERE origen IS NOT NULL
     GROUP BY origen
  LOOP
    v_titulo := CASE WHEN v_sala.cuantos = 1
                     THEN 'Salió un traslado mientras estaban cerrados'
                     ELSE v_sala.cuantos || ' traslados salieron mientras estaban cerrados' END;
    v_cuerpo := CASE WHEN v_sala.n_quienes = 1 THEN v_sala.un_quien
                     ELSE v_sala.un_quien || ' y ' || (v_sala.n_quienes - 1)
                          || CASE WHEN v_sala.n_quienes = 2 THEN ' persona más' ELSE ' personas más' END END
             || CASE WHEN v_sala.cuantos = 1 THEN ' lo despachó' ELSE ' los despacharon' END
             || ' por ustedes. Revisen que la existencia cuadre.';

    v_n := public.notify_branch(
             v_sala.origen, 'TRASLADO_RESPALDO', v_titulo, v_cuerpo, '/traslados',
             jsonb_build_object('request_ids', v_sala.ids,
                                'unidades',    v_sala.unidades,
                                'traslados',   v_sala.traslados), true);

    -- Sólo se marca lo que efectivamente salió: si la sala no tenía a quién
    -- avisarle, mañana se reintenta (como antes).
    IF coalesce(v_n, 0) > 0 THEN
      INSERT INTO public.avisos_emitidos (clave, recipient_id)
      SELECT 'TRASLADO_RESPALDO:' || t, NULL::uuid
        FROM jsonb_array_elements_text(v_sala.ids) t
      ON CONFLICT DO NOTHING;
    END IF;

    v_total := v_total + coalesce(v_n, 0);
  END LOOP;

  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_ventas_sin_sello(p_probar boolean DEFAULT false, p_dias_sello_tardio integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dest_fac  uuid[];
  v_dest_lib  uuid[];
  v_ids       bigint[];
  v_lista     text;
  v_n1        integer := 0;
  v_tard_ids  bigint[];
  v_tard_list text;
  v_n2        integer := 0;
  v_total     numeric;
BEGIN
  -- ── 1. Ventas sin sello de más de 2 días ─────────────────────────────────
  WITH pend AS (
    SELECT si.id, b.name AS sala, si.tipo_documento, si.correlativo, si.fecha, si.total
      FROM public.sales_invoices si
      JOIN public.branches b ON b.id = si.branch_id
     WHERE public.venta_valida(si.estado)
       AND (si.recibido_mh IS NULL OR si.recibido_mh NOT LIKE repeat('_', 40))
       AND NOT public.cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora, si.customer_id)
       AND si.fecha <= current_date - 2
       AND NOT EXISTS (SELECT 1 FROM public.dte_rechazos_avisados a WHERE a.invoice_id = si.id)
       AND NOT EXISTS (SELECT 1 FROM public.sync_alert_log l
                        WHERE l.domain = 'ventas-sin-sello' AND l.scope_key = si.id::text)
  )
  SELECT count(*), array_agg(id ORDER BY fecha, id),
         string_agg(sala || ' · '
                    || CASE WHEN tipo_documento = 'CCF' THEN 'crédito fiscal ' ELSE 'factura ' END
                    || coalesce(nullif(ltrim(split_part(correlativo, '_', 1), '0'), ''), correlativo)
                    || ' · $' || to_char(total, 'FM999999990.00')
                    || ' (' || to_char(fecha, 'DD/MM/YY') || ')',
                    '  ·  ' ORDER BY fecha, id) FILTER (WHERE rn <= 10)
    INTO v_n1, v_ids, v_lista
    FROM (SELECT p.*, row_number() OVER (ORDER BY fecha, id) rn FROM pend p) x;

  -- ── 2. Sellos que llegaron después del día 10 del mes siguiente ──────────
  WITH tard AS (
    SELECT DISTINCT ON (si.id) si.id, b.name AS sala, si.tipo_documento, si.correlativo,
           si.fecha, si.total
      FROM public.sales_invoice_changelog c
      JOIN public.sales_invoices si ON si.id = c.invoice_id
      JOIN public.branches b ON b.id = si.branch_id
     WHERE c.campo = 'recibido_mh'
       AND c.valor_nuevo LIKE repeat('_', 40)
       AND (c.valor_anterior IS NULL OR c.valor_anterior NOT LIKE repeat('_', 40))
       AND c.detected_at >= now() - make_interval(days => p_dias_sello_tardio)
       AND (c.detected_at AT TIME ZONE 'America/El_Salvador')::date
           > (date_trunc('month', si.fecha) + interval '1 month' + interval '9 days')::date
       AND NOT EXISTS (SELECT 1 FROM public.sync_alert_log l
                        WHERE l.domain = 'ventas-sello-tardio' AND l.scope_key = si.id::text)
     ORDER BY si.id
  )
  SELECT count(*), array_agg(id ORDER BY fecha, id), sum(total),
         string_agg(sala || ' · '
                    || CASE WHEN tipo_documento = 'CCF' THEN 'crédito fiscal ' ELSE 'factura ' END
                    || coalesce(nullif(ltrim(split_part(correlativo, '_', 1), '0'), ''), correlativo)
                    || ' · $' || to_char(total, 'FM999999990.00')
                    || ' (' || to_char(fecha, 'DD/MM/YY') || ')',
                    '  ·  ' ORDER BY fecha, id) FILTER (WHERE rn <= 10)
    INTO v_n2, v_tard_ids, v_total, v_tard_list
    FROM (SELECT t.*, row_number() OVER (ORDER BY fecha, id) rn FROM tard t) x;

  IF p_probar THEN
    RETURN jsonb_build_object('sin_sello', v_n1, 'sin_sello_lista', v_lista,
                              'sello_tardio', v_n2, 'sello_tardio_total', v_total,
                              'sello_tardio_lista', v_tard_list);
  END IF;

  -- Personas, no fichas técnicas (QA, revisión de tienda).
  SELECT array_agg(DISTINCT e.id) INTO v_dest_fac
    FROM public.employees e
   WHERE e.status = 'ACTIVO' AND e.tipo_ficha IS DISTINCT FROM 'tecnica'
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))
                    AND rp.module_key = 'facturacion' AND rp.can_edit)
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))
                    AND rp.module_key = 'facturacion_tab_pendiente_mh' AND rp.can_view);

  SELECT array_agg(DISTINCT e.id) INTO v_dest_lib
    FROM public.employees e
   WHERE e.status = 'ACTIVO' AND e.tipo_ficha IS DISTINCT FROM 'tecnica'
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))
                    AND rp.module_key = 'libros_iva' AND rp.can_view);

  IF coalesce(v_n1, 0) > 0 THEN
    IF coalesce(array_length(v_dest_fac, 1), 0) > 0 THEN
      PERFORM public.notify_employees(
        v_dest_fac, 'DTE_SIN_SELLO',
        CASE WHEN v_n1 = 1 THEN 'Una venta lleva más de 2 días sin sello del MH'
             ELSE v_n1 || ' ventas llevan más de 2 días sin sello del MH' END,
        v_lista || CASE WHEN v_n1 > 10 THEN '  ·  y ' || (v_n1 - 10) || ' más' ELSE '' END
          || '. Sin sello no entran al libro de IVA. Están en Facturación, Pendiente MH.',
        '/facturacion?tab=pendiente_mh',
        jsonb_build_object('invoice_ids', v_ids), true, NULL);
    ELSE
      INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
      VALUES ('DTE_SIN_SELLO_SIN_DESTINATARIOS', 'avisar_ventas_sin_sello', 'Vigilante', 'SYSTEM',
              'CRITICAL', jsonb_build_object('invoice_ids', v_ids));
    END IF;
    -- La marca va siempre: si no, el mismo aviso saldría cada día para siempre.
    INSERT INTO public.sync_alert_log (domain, scope_key, alert_key)
    SELECT 'ventas-sin-sello', unnest(v_ids)::text, 'pendiente'
    ON CONFLICT (domain, scope_key, alert_key) DO NOTHING;
  END IF;

  IF coalesce(v_n2, 0) > 0 THEN
    IF coalesce(array_length(v_dest_lib, 1), 0) > 0 THEN
      PERFORM public.notify_employees(
        v_dest_lib, 'DTE_SELLO_TARDIO',
        CASE WHEN v_n2 = 1 THEN 'Llegó el sello de una venta de un mes ya declarado'
             ELSE 'Llegó el sello de ' || v_n2 || ' ventas de meses ya declarados' END,
        v_tard_list || CASE WHEN v_n2 > 10 THEN '  ·  y ' || (v_n2 - 10) || ' más' ELSE '' END
          || '. Total $' || to_char(v_total, 'FM999999990.00')
          || '. Ahora entran al libro de su mes: si ese mes ya se declaró, hay que rectificar.',
        '/libros-iva',
        jsonb_build_object('invoice_ids', v_tard_ids, 'total', v_total), true, NULL);
    ELSE
      INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
      VALUES ('DTE_SELLO_TARDIO_SIN_DESTINATARIOS', 'avisar_ventas_sin_sello', 'Vigilante', 'SYSTEM',
              'CRITICAL', jsonb_build_object('invoice_ids', v_tard_ids));
    END IF;
    INSERT INTO public.sync_alert_log (domain, scope_key, alert_key)
    SELECT 'ventas-sello-tardio', unnest(v_tard_ids)::text, 'llego'
    ON CONFLICT (domain, scope_key, alert_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('sin_sello', coalesce(v_n1, 0), 'sello_tardio', coalesce(v_n2, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.bitacora_exigir_acceso(p_branch_id bigint, p_accion text DEFAULT 'can_edit'::text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras', p_accion) THEN
        RAISE EXCEPTION 'Tu cargo no tiene el modulo de bitacoras.' USING ERRCODE = '42501';
    END IF;
    IF public.auth_module_scope('bitacoras') <> 'ALL'
       AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
        RAISE EXCEPTION 'Solo puedes trabajar las bitácoras de tu sucursal.' USING ERRCODE = '42501';
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_employee(p_employee_id uuid, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_yo       uuid;
  v_ficha    uuid;
  v_hasta    timestamptz;
  v_sesiones integer := 0;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('bloqueos', 'can_edit')) THEN
    RAISE EXCEPTION 'sin permiso para bloquear' USING ERRCODE = '42501';
  END IF;
  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'falta la persona' USING ERRCODE = '22023';
  END IF;

  v_ficha := (SELECT public.ficha_de_persona(p_employee_id));
  IF v_ficha IS NULL THEN
    RAISE EXCEPTION 'no existe esa persona' USING ERRCODE = '22023';
  END IF;

  -- Quién soy sale del JWT, nunca de un parámetro.
  v_yo := (SELECT public.auth_employee_id());

  -- Bloquearse a uno mismo es un autogol sin vuelta: quedarías fuera y sin
  -- poder desbloquearte, porque desbloquear exige el permiso que acabás de
  -- perder. Se impide en la base y no sólo en la pantalla — y se compara ficha
  -- contra ficha, que es lo que faltaba: con dos identidades, la tarjeta de la
  -- otra no muestra la conexión actual y la pantalla deja apretar.
  IF v_yo IS NOT NULL AND v_yo = v_ficha THEN
    RAISE EXCEPTION 'no puedes bloquearte a ti mismo' USING ERRCODE = '22023';
  END IF;

  v_hasta := coalesce(p_until, 'infinity'::timestamptz);

  UPDATE public.employees
     SET blocked_until  = v_hasta,
         blocked_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         blocked_at     = now(),
         blocked_by     = v_yo
   WHERE id = v_ficha;

  -- Todas las puertas de esa persona, no sólo por la que se la nombró.
  WITH suyas AS (
    SELECT v_ficha AS user_id
    UNION
    SELECT l.auth_user_id FROM public.employee_auth_accounts l
     WHERE l.employee_id = v_ficha
  ),
  cerradas AS (
    DELETE FROM auth.sessions s
     WHERE s.user_id IN (SELECT user_id FROM suyas)
    RETURNING 1
  )
  SELECT count(*) INTO v_sesiones FROM cerradas;

  DELETE FROM public.session_activity sa
   WHERE sa.user_id = v_ficha
      OR sa.user_id IN (SELECT l.auth_user_id FROM public.employee_auth_accounts l
                         WHERE l.employee_id = v_ficha);

  RETURN v_sesiones;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bolsa_al_descartar_corte()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    b      public.bolsas;
    v_n    integer;
    v_sala text;
BEGIN
    SELECT * INTO b FROM public.bolsas
     WHERE corte_id = NEW.id AND estado <> 'ANULADA' FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;

    SELECT count(*) INTO v_n FROM public.bolsas_movimientos m
     WHERE m.bolsa_id = b.id AND m.anulado_at IS NULL;

    -- Limpia y todavía en la sala: se anula sola. El dinero no se movió y el
    -- corte que la justificaba dejó de existir.
    --
    -- Y ahí termina. Su monto NO se le pasa a otra bolsa: las otras son bolsas
    -- físicas ya selladas y etiquetadas, y sumarles un número las haría
    -- prometer efectivo que nadie puso adentro. Un corte descartado es un
    -- error o algo que pasó — el que quiere guardar dinero confirma un corte,
    -- y ese corte crea su bolsa.
    IF b.estado = 'ABIERTA' AND v_n = 0 THEN
        UPDATE public.bolsas
           SET estado = 'ANULADA', anulada_motivo = 'El corte se descartó.',
               anulada_at = now(), updated_at = now()
         WHERE id = b.id;

        INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, motivo, monto, employee_id)
        VALUES (b.id, 'ANULAR', b.estado, 'ANULADA', 'El corte se descartó.',
                b.monto_inicial, NEW.resuelto_por);

        RETURN NEW;
    END IF;

    -- Con vales adentro o ya fuera de la sala, NO se toca: anularla en silencio
    -- borraría el respaldo de un dinero que se movió de verdad. Queda el hecho y
    -- alguien lo mira.
    INSERT INTO public.bolsas_eventos (bolsa_id, accion, motivo, monto, employee_id, nota)
    VALUES (b.id, 'CORTE_DESCARTADO', 'El corte que la originó se descartó.',
            b.monto_inicial, NEW.resuelto_por,
            CASE WHEN v_n > 0 THEN 'Tiene vales adentro: hay que revisarla a mano.'
                 ELSE 'Ya salió de la sucursal: se revisa en el conteo.' END);

    SELECT name INTO v_sala FROM public.branches WHERE id = b.branch_id;
    PERFORM public.notify_employees(
        public.destinatarios_de_modulo(b.branch_id::integer, 'bolsas'),
        'bolsa_de_corte_descartado',
        'Una bolsa quedó de un corte descartado',
        format('%s · la bolsa %s por $%s viene de un corte que se descartó. Hay que revisarla a mano.',
               coalesce(v_sala, 'Sala'), b.folio, to_char(b.monto_inicial, 'FM999,999,990.00')),
        '/cortes',
        jsonb_build_object('bolsa_id', b.id, 'folio', b.folio, 'corte_id', NEW.id),
        true,
        b.branch_id::integer
    );

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bolsa_anular_operacion_nucleo(p_operacion_id bigint, p_motivo text, p_por uuid)
 RETURNS bolsas_operaciones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_oper public.bolsas_operaciones;
    r      record;
BEGIN
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Anular una salida exige decir por qué.';
    END IF;

    SELECT * INTO v_oper FROM public.bolsas_operaciones WHERE id = p_operacion_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa salida no existe.'; END IF;
    IF v_oper.anulada_at IS NOT NULL THEN RAISE EXCEPTION 'Esa salida ya está anulada.'; END IF;

    FOR r IN SELECT b.folio, b.estado FROM public.bolsas_movimientos m
              JOIN public.bolsas b ON b.id = m.bolsa_id
             WHERE m.operacion_id = p_operacion_id AND m.anulado_at IS NULL LOOP
        IF r.estado <> 'ABIERTA' THEN
            RAISE EXCEPTION 'La bolsa % ya salió de la sucursal: esta salida no se puede anular.', r.folio;
        END IF;
    END LOOP;

    UPDATE public.bolsas_movimientos
       SET anulado_at = now(), anulado_por = p_por, anulado_motivo = btrim(p_motivo)
     WHERE operacion_id = p_operacion_id AND anulado_at IS NULL;

    UPDATE public.bolsas_operaciones
       SET anulada_at = now(), anulada_por = p_por, anulada_motivo = btrim(p_motivo),
           updated_at = now()
     WHERE id = p_operacion_id
     RETURNING * INTO v_oper;

    UPDATE public.caja_movimientos_portal
       SET anulado_at = now(), anulado_por = p_por,
           anulado_motivo = btrim(p_motivo), updated_at = now()
     WHERE bolsa_operacion_id = p_operacion_id
       AND anulado_at IS NULL AND erp_movimiento_id IS NULL;

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, motivo, monto, employee_id, nota)
    SELECT m.bolsa_id, 'ANULAR_SALIDA', btrim(p_motivo), -m.monto, p_por, v_oper.folio
      FROM public.bolsas_movimientos m WHERE m.operacion_id = p_operacion_id;

    RETURN v_oper;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bolsa_llego_por_error(p_codigo text, p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_quien   uuid := public.auth_employee_id();
  v_sala    bigint := public._sala_que_reporta(p_branch_id);
  v_nsala   text;
  v_b       record;
  v_abierta record;
  v_entrego uuid;
  v_nentr   text;
  v_cuerpo  text;
BEGIN
  IF v_quien IS NULL OR v_sala IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'No sabemos desde qué sucursal lo reportas.');
  END IF;
  SELECT * INTO v_b FROM public._bolsa_por_codigo(p_codigo);
  IF v_b.request_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'No encontramos ese paquete. Puede que el código no se haya leído bien.');
  END IF;
  IF NOT v_b.en_camino THEN
    RETURN json_build_object('ok', false, 'error', 'Ese paquete ya se recibió o todavía no salió.');
  END IF;
  IF v_b.destino_branch_id = v_sala THEN
    RETURN json_build_object('ok', false, 'codigo', 'ES_DE_AQUI', 'error', 'Ese paquete es para esta sucursal: recíbanlo.');
  END IF;

  SELECT * INTO v_abierta FROM public.bolsa_en_sala_equivocada
   WHERE request_id = v_b.request_id AND resuelto_at IS NULL FOR UPDATE;
  IF v_abierta.id IS NOT NULL AND v_abierta.branch_id = v_sala THEN
    RETURN json_build_object('ok', true, 'ya', true, 'destino', v_b.destino);
  END IF;

  -- Quién la entregó: la última ruta que la llevó, o el recorrido.
  SELECT coalesce(rb.entregada_por, rb.recogida_por) INTO v_entrego
    FROM public.ruta_bolsas rb
   WHERE rb.request_id = v_b.request_id AND rb.soltada_at IS NULL
   ORDER BY rb.recogida_at DESC LIMIT 1;
  IF v_entrego IS NULL THEN
    SELECT r.retirador_id INTO v_entrego
      FROM public.retiro_bultos x JOIN public.retiros r ON r.id = x.retiro_id
     WHERE x.request_id = v_b.request_id ORDER BY x.cargado_at DESC LIMIT 1;
  END IF;

  -- Está acá: la custodia de quien la llevaba termina.
  UPDATE public.ruta_bolsas SET entregada_at = now()
   WHERE request_id = v_b.request_id AND entregada_at IS NULL AND soltada_at IS NULL;
  UPDATE public.retiro_bultos SET entregado_at = now()
   WHERE request_id = v_b.request_id AND entregado_at IS NULL;

  IF v_abierta.id IS NOT NULL THEN
    UPDATE public.bolsa_en_sala_equivocada
       SET branch_id = v_sala, reportado_por = v_quien, reportado_at = now()
     WHERE id = v_abierta.id;
  ELSE
    INSERT INTO public.bolsa_en_sala_equivocada (request_id, branch_id, reportado_por)
    VALUES (v_b.request_id, v_sala, v_quien);
  END IF;

  SELECT name INTO v_nsala FROM public.branches WHERE id = v_sala;
  SELECT name INTO v_nentr FROM public.employees WHERE id = v_entrego;
  v_cuerpo := coalesce(v_nsala, 'Una sucursal') || ' recibió por error el paquete '
           || coalesce(v_b.codigo, '') || ' de ' || coalesce(v_b.origen, '¿?') || ' para '
           || coalesce(v_b.destino, '¿?') || '.'
           || coalesce(' La entregó ' || v_nentr || '.', '')
           || ' Queda ahí: las rutas que pasen la verán para llevarla a ' || coalesce(v_b.destino, 'su sucursal') || '.';
  PERFORM public._avisar_bolsa(public._destinatarios_bodega_y(v_entrego),
    'Un paquete quedó en la sucursal equivocada', v_cuerpo, v_b.request_id, 'SALA_EQUIVOCADA', v_sala);

  RETURN json_build_object('ok', true, 'destino', v_b.destino, 'entrego', v_nentr);
END;
$function$;

CREATE OR REPLACE FUNCTION public.bolsa_operacion_no_anulable(p_operacion_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT CASE
        WHEN o.id IS NULL THEN 'Esa salida no existe.'
        WHEN o.anulada_at IS NOT NULL THEN NULL
        ELSE (SELECT 'La bolsa ' || b.folio || ' ya salió de la sucursal: esta salida no se puede anular.'
                FROM public.bolsas_movimientos m
                JOIN public.bolsas b ON b.id = m.bolsa_id
               WHERE m.operacion_id = o.id AND m.anulado_at IS NULL AND b.estado <> 'ABIERTA'
               LIMIT 1)
    END
      FROM (SELECT p_operacion_id AS pid) p
      LEFT JOIN public.bolsas_operaciones o ON o.id = p.pid;
$function$;

CREATE OR REPLACE FUNCTION public.caja_estado(p_branch_id integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ap     public.cortes_caja_aperturas%ROWTYPE;
  v_dia    date;
  v_reg    numeric;
  v_quien  text;
  v_cortes json;
  v_pz     json;
BEGIN
  -- Los MISMOS dos frenos que `operar-caja` aplica a la acción `estado`:
  -- mirar la caja es `caja_vales can_view`, y sin alcance ALL sólo la propia.
  IF NOT public.auth_has_module_permission('caja_vales', 'can_view') THEN
    RETURN json_build_object('ok', false,
      'error', 'No tienes permiso para mirar la caja desde el portal.');
  END IF;
  IF public.auth_module_scope('caja_vales') IS DISTINCT FROM 'ALL'
     AND public.auth_employee_branch_id() IS DISTINCT FROM p_branch_id THEN
    RETURN json_build_object('ok', false,
      'error', 'Solo puedes mirar la caja de tu propia sucursal.');
  END IF;

  SELECT * INTO v_ap
    FROM public.cortes_caja_aperturas a
   WHERE a.branch_id = p_branch_id AND a.cerrada_at IS NULL
   ORDER BY a.abierta_el DESC, a.turno DESC
   LIMIT 1;

  v_dia := coalesce(v_ap.abierta_el, (now() - interval '6 hours')::date);

  -- Las piezas del juez viajan con cada corte: sin ellas `diferenciaDelCorte`
  -- cae a `diferencia_erp`, la cifra cruda del origen. `diferencia` es la del
  -- juez (NULL si el corte no contó el efectivo: «no se contó» no es «cuadró»).
  SELECT coalesce(json_agg(to_json(c) ORDER BY c.hora), '[]'::json) INTO v_cortes
    FROM (SELECT id, tipo, hora, total_declarado, esperado, diferencia_erp, estado,
                 tk_subtotal, tk_vales, tk_total_caja, tk_cobros_credito,
                 cobros_portal_efectivo,
                 CASE WHEN public.corte_no_conto_efectivo(tipo, total_declarado,
                                                          diferencia_erp, tk_total_caja)
                      THEN NULL
                      ELSE public.corte_diferencia(total_declarado, diferencia_erp,
                             tk_total_caja, tk_subtotal, tk_vales, tk_cobros_credito,
                             cobros_portal_efectivo)
                 END AS diferencia
            FROM public.cortes_caja
           WHERE branch_id = p_branch_id AND fecha = v_dia) c;

  IF v_ap.branch_id IS NULL THEN
    RETURN json_build_object(
      'ok', true, 'abierta', false, 'caja', NULL, 'turno', NULL,
      'turno_corriendo', false, 'registrado', NULL, 'apertura', NULL,
      'quien', NULL, 'desde', NULL, 'dia', v_dia, 'cortes', v_cortes,
      'efectivo', NULL, 'efectivo_piezas', NULL, 'frescura_seg', NULL,
      -- Sin apertura viva no hay día que cerrar, y la pantalla no ofrece el
      -- botón. `null` es «no aplica», que no es lo mismo que «no falta nada».
      'falta_por_contar', NULL);
  END IF;

  SELECT e.name INTO v_quien
    FROM public.caja_aperturas_del_portal p
    JOIN public.employees e ON e.id = p.abierta_por
   WHERE p.branch_id = p_branch_id AND p.erp_apertura_id = v_ap.erp_apertura_id;

  -- El «Monto Registrado» del panel, derivado: apertura más las ventas
  -- FINALIZADAS de la fecha, sin entradas ni salidas — así lo arma el origen.
  SELECT round(coalesce(v_ap.monto_apertura, 0)
              + coalesce(sum(s.total), 0), 2) INTO v_reg
    FROM public.sales_invoices s
   WHERE s.branch_id = p_branch_id AND s.fecha = v_dia AND public.venta_valida(s.estado);

  -- Cuánto de eso son BILLETES, y con qué piezas. La cuenta vive en UNA sola
  -- función: `operar-caja` llama a la misma, así que las dos pantallas que
  -- preguntan por el cajón no pueden contestar distinto.
  v_pz := public.caja_efectivo_piezas(p_branch_id, v_dia, coalesce(v_ap.monto_apertura, 0));

  RETURN json_build_object(
    'ok', true,
    'abierta', true,
    'caja', v_ap.caja_erp,
    'turno', v_ap.turno,
    'turno_corriendo', coalesce(v_ap.turno_corriendo, true),
    'registrado', v_reg,
    'apertura', v_ap.monto_apertura,
    'quien', v_quien,
    'desde', v_ap.abierta_a,
    'dia', v_dia,
    'cortes', v_cortes,
    'efectivo', (v_pz->>'efectivo')::numeric,
    'efectivo_piezas', v_pz,
    'frescura_seg', round(extract(epoch FROM now() - v_ap.vista_at)),
    -- Las piezas van ARMADAS: la suma ya se hizo dos líneas arriba y volver a
    -- pedirla duplicaría el trabajo de cada carga de Mi caja.
    'falta_por_contar', public.caja_falta_por_contar(p_branch_id, v_dia, v_pz));
END;
$function$;

CREATE OR REPLACE FUNCTION public.caja_movimiento_valida_bono()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v public.promocion_pago%ROWTYPE;
BEGIN
    SELECT * INTO v FROM public.promocion_pago WHERE clave_envio = NEW.clave_envio FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'BONO_SIN_RESERVA: esa salida no corresponde a ningún bono reservado'; END IF;
    IF v.estado <> 'reservado' THEN RAISE EXCEPTION 'BONO_NO_RESERVADO: ese bono ya no está por pagar'; END IF;
    IF NEW.tipo <> 'SALIDA' OR NEW.branch_id::bigint <> v.branch_id THEN
        RAISE EXCEPTION 'BONO_OTRA_CAJA: el bono se paga desde la caja de su sucursal';
    END IF;
    IF NEW.monto <> v.monto THEN
        RAISE EXCEPTION 'BONO_OTRO_MONTO: el bono es de % y la salida dice %', v.monto, NEW.monto;
    END IF;
    IF NOT public.es_jefe_de_sala(NEW.registrado_por, v.branch_id) THEN
        RAISE EXCEPTION 'BONO_SIN_JEFATURA: el bono lo paga el jefe de sucursal';
    END IF;
    IF v.employee_id IS NOT NULL AND NEW.recibido_por IS DISTINCT FROM v.employee_id THEN
        RAISE EXCEPTION 'BONO_OTRA_PERSONA: el efectivo lo tiene que recibir la persona que ganó el bono';
    END IF;
    IF v.employee_id IS NULL AND NEW.recibido_por IS NULL THEN
        RAISE EXCEPTION 'BONO_SIN_RECEPTOR: hay que identificar a quien recibe el efectivo';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancelar_envio(p_request_id uuid, p_motivo text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r      public.approval_requests%ROWTYPE;
    v_yo   uuid := public.auth_employee_id();
    v_mi   integer;
    v_todo boolean;
    v_org  integer;
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'Sesión inválida.'; END IF;

    SELECT * INTO r FROM public.approval_requests
     WHERE id = p_request_id AND type = 'INVENTORY_TRANSFER_PUSH';
    IF r.id IS NULL THEN RAISE EXCEPTION 'Ese traslado no existe.'; END IF;
    IF r.status <> 'PENDING' THEN RAISE EXCEPTION 'Ese traslado ya está %.', r.status; END IF;

    IF nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Escribe por qué cancelas el traslado.';
    END IF;

    -- Nada puede haber salido. Se pregunta por `enviado_at` y no por el estado:
    -- una línea puede haber salido y estar hoy en `error` por otra cosa, y ese
    -- producto igual está fuera de la sala.
    IF EXISTS (SELECT 1 FROM public.envio_linea l
                WHERE l.request_id = p_request_id AND l.enviado_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Ya salió producto de este traslado. Lo tiene que contestar la sucursal de destino.';
    END IF;

    v_org := nullif(r.metadata->>'origen_branch_id','')::integer;
    SELECT coalesce(public.sala_de_apoyo_vigente(id), branch_id) INTO v_mi FROM public.employees WHERE id = v_yo;
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
         WHERE e.id = v_yo
           AND (false /* llave maestra retirada 2026-08-28: ya no hay quien la porte — ver docs/PLAN-ROLES-SIN-SYSTEM-ROLE-2026-08-28.md */
                OR EXISTS (SELECT 1 FROM public.role_permissions rp
                            WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))
                              AND rp.module_key = 'traslados' AND rp.scope = 'ALL'))
    ) INTO v_todo;

    IF NOT v_todo AND v_yo IS DISTINCT FROM r.employee_id AND v_mi IS DISTINCT FROM v_org THEN
        RAISE EXCEPTION 'Este traslado lo cancela la sucursal de la que iba a salir el producto.';
    END IF;

    UPDATE public.approval_requests
       SET status = 'CANCELLED',
           approver_id = v_yo,
           approver_note = btrim(p_motivo),
           metadata = coalesce(metadata,'{}'::jsonb)
                      || jsonb_build_object('cancelado_at', now(), 'cancelado_por', v_yo),
           updated_at = now()
     WHERE id = p_request_id AND status = 'PENDING';

    UPDATE public.envio_linea
       SET estado = 'error',
           error = 'El envío se canceló antes de salir: ' || btrim(p_motivo),
           updated_at = now()
     WHERE request_id = p_request_id AND enviado_at IS NULL;

    RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cerrar_bolsa_de_corte(p_corte_id bigint, p_monto_esperado numeric)
 RETURNS bolsas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_corte  public.cortes_caja;
    v_bolsa  public.bolsas;
    v_scope  text;
    v_monto  numeric;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_corte_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El corte no existe.';
    END IF;

    v_scope := (SELECT auth_module_scope('bolsas'));
    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_corte.tipo <> 'C' THEN
        RAISE EXCEPTION 'El cierre del día no lleva bolsa.';
    END IF;

    IF v_corte.estado <> 'CONFIRMADO' THEN
        RAISE EXCEPTION 'Primero hay que confirmar el corte.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.bolsas b
                WHERE b.corte_id = p_corte_id AND b.estado <> 'ANULADA') THEN
        RAISE EXCEPTION 'Este corte ya tiene su bolsa.';
    END IF;

    v_monto := public.bolsa_sugerida(p_corte_id);

    IF v_monto IS NULL OR v_monto <= 0 THEN
        RAISE EXCEPTION 'No queda efectivo por guardar de este corte: las bolsas de la sucursal ya cubren lo declarado.';
    END IF;

    IF round(coalesce(p_monto_esperado, -1), 2) <> v_monto THEN
        RAISE EXCEPTION 'El monto cambió mientras la pantalla estaba abierta: ahora son % y en pantalla decía %. Hay que abrirla de nuevo.',
            to_char(v_monto, 'FM999999990.00'),
            to_char(round(coalesce(p_monto_esperado, 0), 2), 'FM999999990.00');
    END IF;

    INSERT INTO public.bolsas
        (folio, branch_id, corte_id, origen, monto_inicial, fecha, hora, caja, cerrada_por)
    VALUES
        (public.nuevo_folio_de_bolsa(v_corte.branch_id),
         v_corte.branch_id, p_corte_id, 'CORTE', v_monto,
         v_corte.fecha, v_corte.hora, v_corte.empleado_texto,
         (SELECT auth_employee_id()))
    RETURNING * INTO v_bolsa;

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_despues, monto, employee_id, nota)
    VALUES (v_bolsa.id, 'CREAR', 'ABIERTA', v_monto, (SELECT auth_employee_id()),
            'Se guardó a mano, sin corte recién confirmado.');

    RETURN v_bolsa;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cerrar_faltante(p_id uuid, p_estado text, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    bf      public.bolsa_faltante%ROWTYPE;
    v_yo    uuid;
    v_sala  integer;
    v_ok    boolean;
BEGIN
    IF p_estado NOT IN ('aparecio', 'no_aparecio') THEN
        RAISE EXCEPTION 'Un faltante se cierra en aparecio o no_aparecio, no en %.', p_estado;
    END IF;

    v_yo := public.auth_employee_id();
    IF v_yo IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: no se pudo resolver quién eres.';
    END IF;
    IF NOT public.auth_can_edit_any(ARRAY['traslados']) THEN
        RAISE EXCEPTION 'FORBIDDEN: no tienes permiso para resolver faltantes de traslado.';
    END IF;

    SELECT * INTO bf FROM public.bolsa_faltante WHERE id = p_id;
    IF bf.id IS NULL THEN
        RAISE EXCEPTION 'No existe ese faltante.';
    END IF;
    -- Ya cerrado: no se vuelve a cerrar ni se cambia el desenlace.
    IF bf.estado <> 'abierto' THEN
        RETURN json_build_object('ok', false, 'codigo', 'YA_CERRADO', 'estado', bf.estado);
    END IF;

    -- «No apareció» descuenta inventario y dice a cargo de quién queda: lo
    -- decide supervisión (decisión del usuario, 2026-11-12) y lo hace la función
    -- que habla con la caja. Acá sólo se dice adónde ir.
    -- Supervisión lo está cerrando «no apareció» en este momento.
    IF bf.ajuste_en_curso_at IS NOT NULL AND bf.ajuste_en_curso_at > now() - interval '3 minutes' THEN
        RETURN json_build_object('ok', false, 'codigo', 'YA_EN_CURSO');
    END IF;

    IF p_estado = 'no_aparecio' THEN
        IF NOT public.auth_supervisa_faltantes() THEN
            RAISE EXCEPTION 'FORBIDDEN: «No apareció» lo cierra un supervisor o administrador.';
        END IF;
        RETURN json_build_object('ok', false, 'codigo', 'AJUSTAR_EN_CAJA',
                                 'familia', bf.familia, 'request_id', bf.request_id);
    END IF;

    SELECT coalesce(public.sala_de_apoyo_vigente(id), branch_id) INTO v_sala FROM public.employees WHERE id = v_yo;
    IF NOT (
        public.auth_es_supervision()
        OR public.auth_can_edit_scope_all(ARRAY['traslados'])
        OR v_sala IS NOT DISTINCT FROM bf.origen_branch_id
        OR v_sala IS NOT DISTINCT FROM bf.destino_branch_id
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN: este faltante lo resuelven las sucursales que lo vivieron.';
    END IF;

    -- «Apareció» en un renglón de envío que sigue en tránsito NO se cierra
    -- acá: primero hay que recibir el movimiento, y eso lo hace la función que
    -- habla con el sistema.
    IF bf.familia = 'envio' AND EXISTS (
        SELECT 1 FROM public.envio_linea el
         WHERE el.request_id = bf.request_id
           AND el.posicion   = bf.posicion
           AND el.estado     = 'no_llego'
           AND el.id_traslado IS NOT NULL
    ) THEN
        RETURN json_build_object('ok', false, 'codigo', 'RECIBIR_EN_CAJA',
                                 'request_id', bf.request_id);
    END IF;

    UPDATE public.bolsa_faltante
       SET estado      = 'aparecio',
           resolucion  = nullif(btrim(coalesce(p_nota, '')), ''),
           resuelto_por = v_yo,
           resuelto_at = now()
     WHERE id = p_id AND estado = 'abierto'
       AND (ajuste_en_curso_at IS NULL OR ajuste_en_curso_at < now() - interval '3 minutes')
    RETURNING true INTO v_ok;

    IF coalesce(v_ok, false) THEN
        PERFORM public.avisar_faltante_resuelto(p_id, v_yo);
    END IF;

    RETURN json_build_object('ok', coalesce(v_ok, false), 'estado', p_estado);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cerrar_item_por_devolucion(p_devolucion_id uuid, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dev record;
BEGIN
    SELECT * INTO v_dev FROM public.pedido_devolucion WHERE id = p_devolucion_id;
    IF v_dev.id IS NULL OR v_dev.estado <> 'recibida' THEN
        RETURN;   -- sin movimiento recibido no se cierra nada
    END IF;

    UPDATE public.pedido_items SET
        resolucion_status  = 'confirmada',
        resolucion_nota    = coalesce(resolucion_nota, v_dev.nota),
        resuelto_por       = coalesce(resuelto_por, v_dev.solicitada_por),
        resuelto_at        = coalesce(resuelto_at,  v_dev.solicitada_at),
        confirmado_suc_por = p_actor,
        confirmado_suc_at  = now()
    WHERE id = v_dev.pedido_item_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    SELECT v_dev.pedido_item_id, v_dev.pedido_id, v_dev.erp_sucursal_id,
           CASE WHEN v_dev.sentido = 'a_sala' THEN 'traslado_recibido' ELSE 'devolucion_recibida' END,
           pi.resolucion_tipo,
           CASE WHEN v_dev.sentido = 'a_sala' THEN 'Entró en la sucursal: ' ELSE 'Entró en Bodega — ' END
             || v_dev.clave,
           p_actor
      FROM public.pedido_items pi WHERE pi.id = v_dev.pedido_item_id;

    PERFORM public.cerrar_pedido_si_todo_resuelto(v_dev.pedido_id, v_dev.erp_sucursal_id, p_actor);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cerrar_mes_bitacora(p_branch_id bigint, p_periodo text, p_observaciones text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_resumen json;
    v_pend    integer;
    v_id      bigint;
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras_cerrar_mes', 'can_edit') THEN
        RAISE EXCEPTION 'El cierre del mes lo autoriza el regente.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    IF public.bitacora_periodo_cerrado(p_branch_id, p_periodo) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado.' USING ERRCODE = 'P0001';
    END IF;

    IF p_periodo >= to_char(public.bitacora_hoy_sv(), 'YYYY-MM') THEN
        RAISE EXCEPTION 'Ese mes todavia no termina.' USING ERRCODE = 'P0001';
    END IF;

    v_pend := public.bitacora_libro_pendientes(p_branch_id, p_periodo);

    -- Cerrar sella el mes: despues de esto el libro ya no se puede completar
    -- sin reabrirlo. Si quedan renglones esperando su receta, hay que decir por
    -- que se cierra igual — y que quede escrito, no marcado.
    IF v_pend > 0 AND length(coalesce(btrim(p_observaciones), '')) < 15 THEN
        RAISE EXCEPTION
            'En el libro quedan % folios esperando la receta. Si cierras el mes, ya no se pueden completar. Complétalos o escribe aquí por qué se cierra así.',
            v_pend
            USING ERRCODE = 'P0001';
    END IF;

    v_resumen := (
        public.get_bitacora_resumen_mes(p_branch_id, p_periodo)::jsonb
        || jsonb_build_object('libro', jsonb_build_object(
               'renglones', (SELECT count(*) FROM public.bitacora_dispensaciones d
                              WHERE d.branch_id = p_branch_id
                                AND to_char(d.fecha, 'YYYY-MM') = p_periodo),
               'completos',  (SELECT count(*) FROM public.bitacora_dispensaciones d
                              WHERE d.branch_id = p_branch_id
                                AND to_char(d.fecha, 'YYYY-MM') = p_periodo
                                AND d.estado = 'completa'),
               'anulados',   (SELECT count(*) FROM public.bitacora_dispensaciones d
                              WHERE d.branch_id = p_branch_id
                                AND to_char(d.fecha, 'YYYY-MM') = p_periodo
                                AND d.estado = 'anulada'),
               'pendientes', v_pend))
    )::json;

    INSERT INTO public.bitacora_cierres (branch_id, periodo, accion, resumen, motivo, actor_id)
    VALUES (p_branch_id, p_periodo, 'cerrar', v_resumen,
            nullif(btrim(p_observaciones), ''), public.auth_employee_id())
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cerrar_no_reenviadas(p_pedido_id uuid, p_suc_id integer, p_labels text[], p_actor uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_especiales jsonb;
    v_llegadas   jsonb;
    v_items      integer[];
    v_label      text;
    v_n          integer;
BEGIN
    IF p_labels IS NULL OR cardinality(p_labels) = 0 THEN
        RAISE EXCEPTION 'SIN_CAJAS: no se dijo qué caja no se reenvía';
    END IF;

    SELECT CASE WHEN jsonb_typeof(cajas_especiales) = 'array' THEN cajas_especiales ELSE '[]'::jsonb END,
           CASE WHEN jsonb_typeof(cajas_especiales_llegadas) = 'object' THEN cajas_especiales_llegadas ELSE '{}'::jsonb END
      INTO v_especiales, v_llegadas
      FROM public.pedido_sucursal_status
     WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_suc_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_EXISTE: la sucursal no tiene este pedido';
    END IF;

    -- Sólo lo que la sala reportó como no llegado.
    FOREACH v_label IN ARRAY p_labels LOOP
        IF v_llegadas ->> v_label IS DISTINCT FROM 'faltante' THEN
            RAISE EXCEPTION 'NO_FALTA: la caja % no figura como no llegada', v_label;
        END IF;
    END LOOP;

    SELECT array_agg(DISTINCT (x ->> 'pedido_item_id')::integer)
      INTO v_items
      FROM jsonb_array_elements(v_especiales) x
     WHERE x ->> 'label' = ANY (p_labels);
    IF v_items IS NULL OR EXISTS (
        SELECT 1 FROM unnest(p_labels) l
         WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_especiales) x WHERE x ->> 'label' = l)
    ) THEN
        RAISE EXCEPTION 'SIN_RENGLON: una de esas cajas no está en la lista del despacho';
    END IF;

    -- El renglón ENTERO. Un producto que viajó en dos cajas va en un solo
    -- traslado: si una de sus cajas sí llegó, anularlo regresaría también la que
    -- la sala tiene en la mano.
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_especiales) x
         WHERE (x ->> 'pedido_item_id')::integer = ANY (v_items)
           AND NOT (x ->> 'label' = ANY (p_labels))
    ) THEN
        RAISE EXCEPTION 'PARCIAL: parte de ese producto sí llegó';
    END IF;

    -- Nada puede quedar en tránsito: primero se anula en el sistema.
    IF EXISTS (
        SELECT 1 FROM public.pedido_traslado_linea l
         WHERE l.pedido_item_id = ANY (v_items)
           AND l.estado NOT IN ('anulada', 'omitida')
    ) THEN
        RAISE EXCEPTION 'TRASLADO_VIVO: el traslado de ese producto sigue sin anular';
    END IF;

    UPDATE public.pedido_items
       SET status            = 'no_enviado',
           cantidad_enviada  = 0,
           cantidad_recibida = 0,
           falta_caja        = false,
           motivo_no_envio   = coalesce(motivo_no_envio, 'No se reenvió: la caja no llegó a la sucursal')
     WHERE id = ANY (v_items)
       AND pedido_id = p_pedido_id
       AND erp_sucursal_id = p_suc_id
       AND status IN ('pendiente', 'no_enviado');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> cardinality(v_items) THEN
        RAISE EXCEPTION 'ESTADO: ese producto ya se contó o se resolvió de otra forma';
    END IF;

    INSERT INTO public.pedido_item_eventos (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
    SELECT i, p_pedido_id, p_suc_id, 'no_reenviado',
           'La caja no llegó y bodega decidió no reenviarla', p_actor
      FROM unnest(v_items) i;

    UPDATE public.pedido_sucursal_status
       SET cajas_especiales_llegadas = v_llegadas
                                     || (SELECT jsonb_object_agg(l, 'no_reenviada') FROM unnest(p_labels) l)
     WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_suc_id;

    PERFORM public.cerrar_pedido_si_todo_resuelto(p_pedido_id, p_suc_id, p_actor);

    -- El aviso a la sala: por producto, con sus cajas. «Regresó a bodega» sólo
    -- si el producto había salido en un traslado (que ahora está anulado).
    DECLARE
        v_bid  integer;
        v_num  integer;
        v_que  text;
        v_reg  boolean;
    BEGIN
        SELECT branch_id INTO v_bid FROM public.erp_sucursal_map WHERE erp_sucursal_id = p_suc_id;
        SELECT numero INTO v_num FROM public.pedidos WHERE id = p_pedido_id;
        SELECT string_agg(t.cajas || coalesce(' · ' || nullif(t.producto, ''), ''), ' · ' ORDER BY t.primera)
          INTO v_que
          FROM (SELECT string_agg(x ->> 'label', '–' ORDER BY o) AS cajas,
                       max(x ->> 'product_name')                  AS producto,
                       min(o)                                     AS primera
                  FROM jsonb_array_elements(v_especiales) WITH ORDINALITY AS e(x, o)
                 WHERE x ->> 'label' = ANY (p_labels)
                 GROUP BY x ->> 'pedido_item_id') t;
        v_reg := EXISTS (SELECT 1 FROM public.pedido_traslado_linea l
                          WHERE l.pedido_item_id = ANY (v_items) AND l.estado = 'anulada');
        IF v_bid IS NOT NULL THEN
            PERFORM public.notify_branch_como(public.ficha_de_persona(p_actor), v_bid, 'PEDIDO_PROBLEMA',
                'No se reenvía — pedido #' || v_num,
                'Bodega decidió no reenviar lo que no llegó del pedido #' || v_num || ': ' || v_que || '.'
                  || CASE WHEN v_reg THEN ' Ese producto regresó a bodega.' ELSE '' END
                  || ' Ya no queda pendiente.',
                '/pedidos', '{}'::jsonb, true);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        PERFORM public.aviso_de_pedido_fallo('no_reenvio', p_pedido_id, SQLERRM);
    END;

    RETURN json_build_object('items', v_items, 'labels', p_labels);
END;
$function$;

CREATE OR REPLACE FUNCTION public.clave_movimiento_de_item(p_item_id integer, p_prefijo text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_base   text;
    v_numero integer;
    v_suc    text;
    v_ped    uuid;
    v_erpsuc integer;
BEGIN
    SELECT pi.pedido_id, pi.erp_sucursal_id INTO v_ped, v_erpsuc
      FROM public.pedido_items pi WHERE pi.id = p_item_id;
    IF v_ped IS NULL THEN
        RAISE EXCEPTION 'ITEM_NO_EXISTE';
    END IF;

    SELECT l.clave INTO v_base
      FROM public.pedido_traslado_linea l
     WHERE l.pedido_id = v_ped AND l.erp_sucursal_id = v_erpsuc AND l.pedido_item_id = p_item_id;

    IF v_base IS NOT NULL THEN
        RETURN p_prefijo || '-' || v_base;
    END IF;

    -- El pedido no se despachó por el portal: no hay hoja que citar. Misma
    -- forma, con H0, para que la clave siga siendo única y reconocible.
    SELECT numero INTO v_numero FROM public.pedidos WHERE id = v_ped;
    SELECT codigo INTO v_suc FROM public.erp_sucursal_map WHERE erp_sucursal_id = v_erpsuc;
    IF v_suc IS NULL THEN
        RAISE EXCEPTION 'SALA_SIN_CODIGO: la sucursal % no tiene código en el registro de sucursales', v_erpsuc;
    END IF;

    RETURN p_prefijo || '-P' || coalesce(v_numero::text, '0') || '-' || v_suc || '-H0-I' || p_item_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.completar_dispensacion(p_dispensacion_id bigint, p_paciente_nombre text, p_medico_id bigint, p_cantidad_prescrita numeric, p_fecha_prescripcion date DEFAULT NULL::date, p_paciente_edad smallint DEFAULT NULL::smallint, p_paciente_documento text DEFAULT NULL::text, p_foto_url text DEFAULT NULL::text, p_receta_id bigint DEFAULT NULL::bigint, p_motivo_pendiente text DEFAULT NULL::text, p_notas text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_d        public.bitacora_dispensaciones%ROWTYPE;
    v_receta   public.recetas%ROWTYPE;
    v_item_id  bigint;
    v_corr     integer;
    v_anio     smallint;
    v_previo   numeric := 0;
    v_entregado numeric;
    v_prescrito numeric;
    v_estado   text;
BEGIN
    SELECT * INTO v_d FROM public.bitacora_dispensaciones WHERE id = p_dispensacion_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese folio no existe.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.bitacora_exigir_acceso(v_d.branch_id, 'can_edit');
    PERFORM public.bitacora_exigir_libro();

    IF v_d.estado = 'anulada' THEN
        RAISE EXCEPTION 'Ese folio está anulado. La venta se invalidó ante el MH.' USING ERRCODE = 'P0001';
    END IF;
    IF public.bitacora_periodo_cerrado(v_d.branch_id, to_char(v_d.fecha, 'YYYY-MM')) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado. Hay que reabrirlo para poder completarlo.' USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(btrim(p_paciente_nombre), '') = '' THEN
        RAISE EXCEPTION 'Falta el nombre del paciente.' USING ERRCODE = 'P0001';
    END IF;
    IF p_medico_id IS NULL THEN
        RAISE EXCEPTION 'Falta el medico.' USING ERRCODE = 'P0001';
    END IF;
    IF p_cantidad_prescrita IS NULL OR p_cantidad_prescrita <= 0 THEN
        RAISE EXCEPTION 'Falta cuanto receto el medico.' USING ERRCODE = 'P0001';
    END IF;

    v_anio := extract(year FROM v_d.fecha)::smallint;

    IF p_receta_id IS NOT NULL THEN
        SELECT * INTO v_receta FROM public.recetas WHERE id = p_receta_id;
        IF NOT FOUND OR v_receta.branch_id <> v_d.branch_id THEN
            RAISE EXCEPTION 'Esa receta no es de esta sucursal.' USING ERRCODE = 'P0002';
        END IF;
        IF v_receta.estado = 'anulada' THEN
            RAISE EXCEPTION 'Esa receta esta anulada.' USING ERRCODE = 'P0001';
        END IF;

        SELECT coalesce(sum(d.cantidad), 0), max(ri.cantidad_prescrita)
          INTO v_previo, v_prescrito
          FROM public.receta_items ri
          LEFT JOIN public.bitacora_dispensaciones d
                 ON d.receta_item_id = ri.id AND d.estado <> 'anulada' AND d.id <> p_dispensacion_id
         WHERE ri.receta_id = v_receta.id
           AND ri.erp_product_id IS NOT DISTINCT FROM v_d.erp_product_id;
    END IF;

    v_prescrito := coalesce(v_prescrito, p_cantidad_prescrita);

    IF v_previo + v_d.cantidad > v_prescrito THEN
        RAISE EXCEPTION
            'No se puede entregar más de lo recetado. La receta es de %, ya lleva % entregado y este folio suma %.',
            v_prescrito, v_previo, v_d.cantidad
            USING ERRCODE = 'P0001';
    END IF;

    IF p_receta_id IS NULL THEN
        v_corr := public.bitacora_tomar_folio(v_d.branch_id, v_anio, 'receta');

        INSERT INTO public.recetas (
            branch_id, anio, correlativo, paciente_nombre, paciente_edad, paciente_documento,
            medico_id, fecha_prescripcion, foto_url, motivo_pendiente, notas, creada_por
        ) VALUES (
            v_d.branch_id, v_anio, v_corr, btrim(p_paciente_nombre), p_paciente_edad,
            nullif(btrim(p_paciente_documento), ''), p_medico_id,
            coalesce(p_fecha_prescripcion, v_d.fecha), nullif(btrim(p_foto_url), ''),
            p_motivo_pendiente, nullif(btrim(p_notas), ''), public.auth_employee_id()
        )
        RETURNING * INTO v_receta;
    END IF;

    SELECT id INTO v_item_id FROM public.receta_items
     WHERE receta_id = v_receta.id AND erp_product_id IS NOT DISTINCT FROM v_d.erp_product_id
     LIMIT 1;

    IF v_item_id IS NULL THEN
        INSERT INTO public.receta_items (receta_id, erp_product_id, descripcion, cantidad_prescrita)
        VALUES (v_receta.id, v_d.erp_product_id, v_d.producto_nombre, p_cantidad_prescrita)
        RETURNING id INTO v_item_id;
    END IF;

    UPDATE public.bitacora_dispensaciones
       SET receta_item_id = v_item_id,
           estado = 'completa',
           completada_por = public.auth_employee_id(),
           completada_at = now(),
           notas = coalesce(nullif(btrim(p_notas), ''), notas)
     WHERE id = p_dispensacion_id;

    UPDATE public.recetas
       SET foto_url = coalesce(nullif(btrim(p_foto_url), ''), foto_url)
     WHERE id = v_receta.id;

    v_estado := public.recalcular_estado_receta(v_receta.id);

    SELECT coalesce(sum(d.cantidad), 0) INTO v_entregado
      FROM public.bitacora_dispensaciones d
     WHERE d.receta_item_id = v_item_id AND d.estado <> 'anulada';
    SELECT cantidad_prescrita INTO v_prescrito FROM public.receta_items WHERE id = v_item_id;

    RETURN json_build_object(
        'receta_id', v_receta.id,
        'correlativo_txt', v_receta.anio::text || '-' || lpad(v_receta.correlativo::text, 5, '0'),
        'entregado', v_entregado,
        'prescrito', v_prescrito,
        'pendiente', v_prescrito - v_entregado,
        'receta_estado', v_estado
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.compra_erroneo_adjuntar_nota(p_id bigint, p_nota bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_e public.compra_renglon_erroneo; v_n public.purchase_dte_documents;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras','cargar_compra']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_e FROM public.compra_renglon_erroneo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese producto no existe.'; END IF;
  IF v_e.estado IN ('salio','saliendo','sin_verificar') THEN RAISE EXCEPTION 'Ese producto ya salió, está saliendo o falta comprobar su salida.'; END IF;
  IF v_e.nota_papel_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.compra_nota_credito_papel
        WHERE id = v_e.nota_papel_id AND estado IN ('registrada','enviando','sin_verificar')) THEN
    RAISE EXCEPTION 'La nota en papel de este producto ya está en el libro de compras: no se puede cambiar.';
  END IF;
  IF p_nota IS NOT NULL THEN
    SELECT * INTO v_n FROM public.purchase_dte_documents WHERE id = p_nota;
    IF NOT FOUND OR v_n.tipo_dte <> '05' THEN RAISE EXCEPTION 'Eso no es una nota de crédito.'; END IF;
    IF coalesce(v_n.invalidado, false) THEN RAISE EXCEPTION 'Esa nota de crédito está anulada.'; END IF;
    IF v_n.emisor_nit IS DISTINCT FROM v_e.emisor_nit THEN RAISE EXCEPTION 'La nota es de otro proveedor.'; END IF;
  END IF;
  UPDATE public.compra_renglon_erroneo
     SET nota_credito_document_id = p_nota,
         nota_papel_id = NULL,
         estado = CASE WHEN p_nota IS NOT NULL THEN 'con_nota'
                       WHEN erp_traslado_id IS NOT NULL THEN 'en_vencidos' ELSE 'por_mover' END,
         updated_at = now()
   WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compra_erroneo_adjuntar_nota_papel(p_id bigint, p_nota jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_e public.compra_renglon_erroneo; v_id bigint;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras','cargar_compra']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_e FROM public.compra_renglon_erroneo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese producto no existe.'; END IF;
  IF v_e.estado IN ('salio','saliendo','sin_verificar') THEN RAISE EXCEPTION 'Ese producto ya salió, está saliendo o falta comprobar su salida.'; END IF;
  IF v_e.nota_papel_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.compra_nota_credito_papel
        WHERE id = v_e.nota_papel_id AND estado IN ('registrada','enviando','sin_verificar')) THEN
    RAISE EXCEPTION 'La nota en papel de este producto ya está en el libro de compras: no se puede cambiar.';
  END IF;
  v_id := public.compra_nota_papel_guardar(v_e.emisor_nit, v_e.emisor_nombre, p_nota, 'erroneo', p_id);
  UPDATE public.compra_renglon_erroneo
     SET nota_papel_id = v_id, nota_credito_document_id = NULL, estado = 'con_nota', updated_at = now()
   WHERE id = p_id;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.compra_pedir_vence(p_document_id bigint, p_branch_id integer, p_renglones jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint; v_doc record; v_quien uuid := auth_employee_id(); v_gente uuid[];
BEGIN
  IF NOT (SELECT auth_has_module_permission('cargar_compra','can_edit')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF jsonb_typeof(p_renglones) <> 'array' OR jsonb_array_length(p_renglones) = 0 THEN RAISE EXCEPTION 'No hay productos que pedir.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_renglones) r
              WHERE jsonb_typeof(r->'renglon') <> 'number' OR coalesce(btrim(r->>'descripcion'),'') = '')
     OR (SELECT count(DISTINCT r->>'renglon') FROM jsonb_array_elements(p_renglones) r) <> jsonb_array_length(p_renglones) THEN
    RAISE EXCEPTION 'Los productos del pedido vienen incompletos.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_sucursal_map WHERE branch_id = p_branch_id AND NOT es_bodega) THEN RAISE EXCEPTION 'Esa sucursal no existe.'; END IF;
  SELECT emisor_nombre, fecha_emision INTO v_doc FROM purchase_dte_documents WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa factura no existe.'; END IF;
  INSERT INTO compra_pedido_vence (document_id, branch_id, emisor_nombre, fecha_emision, renglones, pedido_por)
  VALUES (p_document_id, p_branch_id, v_doc.emisor_nombre, v_doc.fecha_emision::date, p_renglones, v_quien)
  RETURNING id INTO v_id;
  SELECT array_agg(e.id) INTO v_gente
    FROM employees e JOIN role_permissions rp ON rp.role_id = e.role_id AND rp.module_key = 'traslados' AND rp.can_edit
   WHERE e.status = 'ACTIVO' AND e.branch_id = p_branch_id AND (e.tipo_ficha IS NULL OR e.tipo_ficha = 'empleado');
  IF v_gente IS NOT NULL THEN
    PERFORM notify_employees(v_gente, 'COMPRA_PEDIDO_VENCE',
      'Bodega te pide fechas de vencimiento',
      format('De la factura de %s: %s producto(s). Ponlas en Traslados → En camino.',
             coalesce(v_doc.emisor_nombre, 'un proveedor'), jsonb_array_length(p_renglones)),
      '/traslados?tab=recibir', jsonb_build_object('origen','cargar-compra','pedido', v_id), true, p_branch_id);
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Ya hay un pedido de fechas abierto para esta factura en esa sucursal.';
END;
$function$;

CREATE OR REPLACE FUNCTION public.compra_responder_vence(p_id bigint, p_respuestas jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v record; r jsonb; v_val text; v_mes date; v_limpias jsonb := '{}'::jsonb;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  SELECT * INTO v FROM compra_pedido_vence WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese pedido no existe.'; END IF;
  IF NOT ((SELECT auth_has_module_permission('traslados','can_edit'))
          AND ((SELECT auth_module_scope('traslados')) = 'ALL' OR v.branch_id = (SELECT auth_employee_branch_id())))
     AND NOT (SELECT auth_has_module_permission('cargar_compra','can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF v.estado <> 'pendiente' THEN RAISE EXCEPTION 'Ese pedido ya se contestó.'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(v.renglones) LOOP
    v_val := p_respuestas ->> (r ->> 'renglon');
    IF v_val IS NULL OR v_val !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
      RAISE EXCEPTION 'Falta la fecha de «%».', r ->> 'descripcion';
    END IF;
    v_mes := to_date(v_val || '-01', 'YYYY-MM-DD');
    IF v_mes < date_trunc('month', v_hoy)::date THEN
      RAISE EXCEPTION '«%»: esa fecha ya pasó.', r ->> 'descripcion';
    END IF;
    IF v_mes > v_hoy + interval '10 years' THEN
      RAISE EXCEPTION '«%»: revisa el año de la fecha.', r ->> 'descripcion';
    END IF;
    v_limpias := v_limpias || jsonb_build_object(r ->> 'renglon', v_val);
  END LOOP;
  UPDATE compra_pedido_vence
     SET estado = 'respondido', respuestas = v_limpias, respondido_por = auth_employee_id(),
         respondido_at = now(), updated_at = now()
   WHERE id = p_id;
  PERFORM notify_employees(ARRAY[v.pedido_por], 'COMPRA_PEDIDO_VENCE',
    'La sucursal contestó las fechas de vencimiento',
    format('Factura de %s: ya puedes cargarla.', coalesce(v.emisor_nombre, 'un proveedor')),
    '/cargar-compra', jsonb_build_object('origen','cargar-compra','pedido', p_id), true, v.branch_id);
END;
$function$;

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
                  THEN 'El envío a la sucursal se cortó: buscar el traslado en el sistema antes de volver a enviar.'
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

CREATE OR REPLACE FUNCTION public.confirmar_alias_producto(p_emisor_nit text, p_codigo_prov text, p_product_id integer, p_factor numeric DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_emp uuid;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras','facturas_compra','cargar_compra']) THEN
    RAISE EXCEPTION 'No tienes permiso para confirmar productos de compra.';
  END IF;
  IF nullif(btrim(coalesce(p_emisor_nit,'')),'') IS NULL
     OR nullif(btrim(coalesce(p_codigo_prov,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Falta el proveedor o su código de producto.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Ese producto no existe.';
  END IF;
  IF p_factor IS NULL OR p_factor <= 0 OR p_factor > 1000 THEN
    RAISE EXCEPTION 'Las unidades por cada una del proveedor tienen que estar entre 1 y 1000.';
  END IF;

  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';

  INSERT INTO public.compra_producto_alias
         (emisor_nit, codigo_proveedor, product_id, factor_proveedor, origen, confirmado_por, veces_usado)
  VALUES (btrim(p_emisor_nit), btrim(p_codigo_prov), p_product_id, p_factor, 'confirmado', v_emp, 1)
  ON CONFLICT (emisor_nit, codigo_proveedor) DO UPDATE
     SET product_id       = EXCLUDED.product_id,
         factor_proveedor = EXCLUDED.factor_proveedor,
         origen           = 'confirmado',
         confirmado_por   = EXCLUDED.confirmado_por,
         veces_usado      = public.compra_producto_alias.veces_usado + 1,
         updated_at       = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_llegada_diferencia(p_item_id integer, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor   uuid := auth_employee_id();
    v_it      record;
    v_op      record;
    v_es_sala boolean;
    v_nota    text := nullif(btrim(coalesce(p_nota, '')), '');
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    SELECT pi.* INTO v_it FROM public.pedido_items pi WHERE pi.id = p_item_id FOR UPDATE;
    IF v_it.id IS NULL THEN
        RAISE EXCEPTION 'ITEM_NO_EXISTE';
    END IF;
    IF v_it.resolucion_status <> 'acordada' THEN
        RAISE EXCEPTION 'SIN_ACUERDO: todavía no hay una decisión acordada sobre este producto';
    END IF;

    SELECT * INTO v_op FROM public.diferencia_opcion
     WHERE error_tipo = v_it.error_tipo AND valor = v_it.resolucion_tipo;
    IF v_op.cierra_con NOT IN ('llegada_sala', 'llegada_bodega') THEN
        RAISE EXCEPTION 'NO_SE_CIERRA_ASI: esta decisión no se cierra confirmando una llegada';
    END IF;

    v_es_sala := auth_employee_erp_sucursal_id() IS NOT DISTINCT FROM v_it.erp_sucursal_id;

    -- Lo confirma quien lo RECIBE, y punto. Acá el alcance no sirve de excusa:
    -- Bodega tiene alcance ALL sobre Pedidos y con eso podría dar por llegado a
    -- la sala un producto que nunca salió.
    IF v_op.cierra_con = 'llegada_sala'   AND NOT v_es_sala AND NOT public.auth_es_supervision() THEN
        RAISE EXCEPTION 'LO_CONFIRMA_LA_SALA: el producto llega a la sucursal y la sucursal lo confirma.';
    END IF;
    IF v_op.cierra_con = 'llegada_bodega' AND v_es_sala AND NOT public.auth_es_supervision() THEN
        RAISE EXCEPTION 'LO_CONFIRMA_BODEGA: el producto vuelve a bodega, y bodega es quien lo ve';
    END IF;

    UPDATE public.pedido_items SET
        resolucion_status   = 'confirmada',
        resolucion_vence_at = NULL,
        resolucion_nota     = coalesce(v_nota, resolucion_nota),
        confirmado_suc_por  = v_actor,
        confirmado_suc_at   = now()
    WHERE id = p_item_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    VALUES (p_item_id, v_it.pedido_id, v_it.erp_sucursal_id, 'diferencia_llegada',
            v_it.resolucion_tipo, v_nota, v_actor);

    PERFORM public.cerrar_pedido_si_todo_resuelto(v_it.pedido_id, v_it.erp_sucursal_id, v_actor);

    RETURN jsonb_build_object('estado', 'confirmada');
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_llegada_pedido(p_pedido_id uuid, p_sucursal_id integer, p_cajas_danadas integer[] DEFAULT '{}'::integer[], p_cajas_faltan integer[] DEFAULT '{}'::integer[], p_nota text DEFAULT NULL::text, p_electrolit_faltan integer DEFAULT NULL::integer, p_especiales_llegadas jsonb DEFAULT NULL::jsonb, p_cajas_extra integer DEFAULT 0, p_cajas_extra_notas jsonb DEFAULT NULL::jsonb, p_pagina_items jsonb DEFAULT NULL::jsonb, p_electrolit_ids integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor     uuid := auth_employee_id();
  s           public.pedido_sucursal_status%ROWTYPE;
  v_dan       integer[] := coalesce(p_cajas_danadas, '{}');
  v_falt      integer[] := coalesce(p_cajas_faltan, '{}');
  v_elec      integer   := coalesce(p_electrolit_faltan, 0);
  v_esp_falt  text[];
  v_huerf     text[];
  v_has_falta boolean;
  v_has_dan   boolean;
  v_tipo      text;
  v_pag       jsonb;
  v_elec_ids  integer[] := '{}';
  v_ids       integer[] := '{}';
  v_marcados  integer := 0;
  v_n         integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos']))
     AND p_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: sólo puedes recibir el pedido de tu sucursal';
  END IF;

  SELECT * INTO s FROM public.pedido_sucursal_status
   WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: esa sucursal no tiene ese pedido';
  END IF;
  IF s.llegada_tipo IS NOT NULL THEN
    RAISE EXCEPTION 'YA_CONFIRMADA: la llegada de esa sucursal ya se confirmó';
  END IF;

  v_esp_falt := ARRAY(SELECT k FROM jsonb_each_text(
                  CASE WHEN jsonb_typeof(p_especiales_llegadas) = 'object' THEN p_especiales_llegadas ELSE '{}'::jsonb END) AS e(k, v)
                 WHERE v = 'faltante');
  v_has_dan   := cardinality(v_dan) > 0;
  v_has_falta := cardinality(v_falt) > 0 OR v_elec > 0 OR cardinality(v_esp_falt) > 0;
  v_tipo := CASE WHEN v_has_falta AND v_has_dan THEN 'mixto'
                 WHEN v_has_falta THEN 'falta_caja'
                 WHEN v_has_dan   THEN 'caja_danada'
                 ELSE 'completa' END;

  -- Electrolit: los renglones que eligió la pantalla, y sólo de esta sala.
  -- Se toman ANTES de marcar las cajas numeradas (ver arriba).
  IF v_elec > 0 AND cardinality(coalesce(p_electrolit_ids, '{}')) > 0 THEN
    v_elec_ids := ARRAY(
      SELECT pi.id FROM public.pedido_items pi
       WHERE pi.id = ANY(p_electrolit_ids)
         AND pi.pedido_id = p_pedido_id AND pi.erp_sucursal_id = p_sucursal_id
         AND NOT coalesce(pi.falta_caja, false)
         AND pi.status IS DISTINCT FROM 'recibido');
  END IF;

  -- Especiales: el dueño de cada etiqueta, o se planta.
  IF cardinality(v_esp_falt) > 0 THEN
    v_huerf := ARRAY(SELECT l FROM unnest(v_esp_falt) l
                      WHERE NOT EXISTS (
                        SELECT 1 FROM jsonb_array_elements(
                          CASE WHEN jsonb_typeof(s.cajas_especiales) = 'array' THEN s.cajas_especiales ELSE '[]'::jsonb END) c
                         WHERE c ->> 'label' = l AND c ->> 'pedido_item_id' IS NOT NULL));
    IF cardinality(v_huerf) > 0 THEN
      RAISE EXCEPTION 'No se pudo identificar qué producto es la caja %. Avisa a bodega antes de confirmar la llegada.',
        array_to_string(v_huerf, ', ');
    END IF;
  END IF;

  -- 1. Cajas numeradas que no llegaron.
  IF cardinality(v_falt) > 0 THEN
    v_pag := CASE WHEN jsonb_typeof(s.pagina_items) = 'object' THEN s.pagina_items ELSE '{}'::jsonb END;
    IF v_pag <> '{}'::jsonb THEN
      v_ids := public.renglones_de_cajas(s.caja_map, v_pag, v_falt);
    ELSIF jsonb_typeof(s.caja_map) = 'object' AND s.caja_map <> '{}'::jsonb THEN
      IF coalesce(jsonb_typeof(p_pagina_items), '') <> 'object' OR p_pagina_items = '{}'::jsonb THEN
        RAISE EXCEPTION 'PAGINA_ITEMS_REQUERIDO: el pedido no tiene el mapa de renglones por hoja; recalcúlalo y mándalo en p_pagina_items';
      END IF;
      UPDATE public.pedido_sucursal_status SET pagina_items = p_pagina_items WHERE id = s.id;
      v_ids := public.renglones_de_cajas(s.caja_map, p_pagina_items, v_falt);
    ELSE
      v_ids := ARRAY(SELECT id FROM public.pedido_items
                      WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
                        AND status = 'pendiente');
    END IF;
    IF cardinality(v_ids) > 0 THEN
      UPDATE public.pedido_items SET falta_caja = true
       WHERE id = ANY(v_ids) AND pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_marcados := v_marcados + v_n;
    END IF;
  END IF;

  -- 2. Electrolit que faltó.
  IF cardinality(v_elec_ids) > 0 THEN
    UPDATE public.pedido_items SET falta_caja = true WHERE id = ANY(v_elec_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_marcados := v_marcados + v_n;
  END IF;

  -- 3. Cajas especiales que no llegaron.
  IF cardinality(v_esp_falt) > 0 THEN
    v_ids := public.renglones_de_especiales(s.cajas_especiales, v_esp_falt);
    IF cardinality(v_ids) > 0 THEN
      UPDATE public.pedido_items SET falta_caja = true
       WHERE id = ANY(v_ids) AND pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_marcados := v_marcados + v_n;
    END IF;
  END IF;

  -- 4 + 5. La llegada y su detalle, en una sola escritura.
  UPDATE public.pedido_sucursal_status
     SET llegada_fisica_at         = coalesce(llegada_fisica_at, now()),
         llegada_fisica_por        = CASE WHEN llegada_fisica_at IS NULL THEN v_actor ELSE llegada_fisica_por END,
         llegada_tipo              = v_tipo,
         llegada_nota              = nullif(p_nota, ''),
         falta_cajas               = to_jsonb(v_falt),
         cajas_danadas             = to_jsonb(v_dan),
         falta_caja_at             = CASE WHEN v_has_falta OR v_has_dan THEN now() ELSE falta_caja_at END,
         electrolit_ok             = CASE WHEN p_electrolit_faltan IS NOT NULL THEN p_electrolit_faltan = 0 ELSE electrolit_ok END,
         electrolit_faltantes      = CASE WHEN p_electrolit_faltan IS NOT NULL THEN p_electrolit_faltan ELSE electrolit_faltantes END,
         cajas_especiales_llegadas = CASE WHEN p_especiales_llegadas IS NOT NULL THEN p_especiales_llegadas ELSE cajas_especiales_llegadas END,
         cajas_extra               = CASE WHEN coalesce(p_cajas_extra, 0) > 0 THEN p_cajas_extra END,
         cajas_extra_notas         = CASE WHEN coalesce(p_cajas_extra, 0) > 0 THEN p_cajas_extra_notas END
   WHERE id = s.id;

  RETURN jsonb_build_object('tipo', v_tipo, 'renglones_en_falta', v_marcados);
END;
$function$;

CREATE OR REPLACE FUNCTION public.conteo_caja_problemas_de(p_conteo_id uuid)
 RETURNS TABLE(erp_product_id integer, is_vencidos boolean, tipo text, detalle text, bloquea boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch bigint;
BEGIN
  SELECT branch_id INTO v_branch FROM public.conteos_inventario WHERE id = p_conteo_id;

  RETURN QUERY
  WITH plan AS MATERIALIZED (SELECT * FROM public.conteo_caja_plan(p_conteo_id)),
  ln AS (
    SELECT pl.erp_product_id AS pid, pl.is_vencidos AS venc, e->>'lote' AS lote,
           NULLIF(e->>'vence', '') AS vence, (e->>'unidades')::int AS u,
           COALESCE((e->>'factor_desconocido')::boolean, false) AS sf,
           COALESCE(p.regulado, false) AS reg, COALESCE(p.perecedero, false) AS per
    FROM plan pl
    CROSS JOIN LATERAL jsonb_array_elements(pl.lineas) e
    LEFT JOIN public.products p ON p.id = pl.erp_product_id
  )
  -- A medio contar.
  SELECT pl.erp_product_id, pl.is_vencidos, 'A_MEDIO_CONTAR'::text,
         'Tiene productos contados y otros sin contar. Cuenta los que faltan (0 si no hay).'::text, true
  FROM plan pl WHERE pl.a_medio_contar
  UNION ALL
  -- Sobra sin lote en un producto que lo lleva.
  SELECT ln.pid, ln.venc, 'SOBRA_SIN_LOTE',
         'Se contó de más sin lote asignado: agrega la línea del lote impreso y cuenta ahí esas unidades.', true
  FROM ln WHERE ln.u > 0 AND NOT ln.sf AND ln.reg AND public.conteo_lote_es_generico(ln.lote)
  UNION ALL
  -- Sobra sin vencimiento en un producto que lo exige.
  SELECT ln.pid, ln.venc, 'FALTA_VENCE',
         format('Lo que sobra%s no tiene vencimiento: agrega la línea con su fecha.',
                CASE WHEN public.conteo_lote_es_generico(ln.lote) THEN '' ELSE ' del lote ' || ln.lote END), true
  FROM ln WHERE ln.u > 0 AND NOT ln.sf AND (ln.reg OR ln.per) AND ln.vence IS NULL
        AND NOT (ln.reg AND public.conteo_lote_es_generico(ln.lote))
  UNION ALL
  -- Una presentación sin contenido conocido no se puede llevar a unidades.
  SELECT ln.pid, ln.venc, 'SIN_FACTOR',
         'No se sabe cuántas unidades trae una de sus presentaciones: se ajusta a mano.', false
  FROM ln WHERE ln.sf
  UNION ALL
  -- Una venta pegada al momento en que se contó: la existencia que se leyó
  -- pudo no tenerla todavía (el espejo va 1-2 minutos atrás), y el ajuste la
  -- descontaría dos veces. Se avisa para recontar antes de aprobar.
  SELECT pl.erp_product_id, pl.is_vencidos, 'VENTA_CERCA',
         'Se vendió cerca del momento en que se contó: recuéntalo antes de aprobar.', false
  FROM plan pl
  WHERE NOT pl.is_vencidos AND pl.contado_hasta IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.conteo_inventario_items ci
      JOIN public.sales_invoice_items sii ON sii.erp_product_id = ci.erp_product_id
      JOIN public.sales_invoices si ON si.id = sii.invoice_id
      WHERE ci.conteo_id = p_conteo_id AND ci.erp_product_id = pl.erp_product_id
        AND NOT ci.is_vencidos AND ci.fisico_cantidad IS NOT NULL
        AND si.branch_id = v_branch
        AND si.fecha = (GREATEST(ci.contado_at, ci.recontado_at) AT TIME ZONE 'America/El_Salvador')::date
        AND public.venta_valida(si.estado)
        AND (si.fecha + si.hora) BETWEEN
              (GREATEST(ci.contado_at, ci.recontado_at) AT TIME ZONE 'America/El_Salvador') - interval '5 minutes'
          AND (GREATEST(ci.contado_at, ci.recontado_at) AT TIME ZONE 'America/El_Salvador') + interval '1 minute');
END;
$function$;

CREATE OR REPLACE FUNCTION public.corregir_recepcion_de_item(p_item_id integer, p_cantidad integer, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor   uuid := auth_employee_id();
    v_it      record;
    v_ped     text;
    v_enviado integer;
    v_antes   integer;
    v_error   text;
    v_prob    integer;
    v_nota    text := nullif(btrim(coalesce(p_nota, '')), '');
    v_reabre  boolean := false;
    v_cerrada boolean;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    SELECT * INTO v_it FROM public.pedido_items WHERE id = p_item_id FOR UPDATE;
    IF v_it.id IS NULL THEN
        RAISE EXCEPTION 'ITEM_NO_EXISTE';
    END IF;

    IF v_it.es_extra THEN
        RAISE EXCEPTION 'ES_EXTRA: lo que llegó de más se corrige en su propia pantalla';
    END IF;

    IF auth_module_scope('pedidos') <> 'ALL'
       AND auth_employee_erp_sucursal_id() IS DISTINCT FROM v_it.erp_sucursal_id THEN
        RAISE EXCEPTION 'OTRA_SALA: lo corrige la sucursal que contó el pedido';
    END IF;

    IF v_it.status NOT IN ('recibido', 'con_diferencia') THEN
        RAISE EXCEPTION 'NO_CONTADO: ese producto todavía no se confirmó; se cuenta en su hoja';
    END IF;

    IF NOT public.recepcion_corregible(v_it.pedido_id, v_it.erp_sucursal_id) THEN
        RAISE EXCEPTION 'PLAZO_VENCIDO: un error de la recepción se reporta hasta 2 días después '
                        'de cerrarla. Pasado ese plazo lo levanta un supervisor o administrador.';
    END IF;

    IF v_it.resolucion_status = 'confirmada' THEN
        RAISE EXCEPTION 'YA_RESUELTA: esta diferencia ya se cerró de acuerdo entre la sucursal y bodega, '
                        'y el producto ya se movió. Si apareció un problema nuevo, hay que levantarlo '
                        'con un supervisor o administrador. No se cambia la cantidad que las dos partes firmaron.';
    END IF;
    IF v_it.resolucion_status IS NOT NULL THEN
        RAISE EXCEPTION 'YA_EN_CURSO: esta diferencia ya se está resolviendo; '
                        'la cantidad es la que aceptó la otra parte';
    END IF;

    IF p_cantidad IS NULL OR p_cantidad < 0 THEN
        RAISE EXCEPTION 'CANTIDAD_INVALIDA: escribí cuántos contaste';
    END IF;

    SELECT status INTO v_ped FROM public.pedidos WHERE id = v_it.pedido_id FOR UPDATE;
    IF v_ped = 'anulado' THEN
        RAISE EXCEPTION 'PEDIDO_ANULADO: no se corrige el conteo de un pedido anulado';
    END IF;

    SELECT recibido_erp_at IS NOT NULL INTO v_cerrada
      FROM public.pedido_sucursal_status
     WHERE pedido_id = v_it.pedido_id AND erp_sucursal_id = v_it.erp_sucursal_id;
    IF coalesce(v_cerrada, false) AND v_nota IS NULL THEN
        RAISE EXCEPTION 'MOTIVO_REQUERIDO: la recepción ya se cerró; escribí qué pasó';
    END IF;

    v_enviado := coalesce(v_it.cantidad_enviada, v_it.cantidad_asignada);
    v_antes   := coalesce(v_it.cantidad_recibida, 0);

    IF p_cantidad = v_antes AND v_nota IS NOT DISTINCT FROM v_it.nota_diferencia THEN
        RETURN jsonb_build_object('cambio', false, 'cantidad', v_antes,
                                  'error_tipo', v_it.error_tipo, 'status', v_it.status);
    END IF;

    v_error := CASE
        WHEN p_cantidad < v_enviado                    THEN 'faltante'
        WHEN p_cantidad > v_enviado                    THEN 'sobrante'
        WHEN v_it.error_tipo IN ('danado', 'vencido')  THEN v_it.error_tipo
        ELSE NULL
    END;
    v_prob := CASE
        WHEN v_error IN ('danado', 'vencido')
            THEN least(coalesce(v_it.cantidad_problema, 1), greatest(p_cantidad, 1))
        ELSE NULL
    END;

    UPDATE public.pedido_items SET
        cantidad_recibida = p_cantidad,
        error_tipo        = v_error,
        cantidad_problema = v_prob,
        nota_diferencia   = v_nota,
        status            = CASE WHEN v_error IS NULL THEN 'recibido' ELSE 'con_diferencia' END
    WHERE id = p_item_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
    VALUES (p_item_id, v_it.pedido_id, v_it.erp_sucursal_id, 'correccion_conteo',
            format('Contado %s → %s', v_antes, p_cantidad)
              || CASE WHEN coalesce(v_cerrada, false) THEN ' · después de cerrar la recepción' ELSE '' END
              || coalesce(' · ' || v_nota, ''),
            v_actor);

    IF v_error IS NOT NULL THEN
        UPDATE public.pedido_sucursal_status
           SET corregido_bodega_at        = NULL,
               corregido_bodega_por       = NULL,
               corregido_bodega_nota      = NULL,
               confirmado_correccion_at   = NULL,
               confirmado_correccion_por  = NULL
         WHERE pedido_id       = v_it.pedido_id
           AND erp_sucursal_id = v_it.erp_sucursal_id
           AND (corregido_bodega_at IS NOT NULL OR confirmado_correccion_at IS NOT NULL);
        v_reabre := FOUND;
        PERFORM public.reabrir_diferencias_de_sala(v_it.pedido_id, v_it.erp_sucursal_id, v_actor);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.pedido_items WHERE pedido_id = v_it.pedido_id AND status = 'pendiente'
    ) THEN
        IF EXISTS (SELECT 1 FROM public.pedido_items WHERE pedido_id = v_it.pedido_id AND status = 'con_diferencia') THEN
            UPDATE public.pedidos SET status = 'parcial'    WHERE id = v_it.pedido_id AND status <> 'anulado';
        ELSE
            UPDATE public.pedidos SET status = 'completado' WHERE id = v_it.pedido_id AND status <> 'anulado';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM public.pedido_items WHERE pedido_id = v_it.pedido_id AND status = 'con_diferencia') THEN
        UPDATE public.pedidos SET status = 'parcial' WHERE id = v_it.pedido_id AND status <> 'anulado';
    END IF;

    RETURN jsonb_build_object('cambio', true, 'antes', v_antes, 'cantidad', p_cantidad,
                              'enviado', v_enviado, 'error_tipo', v_error,
                              'reabrio_el_cierre', v_reabre,
                              'status', CASE WHEN v_error IS NULL THEN 'recibido' ELSE 'con_diferencia' END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_codigo_de_vinculacion(p_branch_id bigint, p_nombre text)
 RETURNS TABLE(id uuid, codigo text, expira timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    -- Sin O/0/I/1: en un papel escrito a mano esos cuatro se leen igual, y el
    -- error aparecería recién al final de la instalación.
    v_abc  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_cod  text := '';
    v_dev  uuid;
    i      integer;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['impresion'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_branch_id IS NULL OR btrim(coalesce(p_nombre,'')) = '' THEN
        RAISE EXCEPTION 'Falta la sucursal o el nombre de la caja.';
    END IF;

    FOR i IN 1..8 LOOP
        v_cod := v_cod || substr(v_abc, 1 + floor(random() * length(v_abc))::int, 1);
    END LOOP;

    INSERT INTO public.impresion_dispositivos
        (branch_id, nombre, created_by, codigo_vinculacion, vinculacion_expira)
    VALUES (p_branch_id, btrim(p_nombre), (SELECT auth_employee_id()),
            v_cod, now() + interval '15 minutes')
    RETURNING impresion_dispositivos.id INTO v_dev;

    RETURN QUERY SELECT v_dev, v_cod, now() + interval '15 minutes';
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_metas_gasto(p_concepto text, p_salas jsonb, p_ym_inicio text, p_meses integer, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_margen numeric;
  v_total  numeric;
  v_gasto  bigint;
  v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
  s jsonb;
  v_afectada record;
  v_reabiertas int := 0;
  v_cuotas int;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere edición en Metas';
  END IF;
  IF p_concepto IS NULL OR btrim(p_concepto) = '' THEN
    RAISE EXCEPTION 'CONCEPTO_REQUERIDO: hay que decir de qué gasto se trata';
  END IF;
  IF p_meses IS NULL OR p_meses < 1 OR p_meses > 36 THEN
    RAISE EXCEPTION 'MESES_INVALIDOS: %', p_meses;
  END IF;
  IF p_ym_inicio IS NULL OR p_ym_inicio !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_ym_inicio;
  END IF;
  -- Decisión del usuario: solo a meses que todavía no arrancaron. Nadie ve su
  -- meta moverse a mitad de mes.
  IF p_ym_inicio <= v_ym_actual THEN
    RAISE EXCEPTION 'MES_YA_ARRANCADO: un gasto solo se carga a meses que todavía no empezaron';
  END IF;
  IF p_salas IS NULL OR jsonb_typeof(p_salas) <> 'array' OR jsonb_array_length(p_salas) = 0 THEN
    RAISE EXCEPTION 'SALAS_REQUERIDAS: hay que elegir al menos una sucursal y su monto';
  END IF;

  FOR s IN SELECT value FROM jsonb_array_elements(p_salas) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map m
                   WHERE m.branch_id = (s->>'branch_id')::bigint AND NOT m.es_bodega) THEN
      RAISE EXCEPTION 'SUCURSAL_INVALIDA: %', s->>'branch_id';
    END IF;
    IF coalesce((s->>'monto')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'MONTO_INVALIDO';
    END IF;
  END LOOP;

  SELECT margen_recuperacion_pct INTO v_margen FROM public.metas_config LIMIT 1;
  IF coalesce(v_margen, 0) <= 0 THEN RAISE EXCEPTION 'MARGEN_INVALIDO'; END IF;

  SELECT sum(round((value->>'monto')::numeric, 2)) INTO v_total
  FROM jsonb_array_elements(p_salas);

  INSERT INTO public.metas_gasto (concepto, monto_total, margen_pct, meses, ym_inicio, nota, creado_por)
  VALUES (btrim(p_concepto), v_total, v_margen, p_meses, p_ym_inicio,
          NULLIF(btrim(p_nota), ''), public.auth_employee_id())
  RETURNING id INTO v_gasto;

  INSERT INTO public.metas_gasto_sala (gasto_id, branch_id, monto)
  SELECT v_gasto, (value->>'branch_id')::bigint, round((value->>'monto')::numeric, 2)
  FROM jsonb_array_elements(p_salas);

  INSERT INTO public.metas_gasto_cuota (gasto_id, branch_id, year_month, monto_gasto, monto_venta)
  SELECT v_gasto, r.branch_id, r.year_month, r.monto_gasto, r.monto_venta
  FROM public.metas_gasto_reparto(p_salas, p_ym_inicio, p_meses, v_margen) r;
  GET DIAGNOSTICS v_cuotas = ROW_COUNT;

  -- Cada meta afectada que YA estaba confirmada o aprobada vuelve a propuesta:
  -- el número que el gerente firmó cambió, y tiene que volver a verlo.
  FOR v_afectada IN
    SELECT DISTINCT c.branch_id, c.year_month
    FROM public.metas_gasto_cuota c WHERE c.gasto_id = v_gasto
  LOOP
    UPDATE public.metas_sucursal m
    SET estado = 'propuesta', nota_devolucion = NULL
    WHERE m.branch_id = v_afectada.branch_id
      AND m.year_month = v_afectada.year_month
      AND m.estado IN ('confirmada_supervisor', 'oficial');
    IF FOUND THEN
      v_reabiertas := v_reabiertas + 1;
      PERFORM public.metas_log(
        (SELECT id FROM public.metas_sucursal
          WHERE branch_id = v_afectada.branch_id AND year_month = v_afectada.year_month),
        'reabierta_por_gasto', NULL, 'propuesta', NULL, NULL,
        'se le cargó «' || btrim(p_concepto) || '»: hay que confirmarla y aprobarla otra vez');
    END IF;

    PERFORM public.metas_aplicar_recuperacion(v_afectada.branch_id, v_afectada.year_month);

    PERFORM public.metas_log(
      (SELECT id FROM public.metas_sucursal
        WHERE branch_id = v_afectada.branch_id AND year_month = v_afectada.year_month),
      'gasto_cargado', NULL, NULL, NULL,
      (SELECT monto_meta FROM public.metas_sucursal
        WHERE branch_id = v_afectada.branch_id AND year_month = v_afectada.year_month),
      btrim(p_concepto));
  END LOOP;

  IF v_reabiertas > 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_REABIERTAS',
      'Metas por confirmar de nuevo',
      v_reabiertas || ' meta(s) cambiaron de monto porque se les cargó «'
        || btrim(p_concepto) || '». Hay que confirmarlas otra vez.');
  END IF;

  RETURN json_build_object(
    'gasto_id', v_gasto, 'monto_total', v_total, 'margen_pct', v_margen,
    'venta_total', round(v_total / (v_margen / 100), 2),
    'cuotas', v_cuotas, 'metas_reabiertas', v_reabiertas);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_promocion(p_nombre text, p_renglones jsonb, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor      uuid := public.auth_employee_id();
    v_promo_id   bigint;
    v_nombre     text := nullif(btrim(coalesce(p_nombre,'')), '');
    v_r          jsonb;
    v_rep        jsonb;
    v_renglon_id bigint;
    v_suma       integer;
    v_lote       integer;
    v_producto   integer;
    v_nombre_prod text;
    v_tiene      boolean;
    v_paga       text;
    v_prov       integer;
    v_n_renglones integer := 0;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;
    IF v_nombre IS NULL THEN
        RAISE EXCEPTION 'NOMBRE_REQUERIDO: la promoción necesita un nombre que la sucursal pueda reconocer';
    END IF;
    IF p_renglones IS NULL OR jsonb_array_length(p_renglones) = 0 THEN
        RAISE EXCEPTION 'SIN_PRODUCTOS: una promoción sin productos no cuenta nada';
    END IF;

    INSERT INTO public.promociones (nombre, nota, creado_por)
    VALUES (v_nombre, nullif(btrim(coalesce(p_nota,'')), ''), v_actor)
    RETURNING id INTO v_promo_id;

    FOR v_r IN SELECT * FROM jsonb_array_elements(p_renglones)
    LOOP
        v_producto := (v_r ->> 'erp_product_id')::integer;
        -- Vacío y ausente son lo mismo acá: «todavía no se sabe».
        v_lote     := nullif(v_r ->> 'lote_total', '')::integer;
        v_tiene    := coalesce((v_r ->> 'tiene_bono')::boolean, true);
        v_paga     := nullif(v_r ->> 'paga', '');
        v_prov     := nullif(v_r ->> 'supplier_id', '')::integer;

        SELECT p.nombre INTO v_nombre_prod FROM public.products p WHERE p.id = v_producto;
        IF v_nombre_prod IS NULL THEN
            RAISE EXCEPTION 'PRODUCTO_INEXISTENTE: el producto % no existe', v_producto;
        END IF;

        INSERT INTO public.promocion_renglon (
            promocion_id, erp_product_id, factor_unidades, inicio, fin,
            lote_total, tiene_bono, paga, supplier_id)
        VALUES (
            v_promo_id, v_producto,
            nullif(v_r ->> 'factor_unidades','')::smallint,
            (v_r ->> 'inicio')::date,
            nullif(v_r ->> 'fin','')::date,
            v_lote, v_tiene, v_paga, v_prov)
        RETURNING id INTO v_renglon_id;

        INSERT INTO public.promocion_renglon_tarifa (
            renglon_id, desde, bono_vendedor, bono_adm, bono_bodega, unidades_por_bono, creado_por)
        VALUES (
            v_renglon_id,
            (v_r ->> 'inicio')::date,
            coalesce((v_r ->> 'bono_vendedor')::numeric, 0),
            coalesce((v_r ->> 'bono_adm')::numeric, 0),
            coalesce((v_r ->> 'bono_bodega')::numeric, 0),
            greatest(coalesce((v_r ->> 'unidades_por_bono')::integer, 1), 1),
            v_actor);

        v_suma := 0;
        FOR v_rep IN SELECT * FROM jsonb_array_elements(coalesce(v_r -> 'reparto', '[]'::jsonb))
        LOOP
            INSERT INTO public.promocion_reparto (renglon_id, branch_id, asignado_original, asignado_vigente)
            VALUES (v_renglon_id,
                    (v_rep ->> 'branch_id')::bigint,
                    (v_rep ->> 'unidades')::numeric,
                    (v_rep ->> 'unidades')::numeric);
            v_suma := v_suma + coalesce((v_rep ->> 'unidades')::integer, 0);
        END LOOP;

        IF v_suma > 0 AND v_lote IS NULL THEN
            RAISE EXCEPTION 'REPARTO_SIN_LOTE: % reparte % unidades pero no dice de qué lote',
                v_nombre_prod, v_suma;
        END IF;
        IF v_suma > 0 AND v_suma <> v_lote THEN
            RAISE EXCEPTION 'REPARTO_NO_CUADRA: % reparte % de un lote de %',
                v_nombre_prod, v_suma, v_lote;
        END IF;

        v_n_renglones := v_n_renglones + 1;
    END LOOP;

    PERFORM public.promocion_log(
        v_promo_id, NULL, NULL, 'creada', NULL, v_nombre,
        v_n_renglones || ' producto(s)');

    RETURN json_build_object('id', v_promo_id, 'renglones', v_n_renglones);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cumplimiento_guardar(p_id bigint, p_branch_id bigint, p_tipo text, p_fecha date, p_datos jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_yo     uuid := public.auth_employee_id();
  v_req    text[] := public.cumplimiento_requeridos(p_tipo);
  v_falta  text;
  v_actual public.cumplimiento_registros;
  v_id     bigint;
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  IF v_req IS NULL THEN RAISE EXCEPTION 'TIPO_INVALIDO'; END IF;
  IF p_fecha IS NULL OR p_fecha > (now() AT TIME ZONE 'America/El_Salvador')::date + 60 THEN
    RAISE EXCEPTION 'FECHA_INVALIDA' USING HINT = 'Revisa la fecha del registro.';
  END IF;
  IF NOT public.cumplimiento_puede_escribir(p_tipo, p_branch_id) THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'No puedes anotar este registro en esa sucursal.';
  END IF;
  SELECT k INTO v_falta FROM unnest(v_req) k
   WHERE NOT (coalesce(p_datos, '{}'::jsonb) ? k)
      OR p_datos->k IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb)
   LIMIT 1;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'FALTA_DATO' USING HINT = format('Falta completar: %s.', v_falta);
  END IF;
  IF p_tipo = 'farmacovigilancia' AND (p_datos->>'gravedad') NOT IN ('no_grave','grave','muerte') THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'La gravedad no es válida.';
  END IF;
  IF p_tipo = 'reporte_cero' AND EXISTS (
       SELECT 1 FROM public.cumplimiento_registros r
        WHERE r.branch_id = p_branch_id AND r.tipo = 'reporte_cero' AND r.anulado_at IS NULL
          AND r.datos->>'periodo' = p_datos->>'periodo' AND r.id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'DUPLICADO' USING HINT = 'Esa sucursal ya tiene el reporte cero de ese periodo.';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.cumplimiento_registros (branch_id, tipo, fecha, datos, vence_el, registrado_por)
    VALUES (p_branch_id, p_tipo, p_fecha, p_datos, public.cumplimiento_plazo(p_tipo, p_fecha, p_datos), v_yo)
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_actual FROM public.cumplimiento_registros WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
    IF v_actual.tipo <> p_tipo OR v_actual.branch_id <> p_branch_id THEN RAISE EXCEPTION 'NO_COINCIDE'; END IF;
    IF v_actual.anulado_at IS NOT NULL OR v_actual.estado = 'cerrado' THEN
      RAISE EXCEPTION 'CERRADO' USING HINT = 'Un registro cerrado o anulado ya no se edita.';
    END IF;
    UPDATE public.cumplimiento_registros
       SET fecha = p_fecha, datos = p_datos, vence_el = public.cumplimiento_plazo(p_tipo, p_fecha, p_datos),
           updated_at = now()
     WHERE id = p_id;
    v_id := p_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, branch_id, details)
  VALUES (v_yo, (SELECT e.name FROM public.employees e WHERE e.id = v_yo),
          CASE WHEN p_id IS NULL THEN 'CUMPLIMIENTO_NUEVO' ELSE 'CUMPLIMIENTO_EDITADO' END,
          v_id::text, 'ADMIN_PANEL', 'INFO', p_branch_id, jsonb_build_object('tipo', p_tipo, 'fecha', p_fecha));
  RETURN json_build_object('id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cumplimiento_retiro_a_todas(p_fecha date, p_datos jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_yo uuid := public.auth_employee_id();
  v_n  integer;
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  IF NOT (public.auth_has_module_permission('cumplimiento_tab_retiros', 'can_edit')
          AND public.auth_module_scope('cumplimiento') = 'ALL') THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'Sólo quien ve toda la red avisa un retiro a todas las sucursales.';
  END IF;
  IF coalesce(p_datos->>'alerta', '') = '' OR coalesce(p_datos->>'producto', '') = '' OR coalesce(p_datos->>'lote', '') = ''
     OR coalesce(p_datos->>'fuente', '') = '' THEN
    RAISE EXCEPTION 'FALTA_DATO' USING HINT = 'Completa alerta, fuente, producto y lote.';
  END IF;
  INSERT INTO public.cumplimiento_registros (branch_id, tipo, fecha, datos, registrado_por)
  SELECT b.id, 'retiro', p_fecha, p_datos, v_yo
    FROM public.branches b WHERE b.type IN ('FARMACIA', 'BODEGA');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, details)
  VALUES (v_yo, (SELECT e.name FROM public.employees e WHERE e.id = v_yo), 'CUMPLIMIENTO_RETIRO_A_TODAS',
          p_datos->>'alerta', 'ADMIN_PANEL', 'WARNING', jsonb_build_object('salas', v_n, 'lote', p_datos->>'lote'));
  RETURN json_build_object('salas', v_n);
END;
$function$;

CREATE OR REPLACE FUNCTION public.decidir_devolucion_pedido(p_id uuid, p_accion text, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := auth_employee_id();
    v_dev   record;
    v_nota  text := nullif(btrim(coalesce(p_nota, '')), '');
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;
    IF p_accion NOT IN ('aceptar', 'rechazar') THEN
        RAISE EXCEPTION 'ACCION_INVALIDA: %', p_accion;
    END IF;

    -- La devolución entra a Bodega, así que la decide Bodega. Es la misma regla
    -- que en el traslado entre salas: decide quien va a recibir el producto.
    IF NOT auth_can_edit_scope_all(ARRAY['pedidos'])
       AND NOT EXISTS (
            SELECT 1 FROM public.erp_sucursal_map m
            WHERE m.es_bodega AND m.erp_sucursal_id = auth_employee_erp_sucursal_id()
       ) THEN
        RAISE EXCEPTION 'SOLO_BODEGA: la devolución la decide quien va a recibir el producto';
    END IF;

    SELECT * INTO v_dev FROM public.pedido_devolucion WHERE id = p_id FOR UPDATE;
    IF v_dev.id IS NULL THEN
        RAISE EXCEPTION 'DEVOLUCION_NO_EXISTE';
    END IF;
    IF v_dev.estado <> 'solicitada' THEN
        RAISE EXCEPTION 'YA_DECIDIDA: esta devolución está %', v_dev.estado;
    END IF;

    -- Nada se mueve sin que coincidan DOS personas. Aceptar es lo que saca el
    -- producto del sistema de la sala: quien la pidió no puede además darse el
    -- sí. Rechazar sí puede —es retirar lo que uno mismo pidió, y no mueve nada.
    IF p_accion = 'aceptar' AND v_dev.solicitada_por = v_actor THEN
        RAISE EXCEPTION 'NO_TE_ACEPTAS_SOLO: la acepta la otra parte, no quien la pidió';
    END IF;

    IF p_accion = 'rechazar' AND v_nota IS NULL THEN
        RAISE EXCEPTION 'MOTIVO_REQUERIDO: un rechazo sin motivo deja a la sucursal sin saber qué hacer';
    END IF;

    UPDATE public.pedido_devolucion
       SET estado         = CASE WHEN p_accion = 'aceptar' THEN 'aceptada' ELSE 'rechazada' END,
           decidida_por   = v_actor,
           decidida_at    = now(),
           decision_nota  = CASE WHEN p_accion = 'aceptar' THEN v_nota ELSE decision_nota END,
           motivo_rechazo = CASE WHEN p_accion = 'rechazar' THEN v_nota ELSE motivo_rechazo END,
           updated_at     = now()
     WHERE id = p_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    VALUES
        (v_dev.pedido_item_id, v_dev.pedido_id, v_dev.erp_sucursal_id,
         CASE WHEN p_accion = 'aceptar' THEN 'devolucion_aceptada' ELSE 'devolucion_rechazada' END,
         'devolver_bodega', v_nota, v_actor);

    RETURN jsonb_build_object('id', p_id, 'estado',
        CASE WHEN p_accion = 'aceptar' THEN 'aceptada' ELSE 'rechazada' END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.decidir_diferencia_pedido(p_item_id integer, p_accion text, p_tipo text DEFAULT NULL::text, p_nota text DEFAULT NULL::text, p_evidencia jsonb DEFAULT '[]'::jsonb, p_caja jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor    uuid := auth_employee_id();
    v_it       record;
    v_op       record;
    v_es_sala  boolean;
    v_es_super boolean;
    v_nota     text := nullif(btrim(coalesce(p_nota, '')), '');
    v_nuevo    text;
    v_cant     integer;
    v_dev_id   uuid;
    v_clave    text;
    v_vence    timestamptz;
    v_caja     jsonb;
    v_lote     text;
    v_vcaja    text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    SELECT pi.* INTO v_it FROM public.pedido_items pi WHERE pi.id = p_item_id FOR UPDATE;
    IF v_it.id IS NULL THEN
        RAISE EXCEPTION 'ITEM_NO_EXISTE';
    END IF;
    IF v_it.status <> 'con_diferencia' THEN
        RAISE EXCEPTION 'SIN_DIFERENCIA: este producto no quedó con diferencia al recibirlo';
    END IF;
    IF v_it.resolucion_status = 'confirmada' THEN
        RAISE EXCEPTION 'YA_CERRADA: esta diferencia ya está resuelta';
    END IF;

    v_es_super := public.auth_es_supervision();
    v_es_sala  := auth_employee_erp_sucursal_id() IS NOT DISTINCT FROM v_it.erp_sucursal_id;

    -- ── El lote de la caja (2026-11-13) ───────────────────────────────────
    -- Sólo lo escribe quien tiene la caja (la sala, o supervisión por ella), y
    -- sólo para lo que sale de la sala: dañado o vencido.
    IF p_caja IS NOT NULL AND v_it.error_tipo IN ('danado', 'vencido') AND (v_es_sala OR v_es_super) THEN
        v_lote  := upper(btrim(coalesce(p_caja->>'lote', '')));
        v_vcaja := left(coalesce(p_caja->>'vence', ''), 10);
        IF v_lote = '' OR v_lote ~* '^gen[eé]rico$' OR length(v_lote) > 40 THEN
            RAISE EXCEPTION 'LOTE_INVALIDO: escribe el lote que trae la caja';
        END IF;
        IF v_vcaja !~ '^\d{4}-\d{2}-\d{2}$' OR v_vcaja::date <= current_date THEN
            RAISE EXCEPTION 'VENCE_INVALIDO: el vencimiento de la caja tiene que ser un mes futuro';
        END IF;
        v_caja := jsonb_build_object('lote', v_lote, 'vence', v_vcaja);
        UPDATE public.pedido_items SET caja_devolucion = v_caja WHERE id = p_item_id;
    END IF;
    v_caja := coalesce(v_caja, v_it.caja_devolucion);

    IF p_accion = 'proponer' THEN
        IF v_it.resolucion_status IS NOT NULL THEN
            RAISE EXCEPTION 'YA_PROPUESTA: esta diferencia ya tiene una propuesta en curso';
        END IF;
        IF NOT v_es_sala AND NOT v_es_super THEN
            RAISE EXCEPTION 'PROPONE_LA_SALA: la propone la sucursal que recibió el pedido';
        END IF;
        v_nuevo := 'propuesta';

    ELSIF p_accion = 'contraproponer' THEN
        IF v_it.resolucion_status <> 'propuesta' THEN
            RAISE EXCEPTION 'FUERA_DE_TURNO: sólo se contrapropone sobre una propuesta de la sucursal';
        END IF;
        IF v_es_sala AND NOT v_es_super THEN
            RAISE EXCEPTION 'CONTRAPROPONE_BODEGA: la sucursal ya propuso; le toca a bodega';
        END IF;
        IF p_tipo IS NOT DISTINCT FROM v_it.resolucion_tipo THEN
            RAISE EXCEPTION 'MISMA_OPCION: contraproponer es elegir la OTRA salida';
        END IF;
        v_nuevo := 'contrapropuesta';

    ELSIF p_accion = 'aceptar' THEN
        IF v_it.resolucion_status NOT IN ('propuesta', 'contrapropuesta') THEN
            RAISE EXCEPTION 'NADA_QUE_ACEPTAR';
        END IF;
        -- El acuerdo es de DOS partes: quien propuso no lo cierra solo, tenga
        -- el alcance que tenga.
        IF v_it.resuelto_por = v_actor THEN
            RAISE EXCEPTION 'NO_TE_ACEPTAS_SOLO: la acepta la otra parte';
        END IF;
        -- Y le toca al otro lado del mostrador, no a cualquiera.
        IF v_it.resolucion_status = 'propuesta'      AND v_es_sala AND NOT v_es_super THEN
            RAISE EXCEPTION 'LE_TOCA_A_BODEGA: la propuesta de la sucursal la contesta bodega';
        END IF;
        IF v_it.resolucion_status = 'contrapropuesta' AND NOT v_es_sala AND NOT v_es_super THEN
            RAISE EXCEPTION 'LE_TOCA_A_LA_SALA: la contrapropuesta de bodega la contesta la sucursal';
        END IF;
        p_tipo  := v_it.resolucion_tipo;
        v_nuevo := 'acordada';

    ELSIF p_accion = 'rechazar' THEN
        IF v_it.resolucion_status <> 'contrapropuesta' THEN
            RAISE EXCEPTION 'FUERA_DE_TURNO: sólo se rechaza una contrapropuesta';
        END IF;
        IF NOT v_es_sala AND NOT v_es_super THEN
            RAISE EXCEPTION 'LE_TOCA_A_LA_SALA: la contrapropuesta de bodega la contesta la sucursal';
        END IF;
        IF v_nota IS NULL THEN
            RAISE EXCEPTION 'MOTIVO_REQUERIDO: escribe el motivo. Lo va a leer un supervisor o administrador.';
        END IF;
        UPDATE public.pedido_items SET
            resolucion_status = 'escalada',
            rechazado_por     = v_actor,
            rechazado_at      = now(),
            nota_rechazo      = v_nota
        WHERE id = p_item_id;

        INSERT INTO public.pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
        VALUES (p_item_id, v_it.pedido_id, v_it.erp_sucursal_id, 'diferencia_escalada',
                v_it.resolucion_tipo, v_nota, v_actor);

        RETURN jsonb_build_object('estado', 'escalada');

    ELSIF p_accion = 'supervisar' THEN
        IF v_it.resolucion_status <> 'escalada' THEN
            RAISE EXCEPTION 'NO_ESTA_ESCALADA';
        END IF;
        IF NOT v_es_super THEN
            RAISE EXCEPTION 'SOLO_SUPERVISION: esta diferencia la decide un supervisor o administrador.';
        END IF;
        v_nuevo := 'acordada';

    ELSE
        RAISE EXCEPTION 'ACCION_DESCONOCIDA: %', p_accion;
    END IF;

    SELECT * INTO v_op FROM public.diferencia_opcion
     WHERE error_tipo = v_it.error_tipo AND valor = p_tipo;
    IF v_op.valor IS NULL THEN
        RAISE EXCEPTION 'OPCION_INVALIDA: «%» no es una salida de un %',
                        coalesce(p_tipo, '(vacío)'), coalesce(v_it.error_tipo, 'producto sin tipo');
    END IF;

    IF v_nuevo = 'acordada' AND v_op.cierra_con = 'acuerdo' THEN
        v_nuevo := 'confirmada';
    END IF;

    IF v_nuevo = 'acordada' AND v_op.cierra_con IN ('llegada_sala', 'llegada_bodega') THEN
        v_vence := now() + interval '3 days';
    END IF;

    UPDATE public.pedido_items SET
        resolucion_status   = v_nuevo,
        resolucion_tipo     = p_tipo,
        resolucion_nota     = coalesce(v_nota, resolucion_nota),
        resolucion_ronda    = CASE WHEN p_accion IN ('proponer','contraproponer')
                                   THEN resolucion_ronda + 1 ELSE resolucion_ronda END,
        resolucion_vence_at = v_vence,
        resuelto_por        = CASE WHEN p_accion IN ('proponer','contraproponer','supervisar')
                                   THEN v_actor ELSE resuelto_por END,
        resuelto_at         = CASE WHEN p_accion IN ('proponer','contraproponer','supervisar')
                                   THEN now() ELSE resuelto_at END,
        confirmado_suc_por  = CASE WHEN p_accion = 'aceptar' THEN v_actor ELSE confirmado_suc_por END,
        confirmado_suc_at   = CASE WHEN p_accion = 'aceptar' THEN now()   ELSE confirmado_suc_at END,
        supervisado_por     = CASE WHEN p_accion = 'supervisar' THEN v_actor ELSE supervisado_por END,
        supervisado_at      = CASE WHEN p_accion = 'supervisar' THEN now()   ELSE supervisado_at END,
        rechazado_por       = NULL, rechazado_at = NULL, nota_rechazo = NULL
    WHERE id = p_item_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    VALUES (p_item_id, v_it.pedido_id, v_it.erp_sucursal_id,
            'diferencia_' || p_accion, p_tipo, v_nota, v_actor);

    -- ── El movimiento, si la salida acordada tiene uno ────────────────────
    --
    -- Los dos sentidos entran por acá y salen la MISMA fila. La única
    -- diferencia visible es el prefijo de la clave —DEV lo que va a Bodega,
    -- TRA lo que va a la sala—, para que quien la busque en el sistema sepa de
    -- entrada para dónde salió. El `sentido` de la fila lo pone la base sola.
    IF v_nuevo = 'acordada' AND v_op.mueve IN ('devolucion', 'traslado_a_sala') THEN
        v_cant := public.cantidad_de_diferencia(p_item_id);
        IF v_cant IS NULL OR v_cant <= 0 THEN
            RAISE EXCEPTION 'CANTIDAD_EN_CERO: no hay diferencia que mover';
        END IF;
        IF v_it.error_tipo = 'danado'
           AND coalesce(jsonb_array_length(p_evidencia), 0) = 0
           AND NOT EXISTS (SELECT 1 FROM public.pedido_devolucion d
                            WHERE d.pedido_item_id = p_item_id
                              AND coalesce(jsonb_array_length(d.evidencia_urls), 0) > 0) THEN
            RAISE EXCEPTION 'FOTO_REQUERIDA: el daño se muestra con una foto, para que Bodega decida '
                            'si amerita la devolución o si el producto todavía se puede vender';
        END IF;

        v_clave := public.clave_movimiento_de_item(
            p_item_id,
            CASE WHEN v_op.mueve = 'traslado_a_sala' THEN 'TRA' ELSE 'DEV' END);

        INSERT INTO public.pedido_devolucion (
            pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id,
            motivo, viaja, cantidad, nota, evidencia_urls,
            estado, solicitada_por, decidida_por, decidida_at, clave, caja
        ) VALUES (
            v_it.pedido_id, v_it.erp_sucursal_id, v_it.id, v_it.erp_product_id,
            v_it.error_tipo,
            -- Ni el faltante ni el sobrante se suben a ningún camión: uno nunca
            -- salió de Bodega y el otro ya está en la sala.
            v_it.error_tipo NOT IN ('faltante', 'sobrante'),
            v_cant, v_nota, coalesce(p_evidencia, '[]'::jsonb),
            'aceptada', coalesce(v_it.resuelto_por, v_actor), v_actor, now(), v_clave,
            CASE WHEN v_it.error_tipo IN ('danado', 'vencido') THEN v_caja END
        )
        RETURNING id INTO v_dev_id;
    END IF;

    -- Cerrada en el acto (salida que cierra por acuerdo): si era la última
    -- cosa abierta del pedido, el pedido se cierra acá. Sin esto quedaba
    -- «parcial» para siempre — ver 20260918 cerrar_por_acuerdo.
    IF v_nuevo = 'confirmada' THEN
        PERFORM public.cerrar_pedido_si_todo_resuelto(v_it.pedido_id, v_it.erp_sucursal_id, v_actor);
    END IF;

    RETURN jsonb_build_object(
        'estado', v_nuevo, 'opcion', p_tipo, 'rotulo', v_op.rotulo,
        'mueve', v_op.mueve, 'cierra_con', v_op.cierra_con,
        'devolucion_id', v_dev_id, 'vence_at', v_vence
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.decidir_excedente(p_id bigint, p_aprobar boolean, p_motivo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor  uuid := public.auth_employee_id();
    v_row    public.promocion_excedente%ROWTYPE;
    v_motivo text := nullif(btrim(coalesce(p_motivo,'')), '');
    v_promo  bigint;
    v_nuevo  text;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_approve') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: sólo quien aprueba en Promociones decide un excedente';
    END IF;

    SELECT * INTO v_row FROM public.promocion_excedente WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: el excedente % no existe', p_id; END IF;
    IF v_row.estado <> 'por_decidir' THEN
        RAISE EXCEPTION 'YA_DECIDIDO: este excedente ya está %', v_row.estado;
    END IF;
    IF NOT p_aprobar AND v_motivo IS NULL THEN
        RAISE EXCEPTION 'MOTIVO_REQUERIDO: escribe por qué no se paga. Lo va a leer quien vendió.';
    END IF;

    v_nuevo := CASE WHEN p_aprobar THEN 'aprobado' ELSE 'negado' END;

    UPDATE public.promocion_excedente
       SET estado       = v_nuevo,
           decidido_por = v_actor,
           decidido_at  = now(),
           motivo       = v_motivo
     WHERE id = p_id;

    SELECT r.promocion_id INTO v_promo
      FROM public.promocion_renglon r WHERE r.id = v_row.renglon_id;

    PERFORM public.promocion_log(
        v_promo, v_row.renglon_id, v_row.branch_id,
        CASE WHEN p_aprobar THEN 'excedente_aprobado' ELSE 'excedente_negado' END,
        'por_decidir', v_nuevo,
        v_row.unidades || ' unidades' ||
        CASE WHEN v_motivo IS NOT NULL THEN ' · ' || v_motivo ELSE '' END);

    -- A quien vendió: es plata suya, y si se negó tiene derecho a leer por qué.
    PERFORM public.notify_employees(
        ARRAY[v_row.employee_id], 'PROMO_EXCEDENTE',
        CASE WHEN p_aprobar THEN 'Se aprobó tu excedente' ELSE 'No se aprobó tu excedente' END,
        v_row.unidades || ' unidades por encima del lote' ||
        CASE WHEN p_aprobar THEN '. Se suman a lo tuyo.'
             ELSE ': ' || v_motivo END,
        '/promociones', jsonb_build_object('excedente_id', p_id), false, NULL);

    RETURN json_build_object('id', p_id, 'estado', v_nuevo);
END;
$function$;

CREATE OR REPLACE FUNCTION public.declarar_faltante_tardio(p_request_id uuid, p_faltantes jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    -- El plazo, en un solo sitio. Ver el encabezado.
    c_horas   constant integer := 48;
    r         public.approval_requests%ROWTYPE;
    m         jsonb;
    v_yo      uuid;
    v_sala    integer;
    v_cerrada timestamptz;
    v_horas   numeric;
BEGIN
    v_yo := public.auth_employee_id();
    IF v_yo IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: no se pudo resolver quién eres.';
    END IF;
    IF NOT public.auth_has_module_permission('traslados', 'can_approve') THEN
        RAISE EXCEPTION 'FORBIDDEN: no tienes permiso para recibir traslados.';
    END IF;

    SELECT * INTO r FROM public.approval_requests WHERE id = p_request_id;
    IF r.id IS NULL OR r.type NOT IN ('INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH') THEN
        RAISE EXCEPTION 'Ese paquete no existe o no es un traslado entre sucursales.';
    END IF;
    m := coalesce(r.metadata, '{}'::jsonb);

    -- La sala de DESTINO, que es la que tuvo la caja enfrente. El alcance sobre
    -- todas las salas también entra: supervisión resuelve por las dos puntas.
    SELECT coalesce(public.sala_de_apoyo_vigente(id), branch_id) INTO v_sala FROM public.employees WHERE id = v_yo;
    IF NOT (public.auth_can_edit_scope_all(ARRAY['traslados'])
            OR v_sala IS NOT DISTINCT FROM nullif(m->>'branch_id','')::integer) THEN
        RAISE EXCEPTION 'FORBIDDEN: esto lo declara la sucursal que recibió el paquete.';
    END IF;

    -- Cuándo se cerró la recepción. La solicitud lo guarda en el metadata; el
    -- envío no tiene un momento único —se decide renglón por renglón— así que
    -- es el ÚLTIMO, que es cuando se terminó de mirar la caja.
    IF r.type = 'INVENTORY_TRANSFER_REQUEST' THEN
        v_cerrada := nullif(m->'erp_recibido'->>'at', '')::timestamptz;
    ELSE
        SELECT max(l.decidido_at) INTO v_cerrada
          FROM public.envio_linea l
         WHERE l.request_id = p_request_id
           AND l.estado IN ('aceptada','devuelta','devuelta_recibida','no_llego');
    END IF;

    IF v_cerrada IS NULL THEN
        -- Todavía no se recibió: el camino normal sigue abierto y es el que
        -- corresponde. Decirlo así, y no «no se puede», es la diferencia entre
        -- mandar a alguien a la pantalla correcta o dejarlo trabado.
        RETURN json_build_object('ok', false, 'codigo', 'TODAVIA_NO_RECIBIDA',
            'error', 'Este paquete todavía no se recibió: dilo al recibirlo.');
    END IF;

    v_horas := extract(epoch FROM now() - v_cerrada) / 3600;
    IF v_horas > c_horas THEN
        RETURN json_build_object('ok', false, 'codigo', 'FUERA_DE_PLAZO',
            'horas', round(v_horas),
            'error', 'Este paquete se recibió hace ' || round(v_horas / 24) || ' días. '
                  || 'Un faltante se declara dentro de las ' || c_horas || ' horas, mientras '
                  || 'todavía se puede ir a buscar la caja. Lo que aparezca después se '
                  || 'resuelve por conteo.');
    END IF;

    RETURN public.declarar_faltantes(p_request_id, p_faltantes, v_yo);
END;
$function$;

CREATE OR REPLACE FUNCTION public.declarar_faltantes(p_request_id uuid, p_faltantes jsonb, p_actor uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r          public.approval_requests%ROWTYPE;
    m          jsonb;
    v_familia  text;
    f          jsonb;
    v_pos      integer;
    v_cant     numeric;
    v_nota     text;
    v_prod     integer;
    v_desc     text;
    v_pres     text;
    v_techo    numeric;
    v_origen   integer;
    v_destino  integer;
    v_nuevos   integer := 0;
    v_ids      uuid[] := ARRAY[]::uuid[];
    v_id       uuid;
BEGIN
    SELECT * INTO r FROM public.approval_requests WHERE id = p_request_id;
    IF r.id IS NULL THEN
        RAISE EXCEPTION 'No existe el paquete %.', p_request_id;
    END IF;

    -- La familia se DERIVA del tipo de la fila. Un parámetro podría decir
    -- «envío» apuntando a una solicitud y la lista quedaría mintiendo sobre
    -- dónde mirar.
    v_familia := CASE r.type
        WHEN 'INVENTORY_TRANSFER_REQUEST' THEN 'solicitud'
        WHEN 'INVENTORY_TRANSFER_PUSH'    THEN 'envio'
        ELSE NULL END;
    IF v_familia IS NULL THEN
        RAISE EXCEPTION 'La fila % no es un traslado entre sucursales.', p_request_id;
    END IF;

    m := coalesce(r.metadata, '{}'::jsonb);
    v_origen  := nullif(m->>'origen_branch_id', '')::integer;
    v_destino := nullif(m->>'branch_id', '')::integer;

    FOR f IN SELECT * FROM jsonb_array_elements(coalesce(p_faltantes, '[]'::jsonb))
    LOOP
        v_pos  := nullif(f->>'posicion', '')::integer;
        v_cant := nullif(f->>'cantidad', '')::numeric;
        v_nota := nullif(btrim(coalesce(f->>'nota', '')), '');

        -- Cero no es un faltante: es el renglón que llegó completo. Se saltea en
        -- vez de rebotar, para que la pantalla pueda mandar la lista entera y
        -- que decida el servidor cuáles son huecos de verdad.
        CONTINUE WHEN v_pos IS NULL OR v_cant IS NULL OR v_cant <= 0;

        v_prod := NULL; v_desc := NULL; v_pres := NULL; v_techo := NULL;

        IF v_familia = 'envio' THEN
            SELECT l.erp_product_id, l.descripcion, l.presentacion_tipo, l.cantidad
              INTO v_prod, v_desc, v_pres, v_techo
              FROM public.envio_linea l
             WHERE l.request_id = p_request_id AND l.posicion = v_pos;
        ELSE
            -- En la solicitud la posición es el ÍNDICE del renglón dentro de
            -- `metadata.items`, que es el mismo contrato que ya usa el despacho
            -- parcial (`lineas_aceptadas` viaja como `{i, cantidad}`). El
            -- navegador no elige qué producto se nombra: sólo señala cuál de
            -- los que ya están guardados faltó.
            SELECT nullif(it->>'erp_product_id','')::integer,
                   it->>'descripcion',
                   it->>'presentacion_tipo',
                   nullif(it->>'cantidad','')::numeric
              INTO v_prod, v_desc, v_pres, v_techo
              FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS a(it, n)
             WHERE a.n = v_pos + 1;

            -- Y si el despacho salió recortado, lo que manda es lo que VIAJÓ.
            -- El detalle guarda el producto pero NO la posición, así que se
            -- cruza por producto y sólo vale cuando aparece una vez.
            SELECT max((d->>'cantidad')::numeric) INTO v_techo
              FROM jsonb_array_elements(coalesce(m->'erp_traslado'->'detalle', '[]'::jsonb)) d
             WHERE nullif(d->>'erp_product_id','')::integer = v_prod
            HAVING count(*) = 1;

            IF v_techo IS NULL THEN
                SELECT nullif(it->>'cantidad','')::numeric INTO v_techo
                  FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS a(it, n)
                 WHERE a.n = v_pos + 1;
            END IF;
        END IF;

        -- Una posición que no existe es una pantalla desincronizada, no un
        -- faltante: se rebota entero para que nadie crea que quedó anotado.
        IF v_prod IS NULL AND v_desc IS NULL THEN
            RAISE EXCEPTION 'El paquete % no tiene un producto en la posición %.', p_request_id, v_pos;
        END IF;

        IF v_techo IS NOT NULL AND v_techo > 0 AND v_cant > v_techo THEN
            RAISE EXCEPTION 'De % salieron %: no pueden faltar %.',
                coalesce(v_desc, 'ese producto'), v_techo, v_cant;
        END IF;

        INSERT INTO public.bolsa_faltante (
            request_id, familia, posicion, erp_product_id, descripcion, presentacion_tipo,
            cantidad, nota, origen_branch_id, destino_branch_id, declarado_por
        ) VALUES (
            p_request_id, v_familia, v_pos, v_prod, v_desc, v_pres,
            v_cant, v_nota, v_origen, v_destino, p_actor
        )
        -- Dos personas mirando la misma caja declaran el mismo hueco: la
        -- segunda no escribe y tampoco falla. El índice parcial es el que
        -- decide, no un `SELECT` previo que otra transacción puede pisar.
        ON CONFLICT (request_id, posicion) WHERE estado = 'abierto' DO NOTHING
        RETURNING id INTO v_id;

        IF v_id IS NOT NULL THEN
            v_nuevos := v_nuevos + 1;
            v_ids := v_ids || v_id;
            v_id := NULL;
        END IF;
    END LOOP;

    IF v_nuevos > 0 THEN
        PERFORM public.avisar_faltantes(p_request_id, v_ids, p_actor);
    END IF;

    RETURN json_build_object('ok', true, 'declarados', v_nuevos, 'ids', to_json(v_ids));
END;
$function$;

CREATE OR REPLACE FUNCTION public.declarar_sobrantes(p_request_id uuid, p_sobrantes jsonb, p_actor uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r          public.approval_requests%ROWTYPE;
    m          jsonb;
    v_familia  text;
    s          jsonb;
    v_pos      integer;
    v_cant     numeric;
    v_nota     text;
    v_notas    text[] := ARRAY[]::text[];
    v_prod     integer;
    v_desc     text;
    v_pres     text;
    v_factor   integer;
    v_estado   text;
    v_items    jsonb := '[]'::jsonb;
    v_total    numeric := 0;
    v_org_erp  integer;
    v_dst_erp  integer;
    v_org_bid  integer;
    v_dst_bid  integer;
    v_org_nom  text;
    v_dst_nom  text;
    v_venc     boolean;
    v_tiene    numeric;
    v_dest     uuid[];
    v_esc      text;
    v_bolsa    text;
    v_ya       uuid;
    v_id       uuid;
    it         jsonb;
BEGIN
    SELECT * INTO r FROM public.approval_requests WHERE id = p_request_id;
    IF r.id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'No existe ese paquete.');
    END IF;
    v_familia := CASE r.type
        WHEN 'INVENTORY_TRANSFER_REQUEST' THEN 'solicitud'
        WHEN 'INVENTORY_TRANSFER_PUSH'    THEN 'envio'
        ELSE NULL END;
    IF v_familia IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'Esa fila no es un traslado entre sucursales.');
    END IF;
    m := coalesce(r.metadata, '{}'::jsonb);
    -- Un sobrante de un sobrante no existe: lo de más ya entró con su envío.
    IF m ? 'sobrante_de' THEN
        RETURN json_build_object('ok', false, 'error', 'Esto ya es el movimiento de un sobrante.');
    END IF;
    IF v_familia = 'solicitud' AND m->'erp_recibido' IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'El traslado todavía no se recibió.');
    END IF;

    SELECT id INTO v_ya FROM public.approval_requests
     WHERE type = 'INVENTORY_TRANSFER_PUSH' AND metadata->>'sobrante_de' = r.id::text
     LIMIT 1;
    IF v_ya IS NOT NULL THEN
        RETURN json_build_object('ok', true, 'envio_id', v_ya, 'ya', true);
    END IF;

    v_org_erp := nullif(m->>'origen_erp_sucursal_id', '')::integer;
    v_dst_erp := nullif(m->>'erp_sucursal_id', '')::integer;
    v_venc    := coalesce((m->>'origen_vencidos')::boolean, false);
    SELECT em.branch_id, b.name INTO v_org_bid, v_org_nom
      FROM public.erp_sucursal_map em LEFT JOIN public.branches b ON b.id = em.branch_id
     WHERE em.erp_sucursal_id = v_org_erp;
    SELECT em.branch_id, b.name INTO v_dst_bid, v_dst_nom
      FROM public.erp_sucursal_map em LEFT JOIN public.branches b ON b.id = em.branch_id
     WHERE em.erp_sucursal_id = v_dst_erp;
    IF v_org_bid IS NULL OR v_dst_bid IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'El paquete no dice de qué sucursal salió o a cuál llegó.');
    END IF;

    FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p_sobrantes, '[]'::jsonb)) LOOP
        v_pos  := nullif(s->>'posicion', '')::integer;
        v_cant := nullif(s->>'cantidad', '')::numeric;
        v_nota := nullif(btrim(coalesce(s->>'nota', '')), '');
        CONTINUE WHEN v_pos IS NULL OR v_cant IS NULL OR v_cant <= 0;
        IF v_cant <> trunc(v_cant) THEN
            RETURN json_build_object('ok', false, 'error', 'Lo que vino de más se cuenta en presentaciones enteras.');
        END IF;

        v_prod := NULL; v_desc := NULL; v_pres := NULL; v_factor := NULL; v_estado := NULL;
        IF v_familia = 'envio' THEN
            SELECT l.erp_product_id, l.descripcion, l.presentacion_tipo, l.factor, l.estado
              INTO v_prod, v_desc, v_pres, v_factor, v_estado
              FROM public.envio_linea l
             WHERE l.request_id = r.id AND l.posicion = v_pos;
            IF v_prod IS NOT NULL AND v_estado <> 'aceptada' THEN
                RETURN json_build_object('ok', false,
                    'error', coalesce(v_desc, 'Ese producto') || ' no se recibió: no puede haber venido de más.');
            END IF;
        ELSE
            SELECT nullif(a.it->>'erp_product_id', '')::integer, a.it->>'descripcion',
                   a.it->>'presentacion_tipo', nullif(a.it->>'factor', '')::integer
              INTO v_prod, v_desc, v_pres, v_factor
              FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS a(it, n)
             WHERE a.n = v_pos + 1;
        END IF;
        IF v_prod IS NULL OR coalesce(v_factor, 0) <= 0 OR nullif(btrim(coalesce(v_pres, '')), '') IS NULL THEN
            RETURN json_build_object('ok', false,
                'error', format('El paquete no tiene un producto completo en la posición %s.', v_pos));
        END IF;

        -- Lo que está en el inventario de la sala de origen, del mismo estante
        -- del que salió la bolsa.
        IF v_venc THEN
            SELECT coalesce(d.unidades, 0) INTO v_tiene FROM public.v_inventario_disponible_vencidos d
             WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;
        ELSE
            SELECT coalesce(d.unidades, 0) INTO v_tiene FROM public.v_inventario_disponible d
             WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;
        END IF;
        IF coalesce(v_tiene, 0) < v_cant * v_factor THEN
            RETURN json_build_object('ok', false, 'codigo', 'SIN_EXISTENCIA',
                'error', format('%s dice que tiene %s unidades de %s y vinieron %s de más. No se puede pasar a tu sucursal. Avísale a un supervisor o administrador.',
                                coalesce(v_org_nom, 'La sucursal de origen'), coalesce(v_tiene, 0),
                                coalesce(v_desc, 'ese producto'), v_cant * v_factor));
        END IF;

        IF v_items @> jsonb_build_array(jsonb_build_object('erp_product_id', v_prod)) THEN
            RETURN json_build_object('ok', false, 'error', coalesce(v_desc, 'Un producto') || ' está dos veces en lo que vino de más.');
        END IF;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
            'erp_product_id', v_prod, 'descripcion', v_desc, 'presentacion_tipo', v_pres,
            'factor', v_factor, 'cantidad', v_cant));
        v_total := v_total + v_cant * v_factor;
        IF v_nota IS NOT NULL AND NOT (v_nota = ANY (v_notas)) THEN v_notas := v_notas || v_nota; END IF;
    END LOOP;

    IF jsonb_array_length(v_items) = 0 THEN
        RETURN json_build_object('ok', true, 'envio_id', NULL);
    END IF;

    SELECT rd.destinatarios, rd.escalon INTO v_dest, v_esc
      FROM public.resolver_destinatarios_traslado(v_dst_bid) rd;
    v_bolsa := nullif(m->>'codigo_bolsa', '');

    -- La marca que deja pasar este insert por `validar_envio_producto`. Vive
    -- sólo en esta transacción y se borra enseguida.
    PERFORM set_config('portal.sobrante_de', r.id::text, true);
    INSERT INTO public.approval_requests (type, status, employee_id, approver_id, note, metadata)
    VALUES (
        'INVENTORY_TRANSFER_PUSH', 'PENDING', p_actor,
        coalesce(v_dest[1], p_actor),
        coalesce(array_to_string(v_notas, ' · '), 'Llegó de más'),
        jsonb_build_object(
            'origen_erp_sucursal_id', v_org_erp,
            'erp_sucursal_id',        v_dst_erp,
            'origen_branch_id',       v_org_bid,
            'branch_id',              v_dst_bid,
            'origen_branch_name',     v_org_nom,
            'branch_name',            v_dst_nom,
            'origen_vencidos',        v_venc,
            'items',                  v_items,
            'motivo_tipo',            'Sobrante',
            'reason',                 'Llegó de más' || coalesce(' en el paquete ' || v_bolsa, ''),
            'sobrante_de',            r.id,
            'sobrante_familia',       v_familia,
            'sobrante_bolsa',         v_bolsa,
            'destinatarios',          to_jsonb(coalesce(v_dest, ARRAY[]::uuid[])),
            'escalon_aviso',          v_esc,
            'total_unidades',         v_total))
    RETURNING id INTO v_id;
    PERFORM set_config('portal.sobrante_de', '', true);

    RETURN json_build_object('ok', true, 'envio_id', v_id, 'productos', jsonb_array_length(v_items));
END;
$function$;

CREATE OR REPLACE FUNCTION public.dist_cerrar_invalidacion(p_solicitud uuid, p_aprobador uuid, p_nota text, p_aplicado jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    s        public.approval_requests%ROWTYPE;
    v_cuerpo text;
    v_link   text;
BEGIN
    SELECT * INTO s FROM public.approval_requests WHERE id = p_solicitud FOR UPDATE;
    IF NOT FOUND OR s.type <> 'DIST_INVALIDACION' OR s.status <> 'PENDING' THEN RETURN; END IF;
    UPDATE public.approval_requests
       SET status = 'APPROVED', approver_id = p_aprobador,
           approver_note = nullif(btrim(coalesce(p_nota, '')), ''),
           metadata = (metadata - 'aplicando_desde') || jsonb_build_object('aplicado', p_aplicado),
           updated_at = now()
     WHERE id = p_solicitud;
    IF s.metadata->>'accion' = 'corregir' THEN
        v_cuerpo := 'Ya puedes corregir el documento ' || coalesce(s.metadata->>'numero_control', '')
                 || ': se abrió una venta nueva con lo mismo. Al facturarla, la anterior se invalida ante el MH.';
        v_link := '/torogoz/venta/' || coalesce(p_aplicado->>'pedido_id', s.metadata->>'pedido_id');
    ELSE
        v_cuerpo := 'Se deshizo la venta ' || coalesce(s.metadata->>'numero_control', '') || ' de '
                 || coalesce(s.metadata->>'cliente', 'un cliente') || '.';
        v_link := '/torogoz/solicitudes?solicitud=' || p_solicitud;
    END IF;
    PERFORM public.dist_avisar(ARRAY[s.employee_id], 'Solicitud aprobada', v_cuerpo, v_link, 'REQUEST_DECIDED',
        jsonb_build_object('request_id', p_solicitud, 'request_type', 'DIST_INVALIDACION'), p_aprobador);
END $function$;

CREATE OR REPLACE FUNCTION public.dist_devolucion_disponible(p_dte bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE d record; v_items json; v_motivo text;
BEGIN
    SELECT x.id, x.tipo, x.estado, x.numero_control, x.fec_emi, x.pedido_id, x.cliente_id, x.total_pagar, x.invalidacion_estado, c.nombre AS cliente
      INTO d FROM public.dist_dte x JOIN public.dist_clientes c ON c.id = x.cliente_id WHERE x.id = p_dte;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_DEVOLUCION: no existe ese documento'; END IF;
    v_motivo := CASE
        WHEN d.tipo = '01' THEN 'A una Factura no se le hace Nota de Crédito: para una devolución se corrige el documento (se anula y se emite otro con lo que el cliente se quedó).'
        WHEN d.tipo <> '03' THEN 'Sólo un Crédito Fiscal admite Nota de Crédito.'
        WHEN d.estado <> 'sellado' THEN 'El crédito fiscal tiene que estar sellado por el MH antes de hacerle una nota.'
        WHEN d.invalidacion_estado IN ('pendiente', 'procesada') THEN 'El documento tiene una invalidación en curso.'
    END;
    WITH vendidas AS (
        SELECT i.id AS item_id, i.product_id, i.descripcion, i.presentacion, a.lote_id,
               coalesce(sum(a.unidades), max(i.cantidad * greatest(coalesce(i.unidades, 1), 1)))::integer AS vendidas,
               i.precio_con_iva / greatest(coalesce(i.unidades, 1), 1) AS precio_unitario,
               CASE WHEN i.cantidad > 0 THEN i.descuento / (i.cantidad * greatest(coalesce(i.unidades, 1), 1)) ELSE 0 END AS descuento_unitario
          FROM public.dist_pedido_items i
          LEFT JOIN public.dist_lote_asignaciones a ON a.item_id = i.id AND a.dte_id = p_dte AND a.devuelta_at IS NULL
         WHERE i.pedido_id = d.pedido_id
         GROUP BY i.id, a.lote_id
    ),
    devueltas AS (
        SELECT di.item_id, di.lote_id, sum(di.unidades)::integer AS devueltas
          FROM public.dist_devolucion_items di JOIN public.dist_devoluciones dv ON dv.id = di.devolucion_id
         WHERE dv.dte_origen_id = p_dte
           AND (dv.estado = 'emitida' OR (dv.estado = 'preparada' AND dv.created_at > now() - interval '15 minutes'))
         GROUP BY di.item_id, di.lote_id
    )
    SELECT coalesce(json_agg(json_build_object(
            'item_id', v.item_id, 'product_id', v.product_id, 'descripcion', v.descripcion, 'presentacion', v.presentacion,
            'lote_id', v.lote_id, 'lote', l.lote, 'vence', l.vence,
            'vendidas', v.vendidas, 'devueltas', coalesce(dv.devueltas, 0),
            'disponibles', greatest(0, v.vendidas - coalesce(dv.devueltas, 0)),
            'precio_unitario', round(v.precio_unitario, 6), 'descuento_unitario', round(v.descuento_unitario, 6))
          ORDER BY v.item_id, l.vence NULLS LAST), '[]'::json)
      INTO v_items
      FROM vendidas v
      LEFT JOIN public.dist_lotes l ON l.id = v.lote_id
      LEFT JOIN devueltas dv ON dv.item_id = v.item_id AND dv.lote_id IS NOT DISTINCT FROM v.lote_id;
    RETURN json_build_object(
        'documento', json_build_object('id', d.id, 'tipo', d.tipo, 'numero_control', d.numero_control, 'fec_emi', d.fec_emi,
                                       'cliente', d.cliente, 'total', d.total_pagar),
        'puede', v_motivo IS NULL, 'motivo', v_motivo, 'items', v_items,
        'notas', (SELECT coalesce(json_agg(json_build_object('id', dv.id, 'nota_id', dv.nota_id, 'total', dv.total,
                                   'motivo', dv.motivo, 'fecha', dv.emitida_at, 'a_favor', dv.a_favor, 'credito_aplicado', dv.credito_aplicado)
                                   ORDER BY dv.id), '[]'::json)
                    FROM public.dist_devoluciones dv WHERE dv.dte_origen_id = p_dte AND dv.estado = 'emitida'));
END $function$;

CREATE OR REPLACE FUNCTION public.dist_pedir_invalidacion(p_dte bigint, p_accion text, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo      uuid := public.auth_employee_id();
    d         public.dist_dte%ROWTYPE;
    v_plazo   json;
    v_cliente text;
    v_vend    uuid;
    v_quien   text;
    v_motivo  text := nullif(btrim(coalesce(p_motivo, '')), '');
    v_x       public.dist_cxc%ROWTYPE;
    v_efe     numeric := 0;
    v_favor   numeric := 0;
    v_id      uuid;
    v_dest    uuid[];
    v_titulo  text;
    v_cuerpo  text;
    v_link    text;
BEGIN
    IF v_yo IS NULL OR NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no puedes vender en Distribución';
    END IF;
    IF p_accion NOT IN ('anular', 'corregir') THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: acción desconocida';
    END IF;
    IF v_motivo IS NULL THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: escribe por qué hay que %', CASE p_accion WHEN 'anular' THEN 'deshacer la venta' ELSE 'corregir el documento' END;
    END IF;
    SELECT * INTO d FROM public.dist_dte WHERE id = p_dte FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIST_INVALIDACION: no existe ese documento'; END IF;
    IF d.estado <> 'sellado' OR d.tipo NOT IN ('01', '03') OR d.pedido_id IS NULL THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: sólo se invalida una venta sellada por el MH';
    END IF;
    IF d.invalidacion_estado IN ('pendiente', 'procesada') THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: este documento ya se está invalidando';
    END IF;
    IF EXISTS (SELECT 1 FROM public.dist_pedidos WHERE reemplaza_dte_id = p_dte AND estado <> 'anulado') THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: ya hay una corrección abierta para este documento';
    END IF;
    IF EXISTS (SELECT 1 FROM public.approval_requests
                WHERE type = 'DIST_INVALIDACION' AND status = 'PENDING' AND metadata->>'dte_id' = p_dte::text) THEN
        RAISE EXCEPTION 'DIST_INVALIDACION_PEDIDA: ya hay una solicitud esperando decisión para este documento';
    END IF;
    -- Una nota de crédito ya devolvió parte (a la deuda o a favor del
    -- cliente): invalidar el original encima devolvería lo mismo dos veces.
    -- Hacienda tampoco lo acepta: primero se invalida la nota.
    IF EXISTS (SELECT 1 FROM public.dist_devoluciones dv JOIN public.dist_dte n ON n.id = dv.nota_id
                WHERE dv.dte_origen_id = p_dte AND dv.estado = 'emitida'
                  AND n.estado NOT IN ('descartado', 'rechazado', 'invalidado')) THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: Este documento tiene una nota de crédito. Primero hay que invalidar la nota.';
    END IF;
    v_plazo := public.dist_plazo_invalidacion_de(p_dte);
    IF v_plazo->>'estado' = 'vencido' THEN
        RAISE EXCEPTION 'DIST_INVALIDACION: venció el plazo para invalidar este documento (%)', v_plazo->>'limite';
    END IF;

    SELECT c.nombre, p.vendedor_id INTO v_cliente, v_vend
      FROM public.dist_pedidos p JOIN public.dist_clientes c ON c.id = p.cliente_id WHERE p.id = d.pedido_id;

    -- Qué pasaría con el dinero, para que quien decide lo vea antes.
    IF p_accion = 'anular' THEN
        -- Lo cobrado al vender sale del documento (resumen.pagos), igual que
        -- en dist_reintegrar_documento.
        SELECT coalesce(sum((x->>'montoPago')::numeric) FILTER (WHERE x->>'codigo' = '01'), 0),
               coalesce(sum((x->>'montoPago')::numeric) FILTER (WHERE x->>'codigo' NOT IN ('01', '13')), 0)
          INTO v_efe, v_favor FROM jsonb_array_elements(coalesce(d.json->'resumen'->'pagos', '[]'::jsonb)) x;
        SELECT v_efe + coalesce(sum(ab.monto) FILTER (WHERE r.forma = '01'), 0),
               v_favor + coalesce(sum(ab.monto) FILTER (WHERE r.forma <> '01'), 0)
          INTO v_efe, v_favor
          FROM public.dist_cxc x JOIN public.dist_cxc_abonos ab ON ab.cxc_id = x.id
          JOIN public.dist_recibos r ON r.id = ab.recibo_id AND r.anulado_at IS NULL
         WHERE x.dte_id = p_dte;
        -- Lo que se pagó con saldo a favor vuelve al saldo a favor.
        SELECT v_favor + coalesce(sum(a.monto), 0) INTO v_favor
          FROM public.dist_cxc x JOIN public.dist_saldo_aplicaciones a ON a.cxc_id = x.id
         WHERE x.dte_id = p_dte;
    END IF;
    SELECT * INTO v_x FROM public.dist_cxc WHERE dte_id = p_dte;

    -- Sin `approver_id` al insertar, igual que DIST_DESCUENTO: el aviso lo
    -- manda esta función, no `notificar_solicitud_creada`.
    INSERT INTO public.approval_requests (employee_id, type, status, note, metadata)
    VALUES (v_yo, 'DIST_INVALIDACION', 'PENDING', v_motivo,
            jsonb_build_object('dte_id', p_dte, 'accion', p_accion, 'tipo_invalidacion', CASE p_accion WHEN 'anular' THEN 2 ELSE 1 END,
                               'pedido_id', d.pedido_id, 'vendedor_id', v_vend, 'cliente', v_cliente,
                               'tipo_documento', d.tipo, 'numero_control', d.numero_control, 'fec_emi', d.fec_emi,
                               'total', d.total_pagar, 'abonado', coalesce(v_x.abonado, 0),
                               'devolver_efectivo', round(v_efe, 2), 'a_favor', round(v_favor, 2),
                               'plazo', v_plazo))
    RETURNING id INTO v_id;

    SELECT array_agg(e.id) INTO v_dest FROM public.employees e
     WHERE e.status = 'ACTIVO' AND e.id <> v_yo
       AND public.puede_aprobar_modulo(e.id, 'requests_distribucion');
    IF array_length(v_dest, 1) = 1 THEN
        UPDATE public.approval_requests SET approver_id = v_dest[1] WHERE id = v_id;
    END IF;
    SELECT name INTO v_quien FROM public.employees WHERE id = v_yo;
    v_titulo := CASE p_accion WHEN 'anular' THEN 'Deshacer una venta' ELSE 'Corregir un documento' END;
    v_cuerpo := coalesce(v_quien, 'Un vendedor') || CASE p_accion WHEN 'anular' THEN ' pide deshacer ' ELSE ' pide corregir ' END
             || CASE d.tipo WHEN '03' THEN 'el Crédito Fiscal ' ELSE 'la Factura ' END || d.numero_control
             || ' de ' || coalesce(v_cliente, 'un cliente') || ' ($' || to_char(d.total_pagar, 'FM999,999,990.00') || ')'
             || ' — ' || left(v_motivo, 140);
    v_link := '/torogoz/solicitudes?solicitud=' || v_id;
    PERFORM public.dist_avisar(v_dest, v_titulo, v_cuerpo, v_link, 'REQUEST_PENDING',
        jsonb_build_object('request_id', v_id, 'request_type', 'DIST_INVALIDACION'), v_yo);

    RETURN json_build_object('solicitud_id', v_id, 'aprobadores', coalesce(array_length(v_dest, 1), 0));
END $function$;

CREATE OR REPLACE FUNCTION public.dist_validar_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_cliente   public.dist_clientes%ROWTYPE;
    v_pedido    public.dist_pedidos%ROWTYPE;
    v_cat       public.dist_catalogo%ROWTYPE;
    v_prod      public.products%ROWTYPE;
    v_emisor    public.dist_emisores%ROWTYPE;
    v_precio    numeric;
    v_lista     smallint;
    v_importe   numeric;
    v_pedido_d  numeric;   -- el descuento que se pide en este renglón, con IVA
    v_pct       numeric;
    v_puede     boolean;
    v_cat_pct   numeric;   -- el % del catálogo vigente hoy
    v_tope      numeric;   -- el tope del que tiene «descuentos»: el del producto o el de la empresa
BEGIN
    SELECT * INTO v_pedido FROM public.dist_pedidos WHERE id = NEW.pedido_id;
    IF v_pedido.estado <> 'confirmado' THEN
        RAISE EXCEPTION 'DIST_PEDIDO_CERRADO: el pedido ya está %', v_pedido.estado;
    END IF;
    SELECT * INTO v_cliente FROM public.dist_clientes WHERE id = v_pedido.cliente_id;
    SELECT * INTO v_emisor FROM public.dist_emisores WHERE id = v_pedido.emisor_id;
    SELECT * INTO v_cat FROM public.dist_catalogo
     WHERE emisor_id = v_pedido.emisor_id AND product_id = NEW.product_id AND activo;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DIST_FUERA_DE_CATALOGO: el producto % no está en el catálogo de ruta', NEW.product_id;
    END IF;
    SELECT * INTO v_prod FROM public.products WHERE id = NEW.product_id;
    IF v_cliente.tipo IN ('tienda','supermercado') AND (
        NOT v_cat.venta_libre OR coalesce(v_prod.es_antibiotico, false)
        OR coalesce(v_prod.requiere_receta, false)) THEN
        RAISE EXCEPTION 'DIST_NO_VENTA_LIBRE: «%» no es de venta libre y el cliente es %', v_prod.nombre, v_cliente.tipo;
    END IF;

    -- Precio: la lista pedida → la del cliente → la base; y si la presentación
    -- no tiene precio, «UNIDAD» con el precio del catálogo. Gemelo de pantalla:
    -- src/views/distribucion/precios.js.
    v_lista := coalesce(NEW.lista_id, v_cliente.lista_id);
    SELECT p.precio_con_iva, p.lista_id, p.unidades INTO v_precio, v_lista, NEW.unidades
      FROM public.dist_precios p JOIN public.dist_listas l ON l.id = p.lista_id
     WHERE p.emisor_id = v_pedido.emisor_id AND p.product_id = NEW.product_id
       AND p.presentacion = NEW.presentacion AND p.activo AND l.activo
     ORDER BY (p.lista_id = v_lista) DESC, l.orden
     LIMIT 1;
    IF NOT FOUND THEN
        IF NEW.presentacion <> 'UNIDAD' THEN
            RAISE EXCEPTION 'DIST_SIN_PRECIO: «%» no tiene precio en la presentación %', v_prod.nombre, NEW.presentacion;
        END IF;
        v_precio := v_cat.precio_con_iva;
        NEW.unidades := 1;
        v_lista := NULL;
    END IF;
    NEW.precio_con_iva := v_precio;
    NEW.lista_id := v_lista;
    NEW.descripcion := v_prod.nombre || CASE WHEN NEW.presentacion <> 'UNIDAD' THEN ' — ' || NEW.presentacion ELSE '' END;

    -- ── El descuento ──
    v_importe := NEW.cantidad * NEW.precio_con_iva;
    -- Aprobando una solicitud: `dist_resolver_descuento` ya decidió; el
    -- renglón trae el monto final y no se vuelve a juzgar.
    IF current_setting('dist.resolviendo_descuento', true) = 'on' THEN
        IF NEW.descuento > v_importe THEN
            RAISE EXCEPTION 'DIST_DESCUENTO: el descuento pasa del importe del producto';
        END IF;
        RETURN NEW;
    END IF;

    v_pedido_d := CASE WHEN NEW.descuento_pct IS NOT NULL
                       THEN round(v_importe * NEW.descuento_pct / 100, 2)
                       ELSE NEW.descuento END;
    IF v_pedido_d > v_importe THEN
        RAISE EXCEPTION 'DIST_DESCUENTO: el descuento pasa del importe del producto';
    END IF;

    IF v_pedido_d = 0 THEN
        NEW.descuento := 0;
        NEW.descuento_estado := 'aplicado';
        NEW.descuento_pedido := NULL;
        NEW.descuento_origen := NULL;
        RETURN NEW;
    END IF;

    v_pct := CASE WHEN v_importe > 0 THEN v_pedido_d * 100 / v_importe ELSE 0 END;
    -- El % del catálogo (0029): lo da cualquiera que venda, sin aprobación,
    -- mientras esté vigente. Gemelo de pantalla: descuentoDelCatalogo() en
    -- src/views/distribucion/precios.js.
    v_cat_pct := CASE WHEN coalesce(v_cat.descuento_pct, 0) > 0
                       AND (v_cat.descuento_desde IS NULL OR v_cat.descuento_desde <= (now() AT TIME ZONE 'America/El_Salvador')::date)
                       AND (v_cat.descuento_hasta IS NULL OR v_cat.descuento_hasta >= (now() AT TIME ZONE 'America/El_Salvador')::date)
                      THEN v_cat.descuento_pct ELSE 0 END;
    NEW.descuento_origen := CASE WHEN v_cat_pct > 0 AND abs(v_pct - v_cat_pct) <= 0.005 THEN 'catalogo' ELSE 'manual' END;

    -- Volver a guardar la venta con el MISMO descuento ya dado (aprobado o
    -- aplicado por quien podía) no lo vuelve a poner en duda.
    IF TG_OP = 'UPDATE' AND OLD.descuento_estado = 'aplicado' AND OLD.descuento = v_pedido_d
       AND OLD.cantidad = NEW.cantidad AND OLD.precio_con_iva = NEW.precio_con_iva THEN
        NEW.descuento := v_pedido_d;
        NEW.descuento_estado := 'aplicado';
        NEW.descuento_pedido := NULL;
        RETURN NEW;
    END IF;

    v_tope := coalesce(v_cat.descuento_max_pct, v_emisor.descuento_max_pct);
    v_puede := (SELECT auth.role()) = 'service_role'
        OR v_pct <= v_cat_pct + 0.005
        OR (SELECT public.auth_can_edit_any(ARRAY['distribucion_config']))
        OR ((SELECT public.auth_can_edit_any(ARRAY['distribucion_descuentos']))
            AND v_pct <= greatest(v_tope, v_cat_pct) + 0.005);

    IF v_puede THEN
        NEW.descuento := v_pedido_d;
        NEW.descuento_estado := 'aplicado';
        NEW.descuento_pedido := NULL;
    ELSE
        -- Se guarda lo pedido; lo que vale hoy es cero.
        NEW.descuento := 0;
        NEW.descuento_estado := 'pendiente';
        NEW.descuento_pedido := v_pedido_d;
    END IF;
    RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.editar_renglon(p_renglon_id bigint, p_lote_total integer DEFAULT NULL::integer, p_factor_unidades smallint DEFAULT NULL::smallint, p_tiene_bono boolean DEFAULT NULL::boolean, p_paga text DEFAULT NULL::text, p_supplier_id integer DEFAULT NULL::integer, p_borrar_lote boolean DEFAULT false, p_cualquier_pres boolean DEFAULT false, p_reparto jsonb DEFAULT NULL::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_r     public.promocion_renglon%ROWTYPE;
    v_lote  integer;
    v_fac   smallint;
    v_tiene boolean;
    v_paga  text;
    v_prov  integer;
    v_suma  integer;
    v_rep   jsonb;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;

    SELECT * INTO v_r FROM public.promocion_renglon WHERE id = p_renglon_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: el producto % no existe', p_renglon_id; END IF;

    v_lote  := CASE WHEN p_borrar_lote    THEN NULL
                    WHEN p_lote_total IS NOT NULL THEN p_lote_total
                    ELSE v_r.lote_total END;
    v_fac   := CASE WHEN p_cualquier_pres THEN NULL
                    WHEN p_factor_unidades IS NOT NULL THEN p_factor_unidades
                    ELSE v_r.factor_unidades END;
    v_tiene := coalesce(p_tiene_bono, v_r.tiene_bono);
    v_paga  := CASE WHEN NOT v_tiene THEN NULL ELSE coalesce(p_paga, v_r.paga) END;
    v_prov  := CASE WHEN v_paga IS DISTINCT FROM 'proveedor' THEN NULL
                    ELSE coalesce(p_supplier_id, v_r.supplier_id) END;

    IF v_lote IS NOT NULL AND v_lote <= 0 THEN
        RAISE EXCEPTION 'LOTE_INVALIDO: el lote es % — dejalo vacío si no se sabe', v_lote;
    END IF;
    IF v_tiene AND v_paga IS NULL THEN
        RAISE EXCEPTION 'FALTA_QUIEN_PAGA: si paga bono, hay que decir si lo cancela la empresa o un proveedor';
    END IF;
    IF v_paga = 'proveedor' AND v_prov IS NULL THEN
        RAISE EXCEPTION 'FALTA_EL_PROVEEDOR: lo paga un proveedor, hay que decir cuál';
    END IF;

    -- El reparto que va a quedar: el nuevo si vino, el de la tabla si no.
    IF p_reparto IS NOT NULL THEN
        SELECT coalesce(sum((x ->> 'unidades')::integer), 0) INTO v_suma
          FROM jsonb_array_elements(p_reparto) x;
    ELSE
        SELECT coalesce(sum(asignado_vigente), 0) INTO v_suma
          FROM public.promocion_reparto WHERE renglon_id = p_renglon_id;
    END IF;

    -- Se valida el estado FINAL, no el intermedio. Ésa es toda la diferencia.
    IF v_suma > 0 AND v_lote IS NULL THEN
        RAISE EXCEPTION 'REPARTO_SIN_LOTE: quedarían % unidades repartidas sin un lote que las respalde', v_suma;
    END IF;
    IF v_suma > 0 AND v_suma <> v_lote THEN
        RAISE EXCEPTION 'REPARTO_NO_CUADRA: el reparto sumaría % y el lote quedaría en %', v_suma, v_lote;
    END IF;

    UPDATE public.promocion_renglon
       SET lote_total      = v_lote,
           factor_unidades = v_fac,
           tiene_bono      = v_tiene,
           paga            = v_paga,
           supplier_id     = v_prov,
           updated_at      = now()
     WHERE id = p_renglon_id;

    IF p_reparto IS NOT NULL THEN
        DELETE FROM public.promocion_reparto WHERE renglon_id = p_renglon_id;
        FOR v_rep IN SELECT * FROM jsonb_array_elements(p_reparto)
        LOOP
            -- `>= 0` y no `> 0`: la fila en 0 es «aplica acá, sin lote».
            IF (v_rep ->> 'unidades')::integer >= 0 THEN
                INSERT INTO public.promocion_reparto
                    (renglon_id, branch_id, asignado_original, asignado_vigente)
                VALUES (p_renglon_id, (v_rep ->> 'branch_id')::bigint,
                        (v_rep ->> 'unidades')::integer, (v_rep ->> 'unidades')::integer);
            END IF;
        END LOOP;
    END IF;

    PERFORM public.promocion_log(
        v_r.promocion_id, p_renglon_id, NULL, 'renglon_editado',
        coalesce(v_r.lote_total::text, 'sin lote'),
        coalesce(v_lote::text, 'sin lote'),
        CASE WHEN v_tiene IS DISTINCT FROM v_r.tiene_bono
             THEN (CASE WHEN v_tiene THEN 'pasa a pagar bono' ELSE 'pasa a sólo medir' END)
             WHEN v_fac IS DISTINCT FROM v_r.factor_unidades THEN 'cambió la presentación'
             WHEN p_reparto IS NOT NULL THEN 'con reparto nuevo'
             ELSE NULL END);

    RETURN json_build_object('renglon_id', p_renglon_id, 'lote_total', v_lote, 'repartido', v_suma);
END;
$function$;

CREATE OR REPLACE FUNCTION public.editar_reparto(p_renglon_id bigint, p_reparto jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_r     public.promocion_renglon%ROWTYPE;
    v_rep   jsonb;
    v_suma  integer := 0;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;

    SELECT * INTO v_r FROM public.promocion_renglon WHERE id = p_renglon_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: el producto % no existe', p_renglon_id; END IF;

    SELECT coalesce(sum((x ->> 'unidades')::integer), 0) INTO v_suma
      FROM jsonb_array_elements(coalesce(p_reparto, '[]'::jsonb)) x;

    IF v_suma > 0 AND v_r.lote_total IS NULL THEN
        RAISE EXCEPTION 'REPARTO_SIN_LOTE: no se puede repartir % unidades de un lote que no está declarado', v_suma;
    END IF;
    IF v_suma > 0 AND v_suma <> v_r.lote_total THEN
        RAISE EXCEPTION 'REPARTO_NO_CUADRA: reparte % de un lote de %', v_suma, v_r.lote_total;
    END IF;

    -- Se borra y se reescribe. Las marcas de aviso se pierden a propósito: con
    -- un reparto nuevo, el 80% de antes ya no significa lo mismo y la sala tiene
    -- derecho a que le vuelvan a avisar sobre su número nuevo.
    DELETE FROM public.promocion_reparto WHERE renglon_id = p_renglon_id;

    FOR v_rep IN SELECT * FROM jsonb_array_elements(coalesce(p_reparto, '[]'::jsonb))
    LOOP
        IF (v_rep ->> 'unidades')::integer > 0 THEN
            INSERT INTO public.promocion_reparto
                (renglon_id, branch_id, asignado_original, asignado_vigente)
            VALUES (p_renglon_id, (v_rep ->> 'branch_id')::bigint,
                    (v_rep ->> 'unidades')::integer, (v_rep ->> 'unidades')::integer);
        END IF;
    END LOOP;

    PERFORM public.promocion_log(
        v_r.promocion_id, p_renglon_id, NULL, 'reparto_editado',
        NULL, v_suma::text, 'se rehízo el reparto entre las sucursales');

    RETURN json_build_object('renglon_id', p_renglon_id, 'repartido', v_suma);
END;
$function$;

CREATE OR REPLACE FUNCTION public.editar_tarifa_renglon(p_renglon_id bigint, p_bono_vendedor numeric, p_bono_adm numeric, p_bono_bodega numeric, p_unidades_por_bono integer DEFAULT 1, p_desde date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_r     public.promocion_renglon%ROWTYPE;
    v_desde date;
    v_prev  public.promocion_renglon_tarifa%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;

    SELECT * INTO v_r FROM public.promocion_renglon WHERE id = p_renglon_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: el producto % no existe', p_renglon_id; END IF;
    IF v_r.estado = 'cerrado' THEN
        RAISE EXCEPTION 'RENGLON_CERRADO: ya terminó (%), sus montos no se tocan', v_r.cerrado_motivo;
    END IF;

    -- El día del cambio lo pone el servidor, no el llamador: si se pudiera
    -- elegir una fecha pasada, «sin retroactividad» dejaría de ser cierto.
    v_desde := greatest(
        (now() AT TIME ZONE 'America/El_Salvador')::date,
        v_r.inicio);
    IF p_desde IS NOT NULL AND p_desde > v_desde THEN
        v_desde := p_desde;                      -- adelantarlo sí se permite
    END IF;

    SELECT * INTO v_prev FROM public.promocion_renglon_tarifa
     WHERE renglon_id = p_renglon_id AND desde <= v_desde
     ORDER BY desde DESC LIMIT 1;

    INSERT INTO public.promocion_renglon_tarifa
        (renglon_id, desde, bono_vendedor, bono_adm, bono_bodega,
         unidades_por_bono, creado_por)
    VALUES
        (p_renglon_id, v_desde,
         coalesce(p_bono_vendedor, 0), coalesce(p_bono_adm, 0), coalesce(p_bono_bodega, 0),
         greatest(coalesce(p_unidades_por_bono, 1), 1), v_actor)
    ON CONFLICT (renglon_id, desde) DO UPDATE
       SET bono_vendedor     = EXCLUDED.bono_vendedor,
           bono_adm          = EXCLUDED.bono_adm,
           bono_bodega       = EXCLUDED.bono_bodega,
           unidades_por_bono = EXCLUDED.unidades_por_bono,
           creado_por        = EXCLUDED.creado_por;

    PERFORM public.promocion_log(
        v_r.promocion_id, p_renglon_id, NULL, 'tarifa_cambiada',
        coalesce(v_prev.bono_vendedor::text, '—'),
        coalesce(p_bono_vendedor, 0)::text,
        'rige desde ' || v_desde::text);

    RETURN json_build_object('renglon_id', p_renglon_id, 'desde', v_desde);
END;
$function$;

CREATE OR REPLACE FUNCTION public.elegir_sala_activa(p_branch_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_yo    uuid := public.auth_employee_id();
  v_sede  bigint;
  v_antes bigint;
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  SELECT e.branch_id INTO v_sede FROM public.employees e WHERE e.id = v_yo;
  SELECT sa.branch_id INTO v_antes FROM public.sala_activa sa WHERE sa.employee_id = v_yo;

  IF p_branch_id IS NULL OR p_branch_id = v_sede THEN
    DELETE FROM public.sala_activa WHERE employee_id = v_yo;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.employee_branches eb
                    WHERE eb.employee_id = v_yo AND eb.branch_id = p_branch_id) THEN
      RAISE EXCEPTION 'SALA_NO_CUBIERTA' USING HINT = 'Esa sucursal no está entre las que cubres.';
    END IF;
    INSERT INTO public.sala_activa (employee_id, branch_id) VALUES (v_yo, p_branch_id)
    ON CONFLICT (employee_id) DO UPDATE SET branch_id = EXCLUDED.branch_id, updated_at = now();
  END IF;

  INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, branch_id, details)
  VALUES (v_yo, (SELECT e.name FROM public.employees e WHERE e.id = v_yo), 'ELEGIR_SALA_ACTIVA', v_yo::text,
          'ADMIN_PANEL', 'INFO', coalesce(p_branch_id, v_sede),
          jsonb_build_object('antes', v_antes, 'ahora', CASE WHEN p_branch_id = v_sede THEN NULL ELSE p_branch_id END));
  PERFORM set_config('farmalasa.auth_yo', '', true);
  RETURN json_build_object('branch_id', coalesce(public.sala_activa_vigente(v_yo), v_sede::integer));
END;
$function$;

CREATE OR REPLACE FUNCTION public.encargo_nuevo_en_sucursal_crear(p_branch_id bigint, p_customer_id bigint, p_nombre text, p_cantidad integer, p_nota text DEFAULT NULL::text, p_srs jsonb DEFAULT NULL::jsonb, p_foto_url text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint;
BEGIN
  IF NOT (p_branch_id = (SELECT public.auth_employee_branch_id()) OR (SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes']))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN RAISE EXCEPTION 'Elige el cliente.'; END IF;
  IF length(coalesce(btrim(p_nombre), '')) < 3 THEN RAISE EXCEPTION 'Escribe el nombre del producto.'; END IF;
  IF p_cantidad IS NULL OR p_cantidad < 1 OR p_cantidad > 20 THEN RAISE EXCEPTION 'Un encargo va de 1 a 20 unidades.'; END IF;
  IF p_srs IS NOT NULL AND jsonb_typeof(p_srs) <> 'object' THEN RAISE EXCEPTION 'El registro del SRS no es válido.'; END IF;
  -- La foto sólo puede ser de este bucket y de esta sala.
  IF p_foto_url IS NOT NULL AND p_foto_url !~ ('/encargos-fotos/' || p_branch_id || '/') THEN
    RAISE EXCEPTION 'La foto no es de esta sucursal.';
  END IF;
  INSERT INTO public.app_encargos (customer_id, branch_id, product_id, producto_nuevo, producto_nombre, factor, cantidad,
                                   nota_cliente, srs, foto_url, estado, pago_estado)
  VALUES (p_customer_id, p_branch_id, NULL, true, left(btrim(p_nombre), 200), 1, p_cantidad,
          left(nullif(btrim(p_nota), ''), 300), p_srs, nullif(btrim(p_foto_url), ''), 'solicitado', 'pendiente')
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'ENCARGO_NUEVO_EN_SUCURSAL', v_id::text,
          jsonb_build_object('cliente', p_customer_id, 'producto', left(btrim(p_nombre), 200), 'cantidad', p_cantidad,
                             'srs', p_srs IS NOT NULL, 'foto', p_foto_url IS NOT NULL), p_branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('id', v_id, 'codigo', 'E-' || lpad(v_id::text, 6, '0'));
END $function$;

CREATE OR REPLACE FUNCTION public.encargo_proveedor_no_entrego(p_id bigint, p_eleccion text, p_motivo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  e public.app_encargos; v_emp uuid := public.auth_employee_id();
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_motivo text := 'El proveedor no entregó' || coalesce(': ' || nullif(btrim(coalesce(p_motivo, '')), ''), '');
  v_metodo text; v_id bigint; v_dev boolean := p_eleccion = 'devolucion'; v_cod text := 'E-' || lpad(p_id::text, 6, '0');
  v_dest uuid[]; v_cliente text; v_sala text;
BEGIN
  IF NOT public.reservas_v2_rige() THEN RAISE EXCEPTION 'Esta acción empieza a regir con el reglamento nuevo.'; END IF;
  IF p_eleccion NOT IN ('devolucion', 'saldo') THEN RAISE EXCEPTION 'Indica qué eligió el cliente: devolución o saldo a favor.'; END IF;
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
  IF NOT public.encargo_puede_manejar(e.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF e.estado NOT IN ('aceptado', 'pedido') OR e.pago_estado <> 'pagado' THEN
    RAISE EXCEPTION 'Sólo un encargo pagado que todavía no llegó.';
  END IF;
  IF e.reserva_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ese encargo es el resto de la reserva R-%: se resuelve desde la reserva.', lpad(e.reserva_id::text, 6, '0');
  END IF;
  IF EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.encargo_id = e.id) THEN
    RAISE EXCEPTION 'El pago de ese encargo ya se aplicó a una factura.';
  END IF;
  v_metodo := CASE
    WHEN EXISTS (SELECT 1 FROM public.app_reservas_pagos pg WHERE pg.encargo_id = e.id AND pg.pagado_at IS NOT NULL) THEN 'en_linea'
    ELSE coalesce((SELECT CASE lower(m.forma_pago) WHEN 'tarjeta' THEN 'tarjeta' WHEN 'transferencia' THEN 'transferencia' ELSE 'efectivo' END
                     FROM public.caja_movimientos_portal m WHERE m.encargo_id = e.id AND m.anulado_at IS NULL ORDER BY m.id DESC LIMIT 1),
                  'efectivo') END;
  IF coalesce(e.product_id, e.sugerido_product_id) IS NULL THEN
    RAISE EXCEPTION 'Es un producto nuevo sin vincular: vincúlalo al catálogo antes de resolverlo.';
  END IF;
  INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
      precio_unitario, precio_normal, estado, terminos_version, anticipo, pago_estado, pago_metodo, pagado_at,
      cerrada_at, cerrada_por, saldo_favor, saldo_favor_vence, saldo_favor_origen,
      devolucion_pedida_at, devolucion_pedida_por, devolucion_pedida_motivo)
  VALUES (e.customer_id, e.branch_id, 'sucursal', coalesce(e.product_id, e.sugerido_product_id),
      left('Encargo ' || v_cod || ' · ' || e.producto_nombre, 200),
      1, greatest(coalesce(e.factor, 1), 1), 0, 0, 'cancelada', 'encargo', e.anticipo, 'anticipo', v_metodo, coalesce(e.pagado_at, now()),
      now(), v_emp, e.anticipo, v_hoy + public.saldo_favor_dias(), 'anticipo',
      CASE WHEN v_dev THEN now() END, CASE WHEN v_dev THEN v_emp END, CASE WHEN v_dev THEN left(v_motivo, 300) END)
  RETURNING id INTO v_id;
  IF v_dev THEN
    SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = e.customer_id;
    SELECT name INTO v_sala FROM public.branches WHERE id = e.branch_id;
    SELECT array_agg(DISTINCT em.id) INTO v_dest
      FROM public.employees em
      JOIN public.role_permissions rp ON rp.role_id IN (em.role_id, em.secondary_role_id)
       AND rp.module_key = 'dash_reservas_devolver_saldo' AND (rp.can_view OR rp.can_edit)
     WHERE em.status = 'ACTIVO';
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP', 'Devolución en efectivo por autorizar · R-' || lpad(v_id::text, 6, '0'),
        format('%s pide devolver $%s a %s: %s', coalesce(v_sala, 'Una sucursal'), to_char(e.anticipo, 'FM999990.00'),
               coalesce(v_cliente, 'un cliente'), left(v_motivo || ' (encargo ' || v_cod || ')', 160)),
        '/reservas', jsonb_build_object('codigo', 'R-' || lpad(v_id::text, 6, '0'), 'check_key', 'devolucion_pedida:' || v_id), true, e.branch_id::integer);
    END IF;
    INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
    VALUES (v_emp, 'SALDO_DEVOLUCION_PEDIDA', v_id::text, jsonb_build_object('monto', e.anticipo, 'motivo', v_motivo, 'encargo', p_id), e.branch_id, 'ADMIN_PANEL');
  END IF;
  UPDATE public.app_encargos
     SET estado = 'cancelado', cerrado_at = now(), saldo_reserva_id = v_id, updated_at = now(),
         nota_sucursal = left(coalesce(nota_sucursal || ' · ', '') || v_motivo
                              || CASE WHEN v_dev THEN ' · devolución completa' ELSE ' · a saldo a favor' END, 300)
   WHERE id = p_id;
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (e.customer_id, 'reserva', 'base:encargo_no_entregado:' || p_id, 'El proveedor no entregó tu encargo ' || v_cod,
          CASE WHEN v_dev
               THEN 'Pediste la devolución de lo que pagaste ($' || to_char(e.anticipo, 'FM999990.00') || '). Te avisamos cuando esté lista para recogerla en la sucursal; mientras tanto queda a tu favor.'
               ELSE 'Lo que pagaste ($' || to_char(e.anticipo, 'FM999990.00') || ') queda a tu favor por ' || public.saldo_favor_dias()
                    || ' días, para otro producto en cualquier sucursal.' END,
          '/reservas')
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'ENCARGO_PROVEEDOR_NO_ENTREGO', p_id::text,
          jsonb_build_object('eleccion', p_eleccion, 'monto', e.anticipo, 'reserva_saldo', v_id, 'antes', e.estado, 'motivo', v_motivo),
          e.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'eleccion', p_eleccion, 'monto', e.anticipo, 'reserva', 'R-' || lpad(v_id::text, 6, '0'), 'reserva_id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.encargo_ya_vendido(p_id bigint, p_item_id bigint, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  e public.app_encargos; v_emp uuid := public.auth_employee_id();
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  ii public.sales_invoice_items; si public.sales_invoices; v_fact text;
BEGIN
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
  IF NOT public.encargo_puede_manejar(e.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF e.estado NOT IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo') THEN
    RAISE EXCEPTION 'Ese encargo ya está cerrado.';
  END IF;
  IF e.pago_estado = 'pagado' THEN
    RAISE EXCEPTION 'Ese encargo ya se pagó por el portal: se entrega con «Retirar».';
  END IF;
  IF e.reserva_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ese encargo es el resto de la reserva R-%: se resuelve desde la reserva.', lpad(e.reserva_id::text, 6, '0');
  END IF;
  IF EXISTS (SELECT 1 FROM public.caja_movimientos_portal m WHERE m.encargo_id = e.id AND m.anulado_at IS NULL) THEN
    RAISE EXCEPTION 'Ese encargo tiene un cobro en caja del portal: no se puede amarrar a otra venta.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_reservas_pagos pg WHERE pg.encargo_id = e.id
               AND (pg.pagado_at IS NOT NULL OR pg.created_at > now() - interval '2 hours')) THEN
    RAISE EXCEPTION 'El cliente tiene un pago en línea en curso para ese encargo: espera a que se resuelva.';
  END IF;

  SELECT * INTO ii FROM public.sales_invoice_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa venta no existe.'; END IF;
  SELECT * INTO si FROM public.sales_invoices WHERE id = ii.invoice_id;
  IF si.branch_id IS DISTINCT FROM e.branch_id THEN RAISE EXCEPTION 'Esa venta es de otra sucursal.'; END IF;
  IF NOT public.venta_valida(si.estado) THEN RAISE EXCEPTION 'Esa venta está anulada.'; END IF;
  IF si.fecha < (e.created_at AT TIME ZONE 'America/El_Salvador')::date THEN
    RAISE EXCEPTION 'Esa venta es de antes de anotar el encargo.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_encargos o WHERE o.venta_item_id = p_item_id AND o.id <> p_id) THEN
    RAISE EXCEPTION 'Esa venta ya está amarrada a otro encargo.';
  END IF;

  v_fact := si.tipo_documento || ' ' || coalesce(nullif(ltrim(split_part(btrim(si.correlativo), '_', 1), '0'), ''), si.erp_invoice_id::text);
  UPDATE public.app_encargos
     SET estado = 'entregado', venta_item_id = p_item_id, pago_estado = 'pagado',
         pagado_at = coalesce((si.fecha + coalesce(si.hora, '00:00'::time)) AT TIME ZONE 'America/El_Salvador', now()),
         cerrado_at = now(), updated_at = now(),
         nota_sucursal = left(coalesce(nota_sucursal || ' · ', '') || 'Se vendió en ' || v_fact
                              || coalesce(' (' || v_nota || ')', ''), 300)
   WHERE id = p_id;

  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'ENCARGO_YA_VENDIDO', p_id::text,
          jsonb_build_object('antes', e.estado, 'factura_id', si.id, 'item_id', p_item_id, 'factura', v_fact,
                             'total', ii.total_linea, 'por_cobrar', e.anticipo, 'nota', v_nota), e.branch_id, 'ADMIN_PANEL');

  RETURN json_build_object('ok', true, 'id', p_id, 'factura', v_fact);
END $function$;

CREATE OR REPLACE FUNCTION public.encolar_impresion(p_branch_id bigint, p_titulo text, p_contenido text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint; v_pendientes integer; v_bytes bytea;
BEGIN
    IF (SELECT auth_employee_id()) IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF p_branch_id IS NULL THEN RAISE EXCEPTION 'Falta decir en qué sucursal se imprime.'; END IF;
    -- Sólo en la ticketera de la PROPIA sala, salvo quien administra la
    -- impresión en toda la red (2026-10-02). Hasta hoy bastaba con ser
    -- empleado para imprimir contenido libre en la caja de cualquier sucursal.
    -- Medido antes: de 2,293 impresiones, el personal de sala imprimió siempre
    -- en la suya.
    IF p_branch_id IS DISTINCT FROM (SELECT public.auth_employee_branch_id())
       AND NOT (SELECT public.auth_can_edit_scope_all(ARRAY['impresion'])) THEN
        RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: sólo puedes imprimir en tu sucursal';
    END IF;

    BEGIN
        v_bytes := decode(coalesce(p_contenido, ''), 'base64');
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'El documento vino mal armado y no se puede imprimir.';
    END;

    IF octet_length(v_bytes) = 0 THEN
        RAISE EXCEPTION 'No hay nada que imprimir.';
    END IF;
    IF octet_length(v_bytes) > 60000 THEN
        RAISE EXCEPTION 'Ese documento es demasiado largo para un rollo.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.impresion_dispositivos d
                    WHERE d.branch_id = p_branch_id AND d.activo
                      AND d.vinculada_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Esa sucursal no tiene una caja registrada para imprimir.';
    END IF;

    SELECT count(*) INTO v_pendientes FROM public.cola_impresion c
     WHERE c.branch_id = p_branch_id AND c.estado IN ('PENDIENTE','IMPRIMIENDO');
    IF v_pendientes >= 50 THEN
        RAISE EXCEPTION 'Esa caja tiene % documentos esperando: parece que la impresora no esta respondiendo.', v_pendientes;
    END IF;

    INSERT INTO public.cola_impresion (branch_id, titulo, contenido, creado_por)
    VALUES (p_branch_id, left(btrim(p_titulo), 120), v_bytes, (SELECT auth_employee_id()))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.entregar_bolsas(p_ids bigint[], p_recibido_por uuid, p_vale uuid)
 RETURNS bolsas_entregas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo     uuid := (SELECT auth_employee_id());
    v_scope  text := (SELECT auth_module_scope('bolsas'));
    v_mia    bigint := (SELECT auth_employee_branch_id());
    v_branch bigint;
    v_metodo text;
    v_codigo text;
    v_ent    public.bolsas_entregas;
    v_n      integer := 0;
    r        record;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'Hay que elegir al menos una bolsa.';
    END IF;
    IF p_recibido_por IS NULL THEN
        RAISE EXCEPTION 'Falta quien se lleva el efectivo.';
    END IF;
    -- Dos firmas de la misma persona no son un control, son dos clics. Y se
    -- dice ACA, con el dinero todavia en la sala: el mismo aviso al recibir
    -- llega cuando ya no hay marcha atras.
    IF p_recibido_por = v_yo THEN
        RAISE EXCEPTION 'Quien se lleva el efectivo no puede firmar la entrega. La firma alguien de la sucursal.';
    END IF;

    -- Primero las bolsas y después la identidad: si algo de las bolsas no
    -- cuadra, el vale no se gasta y no hay que volver a escanear el carne.
    FOR r IN SELECT * FROM public.bolsas WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE LOOP
        IF v_scope IS DISTINCT FROM 'ALL' AND r.branch_id IS DISTINCT FROM v_mia THEN
            RAISE EXCEPTION 'FORBIDDEN';
        END IF;
        IF r.estado <> 'ABIERTA' THEN
            RAISE EXCEPTION 'La bolsa % ya salió de la sucursal.', r.folio;
        END IF;
        IF v_branch IS NULL THEN v_branch := r.branch_id;
        ELSIF v_branch <> r.branch_id THEN
            RAISE EXCEPTION 'Una entrega es de una sola sucursal. No se pueden juntar bolsas de dos sucursales.';
        END IF;
        v_n := v_n + 1;
    END LOOP;

    IF v_n = 0 THEN RAISE EXCEPTION 'Ninguna de esas bolsas existe.'; END IF;
    IF v_n <> array_length(p_ids, 1) THEN
        RAISE EXCEPTION 'Alguna de esas bolsas ya no esta. Hay que cargar la lista de nuevo.';
    END IF;

    -- Quien se lleva el dinero tiene que estar activo. No se exige que sea de
    -- ESA sala: justamente suele ser alguien de administracion que recolecta.
    IF NOT EXISTS (SELECT 1 FROM public.employees e
                    WHERE e.id = p_recibido_por AND e.status = 'ACTIVO') THEN
        RAISE EXCEPTION 'Esa persona no esta activa: no puede recibir efectivo.';
    END IF;

    v_metodo := public.consumir_vale_de_identidad(p_vale, p_recibido_por);

    SELECT upper(btrim(coalesce(br.codigo, 'B'))) INTO v_codigo
      FROM public.branches br WHERE br.id = v_branch;

    INSERT INTO public.bolsas_entregas
        (folio, branch_id, entregada_por, recibido_por, recibido_metodo)
    VALUES ('E-' || v_codigo || '-' || nextval('public.bolsas_entrega_folio_seq'),
            v_branch, v_yo, p_recibido_por, v_metodo)
    RETURNING * INTO v_ent;

    UPDATE public.bolsas
       SET estado = 'ENTREGADA', entregada_por = v_yo, entregada_at = now(),
           entrega_id = v_ent.id, updated_at = now()
     WHERE id = ANY(p_ids);

    INSERT INTO public.bolsas_eventos
        (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
    SELECT b.id, 'ENTREGAR', 'ABIERTA', 'ENTREGADA', b.monto_inicial, v_yo,
           format('%s · se lo lleva %s (%s)', v_ent.folio,
                  coalesce((SELECT e.name FROM public.employees e WHERE e.id = p_recibido_por), 'sin nombre'),
                  CASE WHEN v_metodo = 'CARNE' THEN 'carne' ELSE 'usuario y contrasena' END)
      FROM public.bolsas b WHERE b.id = ANY(p_ids);

    RETURN v_ent;
END;
$function$;

CREATE OR REPLACE FUNCTION public.escribir_niveles_promocion(p_id bigint, p_laboratorios integer[], p_niveles jsonb, p_umbrales jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_mal record;
BEGIN
    IF jsonb_typeof(coalesce(p_niveles, 'null'::jsonb)) <> 'array'
       OR jsonb_array_length(p_niveles) = 0 THEN
        RAISE EXCEPTION 'SIN_NIVELES: la promoción necesita al menos un nivel';
    END IF;
    IF jsonb_typeof(coalesce(p_umbrales, 'null'::jsonb)) <> 'array'
       OR jsonb_array_length(p_umbrales) = 0 THEN
        RAISE EXCEPTION 'SIN_UMBRALES: hay que decir cuánto necesita cada sucursal';
    END IF;

    DELETE FROM public.promocion_laboratorio   WHERE promocion_id = p_id;
    DELETE FROM public.promocion_nivel_umbral  WHERE promocion_id = p_id;
    DELETE FROM public.promocion_nivel         WHERE promocion_id = p_id;

    INSERT INTO public.promocion_laboratorio (promocion_id, laboratorio_id)
    SELECT DISTINCT p_id, x FROM unnest(p_laboratorios) x
     WHERE EXISTS (SELECT 1 FROM public.laboratorios l WHERE l.id = x);

    IF NOT EXISTS (SELECT 1 FROM public.promocion_laboratorio WHERE promocion_id = p_id) THEN
        RAISE EXCEPTION 'SIN_LABORATORIOS: ninguno de los laboratorios existe';
    END IF;

    INSERT INTO public.promocion_nivel (promocion_id, nivel, monto_por_persona)
    SELECT p_id,
           (n ->> 'nivel')::smallint,
           round((n ->> 'monto')::numeric, 2)
      FROM jsonb_array_elements(p_niveles) n;

    INSERT INTO public.promocion_nivel_umbral (promocion_id, nivel, branch_id, umbral_venta)
    SELECT p_id,
           (u ->> 'nivel')::smallint,
           (u ->> 'branch_id')::bigint,
           round((u ->> 'umbral')::numeric, 2)
      FROM jsonb_array_elements(p_umbrales) u;

    -- Todo umbral tiene que nombrar un nivel que exista.
    IF EXISTS (
        SELECT 1 FROM public.promocion_nivel_umbral nu
         WHERE nu.promocion_id = p_id
           AND NOT EXISTS (SELECT 1 FROM public.promocion_nivel nv
                            WHERE nv.promocion_id = p_id AND nv.nivel = nu.nivel)
    ) THEN
        RAISE EXCEPTION 'NIVEL_INEXISTENTE: hay un umbral para un nivel que no está definido';
    END IF;

    -- Los umbrales de cada sala suben con el nivel. Ver el comentario de arriba.
    SELECT b.name AS sala, x.nivel INTO v_mal
      FROM (
        SELECT nu.branch_id, nu.nivel, nu.umbral_venta,
               lag(nu.umbral_venta) OVER (PARTITION BY nu.branch_id ORDER BY nu.nivel) AS anterior
          FROM public.promocion_nivel_umbral nu
         WHERE nu.promocion_id = p_id
      ) x
      JOIN public.branches b ON b.id = x.branch_id
     WHERE x.anterior IS NOT NULL AND x.umbral_venta <= x.anterior
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
          'UMBRAL_NO_SUBE: en % el nivel % no pide más venta que el anterior; un nivel más alto tiene que costar más',
          v_mal.sala, v_mal.nivel;
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.extender_renglon(p_renglon_id bigint, p_fin date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_r     public.promocion_renglon%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;
    IF p_fin IS NULL THEN
        RAISE EXCEPTION 'FECHA_REQUERIDA: hasta cuándo';
    END IF;

    SELECT * INTO v_r FROM public.promocion_renglon WHERE id = p_renglon_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: el producto % no existe', p_renglon_id; END IF;
    IF p_fin < v_r.inicio THEN
        RAISE EXCEPTION 'FECHA_INVALIDA: el fin no puede ser antes del inicio (%)', v_r.inicio;
    END IF;

    -- Extender REABRE un renglón que había cerrado por vencimiento: es
    -- justamente para lo que sirve. Pero uno cerrado porque se acabó el lote no
    -- se reabre moviendo una fecha — no hay más producto que vender.
    IF v_r.estado = 'cerrado' AND v_r.cerrado_motivo = 'lote_agotado' THEN
        RAISE EXCEPTION 'LOTE_AGOTADO: se vendió el lote entero; extender la fecha no agrega producto';
    END IF;

    UPDATE public.promocion_renglon
       SET fin            = p_fin,
           estado         = 'abierto',
           cerrado_at     = NULL,
           cerrado_motivo = NULL,
           updated_at     = now()
     WHERE id = p_renglon_id;

    -- Si la promoción ya se había finalizado porque todos sus renglones habían
    -- cerrado, extender uno la vuelve a abrir: la vigencia de la promoción se
    -- DERIVA de sus renglones, no al revés.
    UPDATE public.promociones
       SET estado = 'activa', updated_at = now()
     WHERE id = v_r.promocion_id AND estado = 'finalizada';

    PERFORM public.promocion_log(
        v_r.promocion_id, p_renglon_id, NULL, 'extendido',
        v_r.fin::text, p_fin::text, NULL);

    RETURN json_build_object('renglon_id', p_renglon_id, 'fin', p_fin);
END;
$function$;

CREATE OR REPLACE FUNCTION public.facturas_sala_guarda(p_branch_id bigint, p_accion text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.auth_has_module_permission('dash_facturas_sala', p_accion) THEN
    RAISE EXCEPTION 'No tienes permiso para ver las facturas de la sucursal.';
  END IF;

  IF p_branch_id IS DISTINCT FROM
     (SELECT m.branch_id::bigint FROM public.erp_sucursal_map m WHERE m.erp_sucursal_id = 6) THEN
    RAISE EXCEPTION 'Las compras se cargan todas en Bodega.';
  END IF;

  IF public.auth_module_scope('dash_facturas_sala') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
    RAISE EXCEPTION 'Solo puedes trabajar con las facturas de tu propia sucursal.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalizar_sala_con_cajas(p_pedido_id uuid, p_sucursal_id integer, p_total_cajas integer, p_caja_map jsonb, p_pagina_items jsonb, p_cajas_electrolit integer, p_cajas_especiales jsonb, p_ajustes jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor uuid := auth_employee_id();
  s       public.pedido_sucursal_status%ROWTYPE;
  v_envio jsonb;
  v_fin   timestamptz;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: finalizar es de Bodega';
  END IF;
  IF p_total_cajas IS NULL OR p_total_cajas < 0 THEN
    RAISE EXCEPTION 'INVALID: total_cajas inválido';
  END IF;

  SELECT * INTO s FROM public.pedido_sucursal_status
   WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
   FOR UPDATE;
  IF NOT FOUND OR s.iniciado_at IS NULL THEN
    RAISE EXCEPTION 'NO_INICIADO: esa sucursal no empezó a prepararse';
  END IF;
  IF s.finalizado_at IS NOT NULL THEN
    RAISE EXCEPTION 'YA_FINALIZADO: esa sucursal ya estaba finalizada';
  END IF;

  -- 1. Qué sale de verdad (antes de finalizar: sólo toca renglones pendientes).
  v_envio := public.confirmar_envio_pedido(p_pedido_id, p_sucursal_id, coalesce(p_ajustes, '[]'::jsonb));

  -- 2. Finalizar, con la regla viva de la pausa.
  PERFORM public.update_pedido_sucursal_lifecycle(p_pedido_id, p_sucursal_id, 'finalizar', v_actor);
  SELECT finalizado_at INTO v_fin FROM public.pedido_sucursal_status WHERE id = s.id;
  IF v_fin IS NULL THEN
    RAISE EXCEPTION 'No se puede finalizar: la sucursal está en pausa.';
  END IF;

  -- 3. Cajas y hojas.
  UPDATE public.pedido_sucursal_status
     SET total_cajas      = p_total_cajas,
         caja_map         = coalesce(p_caja_map, '{}'::jsonb),
         pagina_items     = coalesce(p_pagina_items, '{}'::jsonb),
         cajas_electrolit = coalesce(p_cajas_electrolit, 0),
         cajas_especiales = coalesce(p_cajas_especiales, '[]'::jsonb)
   WHERE id = s.id;

  RETURN jsonb_build_object('finalizado_at', v_fin, 'envio', v_envio);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fotografiar_bono_meta_mes(p_year_month text, p_origen text DEFAULT 'cierre'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
    v_sala record;
    v_json json;
    v_n    integer := 0;
    v_k    integer;
BEGIN
    IF coalesce(p_year_month, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'MES_INVALIDO: %', p_year_month;
    END IF;
    IF p_year_month >= v_ym_actual THEN
        RAISE EXCEPTION 'MES_NO_CERRADO: % todavía no terminó', p_year_month;
    END IF;

    FOR v_sala IN
        SELECT m.branch_id FROM public.metas_sucursal m
         WHERE m.year_month = p_year_month ORDER BY m.branch_id
    LOOP
        v_json := public.bono_meta_sala_interno(v_sala.branch_id, p_year_month);
        IF v_json IS NULL OR (v_json ->> 'branch_id')::bigint IS DISTINCT FROM v_sala.branch_id THEN
            RAISE EXCEPTION 'META_ILEGIBLE: no se pudo leer el bono de la sucursal % en %',
                v_sala.branch_id, p_year_month;
        END IF;

        INSERT INTO public.metas_bono_persona
            (year_month, branch_id, employee_id, venta, bono, es_jefe, en_prueba, origen)
        SELECT p_year_month, v_sala.branch_id, (p ->> 'employee_id')::uuid,
               round(coalesce((p ->> 'venta')::numeric, 0), 2),
               round(coalesce((p ->> 'bono')::numeric, 0), 2),
               coalesce((p ->> 'es_jefe')::boolean, false),
               coalesce((p ->> 'en_prueba')::boolean, false),
               p_origen
          FROM json_array_elements(v_json -> 'personas') p
         WHERE (p ->> 'employee_id') IS NOT NULL
        ON CONFLICT (year_month, branch_id, employee_id) DO NOTHING;

        GET DIAGNOSTICS v_k = ROW_COUNT;
        v_n := v_n + v_k;
    END LOOP;

    RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.frenar_ajuste_si_hay_conteo_abierto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch bigint;
  v_sala text;
  v_choques text[];
  v_n int;
BEGIN
  IF NEW.type NOT IN ('INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST') THEN
    RETURN NEW;
  END IF;

  -- La sala viaja dentro de `metadata`. Si no viene, no se puede decidir, y una
  -- solicitud de ajuste SIN sala es un defecto por su cuenta: se rechaza.
  v_branch := NULLIF(NEW.metadata->>'branch_id','')::bigint;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'La solicitud no dice de qué sucursal es, y sin eso no se puede registrar.';
  END IF;

  -- Un conteo abierto que todavía no tiene renglones: no se sabe qué va a
  -- contar, así que frena la sala entera.
  SELECT b.name INTO v_sala
  FROM public.conteos_inventario c
  JOIN public.branches b ON b.id = c.branch_id
  WHERE c.branch_id = v_branch
    AND c.status IN ('BORRADOR','EN_PROGRESO')
    AND NOT EXISTS (SELECT 1 FROM public.conteo_inventario_items i WHERE i.conteo_id = c.id)
  LIMIT 1;

  IF v_sala IS NOT NULL THEN
    RAISE EXCEPTION 'En % hay un conteo de inventario abierto. Mientras se cuenta no se puede cargar ni descargar producto: el número cambiaría debajo de quien está contando. Cierra el conteo y vuelve a intentarlo.', v_sala;
  END IF;

  -- Los productos de la solicitud que están en un conteo abierto de la sala.
  -- Una línea sin `erp_product_id` no se puede cruzar: se rechaza igual que la
  -- solicitud sin sala, para que no sea la vuelta por donde pase.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.metadata->'items','[]'::jsonb)) it
    WHERE NULLIF(it->>'erp_product_id','') IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.conteos_inventario c
    WHERE c.branch_id = v_branch AND c.status IN ('BORRADOR','EN_PROGRESO')
  ) THEN
    RAISE EXCEPTION 'Hay un conteo de inventario abierto en la sucursal y un producto de la solicitud no dice cuál es. Quítalo y vuelve a intentarlo.';
  END IF;

  SELECT array_agg(DISTINCT COALESCE(it->>'descripcion', it->>'erp_product_id')), count(DISTINCT it->>'erp_product_id')
    INTO v_choques, v_n
  FROM jsonb_array_elements(COALESCE(NEW.metadata->'items','[]'::jsonb)) it
  WHERE EXISTS (
    SELECT 1
    FROM public.conteos_inventario c
    JOIN public.conteo_inventario_items i ON i.conteo_id = c.id
    WHERE c.branch_id = v_branch
      AND c.status IN ('BORRADOR','EN_PROGRESO')
      AND i.erp_product_id = (it->>'erp_product_id')::int
  );

  IF v_n > 0 THEN
    -- El texto sale tal cual a la pantalla (`mensajeAmigable`): para una
    -- persona, sin jerga, y dice qué hacer (DESIGN.md §26).
    RAISE EXCEPTION '% en el conteo de inventario abierto: %. Mientras se cuenta no se puede cargar ni descargar: el número cambiaría debajo de quien está contando. Quítalo de la solicitud o espera a que cierre el conteo.',
      CASE WHEN v_n = 1 THEN 'Este producto está' ELSE 'Estos productos están' END,
      array_to_string(v_choques[1:3], ', ') || CASE WHEN v_n > 3 THEN format(' y %s más', v_n - 3) ELSE '' END;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.frenar_traslado_duplicado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_destino text := NEW.metadata->>'erp_sucursal_id';
    v_origen  text := NEW.metadata->>'origen_erp_sucursal_id';
    v_venc    text := coalesce(NEW.metadata->>'origen_vencidos','false');
    v_sala    text := coalesce(nullif(NEW.metadata->>'origen_branch_name',''), 'esa sucursal');
    v_repe    text;
    v_abierta text;
BEGIN
    -- Dos veces el mismo producto en la MISMA solicitud. Se avisa aparte de lo
    -- de abajo porque no es lo mismo que hay que hacer: acá se suman, allá se
    -- le sube la cantidad a la que ya está esperando.
    SELECT string_agg(DISTINCT coalesce(nombre, '#' || prod), ', ')
      INTO v_repe
      FROM (
          SELECT it.item->>'erp_product_id' AS prod,
                 nullif(it.item->>'descripcion','') AS nombre,
                 count(*) OVER (PARTITION BY it.item->>'erp_product_id') AS veces
          FROM jsonb_array_elements(coalesce(NEW.metadata->'items','[]'::jsonb)) AS it(item)
      ) n
     WHERE n.veces > 1;

    IF v_repe IS NOT NULL THEN
        RAISE EXCEPTION '% está más de una vez en la misma solicitud. Ponlo una sola vez con la cantidad total.', v_repe
            USING ERRCODE = '23505';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(
        'traslado:' || coalesce(v_destino,'') || ':' || coalesce(v_origen,'') || ':' || v_venc));

    SELECT string_agg(DISTINCT coalesce(nuevo.nombre, '#' || nuevo.prod), ', ')
      INTO v_abierta
      FROM (
          SELECT it.item->>'erp_product_id' AS prod,
                 nullif(it.item->>'descripcion','') AS nombre
          FROM jsonb_array_elements(coalesce(NEW.metadata->'items','[]'::jsonb)) AS it(item)
      ) nuevo
     WHERE EXISTS (
          SELECT 1
          FROM public.approval_requests a,
               jsonb_array_elements(coalesce(a.metadata->'items','[]'::jsonb)) AS ot(item)
          WHERE a.type   = 'INVENTORY_TRANSFER_REQUEST'
            AND a.status = 'PENDING'
            AND a.id <> NEW.id
            AND a.metadata->>'erp_sucursal_id'        IS NOT DISTINCT FROM v_destino
            AND a.metadata->>'origen_erp_sucursal_id' IS NOT DISTINCT FROM v_origen
            AND coalesce(a.metadata->>'origen_vencidos','false') = v_venc
            AND ot.item->>'erp_product_id' = nuevo.prod
     );

    IF v_abierta IS NOT NULL THEN
        RAISE EXCEPTION 'Ya hay una solicitud de % a % esperando respuesta. Si necesitas más, súbele la cantidad a esa solicitud o pídeselo a otra sucursal.', v_abierta, v_sala
            USING ERRCODE = '23505';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generar_propuestas_metas(p_year_month text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_creadas integer;
  v_b bigint;
BEGIN
  IF p_year_month IS NULL OR p_year_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_year_month;
  END IF;

  WITH
  ins AS (
    INSERT INTO public.metas_sucursal
      (branch_id, year_month, monto_base, monto_recuperacion, monto_meta,
       monto_propuesto, estado, nota)
    SELECT c.branch_id, p_year_month, c.propuesta, 0, c.propuesta, c.propuesta, 'propuesta',
           public.metas_nota_propuesta(c.ym_ultimo, c.pct_ultimo, c.ultimo_proyectado, c.factor)
    FROM public.metas_calculo_propuesta(p_year_month) c
    WHERE c.propuesta IS NOT NULL
    ON CONFLICT (branch_id, year_month) DO NOTHING
    RETURNING id, branch_id, year_month, monto_meta
  ),
  log AS (
    INSERT INTO public.metas_historial
      (meta_id, branch_id, year_month, evento, estado_despues, monto_despues, nota)
    SELECT i.id, i.branch_id, i.year_month, 'propuesta_generada', 'propuesta', i.monto_meta,
           'la calculó el portal con el ritmo de los últimos meses y el factor de cumplimiento'
    FROM ins i
    RETURNING 1
  )
  SELECT count(*) INTO v_creadas FROM log;

  FOR v_b IN SELECT DISTINCT c.branch_id FROM public.metas_gasto_cuota c
             WHERE c.year_month = p_year_month AND c.estado = 'pendiente' LOOP
    PERFORM public.metas_aplicar_recuperacion(v_b, p_year_month);
  END LOOP;

  IF v_creadas > 0 THEN
    PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_PROPUESTAS',
      'Metas propuestas para ' || public.metas_mes_label(p_year_month),
      v_creadas || ' sucursal(es) ya tienen su meta propuesta. Revísalas, ajústalas y confírmalas.');
  END IF;

  RETURN v_creadas;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_abonos_del_dia(p_branch integer, p_fecha date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_cortes boolean := (SELECT public.auth_has_module_permission('cortes_caja', 'can_view'));
    v_vales  boolean := (SELECT public.auth_has_module_permission('caja_vales', 'can_view'));
    v_todas  boolean;
    v_out    json;
BEGIN
    -- El bloqueo de una persona vive en una policy, y una función DEFINER se
    -- las salta todas. Sin esta línea, bloquear a alguien le cerraría el portal
    -- y le dejaría abierta esta puerta.
    IF NOT (SELECT public.auth_no_bloqueado()) THEN
        RAISE EXCEPTION 'FORBIDDEN: sin acceso';
    END IF;
    IF NOT (v_cortes OR v_vales) THEN
        RAISE EXCEPTION 'FORBIDDEN: no puedes ver los cobros de crédito';
    END IF;

    v_todas := (v_cortes AND (SELECT public.auth_module_scope('cortes_caja')) = 'ALL')
            OR (v_vales  AND (SELECT public.auth_module_scope('caja_vales'))  = 'ALL');
    IF NOT v_todas AND p_branch IS DISTINCT FROM (SELECT public.auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN: esa sucursal no es la tuya';
    END IF;

    SELECT coalesce(json_agg(to_json(t) ORDER BY t.momento), '[]'::json) INTO v_out
    FROM (
        SELECT a.id,
               a.created_at                                            AS momento,
               (a.created_at AT TIME ZONE 'America/El_Salvador')::time  AS hora,
               a.monto, a.forma, a.cliente, a.credito_erp, a.factura_erp,
               a.documento, a.erp_abono_id,
               a.anulado_at IS NOT NULL                                AS anulado,
               e.name                                                  AS quien
        FROM public.creditos_abonos_portal a
        LEFT JOIN public.employees e ON e.id = a.abonado_por
        WHERE a.branch_id = p_branch
          AND (a.created_at AT TIME ZONE 'America/El_Salvador')::date = p_fecha
    ) t;

    RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_bono_semestral(p_semestre text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
    v_meses     text[];
    v_ym_actual text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
    v_sem       public.bono_semestre%ROWTYPE;
    v_meses_json json;
    v_personas  json;
BEGIN
    IF public.auth_employee_id() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('metas', 'can_view')
       OR public.auth_module_scope('metas') <> 'ALL' THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: el pago semestral exige ver las metas de todas las sucursales'
            USING ERRCODE = '42501';
    END IF;
    IF coalesce(p_semestre, '') !~ '^[0-9]{4}-S[12]$' THEN
        RAISE EXCEPTION 'SEMESTRE_INVALIDO: se escribe AAAA-S1 o AAAA-S2';
    END IF;

    v_meses := public.meses_del_semestre(p_semestre);
    SELECT * INTO v_sem FROM public.bono_semestre WHERE semestre = p_semestre;

    SELECT json_agg(json_build_object(
               'ym', m.ym,
               'estado', CASE WHEN EXISTS (SELECT 1 FROM public.metas_bono_persona f
                                            WHERE f.year_month = m.ym) THEN 'cerrado'
                              WHEN m.ym <= v_ym_actual THEN 'provisional'
                              ELSE 'futuro' END,
               'informativo', NOT public.metas_bono_activo(m.ym))
           ORDER BY m.ym)
      INTO v_meses_json
      FROM unnest(v_meses) m(ym);

    IF v_sem.estado = 'aprobado' THEN
        SELECT json_agg(json_build_object(
                   'employee_id', d.employee_id, 'nombre', e.name, 'code', e.code,
                   'status', d.status_al_aprobar, 'activo', d.status_al_aprobar = 'ACTIVO',
                   'salas', (SELECT json_agg(DISTINCT b.name) FROM public.metas_bono_persona f
                               JOIN public.branches b ON b.id = f.branch_id
                              WHERE f.employee_id = d.employee_id AND f.year_month = ANY (v_meses)
                                AND f.bono > 0),
                   'por_mes', d.por_mes, 'total', d.total, 'total_pagable', d.total, 'provisional', false,
                   'pagar', d.pagar,
                   'decision', (SELECT json_build_object('pagar', x.pagar, 'motivo', x.motivo,
                                        'por', pe.name, 'at', x.decidido_at)
                                  FROM public.bono_semestre_decision x
                                  JOIN public.employees pe ON pe.id = x.decidido_por
                                 WHERE x.semestre_id = v_sem.id AND x.employee_id = d.employee_id))
               ORDER BY d.total DESC, e.name)
          INTO v_personas
          FROM public.bono_semestre_detalle d
          JOIN public.employees e ON e.id = d.employee_id
         WHERE d.semestre_id = v_sem.id;
    ELSE
        WITH
        con_foto AS (
            SELECT DISTINCT f.year_month FROM public.metas_bono_persona f
             WHERE f.year_month = ANY (v_meses)
        ),
        filas AS (
            SELECT f.year_month AS ym, f.branch_id, f.employee_id, f.bono, false AS provisional
              FROM public.metas_bono_persona f
             WHERE f.year_month = ANY (v_meses) AND f.bono > 0
            UNION ALL
            SELECT m.ym, ms.branch_id, (p ->> 'employee_id')::uuid,
                   round(coalesce((p ->> 'bono')::numeric, 0), 2), true
              FROM unnest(v_meses) m(ym)
              JOIN public.metas_sucursal ms ON ms.year_month = m.ym
             CROSS JOIN LATERAL json_array_elements(
                       public.bono_meta_sala_interno(ms.branch_id, m.ym) -> 'personas') p
             WHERE m.ym <= v_ym_actual
               AND m.ym NOT IN (SELECT c.year_month FROM con_foto c)
               AND (p ->> 'employee_id') IS NOT NULL
               AND round(coalesce((p ->> 'bono')::numeric, 0), 2) > 0
        ),
        por_mes AS (
            SELECT employee_id, ym, sum(bono) AS bono, bool_or(provisional) AS provisional
              FROM filas GROUP BY employee_id, ym
        ),
        persona AS (
            SELECT pm.employee_id,
                   sum(pm.bono) AS total,
                   coalesce(sum(pm.bono) FILTER (WHERE public.metas_bono_activo(pm.ym)), 0) AS total_pagable,
                   bool_or(pm.provisional) AS provisional,
                   json_object_agg(pm.ym, pm.bono ORDER BY pm.ym) AS por_mes
              FROM por_mes pm GROUP BY pm.employee_id
        )
        SELECT json_agg(json_build_object(
                   'employee_id', p.employee_id, 'nombre', e.name, 'code', e.code,
                   'status', e.status, 'activo', e.status = 'ACTIVO',
                   'salas', (SELECT json_agg(DISTINCT b.name) FROM filas f
                               JOIN public.branches b ON b.id = f.branch_id
                              WHERE f.employee_id = p.employee_id),
                   'por_mes', p.por_mes, 'total', round(p.total, 2),
                   'total_pagable', round(p.total_pagable, 2),
                   'provisional', p.provisional,
                   'pagar', CASE WHEN e.status = 'ACTIVO' THEN true ELSE d.pagar END,
                   'decision', CASE WHEN d.id IS NULL THEN NULL ELSE
                       json_build_object('pagar', d.pagar, 'motivo', d.motivo,
                                         'por', pe.name, 'at', d.decidido_at) END)
               ORDER BY p.total DESC, e.name)
          INTO v_personas
          FROM persona p
          JOIN public.employees e ON e.id = p.employee_id
          LEFT JOIN public.bono_semestre_decision d
                 ON d.semestre_id = v_sem.id AND d.employee_id = p.employee_id
          LEFT JOIN public.employees pe ON pe.id = d.decidido_por;
    END IF;

    RETURN json_build_object(
        'semestre',     p_semestre,
        'meses',        v_meses_json,
        'estado',       coalesce(v_sem.estado, 'borrador'),
        'aprobado_por', (SELECT e.name FROM public.employees e WHERE e.id = v_sem.aprobado_por),
        'aprobado_at',  v_sem.aprobado_at,
        'nota',         v_sem.nota,
        'personas',     coalesce(v_personas, '[]'::json)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_bonos_producto_sala(p_branch_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_items json;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('caja_vales', 'can_view') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: hace falta ver la caja' USING ERRCODE = '42501';
    END IF;
    IF public.auth_module_scope('caja_vales') <> 'ALL'
       AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: sólo tu sucursal' USING ERRCODE = '42501';
    END IF;

    SELECT json_agg(json_build_object(
               'item', i.item, 'tipo', i.tipo, 'promocion', i.promocion,
               'employee_id', i.employee_id, 'nombre', e.name,
               'first_names', e.first_names, 'last_names', e.last_names,
               'monto', i.monto, 'unidades', i.unidades,
               'estado', coalesce(pg.estado, 'pendiente'),
               -- H19: el bono de quien ya no trabaja sigue acá, dicho.
               'activo', coalesce(e.status = 'ACTIVO', true),
               -- H20: la caja no contestó y ya pasó el rato: hay que resolverlo.
               'sin_confirmar', pg.estado = 'enviado'
                    AND EXISTS (SELECT 1 FROM public.caja_movimientos_portal m
                                 WHERE m.id = pg.movimiento_id AND m.anulado_at IS NULL
                                   AND m.created_at <= now() - interval '3 minutes'))
           ORDER BY i.promocion, i.tipo DESC, e.name)
      INTO v_items
      FROM public.bonos_producto_items() i
      LEFT JOIN public.employees e ON e.id = i.employee_id
      LEFT JOIN public.promocion_pago pg ON pg.item = i.item
     WHERE i.branch_id = p_branch_id
       AND coalesce(pg.estado, 'pendiente') NOT IN ('pagado', 'fuera_del_portal');

    RETURN json_build_object(
        'branch_id',   p_branch_id,
        'puedo_pagar', public.es_jefe_de_sala(v_actor, p_branch_id),
        'items',       coalesce(v_items, '[]'::json));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_ccf_con_problema(p_desde date, p_hasta date)
 RETURNS TABLE(invoice_id bigint, branch_id bigint, branch_name text, fecha date, correlativo text, estado text, total numeric, problemas text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH obs AS (
        SELECT o.id, o.observaciones
        FROM public.get_invoice_observations(p_desde, p_hasta, NULL) o
        WHERE o.tipo_documento = 'CCF'
    ),
    base AS (
        SELECT si.id, si.branch_id, b.name AS branch_name, si.fecha, si.correlativo,
               si.estado, si.total, o.observaciones,
               EXISTS (SELECT 1 FROM public.sales_invoice_resolutions r WHERE r.invoice_id = si.id)      AS cerrado_mh,
               EXISTS (SELECT 1 FROM public.sales_observation_resolutions r WHERE r.invoice_id = si.id)  AS cerrado_obs
        FROM public.sales_invoices si
        JOIN public.branches b ON b.id = si.branch_id
        LEFT JOIN obs o ON o.id = si.id
        WHERE si.tipo_documento = 'CCF'
          AND si.fecha BETWEEN p_desde AND p_hasta
    ),
    marcado AS (
        SELECT b.*,
               array_remove(ARRAY[
                   CASE WHEN NOT b.cerrado_mh AND b.estado <> 'NULA'
                         AND (b.recibido_mh IS NULL OR length(b.recibido_mh) <> 40)
                        THEN 'sin sello del MH' END,
                   CASE WHEN NOT b.cerrado_mh AND b.estado = 'NULA'
                        THEN 'anulado sin completar ante el MH' END,
                   CASE WHEN NOT b.cerrado_obs AND b.observaciones IS NOT NULL
                         AND array_length(b.observaciones, 1) > 0
                        THEN 'con observacion: ' || array_to_string(b.observaciones, ', ') END
               ], NULL) AS problemas
        FROM (SELECT b.*, si.recibido_mh FROM base b
              JOIN public.sales_invoices si ON si.id = b.id) b
    )
    SELECT m.id, m.branch_id::bigint, m.branch_name, m.fecha, m.correlativo,
           m.estado, m.total, m.problemas
    FROM marcado m
    WHERE array_length(m.problemas, 1) > 0
    ORDER BY m.fecha, m.branch_name, m.correlativo;
$function$;

CREATE OR REPLACE FUNCTION public.get_cortes_z(p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(branch_id bigint, sucursal text, direccion text, departamento text, periodo date, fecha_inicio date, fecha_fin date, tiquete_total numeric, factura_total numeric, ccf_total numeric, total_general numeric, z_factura numeric, z_ccf numeric, z_total numeric, portal_factura numeric, portal_ccf numeric, portal_total numeric, dif_factura numeric, dif_ccf numeric, dif_total numeric, retencion numeric, portal_retencion numeric, dif_retencion numeric, residuo numeric, portal_documentos bigint, hallazgos jsonb, declaracion jsonb, comprobaciones jsonb, detalle jsonb, ticket text, obtenido_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH vista AS (
        -- true = ve el cotejo completo: el detalle de lo que no se envía.
        -- El libro NO depende de esto: para todos lleva sólo lo enviado.
        SELECT coalesce((SELECT auth_has_module_permission('corte_z_ver_envio_mh', 'can_view')), false) AS completo
    ),
    ventas AS (
        SELECT si.*,
               -- coalesce: `venta_fiscal` da NULL con el sello en NULL, y un
               -- NULL acá haría que `NOT en_libro` dejara afuera del conteo de
               -- «sin sello» justo a las ventas sin sello.
               coalesce(public.venta_fiscal(si.estado, si.recibido_mh), false) AS en_libro
        FROM public.sales_invoices si
        WHERE si.fecha >= date_trunc('month', p_desde)::date
          AND si.fecha <= (date_trunc('month', p_hasta) + interval '1 month - 1 day')::date
    ),
    portal AS (
        SELECT si.branch_id,
               date_trunc('month', si.fecha)::date AS periodo,
               coalesce(sum(si.total) FILTER (WHERE si.tipo_documento = 'COF'), 0) AS factura,
               coalesce(sum(si.total) FILTER (WHERE si.tipo_documento = 'CCF'), 0) AS ccf,
               coalesce(sum(si.total), 0) AS total,
               coalesce(sum(si.retencion), 0) AS retencion,
               count(*) AS documentos,
               -- El `total` de cada sección es `subtotal + iva`: el VALOR DE LA
               -- OPERACIÓN, que es lo que va al libro. `total` a secas es lo
               -- cobrado —ya neto de la retención del Art. 162— y la retención
               -- no reduce la venta: va aparte, como crédito.
               jsonb_build_object(
                   'factura', jsonb_build_object(
                       'exentas',  round(coalesce(sum(CASE WHEN coalesce(si.iva,0) = 0 THEN coalesce(si.subtotal,0) + coalesce(si.iva,0) ELSE 0 END) FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'gravadas', round(coalesce(sum(CASE WHEN coalesce(si.iva,0) > 0 THEN coalesce(si.subtotal,0) ELSE 0 END) FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'debito',   round(coalesce(sum(si.iva)       FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'retenido', round(coalesce(sum(si.retencion) FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'total',    round(coalesce(sum(si.subtotal + si.iva) FILTER (WHERE si.tipo_documento = 'COF'), 0), 2),
                       'documentos', count(*) FILTER (WHERE si.tipo_documento = 'COF')),
                   'ccf', jsonb_build_object(
                       'exentas',  round(coalesce(sum(CASE WHEN coalesce(si.iva,0) = 0 THEN coalesce(si.subtotal,0) + coalesce(si.iva,0) ELSE 0 END) FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'gravadas', round(coalesce(sum(CASE WHEN coalesce(si.iva,0) > 0 THEN coalesce(si.subtotal,0) ELSE 0 END) FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'debito',   round(coalesce(sum(si.iva)       FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'retenido', round(coalesce(sum(si.retencion) FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'total',    round(coalesce(sum(si.subtotal + si.iva) FILTER (WHERE si.tipo_documento = 'CCF'), 0), 2),
                       'documentos', count(*) FILTER (WHERE si.tipo_documento = 'CCF'))
               ) AS declaracion
        FROM ventas si
        WHERE si.en_libro
        GROUP BY 1, 2
    ),
    control AS (
        SELECT si.branch_id,
               date_trunc('month', si.fecha)::date AS periodo,
               count(*) FILTER (WHERE public.venta_valida(si.estado) AND NOT si.en_libro
                                  AND coalesce(length(si.recibido_mh), 0) <> 40) AS sin_sello_docs,
               coalesce(sum(si.total) FILTER (WHERE public.venta_valida(si.estado) AND NOT si.en_libro
                                  AND coalesce(length(si.recibido_mh), 0) <> 40), 0) AS sin_sello_monto,
               -- De las sin sello, las que no se envían por la regla de la
               -- noche (consumidor final desde las 6 p. m.).
               count(*) FILTER (WHERE public.venta_valida(si.estado) AND NOT si.en_libro
                                  AND coalesce(length(si.recibido_mh), 0) <> 40
                                  AND public.cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora, si.customer_id)) AS noche_docs,
               coalesce(sum(si.total) FILTER (WHERE public.venta_valida(si.estado) AND NOT si.en_libro
                                  AND coalesce(length(si.recibido_mh), 0) <> 40
                                  AND public.cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora, si.customer_id)), 0) AS noche_monto,
               count(*) FILTER (WHERE si.estado = 'DTE INVALIDADO EN MH') AS anulados_docs,
               coalesce(sum(si.total) FILTER (WHERE si.estado = 'DTE INVALIDADO EN MH'), 0) AS anulados_monto,
               count(*) FILTER (WHERE si.en_libro
                                  AND abs(coalesce(si.iva, 0) - round(coalesce(si.subtotal, 0) * 0.13, 2)) > 0.01) AS iva_raro_docs
        FROM ventas si
        GROUP BY 1, 2
    ), base0 AS (
        SELECT z.*, b.name AS sucursal,
               nullif(btrim(b.address), '') AS direccion,
               nullif(btrim(b.settings->'location'->>'department'), '') AS departamento,
               coalesce(p.factura, 0) AS p_factura,
               coalesce(p.ccf, 0)     AS p_ccf,
               coalesce(p.total, 0)   AS p_total,
               coalesce(p.retencion, 0) AS p_retencion,
               coalesce(p.documentos, 0) AS p_docs,
               coalesce(p.declaracion, '{}'::jsonb) AS p_declaracion,
               coalesce(k.sin_sello_docs, 0)  AS sin_sello_docs,
               coalesce(k.sin_sello_monto, 0) AS sin_sello_monto,
               coalesce(k.noche_docs, 0)      AS noche_docs,
               coalesce(k.noche_monto, 0)     AS noche_monto,
               coalesce(k.anulados_docs, 0)   AS anulados_docs,
               coalesce(k.anulados_monto, 0)  AS anulados_monto,
               coalesce(k.iva_raro_docs, 0)   AS iva_raro_docs,
               coalesce(nullif(z.detalle->'secciones'->'factura'->>'retencion','')::numeric, 0) AS r_factura,
               coalesce(nullif(z.detalle->'secciones'->'ccf'->>'retencion','')::numeric, 0)     AS r_ccf,
               coalesce(nullif(z.detalle->'secciones'->'tiquete'->>'gravadas','')::numeric, 0) AS g_tiquete,
               coalesce(nullif(z.detalle->'secciones'->'factura'->>'gravadas','')::numeric, 0) AS g_factura,
               coalesce(nullif(z.detalle->'secciones'->'ccf'->>'gravadas','')::numeric, 0)     AS g_ccf,
               hh.j AS hallazgos
        FROM public.corte_z z
        JOIN public.branches b ON b.id = z.branch_id
        LEFT JOIN portal  p ON p.branch_id = z.branch_id AND p.periodo = z.periodo
        LEFT JOIN control k ON k.branch_id = z.branch_id AND k.periodo = z.periodo
        LEFT JOIN LATERAL (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'fecha',        h.fecha,
                       'diferencia',   h.diferencia,
                       'sin_explicar', h.sin_explicar,
                       'documentos',   h.documentos
                   ) ORDER BY h.fecha), '[]'::jsonb) AS j
            FROM public.ventas_cuadre_hallazgos h
            WHERE h.branch_id = z.branch_id
              AND h.resuelto_at IS NULL
              AND h.fecha >= z.periodo
              AND h.fecha < (z.periodo + interval '1 month')
        ) hh ON true
        WHERE (SELECT auth_has_module_permission('corte_z', 'can_view'))
          AND ((SELECT auth_module_scope('corte_z')) = 'ALL'
               OR z.branch_id = (SELECT auth_employee_branch_id()))
          AND z.periodo >= date_trunc('month', p_desde)::date
          AND z.periodo <= date_trunc('month', p_hasta)::date
          AND (p_branch_id IS NULL OR z.branch_id = p_branch_id)
    ), base AS (
        -- Sin «Ver el cotejo completo», el Corte Z se muestra SEGÚN LO ENVIADO:
        -- a la sección «con factura» se le resta el consumidor final de la
        -- noche, que no se envía. Así cuadra con el libro, y la diferencia que
        -- quede es una diferencia de verdad. Con el permiso, el Z tal cual.
        SELECT b0.*,
               CASE WHEN (SELECT completo FROM vista) THEN 0 ELSE b0.noche_monto END AS ajuste
        FROM base0 b0
    ), base_aj AS (
        SELECT base.*,
               base.g_factura - base.ajuste AS g_factura_aj
        FROM base
    ), chk0 AS (
        SELECT base_aj.*,
               (g_tiquete + g_factura_aj + g_ccf) AS z_suma,
               round(p_total - (g_tiquete + g_factura_aj + g_ccf), 2) AS c_cotejo,
               round(p_retencion - (r_factura + r_ccf), 2)         AS c_retencion,
               -- gravadas + débito = total. La retención NO entra: no reduce la
               -- venta y el libro no tiene columna para ella.
               round(coalesce((p_declaracion->'factura'->>'gravadas')::numeric, 0)
                   + coalesce((p_declaracion->'factura'->>'debito')::numeric, 0)
                   + coalesce((p_declaracion->'factura'->>'exentas')::numeric, 0)
                   - coalesce((p_declaracion->'factura'->>'total')::numeric, 0), 2) AS c_coh_cof,
               round(coalesce((p_declaracion->'ccf'->>'gravadas')::numeric, 0)
                   + coalesce((p_declaracion->'ccf'->>'debito')::numeric, 0)
                   + coalesce((p_declaracion->'ccf'->>'exentas')::numeric, 0)
                   - coalesce((p_declaracion->'ccf'->>'total')::numeric, 0), 2)     AS c_coh_ccf,
               round((total_general - ajuste) - (g_tiquete + g_factura_aj + g_ccf)
                   + (r_factura + r_ccf), 2) AS c_ticket
        FROM base_aj
    ), chk AS (
        SELECT chk0.*,
               -- Sin el permiso, lo de la noche no es una venta «fuera del libro».
               sin_sello_docs  - CASE WHEN ajuste > 0 THEN noche_docs ELSE 0 END AS sin_sello_docs_v,
               sin_sello_monto - ajuste AS sin_sello_monto_v,
               CASE WHEN ajuste > 0 THEN 0 ELSE noche_docs END AS noche_docs_v
        FROM chk0
    )
    SELECT branch_id, sucursal, direccion, departamento,
           periodo, fecha_inicio, fecha_fin,
           tiquete_total, factura_total - ajuste, ccf_total, total_general - ajuste,
           round(g_factura_aj, 2), round(g_ccf, 2), round(z_suma, 2),
           p_factura, p_ccf, p_total,
           round(p_factura - g_factura_aj, 2),
           round(p_ccf     - g_ccf, 2),
           round(c_cotejo, 2),
           round(r_factura + r_ccf, 2),
           round(p_retencion, 2),
           round(c_retencion, 2),
           round(c_cotejo, 2),
           p_docs,
           hallazgos,
           p_declaracion,
           jsonb_build_array(
               jsonb_build_object(
                   'clave', 'cotejo',
                   'rotulo', 'El libro coincide con el Corte Z',
                   'estado', CASE WHEN abs(c_cotejo) < 0.005 THEN 'ok' ELSE 'alerta' END,
                   'detalle', CASE WHEN abs(c_cotejo) < 0.005
                       THEN 'Las ventas con factura y con crédito fiscal cuadran al centavo contra las ventas gravadas del Corte Z.'
                       ELSE 'Diferencia de $' || to_char(abs(c_cotejo), 'FM999999990.00') || ' contra el Corte Z.' END),
               jsonb_build_object(
                   'clave', 'retencion',
                   'rotulo', 'La retención coincide con la del Corte Z',
                   'estado', CASE WHEN abs(c_retencion) < 0.005 THEN 'ok' ELSE 'alerta' END,
                   'detalle', CASE
                       WHEN abs(c_retencion) >= 0.005
                           THEN 'El Corte Z declara $' || to_char(r_factura + r_ccf, 'FM999999990.00')
                                || ' y el libro suma $' || to_char(p_retencion, 'FM999999990.00') || ' documento por documento.'
                       WHEN p_retencion < 0.005
                           THEN 'Ningún cliente retuvo en el período.'
                       ELSE 'Los $' || to_char(p_retencion, 'FM999999990.00')
                            || ' que sumó el libro documento por documento son los que declara el Corte Z. No reducen la venta: van aparte, como anticipo ya pagado.' END),
               jsonb_build_object(
                   'clave', 'coherencia',
                   'rotulo', 'Las cifras de la declaración se sostienen entre sí',
                   'estado', CASE WHEN abs(c_coh_cof) < 0.005 AND abs(c_coh_ccf) < 0.005 THEN 'ok' ELSE 'alerta' END,
                   'detalle', CASE WHEN abs(c_coh_cof) < 0.005 AND abs(c_coh_ccf) < 0.005
                       THEN 'Ventas exentas + gravadas + débito fiscal = total, en las dos secciones.'
                       ELSE 'La suma no cierra: consumidor $' || to_char(c_coh_cof, 'FM999999990.00')
                            || ', contribuyente $' || to_char(c_coh_ccf, 'FM999999990.00') || '.' END),
               jsonb_build_object(
                   'clave', 'iva',
                   'rotulo', 'El débito fiscal es el 13% de la base',
                   'estado', CASE WHEN iva_raro_docs = 0 THEN 'ok' ELSE 'alerta' END,
                   'detalle', CASE WHEN iva_raro_docs = 0
                       THEN 'Verificado documento por documento en los ' || p_docs || ' del libro.'
                       ELSE iva_raro_docs || ' documento(s) con un débito que no es el 13% de su base.' END),
               jsonb_build_object(
                   'clave', 'sello',
                   'rotulo', 'Ninguna venta quedó fuera del libro sin querer',
                   'estado', CASE WHEN sin_sello_docs_v = 0 THEN 'ok' ELSE 'alerta' END,
                   'detalle', CASE WHEN sin_sello_docs_v > 0
                       THEN sin_sello_docs_v || ' venta(s) por $' || to_char(sin_sello_monto_v, 'FM999999990.00')
                            || ' figuran vendidas pero sin el sello del MH. El libro no las lleva.'
                            || CASE WHEN noche_docs_v > 0
                                    THEN ' De ellas, ' || noche_docs_v || ' por $' || to_char(noche_monto, 'FM999999990.00')
                                         || ' son de consumidor final desde las 6:00 p. m., que no se envían.'
                                    ELSE '' END
                       WHEN anulados_docs > 0
                           THEN 'Las únicas ' || anulados_docs || ' excluidas son anulaciones, por $'
                                || to_char(anulados_monto, 'FM999999990.00') || '.'
                       ELSE 'Todas las ventas del período tienen sello del MH.' END),
               jsonb_build_object(
                   'clave', 'ticket',
                   'rotulo', 'El total del Corte Z se explica por su retención',
                   'estado', CASE WHEN abs(c_ticket) < 0.005 THEN 'ok' ELSE 'alerta' END,
                   'detalle', CASE
                       WHEN abs(c_ticket) >= 0.005
                           THEN 'Su total se aparta de sus ventas gravadas en $'
                                || to_char(abs((total_general - ajuste) - z_suma), 'FM999999990.00')
                                || ', y la retención que declara sólo explica $'
                                || to_char(r_factura + r_ccf, 'FM999999990.00') || '. Hay que revisarlo.'
                       WHEN (r_factura + r_ccf) < 0.005
                           THEN 'Su total es igual a sus ventas gravadas, como corresponde cuando nadie retuvo.'
                       ELSE 'Su total resta $' || to_char(r_factura + r_ccf, 'FM999999990.00')
                            || ' que sus ventas gravadas ya tenían descontados — el desfase conocido del documento, ni un centavo más.' END)
           ),
           -- Las secciones del ticket, con el mismo ajuste en «con factura». Y
           -- el texto original sólo con el permiso: trae las cifras sin ajustar.
           CASE WHEN ajuste = 0 THEN detalle
                ELSE jsonb_set(jsonb_set(detalle,
                       '{secciones,factura,gravadas}',
                       to_jsonb(round(coalesce(nullif(detalle->'secciones'->'factura'->>'gravadas','')::numeric, 0) - ajuste, 2)), false),
                       '{secciones,factura,total}',
                       to_jsonb(round(coalesce(nullif(detalle->'secciones'->'factura'->>'total','')::numeric, 0) - ajuste, 2)), false) END,
           CASE WHEN (SELECT completo FROM vista) THEN ticket END,
           obtenido_at
    FROM chk
    ORDER BY periodo DESC, sucursal;
$function$;

CREATE OR REPLACE FUNCTION public.get_facturas_sala_panel(p_dias integer DEFAULT 90)
 RETURNS TABLE(claim_id bigint, document_id bigint, fecha_emision date, etiqueta text, emisor_nombre text, monto_total numeric, items_text text, sala text, tomada_por text, tomada_at timestamp with time zone, origen text, registrada boolean, dias_sin_cargar integer, liberada_at timestamp with time zone, liberada_motivo text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (public.auth_has_module_permission('facturas_sala', 'can_view')
          OR public.auth_has_module_permission('compras', 'can_view')
          OR public.auth_has_module_permission('facturas_compra', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver este panel.';
  END IF;

  RETURN QUERY
  SELECT c.id, c.document_id, d.fecha_emision,
         COALESCE(public.etiquetas_factura_sala(d.emisor_nit, d.items_norm), r.etiqueta),
         d.emisor_nombre,
         d.monto_total, d.items_text, b.name, c.claimed_by_name, c.claimed_at,
         c.origen, (c.receipt_id IS NOT NULL),
         CASE WHEN c.receipt_id IS NULL AND c.released_at IS NULL
              THEN (current_date - c.claimed_at::date) END,
         c.released_at, c.released_motivo
    FROM public.purchase_dte_claims c
    JOIN public.purchase_dte_documents d ON d.id = c.document_id
    LEFT JOIN public.purchase_claim_rules r ON r.id = c.rule_id
    LEFT JOIN public.branches b ON b.id = c.branch_id
   WHERE c.claimed_at >= now() - make_interval(days => p_dias)
   ORDER BY c.claimed_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_libro_lotes_por_revisar(p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_out json;
BEGIN
    IF NOT ((SELECT public.auth_has_module_permission('bitacoras_corregir_lote', 'can_view'))
            OR (SELECT public.auth_has_module_permission('bitacoras_confirmar_lote', 'can_view'))) THEN
        RAISE EXCEPTION 'Tu cargo no revisa lotes del libro.' USING ERRCODE = '42501';
    END IF;
    IF p_branch_id IS NULL THEN
        IF public.auth_module_scope('bitacoras') <> 'ALL' THEN
            RAISE EXCEPTION 'Elige tu sucursal.' USING ERRCODE = '42501';
        END IF;
    ELSE
        PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');
    END IF;

    SELECT coalesce(json_agg(x ORDER BY x.orden, x.fecha DESC, x.id), '[]'::json) INTO v_out
    FROM (
        SELECT r.id, r.dispensacion_id, r.branch_id, b.name AS sala, r.motivo, r.estado,
               r.lote_original, r.vence_original, r.partes, r.vendido_vencido, r.nota,
               r.devuelta_motivo, r.corregida_at, r.confirmada_at, r.created_at,
               r.corregida_por, ec.name AS corregida_por_nombre,
               r.confirmada_por, ef.name AS confirmada_por_nombre,
               d.folio_txt, d.fecha, d.hora, d.producto_nombre, d.laboratorio, d.cantidad,
               d.correlativo_doc, d.vendedor_nombre AS vendedor,
               CASE r.estado WHEN 'devuelta' THEN 0 WHEN 'pendiente' THEN 1
                             WHEN 'corregida' THEN 2 ELSE 3 END AS orden
          FROM public.libro_lote_revisiones r
          JOIN public.bitacora_dispensaciones d ON d.id = r.dispensacion_id
          JOIN public.branches b ON b.id = r.branch_id
          LEFT JOIN public.employees ec ON ec.id = r.corregida_por
          LEFT JOIN public.employees ef ON ef.id = r.confirmada_por
         WHERE (p_branch_id IS NULL OR r.branch_id = p_branch_id)
           AND (r.estado <> 'confirmada' OR r.confirmada_at > now() - interval '60 days')
    ) x;
    RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_metas_mes_en_curso(p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_metas   boolean := auth_has_module_permission('metas', 'can_view');
  v_widget  boolean := auth_has_module_permission('dash_meta_sala', 'can_view');
  v_todas   boolean := false;
  v_branch  bigint;
  v_hoy     date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ini     date := date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date)::date;
  v_ym      text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
  v_fin     date;
  v_cfg     record;
  v_meta numeric; v_base numeric; v_recup numeric; v_estado text;
  v_acum numeric; v_proy numeric; v_dias int; v_dia_hoy int;
  v_dias_json json; v_vend json;
  v_prom_venta numeric; v_prom_ticket numeric; v_prom_dia numeric;
  v_prom_hora numeric; v_con_horario int; v_personas int; v_revisar int;
  v_np_total numeric; v_np_facturas int; v_np_detalle json;
BEGIN
  IF NOT (v_metas OR v_widget) THEN RETURN NULL; END IF;

  -- Quien tiene alcance de todas las salas puede pedir «todas» (NULL) o una.
  -- Quien no, ve la suya y el parámetro se ignora.
  IF (v_metas AND auth_module_scope('metas') = 'ALL')
     OR (v_widget AND auth_module_scope('dash_meta_sala') = 'ALL') THEN
    v_branch := p_branch_id;
    v_todas  := p_branch_id IS NULL;
  ELSE
    v_branch := auth_employee_branch_id();
  END IF;

  IF NOT v_todas AND v_branch IS NULL THEN RETURN NULL; END IF;
  IF NOT v_todas AND NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map m
                                 WHERE m.branch_id = v_branch AND NOT m.es_bodega) THEN
    RETURN NULL;
  END IF;

  v_fin := (v_ini + interval '1 month - 1 day')::date;
  SELECT * INTO v_cfg FROM public.metas_config LIMIT 1;

  -- La meta y la proyección salen del mismo sitio que el tablero: si acá se
  -- recalcularan, un día dirían otra cosa que las tarjetas de al lado.
  SELECT sum(d.monto_meta), sum(d.venta_acumulada), sum(d.proyeccion),
         max(d.dias_mes), max(d.dias_transcurridos)
    INTO v_meta, v_acum, v_proy, v_dias, v_dia_hoy
  FROM public.get_metas_dashboard(v_ym) d
  WHERE v_todas OR d.branch_id = v_branch;

  SELECT sum(m.monto_base), sum(m.monto_recuperacion),
         CASE WHEN count(*) FILTER (WHERE m.estado <> 'oficial') > 0 THEN 'pendiente' ELSE 'oficial' END
    INTO v_base, v_recup, v_estado
  FROM public.metas_sucursal m
  WHERE m.year_month = v_ym AND (v_todas OR m.branch_id = v_branch)
    AND m.branch_id IN (SELECT s.branch_id FROM public.erp_sucursal_map s WHERE NOT s.es_bodega);

  -- ── Lo que no es venta de productos, este mes ───────────────────────────
  -- Se calcula UNA vez y se usa tres veces: para restar de cada día, para el
  -- total del aviso y para el detalle que se muestra al abrirlo.
  SELECT coalesce(sum(v.total::numeric), 0), count(*)::int,
         json_agg(json_build_object(
           'fecha', v.fecha, 'hora', to_char(v.hora, 'HH24:MI'),
           'cliente', v.cliente, 'correlativo', v.correlativo,
           'total', v.total, 'motivo', v.motivo) ORDER BY v.fecha DESC, v.hora DESC)
    INTO v_np_total, v_np_facturas, v_np_detalle
  FROM public.ventas_sin_producto v
  WHERE v.fecha BETWEEN v_ini AND v_fin
    AND (v_todas OR v.branch_id = v_branch)
    AND v.branch_id IN (SELECT s.branch_id FROM public.erp_sucursal_map s WHERE NOT s.es_bodega);

  -- ── Día por día ─────────────────────────────────────────────────────────
  SELECT json_agg(to_json(t) ORDER BY t.dia) INTO v_dias_json
  FROM (
    SELECT EXTRACT(day FROM b.fecha)::int AS dia,
           round(b.bruto - coalesce(n.monto, 0), 2) AS venta,
           (b.fecha = v_hoy) AS es_hoy,
           round(coalesce(n.monto, 0), 2) AS no_producto
    FROM (
      SELECT si.fecha, sum(si.total::numeric) AS bruto
      FROM public.sales_invoices si
      WHERE si.fecha BETWEEN v_ini AND v_fin
        AND public.venta_valida(si.estado)
        AND (v_todas OR si.branch_id = v_branch)
        AND si.branch_id IN (SELECT s.branch_id FROM public.erp_sucursal_map s WHERE NOT s.es_bodega)
      GROUP BY si.fecha
    ) b
    LEFT JOIN (
      SELECT v.fecha, sum(v.total::numeric) AS monto
      FROM public.ventas_sin_producto v
      WHERE v.fecha BETWEEN v_ini AND v_fin
        AND (v_todas OR v.branch_id = v_branch)
        AND v.branch_id IN (SELECT s.branch_id FROM public.erp_sucursal_map s WHERE NOT s.es_bodega)
      GROUP BY v.fecha
    ) n ON n.fecha = b.fecha
  ) t;

  -- ── Quién vende ─────────────────────────────────────────────────────────
  -- `dias` sigue siendo «días con venta»: es el único dato de presencia que hay
  -- (attendance en 0, timesheets sin horas). Lo que se suma ahora son las
  -- HORAS PROGRAMADAS de esos mismos días, que sí existen desde que el horario
  -- se publica.
  SELECT json_agg(to_json(v) ORDER BY v.venta DESC) INTO v_vend
  FROM (
    WITH ventas AS (
      SELECT e.id AS employee_id, e.name AS nombre, e.branch_id AS sala_propia,
             si.branch_id, si.fecha,
             sum(si.total::numeric) AS venta_dia_monto,
             count(*)::int          AS tickets_dia
      FROM public.sales_invoices si
      JOIN public.employees e ON e.code = si.cod_vendedor AND e.status = 'ACTIVO'
      WHERE si.fecha BETWEEN v_ini AND v_fin
        AND public.venta_valida(si.estado)
        AND (v_todas OR si.branch_id = v_branch)
        AND si.branch_id IN (SELECT s.branch_id FROM public.erp_sucursal_map s WHERE NOT s.es_bodega)
      GROUP BY e.id, e.name, e.branch_id, si.branch_id, si.fecha
    ),
    -- Las horas que el horario publicado le asigna a cada día que vendió.
    -- `NULL` = ese día no está cubierto por un horario publicado, o es día
    -- libre: no suma ni al numerador ni al denominador. `hay_horario`
    -- distingue las dos cosas, que es lo que separa «no sé» de «no tenía turno».
    con_horas AS (
      SELECT vt.*,
             (r.id IS NOT NULL) AS hay_horario,
             CASE
               WHEN r.id IS NOT NULL
                AND coalesce((r.schedule_data -> k.dia ->> 'isOff')::boolean, true) = false
                AND h.ini IS NOT NULL AND h.fin IS NOT NULL
               THEN GREATEST(0,
                      EXTRACT(epoch FROM (h.fin::time - h.ini::time)) / 3600.0
                      + CASE WHEN h.fin::time < h.ini::time THEN 24 ELSE 0 END
                      - CASE WHEN coalesce((r.schedule_data -> k.dia ->> 'hasLunch')::boolean, false)
                             THEN 1 ELSE 0 END)
             END AS horas_dia
      FROM ventas vt
      CROSS JOIN LATERAL (SELECT EXTRACT(dow FROM vt.fecha)::int::text AS dia) k
      LEFT JOIN public.employee_rosters r
             ON r.employee_id     = vt.employee_id
            AND r.week_start_date = date_trunc('week', vt.fecha)::date
            AND r.status          = 'PUBLISHED'
      LEFT JOIN public.shifts sh
             ON sh.id::text = nullif(r.schedule_data -> k.dia ->> 'shiftId', '')
      CROSS JOIN LATERAL (
        SELECT coalesce(nullif(r.schedule_data -> k.dia ->> 'customStart', ''), sh.start_time::text) AS ini,
               coalesce(nullif(r.schedule_data -> k.dia ->> 'customEnd',   ''), sh.end_time::text)   AS fin
      ) h
    )
    SELECT ch.employee_id, ch.nombre,
           (SELECT b.name FROM public.branches b WHERE b.id = ch.branch_id) AS sala,
           round(sum(ch.venta_dia_monto), 2)                       AS venta,
           sum(ch.tickets_dia)::int                                AS tickets,
           round(sum(ch.venta_dia_monto) / sum(ch.tickets_dia), 2) AS ticket,
           count(*)::int                                           AS dias,
           round(sum(ch.venta_dia_monto) / count(*), 2)            AS venta_dia,
           round(coalesce(sum(ch.horas_dia) FILTER (WHERE ch.horas_dia > 0), 0), 2) AS horas,
           count(*) FILTER (WHERE ch.horas_dia > 0)::int                            AS dias_horario,
           round(sum(ch.venta_dia_monto) FILTER (WHERE ch.horas_dia > 0)
                 / nullif(sum(ch.horas_dia) FILTER (WHERE ch.horas_dia > 0), 0), 2) AS venta_hora,
           -- Días con venta que el horario publicado marca libre, y si la sala
           -- de la venta no es la del empleado. Dos hechos, sin veredicto.
           count(*) FILTER (WHERE ch.hay_horario AND ch.horas_dia IS NULL)::int     AS dias_sin_turno,
           (min(ch.sala_propia) IS DISTINCT FROM ch.branch_id)                      AS sala_ajena
    FROM con_horas ch
    GROUP BY ch.employee_id, ch.nombre, ch.branch_id
  ) v;

  SELECT round(avg((x->>'venta')::numeric), 2),
         round(avg((x->>'ticket')::numeric), 2),
         round(avg((x->>'venta_dia')::numeric), 2),
         round(avg((x->>'venta_hora')::numeric), 2),
         count(*) FILTER (WHERE (x->>'venta_hora') IS NOT NULL)::int,
         count(*)::int,
         count(*) FILTER (WHERE (x->>'dias_sin_turno')::int > 0
                             OR (x->>'sala_ajena')::boolean)::int
    INTO v_prom_venta, v_prom_ticket, v_prom_dia, v_prom_hora,
         v_con_horario, v_personas, v_revisar
  FROM json_array_elements(coalesce(v_vend, '[]'::json)) x;

  RETURN json_build_object(
    'todas',        v_todas,
    'branch_id',    v_branch,
    'sala',         CASE WHEN v_todas THEN 'Todas las sucursales'
                         ELSE (SELECT b.name FROM public.branches b WHERE b.id = v_branch) END,
    'year_month',   v_ym,
    'meta',         v_meta,
    'monto_base',   v_base,
    'monto_recuperacion', v_recup,
    'estado_meta',  v_estado,
    'acumulado',    v_acum,
    'proyeccion',   v_proy,
    'dias_mes',     v_dias,
    'dia_hoy',      v_dia_hoy,
    'ritmo_diario', CASE WHEN v_dias > 0 THEN round(v_meta / v_dias, 2) END,
    'umbral_medio', v_cfg.umbral_bono_medio,
    'umbral_total', v_cfg.umbral_bono_total,
    'dias',         coalesce(v_dias_json, '[]'::json),
    'vendedores',   coalesce(v_vend, '[]'::json),
    'promedio_venta',  v_prom_venta,
    'promedio_ticket', v_prom_ticket,
    'promedio_dia',    v_prom_dia,
    -- Horario: el promedio por hora, a cuántos se les pudo calcular y sobre
    -- cuántos. La pantalla habilita la vista «por hora» sólo si son todos.
    'promedio_hora',   v_prom_hora,
    'con_horario',     coalesce(v_con_horario, 0),
    'personas',        coalesce(v_personas, 0),
    'para_revisar',    coalesce(v_revisar, 0),
    -- El aviso: cuánto se facturó este mes que NO es venta de productos, en
    -- cuántas facturas, y cuáles. Cero facturas ⇒ la pantalla no pinta nada.
    'no_producto',          coalesce(v_np_total, 0),
    'no_producto_facturas', coalesce(v_np_facturas, 0),
    'no_producto_detalle',  coalesce(v_np_detalle, '[]'::json)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_traslado_disponibilidad(p_request_id uuid)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH sol AS (
        SELECT nullif(a.metadata->>'origen_erp_sucursal_id','')::integer AS origen,
               nullif(a.metadata->>'erp_sucursal_id','')::integer        AS destino,
               nullif(a.metadata->>'origen_branch_id','')::integer       AS origen_bid,
               a.metadata->>'origen_branch_name'                         AS origen_nombre,
               coalesce((a.metadata->>'origen_vencidos')::boolean,false) AS origen_venc,
               coalesce(a.metadata->'items','[]'::jsonb)                 AS items
        FROM public.approval_requests a
        WHERE a.id = p_request_id AND a.type = 'INVENTORY_TRANSFER_REQUEST'
    ),
    -- `WITH ORDINALITY` conserva el ORDEN del array, e `idx` es la posición en
    -- `metadata.items`. Esa posición es el nombre del renglón en todo el
    -- circuito: es como `aplicar-movimiento-inventario` recibe qué líneas entran
    -- («el cliente manda ÍNDICES con su cantidad, nunca las líneas»), y por lo
    -- mismo — con índices, el navegador sólo puede señalar cuáles de las que YA
    -- se guardaron entran, no inventar una.
    lineas AS (
        SELECT (it.ord - 1)::integer AS idx,
               nullif(it.item->>'erp_product_id','')::integer AS prod,
               it.item->>'descripcion' AS descripcion,
               coalesce((it.item->>'cantidad')::numeric, 0)
                 * coalesce((it.item->>'factor')::numeric, 1) AS pedido
        FROM sol, jsonb_array_elements(sol.items) WITH ORDINALITY AS it(item, ord)
    ),
    -- La existencia de los productos pedidos, calculada UNA vez para las dos
    -- lecturas de abajo (ver el encabezado de la migración 2026-09-22).
    disp AS MATERIALIZED (
        SELECT d.erp_product_id, d.erp_sucursal_id, d.unidades, d.en_vuelo
        FROM public.v_inventario_disponible d
        WHERE d.erp_product_id = ANY (ARRAY(SELECT l.prod FROM lineas l))
    ),
    stock AS (
        SELECT l.idx, d.erp_sucursal_id, d.unidades
        FROM lineas l
        JOIN disp d ON d.erp_product_id = l.prod
    ),
    -- El estante del origen: el de vencidos cuando la solicitud lo nombra, el
    -- normal en todos los demás casos.
    stock_origen AS (
        SELECT l.idx, d.unidades, d.en_vuelo
        FROM lineas l CROSS JOIN sol
        JOIN public.v_inventario_disponible_vencidos d
          ON d.erp_product_id = l.prod AND d.erp_sucursal_id = sol.origen
        WHERE sol.origen_venc
        UNION ALL
        SELECT l.idx, d.unidades, d.en_vuelo
        FROM lineas l CROSS JOIN sol
        JOIN disp d
          ON d.erp_product_id = l.prod AND d.erp_sucursal_id = sol.origen
        WHERE NOT sol.origen_venc
    ),
    minimos AS (
        SELECT l.idx, sp.erp_sucursal_id,
               coalesce(sp.manual_min, sp.calc_min, sp.min_units, 0) AS minimo
        FROM lineas l
        JOIN public.product_stock_params sp ON sp.erp_product_id = l.prod
    ),
    detalle AS (
        SELECT l.idx, l.prod, l.descripcion, l.pedido,
               coalesce(so.unidades, 0) AS unidades,
               coalesce(so.en_vuelo, 0) AS en_vuelo,
               -- El área de vencidos no defiende un mínimo: ahí no se repone nada.
               CASE WHEN sol.origen_venc THEN 0 ELSE coalesce(mo.minimo, 0) END AS minimo,
               (coalesce(so.unidades, 0) >= l.pedido) AS puede,
               -- A quién más pedirle ESTE renglón: las salas que lo cubren
               -- entero, sin contar el origen ni el destino. Es por renglón
               -- porque cada producto tiene su propio mapa de quién lo tiene.
               -- Dos salas con la misma existencia se desempatan por sala: sin
               -- eso, el orden lo decidía el plan.
               coalesce((
                   SELECT json_agg(json_build_object(
                              'erp_sucursal_id', s.erp_sucursal_id,
                              'sala',            coalesce(m.nombre, 'Sucursal ' || s.erp_sucursal_id),
                              'unidades',        s.unidades,
                              'minimo',          coalesce(mi.minimo, 0))
                            ORDER BY s.unidades DESC, s.erp_sucursal_id)
                   FROM stock s
                   LEFT JOIN minimos mi ON mi.idx = s.idx AND mi.erp_sucursal_id = s.erp_sucursal_id
                   LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = s.erp_sucursal_id
                   WHERE s.idx = l.idx
                     AND s.erp_sucursal_id <> sol.origen
                     AND s.erp_sucursal_id <> sol.destino
                     AND s.unidades >= l.pedido
               ), '[]'::json) AS alternativas
        FROM lineas l
        CROSS JOIN sol
        LEFT JOIN stock_origen so ON so.idx = l.idx
        LEFT JOIN minimos mo ON mo.idx = l.idx AND mo.erp_sucursal_id = sol.origen
    )
    SELECT json_build_object(
        'pedido', coalesce(l0.pedido, 0),
        'origen', json_build_object(
            'erp_sucursal_id', sol.origen,
            'vencidos', sol.origen_venc,
            'unidades', coalesce(l0.unidades, 0),
            'en_vuelo', coalesce(l0.en_vuelo, 0),
            'minimo',   coalesce(l0.minimo, 0),
            'puede',    coalesce((SELECT bool_and(d.puede) FROM detalle d), false)
        ),
        'respaldo', CASE
            WHEN sol.origen_bid IS NOT NULL
             AND sol.origen_bid = ANY (COALESCE(public.salas_que_cubro_ahora(), ARRAY[]::integer[]))
            THEN json_build_object('sala', coalesce(nullif(sol.origen_nombre, ''), 'La otra sucursal'))
            ELSE NULL
        END,
        'alternativas', coalesce(l0.alternativas, '[]'::json),
        'lineas', coalesce((
            SELECT json_agg(json_build_object(
                       'idx',            d.idx,
                       'erp_product_id', d.prod,
                       'descripcion',    d.descripcion,
                       'pedido',         d.pedido,
                       'unidades',       d.unidades,
                       'en_vuelo',       d.en_vuelo,
                       'minimo',         d.minimo,
                       'puede',          d.puede,
                       'alternativas',   d.alternativas)
                     ORDER BY d.idx)
            FROM detalle d), '[]'::json)
    )
    FROM sol LEFT JOIN detalle l0 ON l0.idx = 0;
$function$;

CREATE OR REPLACE FUNCTION public.guardar_minmax_desde_pedido(p_pedido_item_id integer, p_min integer, p_max integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    it  public.pedido_items%ROWTYPE;
    v_n integer;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['minmax'])) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
    END IF;

    IF public.auth_module_locked(ARRAY['minmax','pedidos']) THEN
        RAISE EXCEPTION 'MODULE_LOCKED: Min/Max está en mantenimiento';
    END IF;

    SELECT * INTO it FROM public.pedido_items WHERE id = p_pedido_item_id;
    IF it.id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: el producto % no existe', p_pedido_item_id;
    END IF;

    -- La sala del renglón contra el alcance de quien llama (2026-10-08). Es la
    -- misma regla que la policy `psp_update`: MIN·MAX con alcance de red, o la
    -- sala propia. Sin esto, quien tiene `minmax` de una sala (hoy Jefe/a de
    -- Compras y Logística) cambiaba el MIN·MAX de cualquier sucursal pasando
    -- el id de un renglón de otra — la función es DEFINER y salta la policy.
    IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['minmax']))
       AND it.erp_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
        RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: ese producto es de otra sucursal';
    END IF;

    UPDATE public.product_stock_params
       SET min_units = p_min, max_units = p_max,
           manual_min = NULL, manual_max = NULL,
           draft_status = 'none', draft_min = NULL, draft_max = NULL,
           updated_at = now()
     WHERE erp_product_id = it.erp_product_id
       AND erp_sucursal_id = it.erp_sucursal_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_n = 0 THEN
        RAISE EXCEPTION 'NOT_FOUND: el producto no tiene Mín/Máx en esa sucursal';
    END IF;

    RETURN json_build_object('ok', true,
                             'erp_product_id', it.erp_product_id,
                             'erp_sucursal_id', it.erp_sucursal_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.guardar_particion_renglon(p_emisor_nit text, p_llave text, p_partes jsonb, p_document_id bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp uuid;
  v_nit text := nullif(btrim(coalesce(p_emisor_nit,'')),'');
  v_llave text := nullif(btrim(coalesce(p_llave,'')),'');
  v_n int;
  v_malas int;
  v_suma numeric;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['compras','facturas_compra','cargar_compra']) THEN
    RAISE EXCEPTION 'No tienes permiso para partir productos de compra.';
  END IF;
  IF v_nit IS NULL OR v_llave IS NULL THEN
    RAISE EXCEPTION 'Falta el proveedor o su código de producto.';
  END IF;
  IF jsonb_typeof(coalesce(p_partes,'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Las partes no son válidas.';
  END IF;
  IF p_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.purchase_dte_documents d WHERE d.id = p_document_id AND d.emisor_nit = v_nit
  ) THEN
    RAISE EXCEPTION 'Esa factura no es de este proveedor.';
  END IF;

  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';

  v_n := jsonb_array_length(p_partes);
  IF v_n = 0 AND p_document_id IS NULL THEN
    -- Dejar entero, recordado: se borra la regla y la excepción de cualquier factura.
    DELETE FROM public.compra_renglon_particion WHERE emisor_nit = v_nit AND llave = v_llave;
    RETURN;
  END IF;

  IF v_n > 0 THEN
    IF v_n > 6 THEN RAISE EXCEPTION 'Un producto de la factura se parte en 6 como máximo.'; END IF;
    SELECT count(*) FILTER (WHERE NOT (
             (x->>'product_id') ~ '^[0-9]+$'
             AND (x->>'unidades') ~ '^[0-9]+$' AND (x->>'unidades')::numeric BETWEEN 1 AND 1000
             AND (x->>'porcentaje') ~ '^[0-9]+(\.[0-9]+)?$' AND (x->>'porcentaje')::numeric > 0
           )),
           sum(CASE WHEN (x->>'porcentaje') ~ '^[0-9]+(\.[0-9]+)?$' THEN (x->>'porcentaje')::numeric END)
      INTO v_malas, v_suma
      FROM jsonb_array_elements(p_partes) x;
    IF v_malas > 0 THEN RAISE EXCEPTION 'Cada parte lleva un producto, unidades enteras y su parte del costo.'; END IF;
    IF v_suma <> 100 THEN RAISE EXCEPTION 'El costo tiene que sumar 100 %% (va en %).', v_suma; END IF;
    IF v_n = 1 AND (p_partes->0->>'unidades')::numeric < 2 THEN
      RAISE EXCEPTION 'Con un solo producto de 1 unidad no hay nada que partir.';
    END IF;
    IF (SELECT count(DISTINCT x->>'product_id') FROM jsonb_array_elements(p_partes) x) <> v_n THEN
      RAISE EXCEPTION 'El mismo producto está dos veces.';
    END IF;
    IF (SELECT count(*) FROM public.products p
         WHERE p.id IN (SELECT (x->>'product_id')::integer FROM jsonb_array_elements(p_partes) x)) <> v_n THEN
      RAISE EXCEPTION 'Uno de los productos no existe.';
    END IF;
  END IF;

  INSERT INTO public.compra_renglon_particion (emisor_nit, llave, document_id, partes, creado_por)
  VALUES (v_nit, v_llave, p_document_id, p_partes, v_emp)
  ON CONFLICT ON CONSTRAINT compra_renglon_particion_unica DO UPDATE
     SET partes = EXCLUDED.partes, creado_por = EXCLUDED.creado_por, updated_at = now();

  -- Lo que se recuerda vale de inmediato: sin excepción vieja en otras facturas.
  IF p_document_id IS NULL THEN
    DELETE FROM public.compra_renglon_particion
     WHERE emisor_nit = v_nit AND llave = v_llave AND document_id IS NOT NULL;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ignorar_renglon_pendiente(p_id bigint, p_motivo text, p_deshacer boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_emp uuid;
BEGIN
  IF NOT public.auth_can_edit_any(ARRAY['cargar_compra','compras']) THEN
    RAISE EXCEPTION 'No tienes permiso para apartar productos.';
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese producto ya no está en la lista.'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.inyeccion_cotizar(p_branch_id integer, p_origen text, p_items jsonb, p_cantidad integer, p_producto text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_precio   numeric;
  v_total    integer := 0;
  v_ids      bigint[];
  v_producto text;
  v_falta    text;
  v_venta    record;
  v_mez      boolean;
  v_mez_todas boolean;
  v_n_items  integer;
  v_n_cant   integer;
  v_n_mezcla integer;
BEGIN
  IF p_origen NOT IN ('COMPRADA', 'TRAIDA') THEN RAISE EXCEPTION 'Falta si la inyección se compró aquí o la trajo el cliente.'; END IF;
  SELECT precio INTO v_precio FROM inyeccion_precios WHERE origen = p_origen;
  IF v_precio IS NULL THEN RAISE EXCEPTION 'No hay precio para %.', p_origen; END IF;

  IF p_origen = 'TRAIDA' THEN
    v_producto := nullif(trim(coalesce(p_producto, '')), '');
    IF v_producto IS NULL THEN RAISE EXCEPTION 'Falta qué inyección trajo el cliente.'; END IF;
    IF coalesce(p_cantidad, 0) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'La cantidad de aplicaciones no es válida.'; END IF;
    -- La que trajo el cliente: su lote viene en `p_items[0]` (lote, vence).
    PERFORM public.inyeccion_lote_valido(p_items->0->>'lote', p_items->0->>'vence');
    RETURN json_build_object('precio', v_precio, 'aplicaciones', p_cantidad,
      'monto', round(v_precio * p_cantidad, 2),
      'detalle', 'Traida · ' || p_cantidad || 'x ' || upper(v_producto));
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Falta elegir qué inyecciones de la venta se pagan.';
  END IF;
  SELECT array_agg(DISTINCT (e->>'invoice_id')::bigint) INTO v_ids FROM jsonb_array_elements(p_items) e;
  IF array_length(v_ids, 1) > 1 THEN RAISE EXCEPTION 'Un cobro se asigna a una sola venta.'; END IF;

  SELECT id, branch_id, correlativo INTO v_venta FROM sales_invoices WHERE id = v_ids[1] AND public.venta_valida(estado);
  IF v_venta.id IS NULL THEN RAISE EXCEPTION 'Esa venta no existe o está anulada.'; END IF;
  -- Una venta de OTRA sala sí se puede cobrar (2026-10-03): el cliente compra
  -- en una sucursal y se la aplica en otra, con el ticket en la mano. A esa
  -- venta la pantalla sólo llega buscando su número exacto de comprobante
  -- (`inyeccion_venta_por_comprobante`); el cobro y las aplicaciones quedan en
  -- la sala de la CAJA, que es donde entra el dinero y donde se aplica.

  -- La MEZCLA: todos los elegidos mezclados, al menos dos, la misma cantidad.
  SELECT bool_or(coalesce((e->>'mezcla')::boolean, false)), bool_and(coalesce((e->>'mezcla')::boolean, false)),
         count(*), count(DISTINCT (e->>'cantidad')::int), min((e->>'cantidad')::int)
    INTO v_mez, v_mez_todas, v_n_items, v_n_cant, v_n_mezcla
  FROM jsonb_array_elements(p_items) e;
  IF v_mez AND NOT v_mez_todas THEN RAISE EXCEPTION 'En una mezcla todas las inyecciones elegidas van mezcladas.'; END IF;
  IF v_mez AND v_n_items < 2 THEN RAISE EXCEPTION 'Una mezcla necesita al menos dos inyecciones.'; END IF;
  IF v_mez AND v_n_cant > 1 THEN RAISE EXCEPTION 'En una mezcla todas llevan la misma cantidad.'; END IF;

  -- La dosis, en los renglones que se cuentan por ml: que venga, que sea una
  -- de las declaradas y que coincida con la ya fijada por un cobro anterior.
  SELECT string_agg(
           CASE WHEN nullif(e->>'dosis_ml', '') IS NULL THEN 'falta elegir cuánto se pone de ' || r.descripcion
                WHEN r.dosis_ml IS NOT NULL AND (e->>'dosis_ml')::numeric <> r.dosis_ml
                  THEN r.descripcion || ' ya se cobró a ' || trim_scale(r.dosis_ml) || ' ml'
                ELSE 'la dosis de ' || r.descripcion || ' no está en el catálogo' END, '; ')
    INTO v_falta
  FROM jsonb_array_elements(p_items) e
  JOIN public.inyeccion_renglones_de_venta(v_ids) r ON r.linea_num = (e->>'linea_num')::smallint
  WHERE r.contenido_ml IS NOT NULL
    AND (nullif(e->>'dosis_ml', '') IS NULL
         OR NOT ((e->>'dosis_ml')::numeric = ANY (r.opciones_ml))
         OR (r.dosis_ml IS NOT NULL AND (e->>'dosis_ml')::numeric <> r.dosis_ml));
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'Revisa la dosis: %.', v_falta;
  END IF;

  -- Cada renglón pedido: que exista, sea inyectable y alcance el saldo (por
  -- ml, el saldo con la dosis elegida).
  SELECT string_agg(coalesce(r.descripcion, 'producto ' || (e->>'linea_num')), ', ') INTO v_falta
  FROM jsonb_array_elements(p_items) e
  LEFT JOIN public.inyeccion_renglones_de_venta(v_ids) r
    ON r.linea_num = (e->>'linea_num')::smallint
  WHERE r.linea_num IS NULL
     OR coalesce((e->>'cantidad')::int, 0) < 1
     OR (e->>'cantidad')::int > CASE WHEN r.contenido_ml IS NULL THEN r.disponibles
                                     ELSE greatest(floor(r.unidades * floor(r.contenido_ml / (e->>'dosis_ml')::numeric))::int - r.usadas, 0) END;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'Ya no quedan esas aplicaciones por pagar: %.', v_falta;
  END IF;

  SELECT sum((e->>'cantidad')::int),
         string_agg((e->>'cantidad') || 'x ' || r.descripcion
                    || CASE WHEN r.contenido_ml IS NOT NULL THEN ' ' || trim_scale((e->>'dosis_ml')::numeric) || 'ml' ELSE '' END,
                    ', ' ORDER BY r.linea_num)
    INTO v_total, v_producto
  FROM jsonb_array_elements(p_items) e
  JOIN public.inyeccion_renglones_de_venta(v_ids) r ON r.linea_num = (e->>'linea_num')::smallint;

  -- Mezcladas: se cobra UNA aplicación por grupo (decisión del usuario).
  IF v_mez THEN
    SELECT string_agg(r.descripcion
                      || CASE WHEN r.contenido_ml IS NOT NULL THEN ' ' || trim_scale((e->>'dosis_ml')::numeric) || 'ml' ELSE '' END,
                      ' + ' ORDER BY r.linea_num)
      INTO v_producto
    FROM jsonb_array_elements(p_items) e
    JOIN public.inyeccion_renglones_de_venta(v_ids) r ON r.linea_num = (e->>'linea_num')::smallint;
    v_total := v_n_mezcla;
    v_producto := v_total || 'x ' || v_producto || ' (mezcla)';
  END IF;

  -- Los renglones cuya factura no identifica la ampolla traen su lote escrito.
  PERFORM public.inyeccion_lote_valido(e->>'lote', e->>'vence')
     FROM jsonb_array_elements(p_items) e
     JOIN sales_invoice_items ii ON ii.invoice_id = (e->>'invoice_id')::bigint
                                AND ii.linea_num = (e->>'linea_num')::smallint
    WHERE public.inyeccion_lote_pide(ii.lote);

  RETURN json_build_object('precio', v_precio, 'aplicaciones', v_total,
    'monto', round(v_precio * v_total, 2),
    'detalle', 'Fac ' || regexp_replace(coalesce(v_venta.correlativo, ''), '^0+', '') || ' · ' || v_producto);
END;
$function$;

CREATE OR REPLACE FUNCTION public.inyeccion_libro_guardar(p_inyeccion_id bigint, p_datos jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_yo     uuid := public.auth_employee_id();
  v        public.inyeccion_aplicaciones;
  v_via    text := nullif(btrim(p_datos->>'via'), '');
  v_doc    text := nullif(btrim(p_datos->>'documento'), '');
  v_sitio  text := nullif(btrim(p_datos->>'sitio'), '');
  v_reac   text := nullif(btrim(p_datos->>'reaccion'), '');
  v_firma  text := nullif(p_datos->>'firma_png', '');
  v_edad   smallint;
  v_lote   text := nullif(upper(btrim(p_datos->>'lote')), '');
  v_vence  date;
  v_dosis  numeric;
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  IF NOT (public.auth_has_module_permission('inyecciones', 'can_edit')
          OR public.auth_has_module_permission('inyecciones_confirmar', 'can_edit')) THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'No puedes completar el libro de inyectables.';
  END IF;
  SELECT * INTO v FROM public.inyeccion_aplicaciones WHERE id = p_inyeccion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.inyeccion_al_alcance(v.branch_id, v.aplicada_branch_id) THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'Esa aplicación no es de tu sucursal.';
  END IF;
  IF v.aplicada_at IS NULL THEN
    RAISE EXCEPTION 'NO_APLICADA' USING HINT = 'El libro se completa cuando la inyección ya se aplicó.';
  END IF;

  BEGIN
    v_edad  := nullif(btrim(p_datos->>'edad'), '')::smallint;
    v_vence := nullif(btrim(p_datos->>'vence'), '')::date;
    v_dosis := nullif(btrim(p_datos->>'dosis_ml'), '')::numeric;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'Revisa la edad, el vencimiento y la dosis.';
  END;

  IF v_via IS NOT NULL AND v_via NOT IN ('IM', 'IV', 'SC', 'ID') THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'La vía no es válida.';
  END IF;
  IF v_edad IS NOT NULL AND (v_edad < 0 OR v_edad > 120) THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'La edad no es válida.';
  END IF;
  IF v_dosis IS NOT NULL AND (v_dosis <= 0 OR v_dosis > 100) THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'La dosis en ml no es válida.';
  END IF;
  IF v_lote IS NOT NULL AND length(v_lote) NOT BETWEEN 2 AND 30 THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'El lote no es válido.';
  END IF;
  IF v_firma IS NOT NULL AND (v_firma NOT LIKE 'data:image/png;base64,%' OR length(v_firma) >= 200000) THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'La firma no se pudo leer. Vuelve a firmar.';
  END IF;

  -- Lo que el renglón necesita para estar completo. La ampolla se juzga con lo
  -- que ya tenga la aplicación o con lo que llega ahora.
  IF v_doc IS NULL OR v_via IS NULL OR v_sitio IS NULL OR v_edad IS NULL OR v_reac IS NULL
     OR coalesce(v.lote, v_lote) IS NULL OR coalesce(v.vence, v_vence) IS NULL
     OR coalesce(v.dosis_ml, v_dosis) IS NULL THEN
    RAISE EXCEPTION 'DATO_FALTANTE'
      USING HINT = 'Faltan datos: documento, edad, vía, sitio, reacción, lote, vencimiento y dosis son obligatorios.';
  END IF;

  UPDATE public.inyeccion_aplicaciones
     SET lote = coalesce(lote, v_lote), vence = coalesce(vence, v_vence), dosis_ml = coalesce(dosis_ml, v_dosis)
   WHERE id = p_inyeccion_id AND (lote IS NULL OR vence IS NULL OR dosis_ml IS NULL);

  INSERT INTO public.inyeccion_libro AS l (inyeccion_id, documento, medico, junta_medico, via, sitio, observaciones,
                                           edad, reaccion, firma_png, firmado_at, registrado_por)
  VALUES (p_inyeccion_id, v_doc, nullif(btrim(p_datos->>'medico'), ''),
          nullif(btrim(p_datos->>'junta_medico'), ''), v_via, v_sitio,
          nullif(btrim(p_datos->>'observaciones'), ''), v_edad, v_reac, v_firma,
          CASE WHEN v_firma IS NOT NULL THEN now() END, v_yo)
  ON CONFLICT (inyeccion_id) DO UPDATE
     SET documento = EXCLUDED.documento, medico = EXCLUDED.medico, junta_medico = EXCLUDED.junta_medico,
         via = EXCLUDED.via, sitio = EXCLUDED.sitio, observaciones = EXCLUDED.observaciones,
         edad = EXCLUDED.edad, reaccion = EXCLUDED.reaccion,
         -- Una firma ya dada no se borra por guardar sin firma otra vez.
         firma_png = coalesce(EXCLUDED.firma_png, l.firma_png),
         firmado_at = CASE WHEN EXCLUDED.firma_png IS NOT NULL THEN now() ELSE l.firmado_at END,
         registrado_por = EXCLUDED.registrado_por, updated_at = now()
   WHERE (l.documento, l.medico, l.junta_medico, l.via, l.sitio, l.observaciones, l.edad, l.reaccion)
         IS DISTINCT FROM (EXCLUDED.documento, EXCLUDED.medico, EXCLUDED.junta_medico, EXCLUDED.via, EXCLUDED.sitio,
                           EXCLUDED.observaciones, EXCLUDED.edad, EXCLUDED.reaccion)
      OR EXCLUDED.firma_png IS NOT NULL;

  INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, branch_id, details)
  VALUES (v_yo, (SELECT e.name FROM public.employees e WHERE e.id = v_yo), 'INYECCION_LIBRO', p_inyeccion_id::text,
          'ADMIN_PANEL', 'INFO', coalesce(v.aplicada_branch_id, v.branch_id),
          jsonb_build_object('via', v_via, 'firmo', v_firma IS NOT NULL));
  RETURN json_build_object('id', p_inyeccion_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.inyeccion_vincular_cobro(p_cobro_id bigint, p_invoice_id bigint, p_linea_num integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp   uuid := (SELECT auth_employee_id());
  v_cobro record;
  v_venta record;
  v_reng  record;
  v_n     integer;
  i       integer;
BEGIN
  IF NOT (SELECT auth_has_module_permission('inyecciones_dosis', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT id, branch_id, monto, registrado_at, registrado_por, tipo_codigo, anulado_at INTO v_cobro
    FROM caja_movimientos_portal WHERE id = p_cobro_id;
  IF v_cobro.id IS NULL OR v_cobro.tipo_codigo <> 'APLICACION' OR v_cobro.anulado_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ese cobro no es una aplicación vigente.';
  END IF;
  -- Alcance (2026-11-10): sin ALL, sólo un cobro de su sala.
  IF (SELECT auth_module_scope('inyecciones_dosis')) IS DISTINCT FROM 'ALL'
     AND v_cobro.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM inyeccion_aplicaciones WHERE cobro_id = p_cobro_id) THEN
    RAISE EXCEPTION 'Ese cobro ya está asignado.';
  END IF;
  SELECT id, branch_id, customer_id, cliente INTO v_venta FROM sales_invoices
   WHERE id = p_invoice_id AND public.venta_valida(estado);
  IF v_venta.id IS NULL OR v_venta.branch_id <> v_cobro.branch_id THEN
    RAISE EXCEPTION 'La venta no existe, está anulada o es de otra sucursal.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('inyeccion_venta'), p_invoice_id::int);
  SELECT * INTO v_reng FROM public.inyeccion_renglones_de_venta(ARRAY[p_invoice_id]) WHERE linea_num = p_linea_num;
  IF v_reng.linea_num IS NULL THEN RAISE EXCEPTION 'Ese producto no es una inyección.'; END IF;
  v_n := greatest(round(v_cobro.monto / nullif((SELECT precio FROM inyeccion_precios WHERE origen = 'COMPRADA'), 0))::int, 1);
  IF v_n > v_reng.disponibles THEN
    RAISE EXCEPTION 'El cobro equivale a % aplicaciones y a ese producto le quedan %.', v_n, v_reng.disponibles;
  END IF;
  FOR i IN 1..v_n LOOP
    INSERT INTO inyeccion_aplicaciones (branch_id, origen, invoice_id, linea_num, customer_id, cliente, producto,
                                        precio, cobro_id, confirmada, aplicada_at, aplicada_por, aplicada_branch_id,
                                        creada_por, vinculada_por)
    VALUES (v_cobro.branch_id, 'COMPRADA', p_invoice_id, p_linea_num, v_venta.customer_id, v_venta.cliente,
            v_reng.descripcion, round(v_cobro.monto / v_n, 2), p_cobro_id, true,
            v_cobro.registrado_at, coalesce(v_cobro.registrado_por, v_emp), v_cobro.branch_id, v_emp, v_emp);
  END LOOP;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.justificar_diferencia_corte(p_id bigint, p_motivo text, p_causa text DEFAULT NULL::text, p_evidencia_ref text DEFAULT NULL::text, p_evidencia_foto text DEFAULT NULL::text)
 RETURNS cortes_caja_diferencias
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_vieja public.cortes_caja_diferencias;
    v_nueva public.cortes_caja_diferencias;
    v_causa text;
    v_ref   text := NULLIF(btrim(coalesce(p_evidencia_ref, '')), '');
    v_foto  text := NULLIF(btrim(coalesce(p_evidencia_foto, '')), '');
BEGIN
    IF NOT (SELECT auth_has_module_permission('cortes_caja_resolver', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Corregir una resolucion exige decir por que.';
    END IF;
    IF v_ref IS NULL AND v_foto IS NULL THEN
        RAISE EXCEPTION 'Una causa encontrada necesita su comprobante: el numero del documento que se corrigio o una foto.';
    END IF;

    SELECT * INTO v_vieja FROM public.cortes_caja_diferencias WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa resolucion no existe.'; END IF;

    IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
       AND v_vieja.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_vieja.anulada_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esa resolucion ya estaba anulada.';
    END IF;
    IF v_vieja.asentado_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esta resolución ya se registró. No se puede corregir desde aquí.';
    END IF;
    IF v_vieja.via = 'JUSTIFICA' THEN
        RAISE EXCEPTION 'Esta diferencia ya esta como causa encontrada: no mueve dinero.';
    END IF;
    -- El dinero que ya entró por abonos está en el cajón: si la causa aparece
    -- después, primero se anulan (y se devuelven) los abonos.
    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencia_abonos a
                WHERE a.diferencia_id = p_id AND a.anulada_at IS NULL) THEN
        RAISE EXCEPTION 'Este faltante ya tiene abonos: hay que anularlos antes de cambiarlo a causa encontrada.';
    END IF;

    v_causa := coalesce(NULLIF(btrim(coalesce(p_causa, '')), ''), v_vieja.causa);

    UPDATE public.cortes_caja_diferencias SET
        anulada_at = now(), anulada_por = (SELECT auth_employee_id()),
        anulada_motivo = btrim(p_motivo), updated_at = now()
    WHERE id = p_id;

    INSERT INTO public.cortes_caja_diferencias
        (corte_id, branch_id, fecha, monto, via, causa, registrado_por,
         evidencia_ref, evidencia_foto_url)
    VALUES (v_vieja.corte_id, v_vieja.branch_id, v_vieja.fecha, v_vieja.monto,
            'JUSTIFICA', v_causa, (SELECT auth_employee_id()), v_ref, v_foto)
    RETURNING * INTO v_nueva;

    INSERT INTO public.cortes_caja_eventos
        (corte_id, accion, motivo, nota, employee_id)
    VALUES (v_vieja.corte_id, 'ANULAR_DIFERENCIA', btrim(p_motivo),
            'Se corrige: era ' || v_vieja.via, (SELECT auth_employee_id())),
           (v_vieja.corte_id, 'RESOLVER_DIFERENCIA', v_causa,
            'JUSTIFICA ' || to_char(v_nueva.monto, 'FM999999990.00')
              || CASE WHEN v_ref IS NOT NULL THEN ' · ' || v_ref ELSE '' END,
            (SELECT auth_employee_id()));

    RETURN v_nueva;
END;
$function$;

CREATE OR REPLACE FUNCTION public.libro_lote_confirmar(p_revision_id bigint, p_aceptar boolean, p_motivo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r record; d record;
    v_yo uuid := public.auth_employee_id();
    v_dest uuid[];
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'Sin ficha de empleado.' USING ERRCODE = '42501'; END IF;
    IF NOT (SELECT public.auth_has_module_permission('bitacoras_confirmar_lote', 'can_edit')) THEN
        RAISE EXCEPTION 'Confirmar un lote del libro es del regente.' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO r FROM public.libro_lote_revisiones WHERE id = p_revision_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa revisión no existe.' USING ERRCODE = 'P0001'; END IF;
    IF r.estado <> 'corregida' THEN
        RAISE EXCEPTION 'Sólo se confirma un lote que la sucursal ya corrigió.' USING ERRCODE = 'P0001';
    END IF;
    IF r.corregida_por = v_yo THEN
        RAISE EXCEPTION 'Lo corregiste tú: lo tiene que confirmar otra persona.' USING ERRCODE = '42501';
    END IF;
    IF NOT coalesce(p_aceptar, false) AND coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'Para devolverlo, di qué está mal.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.libro_lote_revisiones
       SET estado = CASE WHEN p_aceptar THEN 'confirmada' ELSE 'devuelta' END,
           confirmada_por = CASE WHEN p_aceptar THEN v_yo END,
           confirmada_at  = CASE WHEN p_aceptar THEN now() END,
           devuelta_motivo = CASE WHEN p_aceptar THEN NULL ELSE btrim(p_motivo) END,
           historial = historial || jsonb_build_array(jsonb_build_object(
               'accion', CASE WHEN p_aceptar THEN 'confirmada' ELSE 'devuelta' END,
               'por', v_yo, 'at', now(), 'motivo', nullif(btrim(coalesce(p_motivo, '')), '')))
     WHERE id = r.id;

    IF NOT p_aceptar THEN
        SELECT * INTO d FROM public.bitacora_dispensaciones WHERE id = r.dispensacion_id;
        v_dest := public.libro_lote_encargados(r.branch_id);
        IF coalesce(array_length(v_dest, 1), 0) > 0 THEN
            PERFORM public.notify_employees(
                v_dest, 'LIBRO_LOTE_POR_REVISAR',
                'El regente devolvió un lote del libro',
                d.folio_txt || ' · ' || d.producto_nombre || ' — ' || btrim(p_motivo),
                '/bitacoras?tab=revision',
                jsonb_build_object('revision_id', r.id, 'branch_id', r.branch_id, 'devuelta', true),
                true, r.branch_id::integer);
        END IF;
    END IF;
    RETURN json_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.libro_lote_corregir(p_revision_id bigint, p_partes jsonb, p_vendido_vencido boolean DEFAULT false, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r record; d record;
    v_yo uuid := public.auth_employee_id();
    v_partes jsonb := '[]'::jsonb;
    v_p jsonb; v_lote text; v_vence date; v_cant numeric;
    v_suma numeric := 0; v_alguna_vencida boolean := false;
    v_dest uuid[];
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'Sin ficha de empleado.' USING ERRCODE = '42501'; END IF;
    IF NOT (SELECT public.auth_has_module_permission('bitacoras_corregir_lote', 'can_edit')) THEN
        RAISE EXCEPTION 'Corregir un lote del libro es del encargado de la sucursal.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO r FROM public.libro_lote_revisiones WHERE id = p_revision_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa revisión no existe.' USING ERRCODE = 'P0001'; END IF;
    PERFORM public.bitacora_exigir_acceso(r.branch_id, 'can_edit');
    IF public.auth_module_scope('bitacoras_corregir_lote') <> 'ALL'
       AND r.branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
        RAISE EXCEPTION 'Sólo corriges los lotes de tu sucursal.' USING ERRCODE = '42501';
    END IF;
    IF r.estado NOT IN ('pendiente', 'devuelta') THEN
        RAISE EXCEPTION 'Ese lote ya se corrigió: lo tiene que confirmar el regente.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO d FROM public.bitacora_dispensaciones WHERE id = r.dispensacion_id;

    IF jsonb_typeof(p_partes) <> 'array' OR jsonb_array_length(p_partes) NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'Escribe entre uno y cinco lotes.' USING ERRCODE = 'P0001';
    END IF;
    FOR v_p IN SELECT * FROM jsonb_array_elements(p_partes) LOOP
        v_lote := upper(btrim(coalesce(v_p->>'lote', '')));
        BEGIN
            v_vence := (v_p->>'vence')::date;
            v_cant  := (v_p->>'cantidad')::numeric;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Revisa la fecha y la cantidad de cada lote.' USING ERRCODE = 'P0001';
        END;
        IF v_lote = '' THEN RAISE EXCEPTION 'Falta el número de un lote.' USING ERRCODE = 'P0001'; END IF;
        IF public.libro_lote_motivo(v_lote, NULL, d.fecha) IS NOT NULL THEN
            RAISE EXCEPTION 'El lote % no sirve: escribe UN lote por fila, tal como está en la caja.', v_lote
                USING ERRCODE = 'P0001';
        END IF;
        IF v_vence IS NULL THEN RAISE EXCEPTION 'Falta el vencimiento del lote %.', v_lote USING ERRCODE = 'P0001'; END IF;
        IF v_cant IS NULL OR v_cant <= 0 THEN
            RAISE EXCEPTION 'La cantidad del lote % tiene que ser mayor que cero.', v_lote USING ERRCODE = 'P0001';
        END IF;
        IF public.vence_efectivo(v_vence) < d.fecha THEN v_alguna_vencida := true; END IF;
        v_suma := v_suma + v_cant;
        v_partes := v_partes || jsonb_build_object('lote', v_lote, 'vence', v_vence, 'cantidad', v_cant);
    END LOOP;

    IF v_suma <> d.cantidad THEN
        RAISE EXCEPTION 'Los lotes suman % y la venta fue de %.', v_suma, d.cantidad USING ERRCODE = 'P0001';
    END IF;
    IF v_alguna_vencida AND NOT coalesce(p_vendido_vencido, false) THEN
        RAISE EXCEPTION 'Un lote ya estaba vencido el día de la venta. Si es así, márcalo como vendido vencido.'
            USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(p_vendido_vencido, false) AND NOT v_alguna_vencida THEN
        RAISE EXCEPTION 'Marcaste «vendido vencido» pero ningún lote vencía antes de la venta.' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.libro_lote_revisiones
       SET estado = 'corregida', partes = v_partes,
           vendido_vencido = coalesce(p_vendido_vencido, false),
           nota = nullif(btrim(coalesce(p_nota, '')), ''),
           corregida_por = v_yo, corregida_at = now(), devuelta_motivo = NULL,
           historial = historial || jsonb_build_array(jsonb_build_object(
               'accion', 'corregida', 'por', v_yo, 'at', now(), 'partes', v_partes,
               'vendido_vencido', coalesce(p_vendido_vencido, false)))
     WHERE id = r.id;

    v_dest := public.libro_lote_regentes();
    IF coalesce(array_length(v_dest, 1), 0) > 0 THEN
        PERFORM public.notify_employees(
            v_dest, 'LIBRO_LOTE_POR_CONFIRMAR',
            (SELECT name FROM public.branches WHERE id = r.branch_id) || ': lote del libro por confirmar',
            d.folio_txt || ' · ' || d.producto_nombre
                || CASE WHEN coalesce(p_vendido_vencido, false) THEN '. La sucursal dice que SE VENDIÓ VENCIDO.'
                        ELSE '. La sucursal escribió el lote real.' END,
            '/bitacoras?tab=revision',
            jsonb_build_object('revision_id', r.id, 'branch_id', r.branch_id, 'vendido_vencido', coalesce(p_vendido_vencido, false)),
            true, r.branch_id::integer);
    END IF;

    RETURN json_build_object('ok', true, 'partes', v_partes);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mapfre_cotizar(p_branch_id integer, p_invoice_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_si    public.sales_invoices%ROWTYPE;
  v_monto numeric;
  v_n     integer;
BEGIN
  SELECT * INTO v_si FROM public.sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa factura no existe.'; END IF;
  IF v_si.customer_id IS DISTINCT FROM public.mapfre_customer_id() THEN
    RAISE EXCEPTION 'Esa factura no es de Mapfre.';
  END IF;
  IF v_si.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Esa factura es de otra sucursal.'; END IF;
  IF NOT public.venta_valida(v_si.estado) THEN RAISE EXCEPTION 'Esa factura está anulada.'; END IF;

  SELECT round(sum(i.total_linea), 2), count(*) INTO v_monto, v_n
    FROM public.sales_invoice_items i
   WHERE i.invoice_id = v_si.id AND i.erp_product_id = 0;
  IF v_n = 0 OR coalesce(v_monto, 0) <= 0 THEN
    RAISE EXCEPTION 'Esa factura no trae la parte del asegurado (el descuento con puntos).';
  END IF;

  IF public.mapfre_ya_cobrada(v_si.id) THEN
    RAISE EXCEPTION 'Esa factura de Mapfre ya tiene su pago anotado.';
  END IF;

  RETURN json_build_object('invoice_id', v_si.id, 'correlativo', v_si.correlativo,
                           'fecha', v_si.fecha, 'monto', v_monto, 'total_mapfre', v_si.total);
END $function$;

CREATE OR REPLACE FUNCTION public.marcar_ajuste_manual_minmax()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cambio_numero  boolean := NEW.min_units     IS DISTINCT FROM OLD.min_units
                           OR NEW.max_units     IS DISTINCT FROM OLD.max_units;
  v_cambio_motivo  boolean := NEW.manual_motivo IS DISTINCT FROM OLD.manual_motivo;
BEGIN
  -- «Ya no rota» es el único motivo que BORRA historial de demanda: le dice al
  -- cálculo que deje de contar todo lo vendido antes de hoy. No puede quedar a
  -- un clic de distancia de cualquiera que edite una celda, así que pide el
  -- mismo alcance que ya distingue a supervisión de una sala.
  IF v_cambio_motivo AND NEW.manual_motivo = 'ya_no_rota'
     AND auth.uid() IS NOT NULL
     AND NOT (SELECT public.auth_can_edit_scope_all(ARRAY['minmax'])) THEN
    RAISE EXCEPTION 'MOTIVO_DENEGADO: «ya no rota» sólo lo puede poner quien decide sobre todas las sucursales';
  END IF;

  -- Quién NO es una persona ajustando a mano:
  --
  -- 1. El recálculo y el auto-aplicar corren con service_role desde la edge
  --    function: ahí `auth.uid()` es NULL.
  -- 2. Publicar un borrador SÍ corre con la sesión de quien publica
  --    (publish_stock_params es SECURITY DEFINER pero la invoca el navegador),
  --    así que `auth.uid()` no alcanza para distinguirlo. Lo que sí lo
  --    distingue es que publicar SIEMPRE reescribe `published_at` en el mismo
  --    UPDATE — es su firma, y no la comparte ninguna edición de celda.
  IF auth.uid() IS NOT NULL
     AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at THEN
    -- Declarar el motivo TAMBIÉN es ajustar: alguien puede marcar «ya no rota»
    -- sin tocar el número, y sin `manual_at` ese motivo no tendría fecha de
    -- corte —que es justo el dato del que depende— ni pasaría su propio CHECK.
    IF v_cambio_numero OR (v_cambio_motivo AND NEW.manual_motivo IS NOT NULL) THEN
      NEW.manual_at  := now();
      NEW.manual_por := coalesce(auth.email(), auth.uid()::text);
      -- El sello de la solicitud vale para el par que se aprobó. Si el número
      -- se movió y quien escribe no trajo un sello propio, se limpia: si no,
      -- una edición cualquiera heredaría la protección de una decisión que ya
      -- no describe este número.
      IF v_cambio_numero AND NEW.ajuste_solicitud_id IS NOT DISTINCT FROM OLD.ajuste_solicitud_id THEN
        NEW.ajuste_solicitud_id := NULL;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.marcar_ventas_desaparecidas(p_branch_id integer, p_fini date, p_ffin date, p_vistos text[], p_inmediato boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_faltan     integer;
    v_tope       integer;
    v_marcadas   json := '[]'::json;
    v_n          integer := 0;
    v_dest       uuid[];
    v_lista      text;
    v_sala       text;
    v_con_sello  integer;
BEGIN
    IF p_vistos IS NULL OR cardinality(p_vistos) = 0 THEN
        RETURN json_build_object('ok', false, 'motivo', 'listado vacío');
    END IF;

    -- Lo que volvió: si estaba marcada, el sync ya le devolvió su estado del
    -- origen (compara estado y lo reescribe); acá sólo se anota cuándo.
    UPDATE public.ventas_desaparecidas d
       SET reaparecio_at = now()
     WHERE d.branch_id = p_branch_id
       AND d.erp_invoice_id = ANY (p_vistos)
       AND d.marcada_at IS NOT NULL AND d.reaparecio_at IS NULL;
    -- Una ausencia que no llegó a marcarse y volvió no fue nada.
    DELETE FROM public.ventas_desaparecidas d
     WHERE d.branch_id = p_branch_id
       AND d.erp_invoice_id = ANY (p_vistos)
       AND d.marcada_at IS NULL;

    SELECT count(*) INTO v_faltan
      FROM public.sales_invoices si
     WHERE si.branch_id = p_branch_id
       AND si.fecha BETWEEN p_fini AND p_ffin
       AND si.estado IS DISTINCT FROM 'DESAPARECIDA EN ORIGEN'
       AND si.erp_invoice_id IS NOT NULL
       AND NOT (si.erp_invoice_id = ANY (p_vistos));

    IF v_faltan = 0 THEN
        RETURN json_build_object('ok', true, 'faltan', 0, 'marcadas', '[]'::json);
    END IF;

    v_tope := greatest(5, ceil(cardinality(p_vistos) * 0.05)::integer);
    IF v_faltan > v_tope THEN
        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
        VALUES ('VENTAS_DESAPARECIDAS_FRENADO', p_branch_id::text, 'Vigilante', 'SYSTEM', 'WARNING',
                jsonb_build_object('branch_id', p_branch_id, 'fini', p_fini, 'ffin', p_ffin,
                                   'faltan', v_faltan, 'vistos', cardinality(p_vistos)));
        RETURN json_build_object('ok', false, 'motivo', 'demasiadas ausencias', 'faltan', v_faltan);
    END IF;

    INSERT INTO public.ventas_desaparecidas (invoice_id, branch_id, erp_invoice_id)
    SELECT si.id, si.branch_id, si.erp_invoice_id
      FROM public.sales_invoices si
     WHERE si.branch_id = p_branch_id
       AND si.fecha BETWEEN p_fini AND p_ffin
       AND si.estado IS DISTINCT FROM 'DESAPARECIDA EN ORIGEN'
       AND si.erp_invoice_id IS NOT NULL
       AND NOT (si.erp_invoice_id = ANY (p_vistos))
    ON CONFLICT (invoice_id) DO UPDATE
       SET primera_ausencia = CASE WHEN ventas_desaparecidas.reaparecio_at IS NOT NULL
                                   THEN now() ELSE ventas_desaparecidas.primera_ausencia END,
           marcada_at       = CASE WHEN ventas_desaparecidas.reaparecio_at IS NOT NULL
                                   THEN NULL ELSE ventas_desaparecidas.marcada_at END,
           reaparecio_at    = NULL;

    WITH aMarcar AS (
        SELECT si.id, si.estado
          FROM public.sales_invoices si
          JOIN public.ventas_desaparecidas d ON d.invoice_id = si.id
         WHERE si.branch_id = p_branch_id
           AND si.fecha BETWEEN p_fini AND p_ffin
           AND si.estado IS DISTINCT FROM 'DESAPARECIDA EN ORIGEN'
           AND NOT (si.erp_invoice_id = ANY (p_vistos))
           AND (p_inmediato OR d.primera_ausencia <= now() - interval '3 minutes')
    ), upd AS (
        UPDATE public.sales_invoices si
           SET estado = 'DESAPARECIDA EN ORIGEN', updated_at = now()
          FROM aMarcar m
         WHERE si.id = m.id
        RETURNING si.id, si.branch_id, si.tipo_documento, si.correlativo, si.codigo_generacion,
                  si.fecha, si.hora, si.total, si.tipo_pago, si.cliente, si.recibido_mh, m.estado AS previo
    ), log AS (
        INSERT INTO public.sales_invoice_changelog
               (invoice_id, codigo_generacion, branch_id, tipo_documento, campo, valor_anterior, valor_nuevo)
        SELECT id, codigo_generacion, branch_id, tipo_documento, 'estado', previo, 'DESAPARECIDA EN ORIGEN'
          FROM upd
        RETURNING invoice_id
    ), marca AS (
        UPDATE public.ventas_desaparecidas d
           SET marcada_at = now(), estado_previo = u.previo
          FROM upd u WHERE d.invoice_id = u.id
        RETURNING d.invoice_id
    )
    SELECT count(*),
           coalesce(json_agg(json_build_object(
               'id', u.id, 'correlativo', u.correlativo, 'tipo_documento', u.tipo_documento,
               'fecha', u.fecha, 'hora', u.hora, 'total', u.total, 'tipo_pago', u.tipo_pago,
               'cliente', u.cliente, 'con_sello', length(u.recibido_mh) = 40,
               'estado_previo', u.previo) ORDER BY u.fecha, u.hora), '[]'::json),
           string_agg(CASE WHEN u.tipo_documento = 'CCF' THEN 'crédito fiscal ' ELSE 'factura ' END
                      || coalesce(nullif(ltrim(split_part(u.correlativo, '_', 1), '0'), ''), u.correlativo)
                      || ' · $' || to_char(u.total, 'FM999999990.00')
                      || ' (' || to_char(u.fecha, 'DD/MM') || ' ' || to_char(u.hora, 'HH24:MI') || ')'
                      || CASE WHEN length(u.recibido_mh) = 40 THEN ', con sello del MH' ELSE '' END,
                      '  ·  ' ORDER BY u.fecha, u.hora),
           count(*) FILTER (WHERE length(u.recibido_mh) = 40)
      INTO v_n, v_marcadas, v_lista, v_con_sello
      FROM upd u;

    IF v_n > 0 THEN
        SELECT name INTO v_sala FROM public.branches WHERE id = p_branch_id;

        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
        VALUES ('VENTA_DESAPARECIDA_EN_ORIGEN', p_branch_id::text, 'Vigilante', 'SYSTEM', 'CRITICAL',
                jsonb_build_object('branch_id', p_branch_id, 'facturas', v_marcadas::jsonb,
                                   'inmediato', p_inmediato));

        -- Quien lo resuelve: edita Facturación y ve Saltos, que es adonde lleva
        -- el aviso. Mismo criterio que `avisar_rechazos_sin_arreglo`.
        SELECT array_agg(DISTINCT e.id) INTO v_dest
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND EXISTS (SELECT 1 FROM public.role_permissions rp
                        WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                          AND rp.module_key = 'facturacion' AND rp.can_edit)
           AND EXISTS (SELECT 1 FROM public.role_permissions rp
                        WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                          AND rp.module_key = 'facturacion_tab_saltos' AND rp.can_view);

        IF coalesce(array_length(v_dest, 1), 0) > 0 THEN
            PERFORM public.notify_employees(
                v_dest, 'VENTA_DESAPARECIDA',
                CASE WHEN v_n = 1 THEN 'Se eliminó una factura ya emitida en ' || v_sala
                     ELSE 'Se eliminaron ' || v_n || ' facturas ya emitidas en ' || v_sala END,
                v_lista || CASE WHEN v_n = 1
                                THEN '. Dejó de contar como venta en el portal y aparece en Saltos.'
                                ELSE '. Dejaron de contar como venta en el portal y aparecen en Saltos.' END
                  || CASE WHEN v_con_sello = 1 AND v_n = 1
                          THEN ' El MH la tiene recibida. Hay que invalidarla o restituirla.'
                          WHEN v_con_sello > 0
                          THEN ' El MH tiene recibidas ' || v_con_sello || ': hay que invalidarlas o restituirlas.'
                          ELSE '' END,
                '/facturacion?tab=saltos',
                jsonb_build_object('origen', 'venta-desaparecida', 'facturas', v_marcadas::jsonb),
                true, p_branch_id);
        ELSE
            INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
            VALUES ('VENTA_DESAPARECIDA_SIN_DESTINATARIOS', p_branch_id::text, 'Vigilante', 'SYSTEM',
                    'CRITICAL', jsonb_build_object('facturas', v_marcadas::jsonb));
        END IF;
    END IF;

    RETURN json_build_object('ok', true, 'faltan', v_faltan, 'marcadas', v_marcadas);
END;
$function$;

CREATE OR REPLACE FUNCTION public.metas_avisar_cierre_a_admin(p_ym_cerrado text, p_ultimo_intento boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ym_nuevo   text := to_char(((p_ym_cerrado || '-01')::date + interval '1 month')::date, 'YYYY-MM');
  v_dias_mes   integer := EXTRACT(day FROM ((p_ym_cerrado || '-01')::date + interval '1 month -1 day'))::int;
  v_fini       date;
  v_ffin       date;
  v_clave      text;
  v_n          integer;
  v_ids        uuid[];
BEGIN
  IF p_ym_cerrado IS NULL OR p_ym_cerrado !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'MES_INVALIDO: %', p_ym_cerrado;
  END IF;
  v_fini  := (p_ym_cerrado || '-01')::date;
  v_ffin  := (v_fini + interval '1 month -1 day')::date;
  v_clave := 'METAS_CIERRE_EMPRESA:' || p_ym_cerrado;

  WITH
  cerrado AS (
    SELECT d.branch_id::bigint AS branch_id,
           SUM(d.sum_total - d.sum_no_producto)::numeric AS venta,
           COUNT(*)::int AS dias_dato
    FROM public.sales_daily_stats d
    WHERE to_char(d.date, 'YYYY-MM') = p_ym_cerrado
    GROUP BY 1
  ),
  salas AS (
    SELECT c.branch_id, b.name AS sala,
           COALESCE(res.venta_total, ROUND(c.venta, 2)) AS venta,
           mv.monto_meta AS meta,
           COALESCE(res.pct_cumplimiento,
                    CASE WHEN mv.monto_meta > 0
                         THEN ROUND(c.venta / mv.monto_meta * 100, 1) END) AS pct
    FROM cerrado c
    JOIN public.erp_sucursal_map em ON em.branch_id = c.branch_id AND NOT em.es_bodega
    JOIN public.branches b ON b.id = c.branch_id
    LEFT JOIN public.metas_sucursal mv
           ON mv.branch_id = c.branch_id AND mv.year_month = p_ym_cerrado
    LEFT JOIN public.metas_resultado res
           ON res.branch_id = c.branch_id AND res.year_month = p_ym_cerrado
    WHERE (c.dias_dato = v_dias_mes OR res.year_month IS NOT NULL)
  ),
  global AS (
    SELECT SUM(venta) AS venta, SUM(meta) AS meta, COUNT(*) AS cuantas,
           CASE WHEN SUM(meta) > 0 THEN ROUND(SUM(venta) / SUM(meta) * 100, 1) END AS pct
    FROM salas
  ),
  vend AS MATERIALIZED (
    SELECT * FROM public.get_vendedores_resumen(v_fini, v_ffin, NULL)
  ),
  top3 AS (
    SELECT json_agg(json_build_object(
             'employee_id', t.id, 'nombre', t.name, 'sala', t.sala, 'venta', t.total_ventas)
           ORDER BY t.total_ventas DESC) AS filas
    FROM (
      SELECT e.id, e.name, b.name AS sala, v.total_ventas
      FROM vend v
      JOIN public.employees e
        ON e.code = v.cod_vendedor AND e.branch_id = v.branch_id AND e.status = 'ACTIVO'
      JOIN public.branches b ON b.id = v.branch_id
      JOIN public.erp_sucursal_map em ON em.branch_id = v.branch_id AND NOT em.es_bodega
      ORDER BY v.total_ventas DESC
      LIMIT 3
    ) t
  ),
  destinatarios AS (
    SELECT e.id AS employee_id
    FROM public.employees e
    WHERE e.status = 'ACTIVO'
      AND COALESCE(e.tipo_ficha, 'empleado') = 'empleado'
      AND EXISTS (SELECT 1 FROM public.role_permissions rp
                   WHERE rp.module_key = 'metas' AND rp.can_view
                     AND rp.role_id IN (e.role_id, e.secondary_role_id))
      AND NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map em
                       WHERE em.branch_id = e.branch_id AND NOT em.es_bodega)
  ),
  ins AS (
    INSERT INTO public.notifications
      (recipient_id, type, title, body, link, metadata)
    SELECT d.employee_id,
           'METAS_CIERRE_EMPRESA',
           -- «La meta» y no «la empresa»: lo que cerró en 96.4% es la meta.
           'La meta de ' || public.metas_mes_label(p_ym_cerrado)
             || ' cerró en ' || (SELECT pct FROM global) || '%',
           'Las ' || (SELECT cuantas FROM global) || ' sucursales vendieron $'
             || to_char((SELECT venta FROM global), 'FM999,999,990.00')
             || ' de una meta de $' || to_char((SELECT meta FROM global), 'FM999,999,990.00')
             || '. Las metas de ' || public.metas_mes_label(v_ym_nuevo) || ' ya están publicadas.',
           '/metas',
           jsonb_build_object(
             'ym_cerrado',  p_ym_cerrado,
             'ym_nuevo',    v_ym_nuevo,
             'mes_cerrado', public.metas_mes_label(p_ym_cerrado),
             'mes_nuevo',   public.metas_mes_label(v_ym_nuevo),
             'pct',         (SELECT pct   FROM global),
             'venta',       (SELECT venta FROM global),
             'meta',        (SELECT meta  FROM global),
             'sucursales',  (SELECT json_agg(json_build_object('sala', s.sala, 'pct', s.pct)
                                             ORDER BY s.pct DESC NULLS LAST) FROM salas s),
             'top3',        (SELECT filas FROM top3))
    FROM destinatarios d
    WHERE (SELECT pct FROM global) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.avisos_emitidos a
         WHERE a.recipient_id = d.employee_id AND a.clave = v_clave
      )
    RETURNING id, recipient_id
  ),
  marca AS (
    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    SELECT v_clave, i.recipient_id FROM ins i
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*), array_agg(id) INTO v_n, v_ids FROM ins;

  -- También al teléfono (2026-09-23).
  PERFORM public.push_de_notificaciones(v_ids);

  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.metas_ciclo_diario()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_dia integer := EXTRACT(day FROM v_hoy)::int;
  v_ym_actual text := to_char(v_hoy, 'YYYY-MM');
  v_ym_sig text := to_char((date_trunc('month', v_hoy) + interval '1 month')::date, 'YYYY-MM');
  v_ym_ant text := to_char((date_trunc('month', v_hoy) - interval '1 month')::date, 'YYYY-MM');
  v_dia_propuesta integer;
  v_creadas integer := 0;
  v_rehechas integer := 0;
  v_n integer;
  v_out text := '';
BEGIN
  SELECT dia_propuesta INTO v_dia_propuesta FROM public.metas_config LIMIT 1;
  v_dia_propuesta := COALESCE(v_dia_propuesta, 28);

  IF v_dia = v_dia_propuesta THEN
    v_creadas := public.generar_propuestas_metas(v_ym_sig);
    v_out := v_out || 'propuestas=' || v_creadas || ' ';

    -- Las que ya existían (mes propuesto antes, o el día corrido) se ponen al
    -- día con las ventas de hoy. No toca confirmadas, oficiales ni ajustadas.
    v_rehechas := public.recalcular_propuestas_metas(v_ym_sig,
      'el portal las rehizo el día de la propuesta con las ventas hasta hoy');
    IF v_rehechas > 0 THEN
      v_out := v_out || 'rehechas=' || v_rehechas || ' ';
      PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_PROPUESTAS',
        'Metas recalculadas para ' || public.metas_mes_label(v_ym_sig),
        v_rehechas || ' meta(s) que ya estaban propuestas se rehicieron con las ventas '
        || 'hasta hoy. Las que ya habías ajustado o confirmado no se tocaron.');
    END IF;
  END IF;

  -- El mes que cerró queda congelado con las reglas que regían ese mes.
  IF v_dia = 5 THEN
    v_n := public.congelar_metas_mes(v_ym_ant, false);
    v_out := v_out || 'congelado_' || v_ym_ant || '=' || v_n || ' ';

    -- Y el bono de cada persona, con el personal de HOY: el pago es semestral
    -- y sumar después recalcularía el mes con quien esté en julio o en enero.
    v_n := public.fotografiar_bono_meta_mes(v_ym_ant, 'cierre');
    v_out := v_out || 'bono_personas_' || v_ym_ant || '=' || v_n || ' ';
  END IF;

  -- El aviso a la sala va DESPUÉS de congelar: el 5, si el congelado acaba de
  -- escribirse, el número de la campana es ya el del histórico.
  IF v_dia BETWEEN 1 AND 5 THEN
    v_n := public.metas_avisar_cierre_a_salas(v_ym_ant, v_dia = 5);
    IF v_n > 0 THEN
      v_out := v_out || 'aviso_salas_' || v_ym_ant || '=' || v_n || ' ';
    END IF;

    -- Y el de administración, que mira las seis a la vez. Va después del de las
    -- salas por el mismo motivo por el que el de las salas va después de
    -- congelar: si algo falla, lo primero que se salva es el aviso de la gente
    -- que persiguió la meta.
    v_n := public.metas_avisar_cierre_a_admin(v_ym_ant, v_dia = 5);
    IF v_n > 0 THEN
      v_out := v_out || 'aviso_admin_' || v_ym_ant || '=' || v_n || ' ';
    END IF;
  END IF;

  -- Desde el día SIGUIENTE al de la propuesta: recordarle a alguien que no
  -- confirmó lo que se creó esta misma mañana no es un recordatorio.
  IF v_dia > v_dia_propuesta THEN
    SELECT count(*) INTO v_n FROM public.metas_sucursal
    WHERE year_month = v_ym_sig AND estado IN ('propuesta', 'devuelta');
    IF v_n > 0 THEN
      PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_RECORDATORIO',
        'Metas sin confirmar',
        'Quedan ' || v_n || ' meta(s) de ' || public.metas_mes_label(v_ym_sig) || ' sin confirmar.');
      v_out := v_out || 'rec_supervisor=' || v_n || ' ';
    END IF;
  END IF;

  IF v_dia >= 30 OR v_dia <= 5 THEN
    SELECT count(*) INTO v_n FROM public.metas_sucursal
    WHERE year_month IN (v_ym_actual, v_ym_sig) AND estado = 'confirmada_supervisor';
    IF v_n > 0 THEN
      PERFORM public.metas_notificar_rol('Gerente General', 'METAS_RECORDATORIO',
        'Metas por aprobar',
        v_n || ' meta(s) confirmadas esperan tu aprobación.');
      v_out := v_out || 'rec_gerente=' || v_n || ' ';
    END IF;
  END IF;

  -- Días 1, 3 y después una vez por semana: el mes en curso sin oficializar es
  -- una situación que dura, no una novedad diaria. Es además la única red en
  -- FEBRERO, donde el 28 es el último día y no hay «día siguiente».
  IF v_dia IN (1, 3, 8, 15, 22, 29) THEN
    SELECT count(*) INTO v_n FROM public.metas_sucursal
    WHERE year_month = v_ym_actual AND estado <> 'oficial';
    IF v_n > 0 THEN
      PERFORM public.metas_notificar_rol('Supervisor/a de Ventas', 'METAS_RECORDATORIO',
        'La meta de ' || public.metas_mes_label(v_ym_actual) || ' sigue pendiente',
        v_n || ' sucursal(es) aún no tienen su meta oficial. Las sucursales la ven como pendiente.');
      PERFORM public.metas_notificar_rol('Gerente General', 'METAS_RECORDATORIO',
        'La meta de ' || public.metas_mes_label(v_ym_actual) || ' sigue pendiente',
        v_n || ' sucursal(es) aún no tienen su meta oficial.');
      v_out := v_out || 'pendientes_mes_actual=' || v_n;
    END IF;
  END IF;

  RETURN COALESCE(NULLIF(v_out, ''), 'sin novedades');
END;
$function$;

CREATE OR REPLACE FUNCTION public.mmcr_solicitud_con_efecto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_oculto  boolean;
  v_hoy_min integer;
  v_hoy_max integer;
BEGIN
  IF NEW.erp_sucursal_id = 6 THEN
    RAISE EXCEPTION 'MMCR_BODEGA: Bodega no admite solicitudes de MIN/MAX — su par sale de la suma de las salas (trg_bodega_draft_sync)';
  END IF;

  -- SECURITY DEFINER a propósito: hoy `psp_select` es USING (true), pero si esa
  -- policy se ajusta alguna vez, un INVOKER dejaría de ver la fila y la guarda
  -- leería «0 · 0» donde hay «5 · 10» — o sea rechazaría por «sin cambio» algo
  -- que sí cambia. No ver y ver un cero se parecen demasiado.
  SELECT p.is_hidden,
         public.minmax_eff_min(p.min_units, p.max_units, p.manual_min, p.manual_max),
         public.minmax_eff_max(p.min_units, p.max_units, p.manual_min, p.manual_max)
    INTO v_oculto, v_hoy_min, v_hoy_max
  FROM public.product_stock_params p
  WHERE p.erp_product_id  = NEW.erp_product_id
    AND p.erp_sucursal_id = NEW.erp_sucursal_id;

  IF v_oculto IS TRUE THEN
    RAISE EXCEPTION 'MMCR_PRODUCTO_OCULTO: el producto está oculto en esa sucursal. Hoy no entra en sus pedidos y la solicitud no se puede aprobar.';
  END IF;

  -- Sin fila = nunca tuvo par en esa sala = no se repone = 0 · 0.
  v_hoy_min := COALESCE(v_hoy_min, 0);
  v_hoy_max := COALESCE(v_hoy_max, 0);

  IF COALESCE(NEW.requested_min, 0) = v_hoy_min
     AND COALESCE(NEW.requested_max, 0) = v_hoy_max THEN
    RAISE EXCEPTION 'MMCR_SIN_CAMBIO: el par propuesto (% · %) es el que la sucursal ya tiene', v_hoy_min, v_hoy_max;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_corte_de_caja()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sala       text;
  v_dest       uuid[];
  v_titulo     text;
  v_cuerpo     text;
  v_sin_conteo boolean;
  v_tramo      numeric;
  v_monto      text;
  v_quien      text;
BEGIN
  -- El cierre del día (Z) no se confirma ni se descarta —lo rechaza
  -- `resolver_corte_caja`—, así que avisarlo sería pedir una acción que no
  -- existe.
  IF NEW.tipo <> 'C' THEN
    RETURN NULL;
  END IF;

  -- Sólo lo recién hecho. El repaso de las 23:40 no reinserta nada (el upsert
  -- ignora duplicados), pero una recarga manual de días pasados sí, y avisarle
  -- a la sala de un corte de la semana pasada es el ruido que enseña a ignorar
  -- la campana. Dos días de ventana y medio día de desfase cubren el corte de
  -- las 23:59, que se captura recién a las 6 del otro día.
  IF NEW.fecha < ((now() AT TIME ZONE 'America/El_Salvador')::date - 1)
     OR coalesce(NEW.desfase_seg, 0) > 43200 THEN
    RETURN NULL;
  END IF;

  v_sin_conteo := public.corte_no_conto_efectivo(NEW.tipo, NEW.total_declarado,
                                                 NEW.diferencia_erp, NEW.tk_total_caja);

  -- `cobros_portal_efectivo` ya está sellado: lo escribe
  -- `cortes_caja_sella_cobros_portal`, que es BEFORE INSERT. Sin él el tramo
  -- nacería con el efectivo de los cobros del portal contado como sobrante —
  -- que es exactamente el «+$78.40 sobre un faltante de $9.85» del 2-sep.
  IF NOT v_sin_conteo THEN
    v_tramo := public.corte_tramo(NEW.id);
    -- 2026-11-14: el corte que cuadró no se avisa (ver el encabezado).
    IF v_tramo IS NOT NULL AND abs(v_tramo) < 0.01 THEN
      RETURN NULL;
    END IF;
    v_monto := '$' || to_char(abs(v_tramo), 'FM999,999,990.00');
  END IF;

  SELECT name INTO v_sala FROM public.branches WHERE id = NEW.branch_id;
  -- Quién hizo el corte, para la tarjeta (23-sep: «falta quien hizo el
  -- corte»). Sólo la ficha ligada: `empleado_texto` es el nombre de la CUENTA
  -- con la que opera la caja, no el de la persona.
  SELECT e.name INTO v_quien FROM public.employees e WHERE e.id = NEW.employee_id;

  v_dest := public.destinatarios_de_cortes(NEW.branch_id);
  IF v_dest IS NULL THEN
    RETURN NULL;
  END IF;

  -- Título neutro (usuario, 23-sep: «siento too much, límpialo»): el monto lo
  -- dibuja la tarjeta a la derecha y lo dice el cuerpo, que es lo que se lee en
  -- el push. La sala va en el título (23-sep).
  v_titulo := coalesce(v_sala || ' · ', '') || 'Corte de las ' || public.hora_12(NEW.hora);

  -- Un corte sin conteo no se confirma: pedirlo manda a la sala a buscar un
  -- botón que no está. Lo que corresponde es descartarlo y volver a cortar.
  v_cuerpo := coalesce(v_sala, 'Tu sucursal') || ' — '
           || CASE
                WHEN v_sin_conteo
                  THEN 'salió sin contar el efectivo. Hay que descartarlo y volver a hacer el corte.'
                WHEN v_tramo <= -0.01
                  THEN 'el efectivo contado quedó ' || v_monto
                       || ' abajo de lo esperado. Hay que revisarlo y confirmarlo.'
                WHEN v_tramo >= 0.01
                  THEN 'el efectivo contado quedó ' || v_monto
                       || ' arriba de lo esperado. Hay que revisarlo y confirmarlo.'
                ELSE 'hay que revisarlo y confirmarlo.'
              END;

  PERFORM public.notify_employees(
    v_dest,
    'CORTE_NUEVO',
    v_titulo,
    v_cuerpo,
    '/cortes',
    jsonb_build_object(
      'corte_id',  NEW.id,
      'branch_id', NEW.branch_id,
      'fecha',     NEW.fecha,
      'hora',      to_char(NEW.hora, 'HH24:MI'),
      -- El número que se anunció. `null` cuando no hubo conteo: no es cero.
      'tramo',     v_tramo,
      'sala',      v_sala,
      'quien_id',  NEW.employee_id,
      'quien',     v_quien,
      'quien_foto', public.foto_de_empleado(NEW.employee_id),
      'contado',   CASE WHEN v_sin_conteo THEN NULL ELSE NEW.total_declarado END,
      'ventas',    NEW.tk_venta
    ),
    true,            -- push: hay que ir a revisarlo, no es informativo
    NEW.branch_id
  );

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_decision_diferencia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_prod    text;
    v_num     integer;
    v_sala    text;
    v_sala_b  integer;
    v_bodega  integer;
    v_rotulo  text;
    v_titulo  text;
    v_cuerpo  text;
    v_dest    uuid[];
    v_ids     uuid[];
    -- La tarjeta de la campana (24-sep).
    v_quien_id uuid;
    v_dif      jsonb;
    v_op       public.diferencia_opcion;
    v_otras    jsonb;
BEGIN
    SELECT p.numero INTO v_num FROM public.pedidos p WHERE p.id = NEW.pedido_id;
    SELECT pr.nombre INTO v_prod FROM public.products pr WHERE pr.id = NEW.erp_product_id;
    SELECT m.nombre, m.branch_id INTO v_sala, v_sala_b
      FROM public.erp_sucursal_map m WHERE m.erp_sucursal_id = NEW.erp_sucursal_id;
    SELECT m.branch_id INTO v_bodega FROM public.erp_sucursal_map m WHERE m.es_bodega;

    SELECT o.* INTO v_op FROM public.diferencia_opcion o
     WHERE o.error_tipo = NEW.error_tipo AND o.valor = NEW.resolucion_tipo;
    v_rotulo := v_op.rotulo;

    -- Las salidas de este tipo de diferencia, para los botones de la tarjeta:
    -- quien contesta acepta la propuesta o propone la otra (24-sep).
    SELECT jsonb_agg(jsonb_build_object('valor', o.valor, 'rotulo', o.rotulo,
                                        'corto', coalesce(o.rotulo_corto, o.rotulo)) ORDER BY o.orden)
      INTO v_otras
      FROM public.diferencia_opcion o WHERE o.error_tipo = NEW.error_tipo;

    v_prod := coalesce(v_prod, 'un producto');

    IF NEW.resolucion_status = 'propuesta' THEN
        v_titulo := coalesce(v_sala, 'Una sucursal') || ' propone cómo cerrar una diferencia';
        v_quien_id := NEW.resuelto_por;
        v_cuerpo := coalesce(v_sala, 'Una sucursal') || ' propone: ' || coalesce(v_rotulo, '—')
                 || ' · ' || v_prod || ' del pedido #' || coalesce(v_num::text, '?');
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND e.branch_id = v_bodega AND e.id <> coalesce(NEW.resuelto_por, e.id);

    ELSIF NEW.resolucion_status = 'contrapropuesta' THEN
        v_titulo := 'Bodega propone otra salida';
        v_quien_id := coalesce(NEW.rechazado_por, NEW.resuelto_por);
        v_cuerpo := 'Bodega propone: ' || coalesce(v_rotulo, '—')
                 || ' · ' || v_prod || ' del pedido #' || coalesce(v_num::text, '?');
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND e.branch_id = v_sala_b AND e.id <> coalesce(NEW.resuelto_por, e.id);

    ELSIF NEW.resolucion_status = 'escalada' THEN
        v_titulo := coalesce(v_sala, 'Una sucursal') || ' y bodega no se ponen de acuerdo';
        v_quien_id := coalesce(NEW.rechazado_por, NEW.resuelto_por);
        v_cuerpo := coalesce(v_sala, 'Una sucursal') || ' y bodega no coinciden sobre ' || v_prod
                 || ' del pedido #' || coalesce(v_num::text, '?')
                 || coalesce(' — ' || NEW.nota_rechazo, '');
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND public.rango_de_empleado(e.id) >= 3;

    ELSIF NEW.resolucion_status IN ('acordada', 'confirmada') THEN
        v_titulo := coalesce(v_sala || ' · ', '')
                 || CASE WHEN NEW.resolucion_status = 'confirmada'
                         THEN 'Diferencia cerrada' ELSE 'Quedaron de acuerdo' END;
        v_quien_id := CASE WHEN NEW.resolucion_status = 'confirmada'
                           THEN coalesce(NEW.supervisado_por, NEW.confirmado_suc_por)
                           ELSE coalesce(NEW.confirmado_suc_por, NEW.resuelto_por) END;
        v_cuerpo := coalesce(v_rotulo, '—') || ' · ' || v_prod
                 || ' del pedido #' || coalesce(v_num::text, '?');
        -- A las dos partes: el acuerdo le cambia el trabajo a los dos lados.
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND e.branch_id IN (v_sala_b, v_bodega)
           AND e.id <> coalesce(NEW.confirmado_suc_por, NEW.supervisado_por, e.id);
    ELSE
        RETURN NEW;
    END IF;

    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN
        RETURN NEW;
    END IF;

    /* Lo que dibuja la tarjeta (usuario, 24-sep): el producto, qué pasó y en
     * cuánto, la salida que se propone y quién la movió. El número de pedido
     * no va: «no sé qué aporta» (23-sep). */
    v_dif := jsonb_strip_nulls(jsonb_build_object(
        'producto',  v_prod,
        'sala',      v_sala,
        'estado',    NEW.resolucion_status,
        'que',       CASE NEW.error_tipo WHEN 'faltante' THEN 'Faltó'
                                         WHEN 'sobrante' THEN 'Sobró'
                                         WHEN 'otro'     THEN 'Otro problema' END,
        'enviada',   coalesce(NEW.cantidad_enviada, NEW.cantidad_asignada),
        'recibida',  NEW.cantidad_recibida,
        'problema',  NEW.cantidad_problema,
        'salida',    v_rotulo,
        -- «¿Se refiere al sistema?» (usuario, 24-sep): cada salida dice si se
        -- arregla con un traslado o en físico, y qué significa para quien lee.
        'corto',     v_op.rotulo_corto,
        'valor',     NEW.resolucion_tipo,
        'opciones',  v_otras,
        'item_id',   NEW.id,
        'nota',      left(nullif(btrim(CASE WHEN NEW.resolucion_status = 'escalada' THEN NEW.nota_rechazo
                                            ELSE NEW.resolucion_nota END), ''), 200),
        'quien',     (SELECT e.name FROM public.employees e WHERE e.id = v_quien_id),
        'quien_id',  v_quien_id,
        'quien_foto', public.foto_de_empleado(v_quien_id)));

    WITH ins AS (
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'PEDIDO_DIFERENCIA', v_titulo, v_cuerpo, '/pedidos',
           jsonb_build_object('pedido_id', NEW.pedido_id, 'pedido_item_id', NEW.id,
                              'erp_sucursal_id', NEW.erp_sucursal_id, 'estado', NEW.resolucion_status,
                              -- De qué lado lee cada uno, y la explicación
                              -- escrita para ese lado: la misma que muestra
                              -- Pedidos (`ayudaPara`).
                              'diferencia', v_dif || jsonb_strip_nulls(jsonb_build_object(
                                  'lado',  x.lado,
                                  'ayuda', CASE x.lado WHEN 'sala'   THEN coalesce(v_op.ayuda_sala, v_op.ayuda)
                                                       WHEN 'bodega' THEN coalesce(v_op.ayuda_bodega, v_op.ayuda)
                                                       ELSE v_op.ayuda END))),
           v_sala_b, coalesce(NEW.resuelto_por, NEW.confirmado_suc_por)
      FROM unnest(v_dest) d
      LEFT JOIN LATERAL (
          SELECT CASE WHEN public.rango_de_empleado(d) >= 3 THEN 'supervision'
                      WHEN e.branch_id = v_bodega THEN 'bodega'
                      WHEN e.branch_id = v_sala_b THEN 'sala' END AS lado
            FROM public.employees e WHERE e.id = d
      ) x ON true
    RETURNING id)
    SELECT array_agg(id) INTO v_ids FROM ins;

    -- También al teléfono (2026-09-23).
    PERFORM public.push_de_notificaciones(v_ids);

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_envio_despachado(p_request_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r        public.approval_requests%ROWTYPE;
    m        jsonb;
    v_quien  text;
    v_n      integer;
    v_unid   numeric;
    v_que    text;
    v_salidas integer;
    v_ya     integer;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
    -- La tarjeta de la campana (24-sep).
    v_nombre text;
    v_prods  jsonb;
    v_sol    jsonb;
BEGIN
    SELECT * INTO r FROM public.approval_requests WHERE id = p_request_id;
    IF r.id IS NULL OR r.type <> 'INVENTORY_TRANSFER_PUSH' THEN RETURN 0; END IF;

    m := coalesce(r.metadata, '{}'::jsonb);

    -- Cuántos salieron ALGUNA VEZ. Este número sólo crece, así que sirve de
    -- marca de agua contra lo ya anunciado.
    SELECT count(*) INTO v_salidas
      FROM public.envio_linea l
     WHERE l.request_id = p_request_id AND l.enviado_at IS NOT NULL;

    v_ya := coalesce((m->>'avisado_lineas')::integer, 0);
    IF coalesce(v_salidas, 0) <= v_ya THEN RETURN 0; END IF;

    -- Y de ésos, los que esperan que la sala de destino los mire: es de lo que
    -- habla el aviso. Sin ninguno no hay nada que anunciar —salió y ya se
    -- decidió— pero la marca se sube igual, para no anunciarlo más tarde.
    SELECT count(*), coalesce(sum(l.unidades), 0),
           CASE WHEN count(*) = 1 THEN max(coalesce(l.descripcion, 'el producto #' || l.erp_product_id))
                ELSE NULL END
      INTO v_n, v_unid, v_que
      FROM public.envio_linea l
     WHERE l.request_id = p_request_id AND l.estado = 'enviada';

    IF coalesce(v_n, 0) = 0 THEN
        UPDATE public.approval_requests
           SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('avisado_lineas', v_salidas)
         WHERE id = p_request_id;
        RETURN 0;
    END IF;

    SELECT name INTO v_nombre FROM public.employees WHERE id = r.employee_id;
    v_quien := coalesce(v_nombre, 'Otra sucursal');

    -- La sala que envía va en el título, sin emoji (24-sep): el color y el
    -- ícono los pone la tarjeta.
    v_titulo := coalesce(nullif(m->>'origen_branch_name', ''), 'Otra sucursal') || ' te envía producto';
    v_cuerpo := v_quien || ' (' || coalesce(nullif(m->>'origen_branch_name',''), 'otra sucursal') || ') te envía '
             || trim(to_char(v_unid, 'FM999,999,990.####'))
             || CASE WHEN v_unid = 1 THEN ' unidad' ELSE ' unidades' END
             || coalesce(' de ' || v_que,
                         ' de ' || v_n || CASE WHEN v_n = 1 THEN ' producto' ELSE ' productos' END)
             || ' — ' || coalesce(m->>'motivo_tipo', 'sin motivo')
             || coalesce(': ' || left(nullif(btrim(coalesce(m->>'reason', r.note, '')), ''), 120), '')
             || '. Revisa la caja y acepta o devuelve lo que no vayas a vender.';

    v_link := '/traslados?tab=envios&envio=' || r.id;

    /* Lo que dibuja la tarjeta (usuario, 24-sep): quién lo envía con su cara,
     * cada producto que espera respuesta con cuántas unidades, y el motivo.
     * Es la misma tarjeta de las solicitudes (`metadata.solicitud`). */
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'nombre',   coalesce(l.descripcion, 'Producto #' || l.erp_product_id),
               'cantidad', l.unidades)) ORDER BY l.posicion)
      INTO v_prods
      FROM (SELECT * FROM public.envio_linea
             WHERE request_id = p_request_id AND estado = 'enviada'
             ORDER BY posicion LIMIT 15) l;

    v_sol := jsonb_strip_nulls(jsonb_build_object(
        'tipo',       'INVENTORY_TRANSFER_PUSH',
        'etiqueta',   'Envío de producto',
        'quien',      v_nombre,
        'quien_id',   r.employee_id,
        'quien_foto', public.foto_de_empleado(r.employee_id),
        'sala',       nullif(m->>'origen_branch_name', ''),
        'productos',  v_prods,
        'mas',        nullif(greatest(v_n - 15, 0), 0),
        'unidades',   v_unid,
        'motivo',     nullif(concat_ws(': ', nullif(m->>'motivo_tipo', ''),
                              left(nullif(btrim(coalesce(m->>'reason', r.note, '')), ''), 160)), '')));

    SELECT coalesce(
             (SELECT array_agg((d)::uuid) FROM jsonb_array_elements_text(m->'destinatarios') d),
             ARRAY[r.approver_id]) INTO v_dest;
    v_dest := (SELECT array_agg(DISTINCT x) FROM unnest(v_dest) x WHERE x IS NOT NULL AND x <> r.employee_id);
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;

    -- Se anota ANTES de mandar: `pg_net` es transaccional, así que si algo de
    -- acá para abajo revienta, la anotación se va con él y el aviso se puede
    -- volver a intentar.
    UPDATE public.approval_requests
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('avisado_lineas', v_salidas)
     WHERE id = p_request_id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', r.id, 'request_type', r.type, 'solicitud', v_sol),
           nullif(m->>'branch_id','')::integer, r.employee_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        -- La línea corta del teléfono (24-sep).
        body    := jsonb_build_object('title', v_titulo,
                                      'message', public.texto_de_push('REQUEST_PENDING', v_cuerpo, jsonb_build_object('solicitud', v_sol)),
                                      'url', v_link,
                                      'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));

    RETURN coalesce(array_length(v_dest, 1), 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_resolucion_envio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m        jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_org    integer := nullif(m->>'origen_branch_id', '')::integer;
    v_quien  text;
    v_ok     integer;
    v_no     integer;
    v_falta  integer;
    v_lista  text;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
    -- La tarjeta de la campana (24-sep).
    v_nombre text;
    v_sala   text := nullif(m->>'branch_name', '');
    v_devs   jsonb;
    v_resp   jsonb;
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_PUSH' THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;
    -- Ya estaba resuelta: es lo que apareció después de un «no llegó», y ese
    -- aviso lo manda `resolver_envio_aparecido` con su propio texto.
    IF OLD.status <> 'PENDING' THEN RETURN NEW; END IF;
    IF v_org IS NULL THEN RETURN NEW; END IF;
    -- El envío de un sobrante (2026-11-12): no es «tu envío llegó», es «lo de
    -- más se descontó de tu inventario». Lo dice `avisar_sobrante`.
    IF m ? 'sobrante_de' THEN
        PERFORM public.avisar_sobrante(NEW.id);
        RETURN NEW;
    END IF;

    SELECT name INTO v_nombre FROM public.employees WHERE id = NEW.approver_id;
    v_quien := coalesce(v_nombre, coalesce(nullif(m->>'branch_name',''), 'La otra sucursal'));

    SELECT count(*) FILTER (WHERE estado = 'aceptada'),
           count(*) FILTER (WHERE estado IN ('devuelta','devuelta_recibida')),
           count(*) FILTER (WHERE estado = 'no_llego')
      INTO v_ok, v_no, v_falta
      FROM public.envio_linea WHERE request_id = NEW.id;

    -- Sólo faltantes: ya lo dijo `avisar_faltantes`, con el producto y el
    -- enlace. No se repite.
    IF coalesce(v_ok, 0) = 0 AND coalesce(v_no, 0) = 0 AND coalesce(v_falta, 0) > 0 THEN
        RETURN NEW;
    END IF;

    SELECT string_agg(coalesce(descripcion, 'el producto #' || erp_product_id)
                      || ' (' || coalesce(motivo_rechazo, 'sin motivo') || ')', '; ' ORDER BY posicion)
      INTO v_lista
      FROM public.envio_linea
     WHERE request_id = NEW.id AND estado IN ('devuelta','devuelta_recibida');

    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (e.id = NEW.employee_id
            OR (e.branch_id = v_org
                AND (public.rango_de_empleado(e.id) BETWEEN 1 AND 2
                     OR e.id IN (SELECT t.employee_id FROM public.empleados_en_turno(v_org) t))));
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN NEW; END IF;

    IF coalesce(v_no, 0) = 0 THEN
        v_titulo := coalesce(v_sala, 'La otra sucursal') || ' recibió tu traslado';
        v_cuerpo := v_quien || ' aceptó ' || v_ok
                 || CASE WHEN v_ok = 1 THEN ' producto' ELSE ' productos' END || ' de tu traslado.';
    ELSE
        v_titulo := coalesce(v_sala, 'La otra sucursal') || ' te devuelve '
                 || CASE WHEN v_no = 1 THEN 'un producto' ELSE v_no || ' productos' END || ' de tu traslado';
        v_cuerpo := v_quien || ' devuelve ' || v_no
                 || CASE WHEN v_no = 1 THEN ' producto' ELSE ' productos' END
                 || CASE WHEN coalesce(v_ok,0) > 0 THEN ' y se queda con ' || v_ok ELSE '' END
                 || coalesce(': ' || v_lista, '')
                 || '. Confirma cuando la caja esté de vuelta en tu sucursal.';
    END IF;

    -- Lo que no llegó se agrega SIEMPRE al final, en las dos ramas: es el único
    -- dato del aviso que manda a alguien a mirar el mostrador hoy.
    IF coalesce(v_falta, 0) > 0 THEN
        v_cuerpo := v_cuerpo || ' Ojo: ' || v_falta
                 || CASE WHEN v_falta = 1 THEN ' producto no llegó en la caja.'
                         ELSE ' productos no llegaron en la caja.' END
                 || ' Revisa si quedó en tu sucursal.';
    END IF;

    v_link := '/traslados?tab=envios&envio=' || NEW.id;

    -- Lo que dibuja la tarjeta (24-sep): quién lo recibió, cuántos se quedó,
    -- cuáles devuelve y por qué, y cuántos no llegaron.
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'nombre', coalesce(descripcion, 'Producto #' || erp_product_id),
               'motivo', motivo_rechazo)) ORDER BY posicion)
      INTO v_devs
      FROM (SELECT * FROM public.envio_linea
             WHERE request_id = NEW.id AND estado IN ('devuelta','devuelta_recibida')
             ORDER BY posicion LIMIT 15) l;

    v_resp := jsonb_strip_nulls(jsonb_build_object(
        'tipo',        'envio',
        'estado',      CASE WHEN coalesce(v_no, 0) = 0 THEN 'RECIBIDO' ELSE 'DEVUELVE' END,
        'quien',       v_nombre,
        'quien_id',    NEW.approver_id,
        'quien_foto',  public.foto_de_empleado(NEW.approver_id),
        'sala',        v_sala,
        'aceptados',   coalesce(v_ok, 0),
        'devueltos',   v_devs,
        'no_llegaron', nullif(coalesce(v_falta, 0), 0)));

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'resuelta', NEW.status,
                              'respuesta', v_resp),
           v_org, NEW.approver_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        -- La línea corta del teléfono (24-sep).
        body := jsonb_build_object('title', v_titulo,
                'message', public.texto_de_push('REQUEST_RESOLVED', v_cuerpo, jsonb_build_object('respuesta', v_resp)),
                'url', v_link,
                'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_resolucion_movimiento_inventario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m          jsonb := coalesce(NEW.metadata, '{}'::jsonb);
    v_branch   integer := nullif(m->>'branch_id', '')::integer;
    v_quien    text;
    v_titulo   text;
    v_cuerpo   text;
    v_verbo    text;
    v_lineas   integer;
    v_unidades numeric;
    v_dest     uuid[];
    -- Sin cast: un valor raro no puede romper la aprobación, sólo no ensancha.
    v_toda     boolean := coalesce(m->'correccion_de_factor'->>'resto', '') ~ '^-?[1-9][0-9]*$';
BEGIN
    IF NEW.type NOT IN ('INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST') THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;
    IF v_branch IS NULL THEN RETURN NEW; END IF;

    SELECT array_agg(id) INTO v_dest FROM public.employees
     WHERE branch_id = v_branch AND status = 'ACTIVO'
       -- La jefatura, salvo que una corrección de factor haya dejado algo sin
       -- ajustar: entonces toda la sala, porque hay algo que pedir (2026-10-30).
       AND (v_toda OR public.rango_de_empleado(id) BETWEEN 1 AND 2)
       AND id <> NEW.employee_id
       AND (NEW.approver_id IS NULL OR id <> NEW.approver_id);

    -- Una sala sin jefatura activa no es un error: simplemente no hay a quién.
    IF v_dest IS NULL OR array_length(v_dest,1) IS NULL THEN RETURN NEW; END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = NEW.approver_id;
    v_quien    := coalesce(v_quien, 'Supervisión');
    v_verbo    := CASE NEW.status WHEN 'APPROVED' THEN 'aprobó' WHEN 'REJECTED' THEN 'rechazó' ELSE 'canceló' END;
    v_lineas   := coalesce(jsonb_array_length(m->'items'), 0);
    v_unidades := coalesce((m->>'total_unidades')::numeric, 0);

    v_titulo := CASE WHEN NEW.type = 'INVENTORY_LOAD_REQUEST'
                     THEN '📦 Carga ' || CASE NEW.status WHEN 'APPROVED' THEN 'aplicada' ELSE 'no aplicada' END
                     ELSE '🗑️ Descarte ' || CASE NEW.status WHEN 'APPROVED' THEN 'aplicado' ELSE 'no aplicado' END END;

    -- La nota hasta 280 (2026-10-30): la corrección de factor dice ahí lo que
    -- NO se ajustó y qué tiene que pedir la sala; a 140 se cortaba a la mitad.
    v_cuerpo := v_quien || ' ' || v_verbo || ' '
             || v_lineas || CASE WHEN v_lineas = 1 THEN ' producto' ELSE ' productos' END
             || ' (' || trim(to_char(v_unidades,'FM999,999,990.####'))
             || CASE WHEN v_unidades = 1 THEN ' unidad' ELSE ' unidades' END || ')'
             || coalesce(' por ' || nullif(m->>'subtipo',''), '')
             || ' en tu sucursal.'
             || coalesce(' — ' || left(nullif(btrim(NEW.approver_note),''), 280), '');

    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, '/requests?solicitud=' || NEW.id,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'resuelta', NEW.status),
           v_branch, NEW.approver_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo,
                'url', '/requests?solicitud=' || NEW.id,
                'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_resolucion_traslado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m        jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_branch integer := nullif(m->>'branch_id', '')::integer;
    v_quien  text;
    v_que    text;
    v_n      integer;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
    v_motivo text;
    v_alt    text;
    v_parcial jsonb;
    v_falto  text;
    -- La tarjeta de la campana (24-sep): la respuesta como datos.
    v_origen text := nullif(m->>'origen_branch_name', '');
    v_nombre text;
    v_estado text;
    v_prods  jsonb;
    v_resp   jsonb;
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_REQUEST' THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;
    IF v_branch IS NULL THEN RETURN NEW; END IF;

    SELECT name INTO v_nombre FROM public.employees WHERE id = NEW.approver_id;
    v_quien := coalesce(v_nombre, 'La otra sucursal');

    -- Qué se pidió. Con un renglón, su nombre; con varios, cuántos son: la
    -- lista entera no entra en un aviso y el nombre del primero haría creer que
    -- es el único.
    v_n := jsonb_array_length(coalesce(m->'items', '[]'::jsonb));
    v_que := CASE
        WHEN v_n = 1 THEN coalesce(nullif(m->'items'->0->>'descripcion', ''), 'lo que pediste')
        WHEN v_n > 1 THEN v_n || ' productos'
        ELSE 'lo que pediste'
    END;

    -- Quien pidió, más la jefatura y el turno de su sala.
    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (e.id = NEW.employee_id
            OR (e.branch_id = v_branch
                AND (public.rango_de_empleado(e.id) BETWEEN 1 AND 2
                     OR e.id IN (SELECT t.employee_id FROM public.empleados_en_turno(v_branch) t))));
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN NEW; END IF;

    IF NEW.status = 'APPROVED' THEN
        v_parcial := m->'erp_traslado'->'parcial';

        IF v_parcial IS NULL THEN
            v_estado := 'ENVIA';
            v_titulo := coalesce(v_origen, 'La otra sucursal') || ' te lo envía';
            v_cuerpo := v_quien || ' confirmó el traslado de ' || v_que
                     || ' desde ' || coalesce(nullif(m->>'origen_branch_name',''), 'la otra sucursal')
                     || '. Avisa cuando llegue para recibirlo.';
        ELSE
            -- Renglón por renglón, qué salió de lo que se pidió. Los que
            -- quedaron fuera no traen `enviada`: salieron cero.
            SELECT string_agg(
                       coalesce(nullif(x->>'descripcion',''), 'el producto #' || (x->>'erp_product_id'))
                       || ': ' || coalesce(x->>'enviada','0') || ' de ' || coalesce(x->>'pedida','?'),
                       '; ' ORDER BY (x->>'i')::integer)
              INTO v_falto
              FROM (
                  SELECT jsonb_array_elements(coalesce(v_parcial->'ajustados','[]'::jsonb)) AS x
                  UNION ALL
                  SELECT jsonb_array_elements(coalesce(v_parcial->'fuera','[]'::jsonb))
              ) t;

            -- Dónde está lo que faltó. Sólo se ofrece una sala que lo cubra
            -- ENTERO: media sugerencia haría que quien pidió se mueva para nada.
            SELECT string_agg(f.nombre || ' lo tiene ' || d.sala || ' (' || d.unidades || ')', ' · ')
              INTO v_alt
              FROM (
                  SELECT (x->>'erp_product_id')::integer AS prod,
                         coalesce(nullif(x->>'descripcion',''), 'el producto #' || (x->>'erp_product_id')) AS nombre,
                         ((coalesce((x->>'pedida')::numeric, 0) - coalesce((x->>'enviada')::numeric, 0))
                           * coalesce((m->'items'->((x->>'i')::integer)->>'factor')::numeric, 1)) AS unidades
                  FROM (
                      SELECT jsonb_array_elements(coalesce(v_parcial->'ajustados','[]'::jsonb)) AS x
                      UNION ALL
                      SELECT jsonb_array_elements(coalesce(v_parcial->'fuera','[]'::jsonb))
                  ) t
              ) f
              JOIN LATERAL (
                  SELECT coalesce(sm.nombre, 'Sucursal ' || v.erp_sucursal_id) AS sala, v.unidades
                    FROM public.v_inventario_disponible v
                    LEFT JOIN public.erp_sucursal_map sm ON sm.erp_sucursal_id = v.erp_sucursal_id
                   WHERE v.erp_product_id = f.prod
                     AND v.erp_sucursal_id IS DISTINCT FROM nullif(m->>'origen_erp_sucursal_id','')::integer
                     AND v.erp_sucursal_id IS DISTINCT FROM nullif(m->>'erp_sucursal_id','')::integer
                     AND v.unidades >= f.unidades
                   ORDER BY v.unidades DESC
                   LIMIT 1
              ) d ON true;

            v_estado := 'PARTE';
            v_titulo := coalesce(v_origen, 'La otra sucursal') || ' te envía una parte';
            v_cuerpo := coalesce(nullif(m->>'origen_branch_name',''), 'La otra sucursal')
                     || ' no tenía todo: ' || coalesce(v_falto, 'salió menos de lo pedido')
                     || coalesce('. ' || nullif(btrim(coalesce(v_parcial->>'motivo','')), ''), '')
                     || coalesce('. Lo que faltó: ' || v_alt, '')
                     || '. Avisa cuando llegue para recibirlo.';
        END IF;
    ELSE
        v_motivo := nullif(btrim(coalesce(m->>'rejection_reason','')), '');
        -- La sugerencia es el motivo por el que este aviso existe: sin ella,
        -- quien pidió vuelve a empezar de cero — abrir la consulta, buscar el
        -- producto, mirar qué sala lo tiene. El dato ya lo teníamos.
        v_alt := nullif(btrim(coalesce(m->>'sugerencia','')), '');
        v_estado := 'NO';
        v_titulo := coalesce(v_origen, 'La otra sucursal') || ' no te lo puede enviar';
        v_cuerpo := coalesce(nullif(m->>'origen_branch_name',''), 'La otra sucursal')
                 || ' no puede enviar ' || v_que
                 || coalesce(': ' || lower(v_motivo), '')
                 || coalesce('. ' || left(nullif(btrim(NEW.approver_note),''), 120), '')
                 || coalesce(' — ' || v_alt, '');
    END IF;

    v_link := '/requests?solicitud=' || NEW.id;

    /* ── Lo que dibuja la tarjeta (usuario, 24-sep) ─────────────────────────
     * Quién respondió (con su cara), qué se pidió y cuánto sale de cada
     * producto, por qué no, y dónde más hay. El título lleva la sala que
     * responde y ya no lleva emoji: el color lo pone la tarjeta. Los
     * `enviada` salen del mismo `parcial` que arma el cuerpo: los de `fuera`
     * salieron cero, los que no aparecen salieron enteros. */
    BEGIN
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'nombre',  coalesce(nullif(it->>'descripcion', ''), 'Producto #' || (it->>'erp_product_id')),
                   'pedida',  CASE WHEN it->>'cantidad' ~ '^[0-9]+(\.[0-9]+)?$' THEN (it->>'cantidad')::numeric END,
                   'enviada', CASE
                                  WHEN v_estado = 'NO' THEN NULL
                                  WHEN aj.x IS NOT NULL AND aj.x->>'enviada' ~ '^[0-9]+(\.[0-9]+)?$' THEN (aj.x->>'enviada')::numeric
                                  WHEN aj.x IS NOT NULL THEN 0
                                  WHEN it->>'cantidad' ~ '^[0-9]+(\.[0-9]+)?$' THEN (it->>'cantidad')::numeric
                              END,
                   -- El lote que salió, por trazabilidad (2026-11-05).
                   'lotes',   CASE WHEN v_estado <> 'NO'
                                   THEN public.lotes_de_renglon_de_traslado(m, (t.ord - 1)::integer) END)) ORDER BY t.ord)
          INTO v_prods
          FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS t(it, ord)
          LEFT JOIN LATERAL (
              SELECT x FROM (
                  SELECT jsonb_array_elements(coalesce(v_parcial->'ajustados', '[]'::jsonb)) AS x
                  UNION ALL
                  SELECT jsonb_array_elements(coalesce(v_parcial->'fuera', '[]'::jsonb))
              ) p WHERE (p.x->>'i') = (t.ord - 1)::text LIMIT 1
          ) aj ON true
         WHERE t.ord <= 15;
    EXCEPTION WHEN OTHERS THEN
        v_prods := NULL;
    END;

    v_resp := jsonb_strip_nulls(jsonb_build_object(
        'tipo',        'traslado',
        'estado',      v_estado,
        'quien',       v_nombre,
        'quien_id',    NEW.approver_id,
        'quien_foto',  public.foto_de_empleado(NEW.approver_id),
        'origen',      v_origen,
        'productos',   v_prods,
        'mas',         nullif(greatest(v_n - 15, 0), 0),
        'motivo',      CASE WHEN v_estado = 'NO' THEN v_motivo
                            ELSE nullif(btrim(coalesce(v_parcial->>'motivo', '')), '') END,
        'nota',        CASE WHEN v_estado = 'NO' THEN left(nullif(btrim(NEW.approver_note), ''), 200) END,
        'alternativa', v_alt));

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'resuelta', NEW.status,
                              'respuesta', v_resp),
           v_branch, NEW.approver_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        -- La línea corta del teléfono (24-sep).
        body := jsonb_build_object('title', v_titulo,
                'message', public.texto_de_push('REQUEST_RESOLVED', v_cuerpo, jsonb_build_object('respuesta', v_resp)),
                'url', v_link,
                'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_solicitud_creada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m            jsonb := coalesce(NEW.metadata, '{}'::jsonb);
    v_quien      text;
    v_etiqueta   text;
    v_titulo     text;
    v_cuerpo     text;
    v_base       text;
    v_link       text;
    v_monto      text;
    v_motivo     text;
    v_lineas     integer;
    v_unidades   numeric;
    v_donde      text;
    v_que        text;
    v_dest       uuid[];
    v_plata      text;
    v_creditos   integer;
    -- La tarjeta de la campana (24-sep): el mismo aviso en datos, no en prosa.
    v_sala       text;
    v_num        text;
    v_doc        text;
    v_antes      text;
    v_despues    text;
    v_productos  jsonb;
    v_mas        integer;
    v_sol        jsonb;
    v_cliente    text;
    v_fecha      text;
    v_pago       text;
    v_origen_s   integer;
    v_tope       integer := 3;
BEGIN
    IF NEW.status <> 'PENDING' OR NEW.approver_id IS NULL OR NEW.approver_id = NEW.employee_id THEN
        RETURN NEW;
    END IF;

    v_base := CASE WHEN public.es_solicitud_operativa(NEW.type)
                   THEN '/requests' ELSE '/requests-personales' END;

    SELECT name INTO v_quien FROM public.employees WHERE id = NEW.employee_id;
    v_quien := coalesce(v_quien, 'Un empleado');

    v_etiqueta := CASE NEW.type
        WHEN 'ANNULMENT_REQUEST'          THEN 'Anulación de factura'
        WHEN 'PAYMENT_CHANGE_REQUEST'     THEN 'Cambio de forma de pago'
        WHEN 'VENDOR_CHANGE_REQUEST'      THEN 'Cambio de vendedor'
        WHEN 'CLIENT_CHANGE_REQUEST'      THEN 'Cambio de cliente'
        WHEN 'INVENTORY_LOAD_REQUEST'     THEN 'Carga de inventario'
        WHEN 'INVENTORY_DISCARD_REQUEST'  THEN 'Descarte de inventario'
        WHEN 'INVENTORY_TRANSFER_REQUEST' THEN 'Traslado entre salas'
        WHEN 'CAJA_MOVIMIENTO_CHANGE'     THEN 'Corrección de caja'
        WHEN 'ABONO_CREDITO_CHANGE'       THEN 'Corrección de un abono'
        WHEN 'ABONO_APROBACION'           THEN 'Abono por aprobar'
        WHEN 'CAJA_INGRESO_AUTORIZACION'  THEN 'Ingreso sin comprobante'
        WHEN 'INVENTORY_TRANSFER_PUSH'    THEN 'Envío entre salas'
        WHEN 'DIST_DESCUENTO'             THEN 'Descuento en una venta'
        WHEN 'MINMAX_CHANGE_REQUEST'      THEN 'Ajuste de Min/Max'
        WHEN 'PERMIT'                     THEN 'Permiso / licencia'
        WHEN 'VACATION'                   THEN 'Vacaciones'
        WHEN 'VACATION_CHANGE'            THEN 'Cambio de vacaciones'
        WHEN 'SHIFT_CHANGE'               THEN 'Cambio de turno'
        WHEN 'SHIFT_EXCEPTION'            THEN 'Excepción de turno'
        WHEN 'OVERTIME'                   THEN 'Horas extra'
        WHEN 'ADVANCE'                    THEN 'Anticipo salarial'
        WHEN 'CERTIFICATE'                THEN 'Constancia Laboral'
        WHEN 'DISABILITY'                 THEN 'Incapacidad'
        ELSE 'Solicitud'
    END;

    v_monto := CASE
        WHEN m ? 'total' AND (m->>'total') ~ '^-?[0-9.]+$'
        THEN '$' || to_char((m->>'total')::numeric, 'FM999,999,990.00')
        ELSE NULL
    END;

    v_motivo := public.motivo_de_solicitud(m, NEW.note);

    IF NEW.type = 'ANNULMENT_REQUEST' THEN
        v_titulo := 'Anulación de factura';
        v_cuerpo := v_quien || ' solicita anular ' || coalesce(m->>'correlativo', 'una factura')
                 || coalesce(' (' || v_monto || ')', '')
                 || coalesce(' · ' || (m->>'branch_name'), '');

    ELSIF NEW.type = 'PAYMENT_CHANGE_REQUEST' THEN
        v_titulo := 'Cambio de forma de pago';
        v_cuerpo := v_quien || ' solicita cambiar el pago de ' || coalesce(m->>'correlativo', 'una factura')
                 || ': ' || coalesce(m->>'current_pago', '—') || ' → ' || coalesce(m->>'new_pago', '—')
                 || coalesce(' (' || v_monto || ')', '');

    ELSIF NEW.type = 'VENDOR_CHANGE_REQUEST' THEN
        v_titulo := 'Cambio de vendedor';
        v_cuerpo := v_quien || ' solicita reasignar ' || coalesce(m->>'correlativo', 'una factura')
                 || ' a ' || coalesce(m->>'new_vendor_name', 'otro vendedor')
                 || coalesce(' (' || v_monto || ')', '');

    ELSIF NEW.type = 'CLIENT_CHANGE_REQUEST' THEN
        v_titulo := 'Cambio de cliente';
        v_cuerpo := v_quien || ' solicita cambiar el cliente de ' || coalesce(m->>'correlativo', 'una factura')
                 || ': ' || coalesce(nullif(m->>'current_cliente', ''), 'Sin nombre')
                 || ' → ' || coalesce(m->>'new_client_name', '—');

    /* ── Las tres del dinero ─────────────────────────────────────────────── */
    ELSIF NEW.type = 'CAJA_MOVIMIENTO_CHANGE' THEN
        v_plata := coalesce('$' || to_char(nullif(m->>'monto_actual','')::numeric, 'FM999,999,990.00'), 'un movimiento');
        v_titulo := 'Corrección de caja';
        v_cuerpo := v_quien || ' pide '
                 || CASE WHEN m->>'que' = 'ANULAR'
                         THEN 'anular ' || v_plata || ' de la caja'
                         ELSE 'dejar ' || v_plata || ' en $'
                              || coalesce(to_char(nullif(m->>'monto_nuevo','')::numeric, 'FM999,999,990.00'), '—') END
                 || coalesce(' · ' || nullif(m->>'concepto',''), '') || '.';

    ELSIF NEW.type = 'ABONO_CREDITO_CHANGE' THEN
        v_plata := coalesce('$' || to_char(nullif(m->>'monto_actual','')::numeric, 'FM999,999,990.00'), 'un abono');
        v_titulo := 'Corrección de un abono';
        v_cuerpo := v_quien || ' pide '
                 || CASE m->>'que'
                      WHEN 'ANULAR' THEN 'anular el abono de ' || v_plata
                      WHEN 'MONTO'  THEN 'cambiar el abono de ' || v_plata || ' a $'
                                       || coalesce(to_char(nullif(m->>'monto_nuevo','')::numeric, 'FM999,999,990.00'), '—')
                      ELSE 'cambiar a ' || coalesce(nullif(m->>'forma_nueva',''), 'otra forma')
                           || ' el abono de ' || v_plata
                    END
                 || coalesce(' de ' || nullif(m->>'cliente',''), '') || '.';

    ELSIF NEW.type = 'ABONO_APROBACION' THEN
        v_plata := coalesce('$' || to_char(nullif(m->>'monto','')::numeric, 'FM999,999,990.00'), 'un abono');
        v_creditos := coalesce(jsonb_array_length(m->'creditos'), 0);
        v_titulo := 'Abono por confirmar';
        v_cuerpo := v_quien || ' cobró ' || v_plata
                 || coalesce(' de ' || nullif(m->>'cliente',''), '')
                 || coalesce(' con ' || lower(nullif(m->>'forma','')), '')
                 || CASE WHEN v_creditos > 1
                         THEN ' en ' || v_creditos || ' créditos' ELSE '' END
                 || '. Ya entró; falta que lo revises.';

    ELSIF NEW.type = 'CAJA_INGRESO_AUTORIZACION' THEN
        v_plata := coalesce('$' || to_char(nullif(m->>'monto','')::numeric, 'FM999,999,990.00'), 'un ingreso');
        v_titulo := 'Ingreso sin comprobante';
        v_cuerpo := v_quien || ' anotó ' || v_plata
                 || coalesce(' con ' || lower(nullif(m->>'forma_pago','')), '')
                 || ' sin foto del comprobante'
                 || coalesce(' · ' || nullif(m->>'concepto',''), '') || '.';

    ELSIF NEW.type = 'INVENTORY_TRANSFER_REQUEST' THEN
        v_lineas   := coalesce(jsonb_array_length(m->'items'), 0);
        v_unidades := coalesce((m->>'total_unidades')::numeric, 0);
        v_donde    := coalesce(nullif(m->>'branch_name', ''), 'otra sucursal');
        v_que := CASE WHEN v_lineas = 1
                      THEN nullif(btrim(coalesce(m->'items'->0->>'descripcion', '')), '')
                      ELSE NULL END;

        v_titulo := '🔄 Te piden un traslado';
        v_cuerpo := v_quien || ' (' || v_donde || ') pide '
                 || trim(to_char(v_unidades, 'FM999,999,990.####'))
                 || CASE WHEN v_unidades = 1 THEN ' unidad' ELSE ' unidades' END
                 || coalesce(' de ' || v_que,
                             ' de ' || v_lineas || CASE WHEN v_lineas = 1 THEN ' producto' ELSE ' productos' END)
                 || ' de tu sucursal.';

    ELSIF NEW.type IN ('INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST') THEN
        v_lineas   := coalesce(jsonb_array_length(m->'items'), 0);
        v_unidades := coalesce((m->>'total_unidades')::numeric, 0);
        v_donde    := coalesce(nullif(m->>'branch_name', ''), 'una sucursal');
        v_que := CASE WHEN v_lineas = 1
                      THEN nullif(btrim(coalesce(m->'items'->0->>'descripcion', '')), '')
                      ELSE NULL END;

        IF NEW.type = 'INVENTORY_LOAD_REQUEST' THEN
            v_titulo := 'Carga de inventario';
            v_cuerpo := v_quien || ' solicita cargar ';
        ELSE
            v_titulo := 'Descarte de inventario';
            v_cuerpo := v_quien || ' solicita descartar ';
        END IF;

        v_cuerpo := v_cuerpo
                 || trim(to_char(v_unidades, 'FM999,999,990.####'))
                 || CASE WHEN v_unidades = 1 THEN ' unidad' ELSE ' unidades' END
                 || coalesce(' de ' || v_que,
                             ' en ' || v_lineas || CASE WHEN v_lineas = 1 THEN ' producto' ELSE ' productos' END)
                 || coalesce(' (' || v_monto || ')', '')
                 || coalesce(' por ' || nullif(m->>'subtipo', ''), '')
                 || ' en ' || v_donde;

    ELSIF NEW.type = 'SHIFT_CHANGE' AND NEW.current_level = 1 THEN
        v_titulo := 'Cambio de turno propuesto';
        v_cuerpo := v_quien || ' te propone un cambio de turno'
                 || coalesce(' para el ' || (m->>'date'), '') || '. Requiere tu aprobación.';

    ELSE
        v_titulo := v_etiqueta || ' por aprobar';
        v_cuerpo := v_etiqueta || ' de ' || v_quien || ': espera tu decisión.';
    END IF;

    IF v_motivo IS NOT NULL THEN
        v_cuerpo := v_cuerpo || ' — ' || left(v_motivo, 140);
    END IF;

    v_link := v_base || '?solicitud=' || NEW.id;

    /* ── Lo que dibuja la tarjeta de la campana (usuario, 24-sep) ───────────
     * Los mismos datos del cuerpo, pero como datos: quién (con su foto), la
     * sala, el documento con su número legible («Factura N.º 74092» y no
     * «0000074092_COF»), el monto, qué cambia (antes → después), los productos y
     * el motivo. El título lleva la sala delante y ya no lleva emoji: el color
     * lo pone la tarjeta. */
    v_sala := coalesce(nullif(m->>'branch_name', ''),
                       (SELECT b.name FROM public.branches b WHERE b.id = nullif(m->>'branch_id', '')::integer));
    IF NEW.type = 'INVENTORY_TRANSFER_REQUEST' THEN
        v_titulo := coalesce(v_sala, 'Otra sucursal') || ' te pide un traslado';
    ELSIF v_sala IS NOT NULL AND NOT (NEW.type = 'SHIFT_CHANGE' AND NEW.current_level = 1) THEN
        v_titulo := v_sala || ' · ' || v_titulo;
    END IF;

    v_num := nullif(regexp_replace(regexp_replace(coalesce(m->>'correlativo', ''), '_.*$', ''), '^0+(?=[0-9])', ''), '');
    -- El TIPO de documento, que es lo que se mira; el número no (24-sep: «el
    -- n.º de factura no es relevante en esa vista»).
    v_doc := CASE WHEN m->>'tipo_documento' = 'CCF' OR m->>'correlativo' LIKE '%\_CCF' THEN 'Crédito fiscal'
                  WHEN m->>'tipo_documento' = 'COF' OR m->>'correlativo' IS NOT NULL THEN 'Consumidor final' END;

    -- La factura: de qué fecha y a nombre de quién (24-sep).
    IF nullif(m->>'invoice_id', '') ~ '^[0-9]+$' THEN
        SELECT si.cliente, si.fecha::text, si.tipo_pago INTO v_cliente, v_fecha, v_pago
          FROM public.sales_invoices si WHERE si.id = (m->>'invoice_id')::bigint;
    END IF;
    v_fecha := coalesce(nullif(m->>'fecha', ''), v_fecha);

    v_antes := CASE NEW.type
        WHEN 'PAYMENT_CHANGE_REQUEST' THEN m->>'current_pago'
        WHEN 'CLIENT_CHANGE_REQUEST'  THEN coalesce(nullif(m->>'current_cliente', ''), 'Sin nombre')
        WHEN 'CAJA_MOVIMIENTO_CHANGE' THEN '$' || to_char(nullif(m->>'monto_actual','')::numeric, 'FM999,999,990.00')
        WHEN 'ABONO_CREDITO_CHANGE'   THEN '$' || to_char(nullif(m->>'monto_actual','')::numeric, 'FM999,999,990.00')
        END;
    v_despues := CASE NEW.type
        WHEN 'PAYMENT_CHANGE_REQUEST' THEN m->>'new_pago'
        WHEN 'VENDOR_CHANGE_REQUEST'  THEN m->>'new_vendor_name'
        WHEN 'CLIENT_CHANGE_REQUEST'  THEN m->>'new_client_name'
        WHEN 'CAJA_MOVIMIENTO_CHANGE' THEN CASE WHEN m->>'que' = 'ANULAR' THEN 'Anular'
                                                ELSE '$' || to_char(nullif(m->>'monto_nuevo','')::numeric, 'FM999,999,990.00') END
        WHEN 'ABONO_CREDITO_CHANGE'   THEN CASE m->>'que' WHEN 'ANULAR' THEN 'Anular'
                                                WHEN 'MONTO' THEN '$' || to_char(nullif(m->>'monto_nuevo','')::numeric, 'FM999,999,990.00')
                                                ELSE nullif(m->>'forma_nueva', '') END
        END;

    -- En un traslado, de cada producto: cuántas hay en la sala a la que se lo
    -- piden (24-sep: «no dice cuántas tengo en inventario»). Las ventas se
    -- mostraron un rato y se quitaron el mismo día: «solo deja lo que
    -- solicitan, el producto, cantidad y cuánto en inventario».
    IF NEW.type = 'INVENTORY_TRANSFER_REQUEST' THEN
        v_origen_s := CASE WHEN m->>'origen_erp_sucursal_id' ~ '^[0-9]+$' THEN (m->>'origen_erp_sucursal_id')::integer END;
        -- Todos los productos, no tres: se aprueba desde la tarjeta, así que
        -- tiene que poder verse la lista entera («Ver los N productos»). 15 de
        -- tope: ~22 ms por producto, y en 60 días el más largo tuvo 8.
        v_tope := 15;
    END IF;

    BEGIN
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'nombre', i->>'descripcion',
                   'cantidad', CASE WHEN i->>'cantidad' ~ '^[0-9]+(\.[0-9]+)?$' THEN (i->>'cantidad')::numeric END,
                   'existencia', CASE WHEN v_origen_s IS NOT NULL AND i->>'erp_product_id' ~ '^[0-9]+$'
                                      THEN (public.get_minmax_contexto_producto((i->>'erp_product_id')::integer, v_origen_s)->>'existencia')::numeric END,
                   -- El lote de cada producto, por trazabilidad (2026-11-05).
                   'lotes', CASE WHEN NEW.type IN ('INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH')
                                 THEN public.lotes_de_renglon_de_traslado(m, (x.ord - 1)::integer) END)))
          INTO v_productos
          FROM (SELECT i, ord FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS e(i, ord) LIMIT v_tope) x;
    EXCEPTION WHEN OTHERS THEN
        -- Sin las cifras, la solicitud y su aviso salen igual.
        SELECT jsonb_agg(jsonb_build_object('nombre', i->>'descripcion'))
          INTO v_productos
          FROM (SELECT i FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) i LIMIT v_tope) x;
    END;
    v_mas := greatest(coalesce(jsonb_array_length(m->'items'), 0) - v_tope, 0);

    v_sol := jsonb_strip_nulls(jsonb_build_object(
        'tipo',      NEW.type,
        'etiqueta',  v_etiqueta,
        'quien',     v_quien,
        'quien_id',  NEW.employee_id,
        'quien_foto', public.foto_de_empleado(NEW.employee_id),
        'sala',      v_sala,
        'origen',    nullif(m->>'origen_branch_name', ''),
        'doc',       v_doc,
        'numero',    v_num,
        -- Sólo si es un número: un valor raro no puede tumbar la solicitud.
        'monto',     CASE WHEN m->>'total' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (m->>'total')::numeric
                          WHEN m->>'monto' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (m->>'monto')::numeric END,
        'antes',     v_antes,
        'despues',   v_despues,
        'cliente',   coalesce(nullif(m->>'cliente', ''), nullif(btrim(v_cliente), '')),
        'fecha',     v_fecha,
        -- En el cambio de pago ya lo dicen `antes`/`despues`.
        'pago',      CASE WHEN NEW.type <> 'PAYMENT_CHANGE_REQUEST'
                          THEN coalesce(nullif(m->>'tipo_pago', ''), lower(nullif(m->>'forma_pago', '')), v_pago) END,
        'productos', v_productos,
        'mas',       nullif(v_mas, 0),
        'unidades',  CASE WHEN m->>'total_unidades' ~ '^[0-9]+(\.[0-9]+)?$' THEN (m->>'total_unidades')::numeric END,
        'subtipo',   nullif(m->>'subtipo', ''),
        'creditos',  nullif(coalesce(jsonb_array_length(m->'creditos'), 0), 0),
        'desde',     coalesce(m->>'startDate', m->>'date'),
        'hasta',     m->>'endDate',
        'motivo',    left(v_motivo, 200)));

    SELECT coalesce(
             (SELECT array_agg((d)::uuid) FROM jsonb_array_elements_text(m->'destinatarios') d),
             (SELECT array_agg(DISTINCT s.x) FROM (SELECT NEW.approver_id AS x UNION SELECT e.id FROM public.employees e WHERE e.status = 'ACTIVO' AND public.puede_aprobar_modulo(e.id, public.modulo_de_notificacion(NEW.type))) s WHERE s.x IS NOT NULL AND s.x <> NEW.employee_id), ARRAY[NEW.approver_id])
      INTO v_dest;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'correlativo', m->>'correlativo',
                              'solicitud', v_sol),
           nullif(m->>'branch_id', '')::integer,
           NEW.employee_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object(
            'title', v_titulo,
            -- La línea corta del teléfono (24-sep).
            'message', public.texto_de_push('REQUEST_PENDING', v_cuerpo, jsonb_build_object('solicitud', v_sol)),
            'url', v_link,
            'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)
        )
    );

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_solicitud_minmax()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dest    uuid[];
    v_suc     text;
    v_cuerpo  text;
    v_ctx     json;
    v_extra   json;
BEGIN
    IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

    v_dest := ARRAY(SELECT x FROM unnest(public.get_minmax_approver_ids()) AS x WHERE x IS DISTINCT FROM NEW.requested_by_id);
    IF v_dest IS NULL OR array_length(v_dest, 1) IS NULL THEN
        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
        VALUES ('MINMAX_SIN_APROBADOR', NEW.id::text, 'Sistema', 'SYSTEM', 'WARNING',
                jsonb_build_object('producto', NEW.product_name,
                                   'motivo', 'get_minmax_approver_ids() no devolvió a nadie'));
        RETURN NEW;
    END IF;

    SELECT nombre INTO v_suc
      FROM public.erp_sucursal_map
     WHERE erp_sucursal_id = NEW.erp_sucursal_id;

    -- Ventas de los 6 meses cerrados, presentaciones y despacho: la misma
    -- respuesta que ve el detalle de la solicitud (24 y 26-sep). El mes en curso
    -- y la existencia salen de `get_minmax_contexto_producto`. Si algo falla, el
    -- aviso sale igual sin esto: la solicitud no puede caerse por un dato de
    -- contexto.
    BEGIN
        v_extra := public.contexto_de_solicitud_minmax(NEW.erp_product_id, NEW.erp_sucursal_id);
        v_ctx   := public.get_minmax_contexto_producto(NEW.erp_product_id, NEW.erp_sucursal_id);
    EXCEPTION WHEN OTHERS THEN
        v_extra := NULL;
        v_ctx   := NULL;
    END;

    v_cuerpo := coalesce(NEW.requested_by_name, 'Un empleado')
             || ' propone Mín ' || NEW.requested_min || ' · Máx ' || NEW.requested_max
             || ' para ' || coalesce(NEW.product_name, 'un producto')
             || coalesce(' (' || v_suc || ')', '')
             || '. Hoy está en Mín ' || coalesce(NEW.current_min::text, '—')
             || ' · Máx ' || coalesce(NEW.current_max::text, '—')
             || coalesce(' — ' || left(nullif(btrim(NEW.reason), ''), 140), '');

    PERFORM public.notify_employees(
        -- Título corto con la sala; lo demás lo dibuja la tarjeta (23-sep).
        v_dest, 'MINMAX_PENDING', 'Ajuste de Mín/Máx' || coalesce(' · ' || v_suc, ''), v_cuerpo,
        '/requests?solicitud=minmax:' || NEW.id,
        jsonb_build_object('request_id', NEW.id, 'request_type', 'MINMAX',
                           'producto', NEW.product_name,
                           -- Lo que dibuja la tarjeta de la campana.
                           'sala',      v_suc,
                           'quien',     NEW.requested_by_name,
                           'quien_id',  NEW.requested_by_id,
                           'quien_foto', public.foto_de_empleado(NEW.requested_by_id),
                           'ventas_meses',     v_extra->'ventas_meses',
                           'ventas_mes_curso', (v_ctx->>'unidades_mes')::numeric,
                           'existencia',       (v_ctx->>'existencia')::numeric,
                           'presentaciones',   v_extra->'presentaciones',
                           'despacho',         v_extra->'despacho',
                           'min_hoy',   NEW.current_min,
                           'max_hoy',   NEW.current_max,
                           'min_nuevo', NEW.requested_min,
                           'max_nuevo', NEW.requested_max,
                           'motivo',    left(nullif(btrim(NEW.reason), ''), 140)),
        true, NULL
    );

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_missing_roster()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_lunes      date := CURRENT_DATE + 2;
  v_detalle    text;
  v_total      integer;
  v_th_ids     uuid[];
BEGIN
  -- Personas EN PLANILLA sin horario para la semana entrante, agrupadas por
  -- sala. Antes esto era un `count(*)` sobre toda la empresa, así que un solo
  -- horario cargado en cualquier sala apagaba el aviso para todas.
  SELECT string_agg(x.linea, E'\n' ORDER BY x.sala),
         sum(x.faltan)
    INTO v_detalle, v_total
  FROM (
    SELECT b.name AS sala,
           count(*) FILTER (WHERE r.id IS NULL) AS faltan,
           '• ' || b.name || ': ' || count(*) FILTER (WHERE r.id IS NULL) ||
             ' de ' || count(*) || ' sin horario' AS linea
    FROM public.branches b
    JOIN public.employees e
      ON e.branch_id = b.id
     AND e.status = 'ACTIVO'
     AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
    LEFT JOIN public.employee_rosters r
      ON r.employee_id = e.id
     AND r.week_start_date = v_lunes
    GROUP BY b.id, b.name
    HAVING count(*) FILTER (WHERE r.id IS NULL) > 0
  ) x;

  IF v_total IS NULL OR v_total = 0 THEN RETURN; END IF;

  SELECT ARRAY_AGG(id) INTO v_th_ids
  FROM public.employees
  WHERE role_id = 11 AND status = 'ACTIVO';

  IF v_th_ids IS NULL THEN RETURN; END IF;

  PERFORM public.notify_employees(
    v_th_ids,
    'SYSTEM',
    'Faltan horarios para la semana del ' || to_char(v_lunes, 'DD/MM/YYYY'),
    v_total || ' persona(s) todavía no tienen horario para esa semana:' || E'\n\n' ||
      v_detalle || E'\n\n' ||
      'Si no se cargan antes del lunes, el reloj de la sucursal usa el horario de la semana anterior.',
    '/horarios',
    jsonb_build_object('source', 'cron-roster-check', 'next_week_start', v_lunes::text,
                       'faltan', v_total, 'triggered_at', now()::text),
    true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.pedir_dato_a_la_sala(p_customer_id bigint, p_campo text DEFAULT 'email'::text, p_motivo_mh text DEFAULT NULL::text, p_valor_actual text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cliente  text;
  v_invoice  bigint;
  v_branch   bigint;
  v_sala     text;
  v_corr     text;
  v_id       uuid;
  v_avisados integer := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     AND NOT (SELECT public.auth_has_module_permission('facturacion','can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN: sin permiso para pedir datos de facturacion';
  END IF;

  SELECT c.name INTO v_cliente FROM public.customers c WHERE c.id = p_customer_id;
  IF v_cliente IS NULL THEN RAISE EXCEPTION 'CLIENTE_NO_EXISTE'; END IF;

  -- La sucursal donde se EMITIÓ el documento — no una «sucursal del cliente»,
  -- que no existe: un cliente compra en varias salas y la que puede averiguar el
  -- correo es la que lo tuvo enfrente.
  SELECT si.id, si.branch_id, si.correlativo INTO v_invoice, v_branch, v_corr
    FROM public.sales_invoices si
   WHERE si.customer_id = p_customer_id
     AND length(si.recibido_mh) IS DISTINCT FROM 40
     AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
   ORDER BY si.fecha DESC, si.hora DESC
   LIMIT 1;

  IF v_invoice IS NULL THEN
    RETURN json_build_object('ok', false, 'avisados', 0,
                             'motivo', 'sin documento pendiente que ubique la sucursal');
  END IF;
  SELECT b.name INTO v_sala FROM public.branches b WHERE b.id = v_branch;

  -- Un solo pedido vivo. Si ya hay uno, no se duplica ni se vuelve a avisar: la
  -- corrida detecta el mismo caso cada noche, y un aviso por persona por noche
  -- sobre lo mismo es cómo se enseña a no mirar la campana.
  SELECT p.id INTO v_id FROM public.dte_datos_pedidos p
   WHERE p.customer_id = p_customer_id AND p.campo = p_campo AND p.estado = 'PENDIENTE';
  IF v_id IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'pedido_id', v_id, 'avisados', 0,
                             'motivo', 'ya habia un pedido abierto');
  END IF;

  INSERT INTO public.dte_datos_pedidos
      (invoice_id, customer_id, branch_id, campo, motivo_mh, valor_actual, correlativo)
  VALUES (v_invoice, p_customer_id, v_branch, p_campo, p_motivo_mh, p_valor_actual, v_corr)
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id)
  SELECT e.id, 'DTE_DATO_PEDIDO',
         'Falta el correo de un cliente',
         'La venta ' || coalesce(nullif(btrim(v_corr), ''), 'de ' || v_sala) ||
         ' no se puede completar: el correo de «' || v_cliente || '» no es válido. ' ||
         'Escribe el correo correcto desde Inicio y el portal termina el resto.',
         '/',
         jsonb_build_object('pedido_id', v_id, 'customer_id', p_customer_id,
                            'cliente', v_cliente, 'correlativo', v_corr,
                            'sala', v_sala, 'motivo_mh', p_motivo_mh),
         v_branch
    FROM public.employees e
   WHERE e.branch_id = v_branch AND e.status = 'ACTIVO';

  GET DIAGNOSTICS v_avisados = ROW_COUNT;

  -- Cero destinatarios NO es un éxito: el pedido no le llegó a nadie y el
  -- documento se queda trabado sin que nadie lo sepa.
  IF v_avisados = 0 THEN
    RETURN json_build_object('ok', false, 'pedido_id', v_id, 'avisados', 0,
                             'sala', v_sala, 'motivo', 'la sucursal no tiene a nadie activo');
  END IF;

  RETURN json_build_object('ok', true, 'pedido_id', v_id, 'avisados', v_avisados,
                           'sala', v_sala, 'correlativo', v_corr);
END;
$function$;

CREATE OR REPLACE FUNCTION public.planificar_traslado_pedido(p_pedido_id uuid, p_sucursal_id integer, p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_numero    integer;
    v_suc       text;
    v_nuevas    integer;
    v_chequeo   jsonb;
BEGIN
    SELECT numero INTO v_numero FROM pedidos WHERE id = p_pedido_id;
    IF v_numero IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado.';
    END IF;

    -- El código de la sala, del registro. Si falta, se para acá: es preferible
    -- no despachar a escribir en el kardex una clave que nadie puede leer.
    SELECT codigo INTO v_suc FROM erp_sucursal_map WHERE erp_sucursal_id = p_sucursal_id;
    IF v_suc IS NULL THEN
        RAISE EXCEPTION 'SALA_SIN_CODIGO: la sucursal % no tiene código en el registro de sucursales', p_sucursal_id;
    END IF;

    v_chequeo := verificar_hojas_pedido(p_pedido_id, p_sucursal_id);
    IF NOT (v_chequeo->>'confiables')::boolean THEN
        RAISE EXCEPTION 'HOJAS_NO_CONFIABLES: %', v_chequeo->>'motivo';
    END IF;

    WITH desde_items AS (
        SELECT (jsonb_array_elements_text(v.value))::integer AS pedido_item_id,
               (v.key)::integer AS hoja
        FROM pedido_sucursal_status pss
        CROSS JOIN LATERAL jsonb_each(coalesce(pss.pagina_items, '{}'::jsonb)) AS v(key, value)
        WHERE pss.pedido_id = p_pedido_id AND pss.erp_sucursal_id = p_sucursal_id
    ),
    desde_paginas AS (
        SELECT (jsonb_array_elements_text(pg.val -> 'ids'))::integer AS pedido_item_id,
               (pg.ord)::integer AS hoja
        FROM pedido_sucursal_status pss
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(pss.paginas, '[]'::jsonb))
             WITH ORDINALITY AS pg(val, ord)
        WHERE pss.pedido_id = p_pedido_id AND pss.erp_sucursal_id = p_sucursal_id
    ),
    mapa AS (
        SELECT pedido_item_id, hoja FROM desde_items
        UNION
        SELECT pedido_item_id, hoja FROM desde_paginas
        WHERE NOT EXISTS (SELECT 1 FROM desde_items)
    ),
    candidatos AS (
        SELECT pi.id, pi.erp_product_id, m.hoja,
               COALESCE(pi.cantidad_enviada, pi.cantidad_asignada) AS cantidad,
               es_despacho_adicional(pi.caja_especial, pi.dispatch_tipo,
                                     dr.dispatch_label IS NOT NULL) AS adicional
        FROM pedido_items pi
        LEFT JOIN mapa m ON m.pedido_item_id = pi.id
        LEFT JOIN dispatch_rules dr ON dr.erp_product_id = pi.erp_product_id
        WHERE pi.pedido_id       = p_pedido_id
          AND pi.erp_sucursal_id = p_sucursal_id
          AND NOT pi.sin_stock
          AND pi.status <> 'no_enviado'
          AND COALESCE(pi.cantidad_enviada, pi.cantidad_asignada) > 0
    )
    INSERT INTO pedido_traslado_linea
        (run_id, pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id, hoja, cantidad,
         clave, estado, error_msg, aviso)
    SELECT p_run_id, p_pedido_id, p_sucursal_id, c.id, c.erp_product_id, c.hoja, c.cantidad,
           'P' || v_numero || '-' || v_suc || '-'
             || CASE WHEN c.adicional        THEN 'CE'
                     WHEN c.hoja IS NOT NULL THEN 'H' || c.hoja::text
                     ELSE 'H0' END
             || '-I' || c.id,
           -- El adicional NO tiene hoja y SÍ se despacha: viaja en el bloque de
           -- cajas adicionales del PDF.
           CASE WHEN c.hoja IS NULL AND NOT c.adicional THEN 'omitida' ELSE 'planificada' END,
           CASE WHEN c.hoja IS NULL AND NOT c.adicional
                THEN 'No salió en ninguna hoja del despacho, así que no se levantó de bodega.'
                ELSE NULL END,
           CASE WHEN c.adicional
                THEN 'Viaja en las cajas adicionales (E1, E2…), no en una hoja numerada.'
                ELSE NULL END
    FROM candidatos c
    ON CONFLICT (pedido_id, erp_sucursal_id, pedido_item_id) DO NOTHING;

    GET DIAGNOSTICS v_nuevas = ROW_COUNT;

    -- Sólo se cierra lo que de verdad no se levantó — nunca un adicional.
    UPDATE pedido_items pi
    SET status           = 'no_enviado',
        cantidad_enviada = 0,
        cantidad_recibida = 0,
        motivo_no_envio  = 'No salió en ninguna hoja del despacho: lo asignado es menos de una '
                        || 'unidad de despacho, así que no se imprimió y nadie lo levantó.'
    FROM pedido_traslado_linea l
    WHERE l.pedido_item_id  = pi.id
      AND l.pedido_id       = p_pedido_id
      AND l.erp_sucursal_id = p_sucursal_id
      AND l.estado          = 'omitida'
      AND pi.status         = 'pendiente';

    RETURN (
        SELECT jsonb_build_object(
            'nuevas',        v_nuevas,
            'total',         count(*),
            'por_despachar', count(*) FILTER (WHERE estado IN ('planificada', 'enviando')),
            'enviadas',      count(*) FILTER (WHERE estado = 'enviada'),
            'omitidas',      count(*) FILTER (WHERE estado = 'omitida'),
            'adicionales',   count(*) FILTER (WHERE aviso IS NOT NULL AND hoja IS NULL),
            'con_error',     count(*) FILTER (WHERE estado = 'error'),
            'hojas',         count(DISTINCT hoja),
            'chequeo_hojas', v_chequeo
        )
        FROM pedido_traslado_linea
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.preventa_preparar(p_employee uuid, p_reservas bigint[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  e public.employees;
  v_branch bigint; v_branch2 bigint; v_customer bigint; v_customer2 bigint; v_n int; v_id bigint; v_erp int;
  v_todas boolean; v_puede boolean; v_ref text;
  r record;
BEGIN
  SELECT * INTO e FROM public.employees WHERE id = p_employee AND status = 'ACTIVO';
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_reservas IS NULL OR cardinality(p_reservas) = 0 THEN RAISE EXCEPTION 'No se dijo qué reserva.'; END IF;

  PERFORM 1 FROM public.app_reservas WHERE id = ANY (p_reservas) ORDER BY id FOR UPDATE;
  SELECT count(*), min(branch_id), max(branch_id), min(customer_id), max(customer_id)
    INTO v_n, v_branch, v_branch2, v_customer, v_customer2
    FROM public.app_reservas WHERE id = ANY (p_reservas);
  IF v_n <> cardinality(p_reservas) THEN RAISE EXCEPTION 'Una de esas reservas no existe.'; END IF;
  IF v_branch <> v_branch2 THEN RAISE EXCEPTION 'Esas reservas son de sucursales distintas.'; END IF;
  IF v_customer <> v_customer2 THEN RAISE EXCEPTION 'Esas reservas son de clientes distintos.'; END IF;

  SELECT bool_or(rp.can_edit), bool_or(rp.can_edit AND rp.scope = 'ALL')
    INTO v_puede, v_todas
    FROM public.role_permissions rp
   WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id)) AND rp.module_key = 'reservas';
  IF NOT coalesce(v_puede, false) OR NOT (coalesce(v_todas, false) OR coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = v_branch) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  FOR r IN SELECT a.*, pv.estado AS pv_estado, pv.externo_ref AS pv_ref, pv.created_at AS pv_at
             FROM public.app_reservas a LEFT JOIN public.preventas pv ON pv.id = a.preventa_id
            WHERE a.id = ANY (p_reservas) LOOP
    IF r.estado NOT IN ('pendiente', 'lista') THEN
      RAISE EXCEPTION 'La reserva R-% ya no está abierta.', lpad(r.id::text, 6, '0');
    END IF;
    IF r.origen = 'app' AND r.bajo_receta AND r.receta_estado IS DISTINCT FROM 'aprobada' THEN
      RAISE EXCEPTION 'La receta de la reserva R-% todavía no está aprobada.', lpad(r.id::text, 6, '0');
    END IF;
    IF r.producto_id IS NULL OR r.producto_id <= 0 THEN
      RAISE EXCEPTION '«%» no es un producto del catálogo: no se puede mandar a la caja.', r.producto_nombre;
    END IF;
    IF r.pv_estado IN ('viva', 'sin_enlace', 'facturada')
       OR (r.pv_estado = 'enviando' AND r.pv_at > now() - interval '5 minutes') THEN
      RAISE EXCEPTION 'La reserva R-% ya tiene una preventa en la caja%.', lpad(r.id::text, 6, '0'),
        coalesce(' (#' || r.pv_ref || ')', '');
    END IF;
  END LOOP;

  SELECT erp_sucursal_id INTO v_erp FROM public.erp_sucursal_map WHERE branch_id = v_branch AND NOT es_bodega;
  IF v_erp IS NULL THEN RAISE EXCEPTION 'Esa sucursal no factura en la caja.'; END IF;

  INSERT INTO public.preventas (branch_id, customer_id, reservas_ids, enviada_por)
  VALUES (v_branch, v_customer, (SELECT array_agg(x ORDER BY x) FROM unnest(p_reservas) x), p_employee)
  RETURNING id INTO v_id;
  UPDATE public.app_reservas SET preventa_id = v_id, updated_at = now() WHERE id = ANY (p_reservas);

  SELECT coalesce(min(pedido), 'R-' || lpad(min(id)::text, 6, '0')) INTO v_ref
    FROM public.app_reservas WHERE id = ANY (p_reservas);

  RETURN json_build_object(
    'preventa_id', v_id, 'erp_sucursal', v_erp, 'branch_id', v_branch, 'codigo', v_ref,
    'documento', (SELECT min(documento) FROM public.app_reservas WHERE id = ANY (p_reservas)),
    'cliente', (SELECT json_build_object('erp_id', c.erp_id, 'name', c.name) FROM public.customers c WHERE c.id = v_customer),
    'vendedor', json_build_object('code', e.code, 'role_id', e.role_id),
    'pagado', (SELECT coalesce(sum(k.pagado), 0) FROM unnest(p_reservas) x, public.reserva_cuenta(x) k),
    'falta_pagar', (SELECT coalesce(sum(k.falta_pagar), 0) FROM unnest(p_reservas) x, public.reserva_cuenta(x) k),
    'renglones', (SELECT json_agg(json_build_object(
        'reserva_id', a.id, 'producto_id', a.producto_id, 'nombre', a.producto_nombre, 'cantidad', a.cantidad,
        'factor', a.factor, 'precio_unitario', a.precio_unitario, 'precio_normal', a.precio_normal,
        'lista_precio', a.lista_precio) ORDER BY a.id)
      FROM public.app_reservas a WHERE a.id = ANY (p_reservas)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.procesar_cambios_de_factor()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ids        bigint[];
  v_productos  integer[];
  v_ajustados  integer[];
  v_dias       integer;
  v_reescritas integer := 0;
  v_convertidas integer := 0;
  v_calc       jsonb := '[]'::jsonb;
  v_r          jsonb;
  v_pub        jsonb;
  v_sala       integer;
  v_dest       uuid[];
  v_res        jsonb;
  v_cuerpo     text;
  v_avisos     integer := 0;
  p            record;
BEGIN
  -- Dos corridas a la vez convertirían dos veces el mismo MIN·MAX.
  IF NOT pg_try_advisory_xact_lock(hashtext('procesar_cambios_de_factor')) THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'en_curso');
  END IF;

  SELECT array_agg(id), array_agg(DISTINCT erp_product_id)
    INTO v_ids, v_productos
    FROM public.cambios_de_factor
   WHERE procesado_at IS NULL;

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'pendientes', 0);
  END IF;

  -- Alguien tiene MIN·MAX o Pedidos en mantenimiento: la cola espera.
  IF public.auth_module_locked(ARRAY['minmax', 'pedidos']) THEN
    RETURN jsonb_build_object('ok', false, 'skipped', true, 'reason', 'module_locked',
                              'pendientes', array_length(v_ids, 1));
  END IF;

  SELECT analysis_days INTO v_dias FROM public.stock_config WHERE id = 1;

  -- 1. Cada venta de esos productos con el factor que su presentación tiene HOY.
  --    El prefijo más largo gana («CAJA X 100» antes que «CAJA»), igual que la
  --    corrección del 2026-09-22.
  CREATE TEMP TABLE _cf_linea ON COMMIT DROP AS
  WITH cat AS (
    SELECT pp.product_id, upper(trim(pr.tipo)) AS tipo,
           min(pp.factor) AS fmin, max(pp.factor) AS fmax
      FROM public.product_precios pp
      JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
     WHERE pp.activo AND pp.factor > 0 AND pp.product_id = ANY(v_productos)
     GROUP BY 1, 2
  )
  SELECT DISTINCT ON (ii.id)
         ii.id, ii.erp_product_id AS pid, ii.cantidad::numeric AS cantidad,
         ii.factor_unidades AS viejo, c.fmax, c.tipo,
         CASE WHEN c.fmin = c.fmax AND c.fmax <> ii.factor_unidades
                   AND (ii.factor_unidades = 1 OR c.fmax = 1)
              THEN c.fmax END AS nuevo,
         si.fecha, esm.erp_sucursal_id AS sala
    FROM public.sales_invoice_items ii
    JOIN cat c ON c.product_id = ii.erp_product_id
              AND upper(ii.presentacion) LIKE c.tipo || ' %'
    JOIN public.sales_invoices si ON si.id = ii.invoice_id
    LEFT JOIN public.erp_sucursal_map esm ON esm.branch_id = si.branch_id AND esm.es_bodega = false
   WHERE ii.erp_product_id = ANY(v_productos)
     AND NOT EXISTS (SELECT 1 FROM public.products x
                      WHERE x.id = ii.erp_product_id AND x.nombre ILIKE 'RECARGA%')
   ORDER BY ii.id, length(c.tipo) DESC;

  SELECT array_agg(DISTINCT pid) INTO v_ajustados FROM _cf_linea WHERE nuevo IS NOT NULL;

  CREATE TEMP TABLE _cf_antes ON COMMIT DROP AS
  SELECT erp_product_id, erp_sucursal_id, min_units, max_units
    FROM public.product_stock_params
   WHERE erp_product_id = ANY(COALESCE(v_ajustados, '{}'));

  IF v_ajustados IS NOT NULL THEN
    -- 2. En qué unidad está el MIN·MAX guardado de cada sala: la mezcla de
    --    ventas de la ventana con la que se calculó. Calculado sobre puras
    --    ventas viejas de 30, la razón es 1/30; sobre ventas que ya venían en
    --    la unidad nueva, es 1 y no se toca nada — que es lo que pasa con un
    --    cambio de hace meses que el recálculo ya absorbió.
    CREATE TEMP TABLE _cf_razon ON COMMIT DROP AS
    SELECT psp.id,
           sum(l.cantidad * COALESCE(l.nuevo, l.viejo)) / NULLIF(sum(l.cantidad * l.viejo), 0) AS razon
      FROM public.product_stock_params psp
      JOIN _cf_linea l ON l.pid = psp.erp_product_id AND l.sala = psp.erp_sucursal_id
     WHERE psp.erp_product_id = ANY(v_ajustados)
       AND psp.erp_sucursal_id <> 6
       AND l.cantidad > 0
       AND l.fecha >  COALESCE(psp.calculated_at, psp.manual_at, now())::date - v_dias
       AND l.fecha <= COALESCE(psp.calculated_at, psp.manual_at, now())::date
     GROUP BY psp.id;

    UPDATE public.product_stock_params psp SET
      min_units   = (public.par_min_max_convertido(psp.min_units,  psp.max_units,  r.razon))[1],
      max_units   = (public.par_min_max_convertido(psp.min_units,  psp.max_units,  r.razon))[2],
      draft_min   = (public.par_min_max_convertido(psp.draft_min,  psp.draft_max,  r.razon))[1],
      draft_max   = (public.par_min_max_convertido(psp.draft_min,  psp.draft_max,  r.razon))[2],
      calc_min    = (public.par_min_max_convertido(psp.calc_min,   psp.calc_max,   r.razon))[1],
      calc_max    = (public.par_min_max_convertido(psp.calc_min,   psp.calc_max,   r.razon))[2],
      manual_min  = (public.par_min_max_convertido(psp.manual_min, psp.manual_max, r.razon))[1],
      manual_max  = (public.par_min_max_convertido(psp.manual_min, psp.manual_max, r.razon))[2],
      daily_velocity     = round(psp.daily_velocity     * r.razon, 6),
      velocity_30d       = round(psp.velocity_30d       * r.razon, 6),
      draft_velocity     = round(psp.draft_velocity     * r.razon, 6),
      draft_velocity_30d = round(psp.draft_velocity_30d * r.razon, 6),
      units_sold_6m      = round(psp.units_sold_6m      * r.razon)::integer,
      draft_units_sold   = round(psp.draft_units_sold   * r.razon)::integer,
      manual_cliente_unidades = CASE WHEN psp.manual_cliente_unidades IS NULL THEN NULL
                                     ELSE GREATEST(1, round(psp.manual_cliente_unidades * r.razon))::integer END,
      updated_at  = now()
      FROM _cf_razon r
     WHERE r.id = psp.id AND r.razon IS NOT NULL AND r.razon <> 1;
    GET DIAGNOSTICS v_convertidas = ROW_COUNT;

    -- 3. El historial. Sólo `factor_unidades`, que es derivada del portal;
    --    `cantidad` y `total_linea` son fiscales. El trigger es
    --    `UPDATE OF presentacion`, así que esto no lo dispara.
    UPDATE public.sales_invoice_items ii
       SET factor_unidades = l.nuevo
      FROM _cf_linea l
     WHERE ii.id = l.id AND l.nuevo IS NOT NULL;
    GET DIAGNOSTICS v_reescritas = ROW_COUNT;

    -- 4. Recalcular esos productos en cada sala, ya sobre el historial nuevo.
    --    calculate_stock_params pide la llave del servidor; acá no hay sesión.
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    FOR v_sala IN SELECT erp_sucursal_id FROM public.erp_sucursal_map
                   WHERE es_bodega = false ORDER BY 1 LOOP
      v_r := public.calculate_stock_params(v_sala, v_ajustados);
      IF NOT COALESCE((v_r->>'ok')::boolean, false) THEN
        RAISE EXCEPTION 'CAMBIO_DE_FACTOR: el recálculo de la sala % no corrió: %', v_sala, v_r;
      END IF;
      v_calc := v_calc || jsonb_build_object('sala', v_sala, 'resultado', v_r);
    END LOOP;

    -- 5. Una decisión de una persona (solicitud aprobada o motivo) no se pisa:
    --    ya quedó convertida en el paso 2. Se le quita el borrador para que la
    --    publicación dirigida no la reemplace por el cálculo.
    UPDATE public.product_stock_params SET
      draft_min = NULL, draft_max = NULL, draft_abc_class = NULL,
      draft_demand_variability = NULL, draft_cv = NULL, draft_velocity = NULL,
      draft_velocity_30d = NULL, draft_units_sold = NULL, draft_revenue = NULL,
      draft_data_days = NULL, draft_calculated_at = NULL, draft_status = 'none',
      updated_at = now()
     WHERE erp_product_id = ANY(v_ajustados)
       AND erp_sucursal_id <> 6
       AND draft_status = 'pending'
       AND (ajuste_solicitud_id IS NOT NULL OR manual_motivo IS NOT NULL);

    -- 6. Publicar: es un cambio de UNIDAD, no de demanda. Dejarlo en borrador
    --    —el freno del 40% lo dejaría ahí siempre— es dejar el pedido pidiendo
    --    en la unidad vieja hasta que alguien lo revise. Bodega se rehace acá.
    v_pub := public.publish_stock_params(NULL, v_ajustados, 'cambio de factor');

    PERFORM set_config('request.jwt.claims', '', true);

    -- 7. La venta por sala que leen otras pantallas.
    PERFORM public.refresh_product_sales_rollup();
  END IF;

  -- 8. El factor que usa el pedido para contar existencias. Siempre: también
  --    cambia cuando no hubo historial que reescribir.
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_product_factor;

  -- 9. Qué pasó, por producto, y el aviso a quien decide el MIN·MAX.
  v_dest := public.destinatarios_de_productos();
  FOR p IN
    SELECT pr.id, pr.nombre,
           count(l.id) FILTER (WHERE l.nuevo IS NOT NULL)                   AS reescritas,
           count(l.id) FILTER (WHERE l.nuevo IS NULL AND l.fmax <> l.viejo) AS dudosas,
           max(l.viejo) FILTER (WHERE l.nuevo IS NOT NULL)                  AS de,
           max(l.nuevo)                                                     AS a,
           max(l.tipo)  FILTER (WHERE l.nuevo IS NOT NULL)                  AS tipo,
           max(l.fecha) FILTER (WHERE l.nuevo IS NOT NULL)                  AS ultima_vieja,
           (SELECT min(c.detectado_at) FROM public.cambios_de_factor c
             WHERE c.id = ANY(v_ids) AND c.erp_product_id = pr.id)         AS desde,
           cat.antes AS cat_de, cat.ahora AS cat_a, cat.tipo AS cat_tipo, cat.foto AS cat_foto
      FROM unnest(v_productos) AS u(pid)
      JOIN public.products pr ON pr.id = u.pid
      LEFT JOIN _cf_linea l ON l.pid = u.pid
      -- El de→a del CATÁLOGO (2026-10-29): la foto de las presentaciones
      -- activas que guardó la carga de precios al detectar el cambio, contra
      -- las de ahora. Es el cambio de verdad y no depende de las ventas: un
      -- producto que pasó de 1x1 a 1x24 sin haberse vendido con el tamaño
      -- viejo no deja rastro en `_cf_linea`. Sólo un tipo con UN tamaño antes
      -- y UN tamaño ahora (si la caja dejó las dos prendidas, no se adivina),
      -- y sólo cambios de UNIDAD: 12→8 en un blíster no mueve la existencia.
      LEFT JOIN LATERAL (
        SELECT x.tipo, x.antes, y.ahora, f.catalogo_antes AS foto
          FROM (SELECT c.catalogo_antes FROM public.cambios_de_factor c
                 WHERE c.id = ANY(v_ids) AND c.erp_product_id = pr.id
                   AND c.catalogo_antes IS NOT NULL
                 ORDER BY c.id LIMIT 1) f
          CROSS JOIN LATERAL (
                SELECT e.tipo, min(e.factor) AS antes
                  FROM jsonb_to_recordset(f.catalogo_antes) AS e(tipo text, factor int)
                 GROUP BY e.tipo HAVING min(e.factor) = max(e.factor)) x
          JOIN (SELECT upper(trim(pre.tipo)) AS tipo, min(pp.factor) AS ahora
                  FROM public.product_precios pp
                  JOIN public.presentaciones pre ON pre.id = pp.id_presentacion
                 WHERE pp.product_id = pr.id AND pp.activo AND pp.factor > 0
                 GROUP BY 1 HAVING min(pp.factor) = max(pp.factor)) y ON y.tipo = x.tipo
         WHERE x.antes <> y.ahora AND (x.antes = 1 OR y.ahora = 1)
         ORDER BY x.tipo
         LIMIT 1) cat ON true
     GROUP BY pr.id, pr.nombre, cat.antes, cat.ahora, cat.tipo, cat.foto
  LOOP
    -- strip_nulls: un null de JSON no es un NULL de SQL, y el aviso pregunta por NULL.
    v_res := jsonb_strip_nulls(jsonb_build_object(
      'ventas_convertidas', p.reescritas,
      'ventas_sin_convertir', p.dudosas,
      'factor_antes', coalesce(p.cat_de, p.de),
      'factor_ahora', coalesce(p.cat_a, p.a),
      'presentacion', coalesce(p.cat_tipo, p.tipo),
      'minmax', (SELECT jsonb_agg(jsonb_build_object(
                          'sala', m.nombre,
                          'antes', jsonb_build_array(a.min_units, a.max_units),
                          'ahora', jsonb_build_array(s.min_units, s.max_units))
                        ORDER BY s.erp_sucursal_id)
                   FROM _cf_antes a
                   JOIN public.product_stock_params s
                     ON s.erp_product_id = a.erp_product_id AND s.erp_sucursal_id = a.erp_sucursal_id
                   JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = s.erp_sucursal_id
                  WHERE a.erp_product_id = p.id
                    AND (a.min_units, a.max_units) IS DISTINCT FROM (s.min_units, s.max_units)),
      -- La existencia que quedó contada en la unidad vieja, en los dos
      -- sentidos, tal como estaba AHORA. Con el de→a del catálogo, siempre:
      -- es el cambio que acaba de pasar. Con el de las ventas, sólo si es
      -- RECIENTE (se vendió con el tamaño viejo en los últimos 60 días): uno
      -- de hace un año ya se corrigió en la caja, y medido en la prueba,
      -- DOLACO —1x1 desde 2025— salía acusado en 3 salas.
      'existencia_por_corregir', CASE
                 WHEN p.cat_de IS NOT NULL THEN
                   nullif(public.existencia_por_corregir(p.id, p.cat_tipo, p.cat_de, p.cat_a, p.desde, p.cat_foto), '[]'::jsonb)
                 WHEN p.ultima_vieja >= CURRENT_DATE - 60 THEN
                   nullif(public.existencia_por_corregir(p.id, p.tipo, p.de, p.a, p.desde), '[]'::jsonb)
               END));

    UPDATE public.cambios_de_factor
       SET procesado_at = now(), resultado = v_res
     WHERE id = ANY(v_ids) AND erp_product_id = p.id;

    IF p.reescritas > 0 OR p.dudosas > 0 OR v_res ? 'existencia_por_corregir' THEN
      v_cuerpo := p.nombre || ': ';
      IF p.reescritas = 0 THEN
        -- Sin ventas que convertir: el aviso igual dice qué cambió.
        v_cuerpo := v_cuerpo || 'cambió el tamaño de su presentación (antes '
                 || (v_res->>'factor_antes') || ' por unidad de venta, ahora '
                 || (v_res->>'factor_ahora') || ').';
      ELSE
        v_cuerpo := v_cuerpo || 'cambió el tamaño de su presentación (antes '
                 || p.de || ' por unidad de venta, ahora ' || p.a || '). Se convirtieron '
                 || p.reescritas || ' ventas'
                 || CASE WHEN v_res->'minmax' IS NOT NULL
                         THEN ' y el Mín/Máx: ' || (SELECT string_agg(
                                (x->>'sala') || ' ' || (x->'antes'->>0) || '·' || (x->'antes'->>1)
                                || ' → ' || (x->'ahora'->>0) || '·' || (x->'ahora'->>1), ', ')
                              FROM jsonb_array_elements(v_res->'minmax') x)
                         ELSE '' END || '.';
      END IF;
      IF v_res->'existencia_por_corregir' IS NOT NULL THEN
        v_cuerpo := v_cuerpo || ' La existencia quedó contada en la unidad vieja en '
                 || (SELECT string_agg(DISTINCT m.nombre, ', ')
                       FROM jsonb_array_elements(v_res->'existencia_por_corregir') x
                       JOIN public.erp_sucursal_map m
                         ON m.erp_sucursal_id = (x->>'erp_sucursal_id')::int)
                 || '. Se corrige con un botón en Productos → Revisión de factor.';
      END IF;
      IF p.dudosas > 0 THEN
        v_cuerpo := v_cuerpo || ' ' || p.dudosas
                 || ' ventas tienen otro tamaño de caja y quedaron como estaban: revisar si es la misma caja.';
      END IF;
      v_avisos := v_avisos + public.notify_employees(
        v_dest, 'SYSTEM', 'Cambio de presentación · ' || p.nombre, v_cuerpo, '/productos?tab=revision',
        jsonb_build_object('erp_product_id', p.id, 'cambio_de_factor', v_res));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'productos', array_length(v_productos, 1),
    'productos_convertidos', COALESCE(array_length(v_ajustados, 1), 0),
    'ventas_convertidas', v_reescritas,
    'filas_minmax_convertidas', v_convertidas,
    'recalculo', v_calc,
    'publicado', v_pub,
    'avisos', v_avisos);
END;
$function$;

CREATE OR REPLACE FUNCTION public.promocion_mover_lote(p_erp_product_id integer, p_origen bigint, p_destino bigint, p_unidades numeric, p_circuito text, p_ref text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_renglon  bigint;
    v_promo    bigint;
    v_cuantos  integer;
    v_disp     integer;
    v_mueve    integer;
    v_movidos  integer := 0;
BEGIN
    IF p_unidades IS NULL OR p_unidades <= 0
       OR p_origen IS NULL OR p_destino IS NULL
       OR p_origen = p_destino THEN
        RETURN 0;
    END IF;

    -- ¿Hay UN renglón abierto de una promoción activa para este producto hoy?
    -- Si hay varios (el mismo producto con dos presentaciones distintas), no se
    -- adivina cuál: no se mueve nada y queda anotado. Repartir a ojo entre dos
    -- renglones sería inventar un dato.
    SELECT count(*), min(r.id), min(r.promocion_id)
      INTO v_cuantos, v_renglon, v_promo
      FROM public.promocion_renglon r
      JOIN public.promociones pm ON pm.id = r.promocion_id
     WHERE r.erp_product_id = p_erp_product_id
       AND r.estado = 'abierto' AND pm.estado = 'activa'
       AND v_hoy BETWEEN r.inicio AND r.fin;

    IF v_cuantos = 0 THEN RETURN 0; END IF;

    IF v_cuantos > 1 THEN
        PERFORM public.promocion_log(
            NULL, NULL, NULL, 'traslado_ambiguo', NULL, p_unidades::text,
            'el producto ' || p_erp_product_id || ' está en ' || v_cuantos ||
            ' productos abiertos. No se movió el lote.');
        RETURN 0;
    END IF;

    -- Las DOS puntas tienen que tener reparto en este renglón. Es lo que deja
    -- afuera a Bodega y lo que conserva el total.
    IF NOT EXISTS (SELECT 1 FROM public.promocion_reparto
                    WHERE renglon_id = v_renglon AND branch_id = p_origen)
       OR NOT EXISTS (SELECT 1 FROM public.promocion_reparto
                       WHERE renglon_id = v_renglon AND branch_id = p_destino) THEN
        RETURN 0;
    END IF;

    SELECT asignado_vigente INTO v_disp
      FROM public.promocion_reparto
     WHERE renglon_id = v_renglon AND branch_id = p_origen
       FOR UPDATE;

    -- No se puede ceder más de lo asignado: la columna no admite negativos, y un
    -- lote negativo no significa nada. Se mueve lo que hay y se anota el tope.
    v_mueve := least(floor(p_unidades)::integer, greatest(v_disp, 0));
    IF v_mueve <= 0 THEN RETURN 0; END IF;

    UPDATE public.promocion_reparto
       SET asignado_vigente = asignado_vigente - v_mueve, updated_at = now()
     WHERE renglon_id = v_renglon AND branch_id = p_origen;

    UPDATE public.promocion_reparto
       SET asignado_vigente = asignado_vigente + v_mueve,
           -- Recibir más lote vuelve a poner a la sala por debajo del umbral, así
           -- que el aviso tiene que poder volver a salir.
           avisado_80_at  = NULL,
           avisado_100_at = NULL,
           updated_at     = now()
     WHERE renglon_id = v_renglon AND branch_id = p_destino;

    INSERT INTO public.promocion_reparto_mov
        (renglon_id, branch_id_origen, branch_id_destino, unidades,
         circuito, origen_ref, movido_por)
    VALUES
        (v_renglon, p_origen, p_destino, v_mueve, p_circuito, p_ref, p_actor);

    PERFORM public.promocion_log(
        v_promo, v_renglon, p_destino, 'lote_movido',
        v_disp::text, (v_disp - v_mueve)::text,
        v_mueve || ' unidades por ' || p_circuito ||
        CASE WHEN v_mueve < floor(p_unidades)
             THEN ' (se pidieron ' || floor(p_unidades)::int || ', había ' || v_disp || ')'
             ELSE '' END);

    v_movidos := v_mueve;
    RETURN v_movidos;
END;
$function$;

CREATE OR REPLACE FUNCTION public.promociones_ciclo_diario()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_lote     integer := 0;
    v_fecha    integer := 0;
    v_final    integer := 0;
    v_avisos   integer := 0;
    v_lab      integer := 0;
    v_exced    integer := 0;  -- tramos de excedente registrados o puestos al día
    v_fila     record;
    v_sala     record;
    v_dest     uuid[];
    v_donde    text;
    v_titulo   text;
    v_cuerpo   text;
    v_salida   text := '';
    -- Lo que hace falta para contestar «¿cuándo terminó?» y «¿hubo campaña?».
    v_ult_fin  date;
    v_motivo   text;
    v_viva     timestamptz;
    v_dia_viva date;
    -- El resumen del día para supervisión (24-sep).
    v_resumen  jsonb;
    v_n_prod   integer;  -- promociones en el resumen
    v_n_bajo   integer;
    v_b        record;
BEGIN
    -- El avance se calcula UNA sola vez: lo necesitan el cierre por lote, el
    -- aviso por sala y el «dónde sí hay» de cada aviso. Llamarlo dentro del
    -- bucle costaba una pasada completa por cada sala avisada.
    DROP TABLE IF EXISTS _promo_av;
    CREATE TEMP TABLE _promo_av ON COMMIT DROP AS
        SELECT * FROM public.promocion_avance(true);
    CREATE INDEX ON _promo_av (renglon_id, branch_id);

    -- ── 1 · Cerrar los que se quedaron sin lote ──────────────────────────────
    FOR v_fila IN
        WITH tot AS (
            SELECT a.renglon_id, sum(a.vendido) AS vendido
              FROM _promo_av a
             GROUP BY a.renglon_id
        )
        SELECT r.id, r.promocion_id, r.lote_total, p.nombre AS producto,
               tot.vendido
          FROM public.promocion_renglon r
          JOIN tot ON tot.renglon_id = r.id
          JOIN public.products p ON p.id = r.erp_product_id
         WHERE r.estado = 'abierto' AND tot.vendido >= r.lote_total
    LOOP
        UPDATE public.promocion_renglon
           SET estado = 'cerrado', cerrado_at = now(),
               cerrado_motivo = 'lote_agotado', updated_at = now()
         WHERE id = v_fila.id;

        PERFORM public.promocion_log(
            v_fila.promocion_id, v_fila.id, NULL, 'cerrado_lote_agotado',
            'abierto', 'cerrado',
            v_fila.producto || ': se vendieron ' || v_fila.vendido::int ||
            ' de un lote de ' || v_fila.lote_total);
        v_lote := v_lote + 1;
    END LOOP;

    -- ── 2 · Cerrar los que se les venció la fecha ────────────────────────────
    FOR v_fila IN
        SELECT r.id, r.promocion_id, r.fin, p.nombre AS producto
          FROM public.promocion_renglon r
          JOIN public.products p ON p.id = r.erp_product_id
         WHERE r.estado = 'abierto' AND r.fin < v_hoy
    LOOP
        UPDATE public.promocion_renglon
           SET estado = 'cerrado', cerrado_at = now(),
               cerrado_motivo = 'fin_de_vigencia', updated_at = now()
         WHERE id = v_fila.id;

        PERFORM public.promocion_log(
            v_fila.promocion_id, v_fila.id, NULL, 'cerrado_fin_de_vigencia',
            'abierto', 'cerrado',
            v_fila.producto || ': venció el ' || v_fila.fin::text);
        v_fecha := v_fecha + 1;
    END LOOP;

    -- ── 3 · La promoción se finaliza cuando cierra su ÚLTIMO renglón ─────────
    FOR v_fila IN
        SELECT pm.id, pm.nombre, pm.created_at
          FROM public.promociones pm
         WHERE pm.estado = 'activa'
           AND pm.tipo = 'producto'
           AND EXISTS (SELECT 1 FROM public.promocion_renglon r WHERE r.promocion_id = pm.id)
           AND NOT EXISTS (SELECT 1 FROM public.promocion_renglon r
                            WHERE r.promocion_id = pm.id AND r.estado = 'abierto')
    LOOP
        UPDATE public.promociones
           SET estado = 'finalizada', updated_at = now()
         WHERE id = v_fila.id;

        PERFORM public.promocion_log(v_fila.id, NULL, NULL, 'finalizada',
            'activa', 'finalizada', 'cerró su último producto');
        v_final := v_final + 1;

        -- Cuándo venció el último producto, y qué lo cerró. El motivo sólo se
        -- nombra cuando es UNO solo: con una promoción que cerró mitad por
        -- fecha y mitad por lote, decir «venció» sería la mitad de la verdad.
        SELECT max(r.fin),
               CASE WHEN count(DISTINCT r.cerrado_motivo) = 1
                    THEN min(r.cerrado_motivo) END
          INTO v_ult_fin, v_motivo
          FROM public.promocion_renglon r
         WHERE r.promocion_id = v_fila.id;

        /* ── ¿Estuvo viva alguna vez? ────────────────────────────────────
         * El anclaje es la ACTIVACIÓN y no la creación: una promoción puede
         * pasar semanas en borrador sin que eso diga nada de si corrió. Si su
         * último producto ya había vencido ese día, no hubo campaña — se cierra
         * igual, pero no es noticia para nadie. */
        SELECT min(h.created_at) INTO v_viva
          FROM public.promocion_historial h
         WHERE h.promocion_id = v_fila.id AND h.evento = 'activada';
        v_dia_viva := (coalesce(v_viva, v_fila.created_at)
                       AT TIME ZONE 'America/El_Salvador')::date;

        IF v_ult_fin IS NOT NULL AND v_ult_fin < v_dia_viva THEN
            -- Queda escrito por qué NO se avisó: un aviso que no sale y no deja
            -- rastro se lee igual que uno que se perdió.
            PERFORM public.promocion_log(v_fila.id, NULL, NULL,
                'finalizada_sin_aviso', 'activa', 'finalizada',
                'se activó el ' || v_dia_viva::text || ', con el último producto '
                || 'vencido desde el ' || v_ult_fin::text || ': no hubo campaña que avisar');
            CONTINUE;
        END IF;

        -- La fecha en palabras. El año sólo cuando no es el de hoy: «venció el
        -- 31 de agosto» se entiende, y «de 2026» sobra doce meses de cada doce.
        v_cuerpo := CASE
            WHEN v_motivo = 'fin_de_vigencia' AND v_ult_fin IS NOT NULL THEN
                'Venció el ' || extract(day from v_ult_fin)::int || ' de ' ||
                (ARRAY['enero','febrero','marzo','abril','mayo','junio','julio',
                       'agosto','septiembre','octubre','noviembre','diciembre'])
                    [extract(month from v_ult_fin)::int] ||
                CASE WHEN extract(year from v_ult_fin) <> extract(year from v_hoy)
                     THEN ' de ' || extract(year from v_ult_fin)::int::text ELSE '' END || '.'
            WHEN v_motivo = 'lote_agotado' THEN 'Se vendió todo el lote.'
            ELSE 'Cerró su último producto.'
        END || ' Puedes ver cómo quedó en Promociones.';

        -- A quien lleva las promociones: se terminó una.
        SELECT array_agg(e.id) INTO v_dest
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND coalesce(e.tipo_ficha,'empleado') = 'empleado'
           AND EXISTS (SELECT 1 FROM public.role_permissions rp
                        WHERE rp.module_key = 'promociones' AND rp.can_view
                          AND rp.role_id IN (e.role_id, e.secondary_role_id));

        IF v_dest IS NOT NULL THEN
            PERFORM public.notify_employees(
                v_dest, 'PROMO_CERRADA',
                'Terminó la promoción ' || v_fila.nombre,
                v_cuerpo,
                '/promociones?tab=historico',
                -- La tarjeta (24-sep): cómo terminó y cuándo.
                jsonb_build_object('promocion_id', v_fila.id,
                    'promo', jsonb_strip_nulls(jsonb_build_object(
                        'tipo',    'cerrada',
                        'nombre',  v_fila.nombre,
                        'motivo',  CASE v_motivo WHEN 'fin_de_vigencia' THEN 'Venció'
                                                 WHEN 'lote_agotado'    THEN 'Se vendió todo el lote' END,
                        'fin',     v_ult_fin))),
                true, NULL);
        END IF;
    END LOOP;

    -- ── 4 · El aviso de «se te está acabando», por sala ──────────────────────
    -- Se marca la fecha del aviso en la fila del reparto, así que un segundo
    -- pase del mismo día no lo repite. El del 100% sale aunque ya haya salido
    -- el del 80%: son dos momentos distintos.
    FOR v_sala IN
        WITH av AS (SELECT * FROM _promo_av)
        SELECT rep.id AS reparto_id, rep.renglon_id, rep.branch_id,
               rep.asignado_vigente, rep.avisado_80_at, rep.avisado_100_at,
               coalesce(av.vendido, 0)                                  AS vendido,
               greatest(rep.asignado_vigente - coalesce(av.vendido,0),0) AS queda,
               CASE WHEN rep.asignado_vigente > 0
                    THEN coalesce(av.vendido,0) / rep.asignado_vigente * 100
               END AS pct,
               b.name  AS sala,
               pr.nombre AS producto,
               pm.id   AS promocion_id,
               pm.nombre AS promocion
          FROM public.promocion_reparto rep
          JOIN public.promocion_renglon r  ON r.id  = rep.renglon_id
          JOIN public.promociones       pm ON pm.id = r.promocion_id
          JOIN public.products          pr ON pr.id = r.erp_product_id
          JOIN public.branches          b  ON b.id  = rep.branch_id
          LEFT JOIN av ON av.renglon_id = rep.renglon_id AND av.branch_id = rep.branch_id
         WHERE r.estado = 'abierto' AND pm.estado = 'activa'
           AND rep.asignado_vigente > 0
           AND coalesce(av.vendido,0) / rep.asignado_vigente * 100 >= 80
           AND (rep.avisado_80_at IS NULL
                OR (rep.avisado_100_at IS NULL
                    AND coalesce(av.vendido,0) >= rep.asignado_vigente))
    LOOP
        -- Dónde SÍ hay: las otras salas del mismo renglón que todavía tienen.
        -- Sin esto el aviso dice «se te acaba» y deja a la persona sin nada que
        -- hacer con esa información.
        -- «Salud 1 (12)» y no «Salud 1 12»: dos números pegados se leen como
        -- uno (usuario, 24-sep).
        SELECT string_agg(x.sala || ' (' || x.queda::int || ')', ' · ' ORDER BY x.queda DESC)
          INTO v_donde
          FROM (
            SELECT b2.name AS sala,
                   rep2.asignado_vigente - coalesce(av2.vendido,0) AS queda
              FROM public.promocion_reparto rep2
              JOIN public.branches b2 ON b2.id = rep2.branch_id
              LEFT JOIN _promo_av av2
                     ON av2.renglon_id = rep2.renglon_id AND av2.branch_id = rep2.branch_id
             WHERE rep2.renglon_id = v_sala.renglon_id
               AND rep2.branch_id <> v_sala.branch_id
               AND rep2.asignado_vigente - coalesce(av2.vendido,0) > 0
             ORDER BY 2 DESC
             LIMIT 3
          ) x;

        IF v_sala.queda <= 0 THEN
            v_titulo := 'Se acabó tu lote — ' || v_sala.producto;
            v_cuerpo := v_sala.promocion || ': vendiste las ' ||
                        v_sala.asignado_vigente || ' unidades que te tocaban.';
        ELSE
            v_titulo := 'Te quedan ' || v_sala.queda::int || ' — ' || v_sala.producto;
            v_cuerpo := v_sala.promocion || ': llevas ' || v_sala.vendido::int ||
                        ' de ' || v_sala.asignado_vigente || ' unidades (' ||
                        round(v_sala.pct)::int || '%).';
        END IF;

        v_cuerpo := v_cuerpo || CASE
            WHEN v_donde IS NOT NULL THEN ' Todavía hay en: ' || v_donde || '.'
            ELSE ' Ya no queda en ninguna otra sucursal.' END;

        -- A la sala: quien puede pedir un traslado, que es quien puede ACTUAR
        -- sobre este aviso.
        SELECT array_agg(e.id) INTO v_dest
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND e.branch_id = v_sala.branch_id
           AND coalesce(e.tipo_ficha,'empleado') = 'empleado'
           AND EXISTS (SELECT 1 FROM public.role_permissions rp
                        WHERE rp.module_key = 'traslados' AND rp.can_edit
                          AND rp.role_id IN (e.role_id, e.secondary_role_id));

        IF v_dest IS NOT NULL THEN
            PERFORM public.notify_employees(
                v_dest, 'PROMO_LOTE_BAJO', v_titulo, v_cuerpo, '/traslados',
                jsonb_build_object('promocion_id', v_sala.promocion_id,
                                   'renglon_id',   v_sala.renglon_id,
                                   'branch_id',    v_sala.branch_id,
                                   -- La tarjeta (24-sep): cuánto va del lote
                                   -- y dónde más queda.
                                   'promo', jsonb_strip_nulls(jsonb_build_object(
                                       'tipo',      'lote',
                                       'nombre',    v_sala.promocion,
                                       'producto',  v_sala.producto,
                                       'sala',      v_sala.sala,
                                       'vendido',   v_sala.vendido::int,
                                       'asignado',  v_sala.asignado_vigente,
                                       'donde',     v_donde))),
                true, v_sala.branch_id::integer);
            v_avisos := v_avisos + 1;
        END IF;

        -- Supervisión ya NO recibe un aviso por sala: recibe UN resumen del día
        -- con todas (usuario, 24-sep: «como supervisor quiero un reporte de
        -- todos, no sólo de una sucursal, y 1 al día»). Ver el paso 4b.

        UPDATE public.promocion_reparto
           SET avisado_80_at  = coalesce(avisado_80_at, now()),
               avisado_100_at = CASE WHEN v_sala.queda <= 0
                                     THEN coalesce(avisado_100_at, now())
                                     ELSE avisado_100_at END,
               updated_at     = now()
         WHERE id = v_sala.reparto_id;

        PERFORM public.promocion_log(
            v_sala.promocion_id, v_sala.renglon_id, v_sala.branch_id,
            CASE WHEN v_sala.queda <= 0 THEN 'aviso_lote_agotado_sala'
                 ELSE 'aviso_lote_bajo_sala' END,
            NULL, round(v_sala.pct)::int || '%', v_sala.sala);
    END LOOP;

    -- ── 4b · El resumen del día, para supervisión ─────────────────────────────
    -- Una fila por PROMOCIÓN y no por producto: hay promociones de 30
    -- productos, y lo que supervisión compara es cómo va cada sala. Por
    -- promoción: cuántos productos, cuándo termina, lo vendido y lo vendido por
    -- sala; y aparte los lotes de sala por agotarse. Uno solo por corrida, y la
    -- corrida es una al día (7:30 a. m.).
    WITH por_sala AS (
        SELECT r.promocion_id, a.branch_id, sum(a.vendido) AS vendido
          FROM _promo_av a
          JOIN public.promocion_renglon r ON r.id = a.renglon_id
         WHERE r.estado = 'abierto'
         GROUP BY r.promocion_id, a.branch_id
    ), bajos AS (
        SELECT r.promocion_id,
               jsonb_agg(jsonb_build_object(
                   'producto', pr.nombre, 'sala', b.name,
                   'vendido',  coalesce(av.vendido, 0)::int, 'asignado', rep.asignado_vigente)
                 ORDER BY coalesce(av.vendido, 0) / rep.asignado_vigente DESC) AS lista,
               count(*) AS n
          FROM public.promocion_reparto rep
          JOIN public.promocion_renglon r ON r.id = rep.renglon_id
          JOIN public.products pr ON pr.id = r.erp_product_id
          JOIN public.branches b  ON b.id = rep.branch_id
          LEFT JOIN _promo_av av ON av.renglon_id = rep.renglon_id AND av.branch_id = rep.branch_id
         WHERE r.estado = 'abierto' AND rep.asignado_vigente > 0
           AND coalesce(av.vendido, 0) >= rep.asignado_vigente * 0.8
         GROUP BY r.promocion_id
    )
    SELECT jsonb_agg(x.fila ORDER BY x.vendido DESC), count(*), sum(x.bajas)
      INTO v_resumen, v_n_prod, v_n_bajo
      FROM (
        SELECT jsonb_strip_nulls(jsonb_build_object(
                   'nombre',     pm.nombre,
                   'productos',  (SELECT count(*) FROM public.promocion_renglon r
                                   WHERE r.promocion_id = pm.id AND r.estado = 'abierto'),
                   'fin',        (SELECT max(r.fin) FROM public.promocion_renglon r
                                   WHERE r.promocion_id = pm.id AND r.estado = 'abierto'),
                   'vendido',    coalesce((SELECT sum(ps.vendido) FROM por_sala ps
                                            WHERE ps.promocion_id = pm.id), 0)::int,
                   -- TODAS las salas y siempre en el mismo orden, también las
                   -- que van en cero: supervisión compara salas, y una que no
                   -- aparece no se puede comparar (usuario, 24-sep).
                   'salas',      (SELECT jsonb_agg(jsonb_build_object('sala', b.name,
                                                   'vendido', coalesce(ps.vendido, 0)::int) ORDER BY b.name)
                                    FROM public.erp_sucursal_map m
                                    JOIN public.branches b ON b.id = m.branch_id
                                    LEFT JOIN por_sala ps ON ps.promocion_id = pm.id AND ps.branch_id = m.branch_id
                                   WHERE NOT m.es_bodega),
                   'por_agotarse', bj.lista)) AS fila,
               coalesce((SELECT sum(ps.vendido) FROM por_sala ps WHERE ps.promocion_id = pm.id), 0) AS vendido,
               coalesce(bj.n, 0) AS bajas
          FROM public.promociones pm
          LEFT JOIN bajos bj ON bj.promocion_id = pm.id
         WHERE pm.estado = 'activa' AND pm.tipo = 'producto'
           -- Sólo las que lo tienen encendido para supervisión (24-sep: «que
           -- se pueda activar en la promoción si lleva o no notificación»).
           AND pm.resumen_supervision
           AND EXISTS (SELECT 1 FROM public.promocion_renglon r
                        WHERE r.promocion_id = pm.id AND r.estado = 'abierto')
         LIMIT 12
      ) x;

    IF coalesce(v_n_prod, 0) > 0 THEN
        SELECT array_agg(e.id) INTO v_dest
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND coalesce(e.tipo_ficha,'empleado') = 'empleado'
           AND EXISTS (SELECT 1 FROM public.role_permissions rp
                        WHERE rp.module_key = 'promociones' AND rp.can_view
                          AND rp.role_id IN (e.role_id, e.secondary_role_id));

        IF v_dest IS NOT NULL THEN
            PERFORM public.notify_employees(
                v_dest, 'PROMO_RESUMEN',
                'Promociones de hoy · ' || v_n_prod
                  || CASE WHEN v_n_prod = 1 THEN ' activa' ELSE ' activas' END
                  || CASE WHEN coalesce(v_n_bajo, 0) = 1 THEN ', 1 sucursal por agotarse'
                          WHEN coalesce(v_n_bajo, 0) > 1 THEN ', ' || v_n_bajo || ' sucursales por agotarse'
                          ELSE '' END,
                'Cómo va cada promoción y cada sucursal.',
                '/promociones',
                jsonb_build_object('fecha', v_hoy,
                    'promo', jsonb_build_object('tipo', 'resumen', 'productos', v_resumen)),
                false, NULL);
        END IF;
    END IF;

    -- ── 4c · El resumen del día, para cada SALA ──────────────────────────────
    -- De las promociones con el resumen encendido para las salas: cada sala ve
    -- SÓLO lo suyo —cuánto lleva vendido en cada una, cuántos días quedan y su
    -- lote por agotarse— (usuario, 24-sep). A la jefatura de la sala.
    FOR v_b IN
        SELECT b.id AS branch_id, b.name AS sala
          FROM public.erp_sucursal_map m
          JOIN public.branches b ON b.id = m.branch_id
         WHERE NOT m.es_bodega
         ORDER BY b.name
    LOOP
        SELECT jsonb_agg(x.fila ORDER BY x.vendido DESC), count(*)
          INTO v_resumen, v_n_prod
          FROM (
            SELECT jsonb_strip_nulls(jsonb_build_object(
                       'nombre',    pm.nombre,
                       'productos', (SELECT count(*) FROM public.promocion_renglon r
                                      WHERE r.promocion_id = pm.id AND r.estado = 'abierto'),
                       'fin',       (SELECT max(r.fin) FROM public.promocion_renglon r
                                      WHERE r.promocion_id = pm.id AND r.estado = 'abierto'),
                       'vendido',   coalesce(v.vendido, 0)::int,
                       'por_agotarse', (SELECT jsonb_agg(jsonb_build_object(
                                               'producto', pr.nombre, 'sala', v_b.sala,
                                               'vendido',  coalesce(av.vendido, 0)::int,
                                               'asignado', rep.asignado_vigente))
                                          FROM public.promocion_reparto rep
                                          JOIN public.promocion_renglon r ON r.id = rep.renglon_id
                                          JOIN public.products pr ON pr.id = r.erp_product_id
                                          LEFT JOIN _promo_av av ON av.renglon_id = rep.renglon_id
                                                                AND av.branch_id = rep.branch_id
                                         WHERE r.promocion_id = pm.id AND r.estado = 'abierto'
                                           AND rep.branch_id = v_b.branch_id AND rep.asignado_vigente > 0
                                           AND coalesce(av.vendido, 0) >= rep.asignado_vigente * 0.8))) AS fila,
                   coalesce(v.vendido, 0) AS vendido
              FROM public.promociones pm
              LEFT JOIN LATERAL (
                  SELECT sum(a.vendido) AS vendido
                    FROM _promo_av a
                    JOIN public.promocion_renglon r ON r.id = a.renglon_id
                   WHERE r.promocion_id = pm.id AND r.estado = 'abierto' AND a.branch_id = v_b.branch_id
              ) v ON true
             WHERE pm.estado = 'activa' AND pm.tipo = 'producto' AND pm.resumen_salas
               AND EXISTS (SELECT 1 FROM public.promocion_renglon r
                            WHERE r.promocion_id = pm.id AND r.estado = 'abierto')
             LIMIT 12
          ) x;

        CONTINUE WHEN coalesce(v_n_prod, 0) = 0;

        SELECT array_agg(e.id) INTO v_dest
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
           AND e.branch_id = v_b.branch_id
           AND public.rango_de_empleado(e.id) BETWEEN 1 AND 2;

        IF v_dest IS NOT NULL THEN
            PERFORM public.notify_employees(
                v_dest, 'PROMO_RESUMEN',
                v_b.sala || ' · Promociones de hoy · ' || v_n_prod
                  || CASE WHEN v_n_prod = 1 THEN ' activa' ELSE ' activas' END,
                'Cuánto lleva vendido tu sucursal en cada promoción.',
                '/promociones',
                jsonb_build_object('fecha', v_hoy, 'branch_id', v_b.branch_id,
                    'promo', jsonb_build_object('tipo', 'resumen', 'sala', v_b.sala, 'productos', v_resumen)),
                false, v_b.branch_id::integer);
        END IF;
    END LOOP;

    -- ── 5 · Congelar el mes de las promociones de LABORATORIO ────────────────
    -- Va al final a propósito: los pasos 1-4 son del tipo producto y ninguno
    -- toca estas filas, así que el orden no cambia el resultado — pero un paso
    -- que escribe el cierre definitivo de un mes se lee mejor último.
    -- Los excedentes de lote: lo vendido por encima del lote queda por
    -- decidir en `promocion_excedente`. Se perdió en 20260902030239 al
    -- reescribir el ciclo; vuelve el 2026-11-10.
    v_exced := public.promociones_registrar_excedentes();

    v_lab := public.promociones_cerrar_meses_de_laboratorio();

    -- Lo que queda en `cron.job_run_details.return_message`. Un cron que
    -- devuelve siempre lo mismo no deja ver si hizo algo.
    IF v_lote  > 0 THEN v_salida := v_salida || 'cerrados_por_lote='  || v_lote  || ' '; END IF;
    IF v_fecha > 0 THEN v_salida := v_salida || 'cerrados_por_fecha=' || v_fecha || ' '; END IF;
    IF v_final > 0 THEN v_salida := v_salida || 'finalizadas='        || v_final || ' '; END IF;
    IF v_avisos> 0 THEN v_salida := v_salida || 'avisos='             || v_avisos|| ' '; END IF;
    IF v_exced > 0 THEN v_salida := v_salida || 'excedentes='         || v_exced || ' '; END IF;
    IF v_lab   > 0 THEN v_salida := v_salida || 'meses_cerrados='     || v_lab   || ' '; END IF;

    RETURN coalesce(nullif(btrim(v_salida), ''), 'sin novedades');
END;
$function$;

CREATE OR REPLACE FUNCTION public.prorroga_registrar(p_tipo text, p_id bigint, p_customer bigint, p_dias integer, p_motivo text, p_origen text, p_empleado uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_branch bigint; v_customer bigint; v_producto text; v_vence date; v_codigo text; v_id bigint;
  v_dest uuid[]; v_cliente text; v_sala text; v_v2 boolean;
BEGIN
  IF p_tipo NOT IN ('reserva', 'encargo') THEN RAISE EXCEPTION 'Tipo inválido.'; END IF;
  IF p_dias IS NULL OR p_dias < 1 OR p_dias > 365 THEN
    RAISE EXCEPTION 'Indica cuántos días de prórroga (de 1 a 365).' USING ERRCODE = 'P0001';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Escribe el motivo de la prórroga.' USING ERRCODE = 'P0001';
  END IF;

  IF p_tipo = 'reserva' THEN
    SELECT r.branch_id, r.customer_id, r.producto_nombre, public.reservas_v2_rige(r.lista_at),
           coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0'))
      INTO v_branch, v_customer, v_producto, v_v2, v_codigo
      FROM public.app_reservas r
     WHERE r.id = p_id AND r.estado = 'lista' AND r.vence_at IS NOT NULL
       AND (p_customer IS NULL OR r.customer_id = p_customer)
       FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sólo se pide prórroga de una reserva lista para retirar.' USING ERRCODE = 'P0001'; END IF;
    IF EXISTS (SELECT 1 FROM public.app_reservas WHERE id = p_id AND prorrogada_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Esta reserva ya tuvo su prórroga: no admite otra.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT e.branch_id, e.customer_id, e.producto_nombre, public.reservas_v2_rige(e.listo_at),
           'E-' || lpad(e.id::text, 6, '0')
      INTO v_branch, v_customer, v_producto, v_v2, v_codigo
      FROM public.app_encargos e
     WHERE e.id = p_id AND e.estado = 'listo'
       AND (p_customer IS NULL OR e.customer_id = p_customer)
       FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sólo se pide prórroga de un encargo que ya llegó.' USING ERRCODE = 'P0001'; END IF;
    IF EXISTS (SELECT 1 FROM public.app_encargos WHERE id = p_id AND prorrogado_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Este encargo ya tuvo su prórroga: no admite otra.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF public.prorroga_pendiente(p_tipo, p_id) THEN
    RAISE EXCEPTION 'Ya hay una prórroga pedida: la están revisando.' USING ERRCODE = 'P0001';
  END IF;

  v_vence := public.prorroga_vence_hoy(p_tipo, p_id);
  INSERT INTO public.prorrogas_retiro (reserva_id, encargo_id, customer_id, branch_id, dias, motivo, origen, pedida_por, vence_antes)
  VALUES (CASE WHEN p_tipo = 'reserva' THEN p_id END, CASE WHEN p_tipo = 'encargo' THEN p_id END,
          v_customer, v_branch, p_dias, left(v_motivo, 300), p_origen, p_empleado, v_vence)
  RETURNING id INTO v_id;

  SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = v_customer;
  SELECT name INTO v_sala FROM public.branches WHERE id = v_branch;
  v_dest := public.prorroga_aprobadores();
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP', 'Prórroga por autorizar · ' || v_codigo,
      format('%s pide %s día%s más para %s (%s): %s', 
             CASE WHEN p_origen = 'app' THEN coalesce(v_cliente, 'El cliente') || ', desde la app,' ELSE coalesce(v_sala, 'Una sucursal') END,
             p_dias, CASE WHEN p_dias = 1 THEN '' ELSE 's' END, coalesce(v_producto, 'retirar'),
             coalesce(v_cliente, 'cliente'), left(v_motivo, 160)),
      '/reservas', jsonb_build_object('codigo', v_codigo, 'prorroga_id', v_id, 'check_key', 'prorroga_pedida:' || v_id),
      true, v_branch::integer);
  END IF;
  IF p_origen = 'app' THEN
    v_dest := public.destinatarios_de_reservas(v_branch);
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP', 'El cliente pidió prórroga · ' || v_codigo,
        format('%s pidió %s día%s más desde la app. Sigue separada mientras se decide.', coalesce(v_cliente, 'El cliente'),
               p_dias, CASE WHEN p_dias = 1 THEN '' ELSE 's' END),
        '/reservas', jsonb_build_object('codigo', v_codigo, 'check_key', 'prorroga_pedida_sala:' || v_id), false, v_branch::integer);
    END IF;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (p_empleado, 'PRORROGA_PEDIDA', v_codigo,
          jsonb_build_object('prorroga_id', v_id, 'tipo', p_tipo, 'id', p_id, 'dias', p_dias, 'motivo', v_motivo, 'origen', p_origen),
          v_branch, CASE WHEN p_origen = 'app' THEN 'SYSTEM' ELSE 'ADMIN_PANEL' END);
  RETURN json_build_object('ok', true, 'id', v_id, 'vence', v_vence);
END $function$;

CREATE OR REPLACE FUNCTION public.puntos_aviso_sin_saldo_texto(p_invoice_id bigint, p_pedidos integer, p_tenia integer)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH d AS (
    SELECT coalesce(b.name, 'la sucursal') AS sala,
           coalesce(si.correlativo, '—') AS documento,
           coalesce(cu.name, 'el cliente') AS cliente,
           coalesce(e.nombre_corto, public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name)) AS vendio,
           greatest(coalesce(p_pedidos, 0), 0) AS pedidos,
           greatest(coalesce(p_tenia, 0), 0) AS tenia
      FROM (SELECT 1) uno
      LEFT JOIN public.sales_invoices si ON si.id = p_invoice_id
      LEFT JOIN public.branches b ON b.id = si.branch_id
      LEFT JOIN public.customers cu ON cu.id = si.customer_id
      LEFT JOIN public.employees e ON e.code = si.cod_vendedor
  ), t AS (
    SELECT d.*, greatest(d.pedidos - d.tenia, 0) AS faltaron,
           to_char(d.pedidos, 'FM999,999,990') AS pedidos_txt,
           to_char(d.tenia, 'FM999,999,990') AS tenia_txt,
           to_char(greatest(d.pedidos - d.tenia, 0), 'FM999,999,990') AS faltaron_txt,
           '$' || to_char(d.pedidos / 100.0, 'FM999,990.00') AS descuento_txt,
           '$' || to_char(greatest(d.pedidos - d.tenia, 0) / 100.0, 'FM999,990.00') AS sin_respaldo_txt
      FROM d
  )
  SELECT json_build_object(
    'titulo', CASE WHEN tenia > 0 THEN 'Canje de puntos de más en ' ELSE 'Canje de puntos sin saldo en ' END || sala,
    'cuerpo',
      format('En la venta %s, a %s se le aplicaron %s puntos (%s de descuento), pero ',
             documento, cliente, pedidos_txt, descuento_txt)
      || CASE WHEN tenia > 0
              THEN format('sólo tenía %s. Faltaron %s puntos: %s de descuento se dio sin puntos que lo respaldaran.',
                          tenia_txt, faltaron_txt, sin_respaldo_txt)
              ELSE format('no tenía ninguno. Los %s de descuento se dieron sin puntos que lo respaldaran.',
                          descuento_txt)
         END
      || CASE WHEN vendio IS NOT NULL THEN format(' Vendió: %s.', vendio) ELSE '' END
      || CASE WHEN tenia > 0
              THEN ' Hay que revisar con quien vendió por qué se aplicaron más puntos de los que el cliente tenía.'
              ELSE ' Hay que revisar con quien vendió por qué se aplicaron puntos a un cliente que no tenía.'
         END)
    FROM t;
$function$;

CREATE OR REPLACE FUNCTION public.puntos_vigilar_irregularidades(p_simular boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_desde date;
  v_hallazgos jsonb;
  v_dest uuid[];
  v_nuevos int := 0;
  r record;
  rp record;
BEGIN
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('omitido', 'el programa no funciona en el portal');
  END IF;
  -- Ayer también: lo que entró al filo de la medianoche se juzga completo.
  v_desde := greatest(v_hoy - 1, (SELECT inicio FROM public.puntos_config WHERE id));

  -- Los traspasos de puntos de un cambio de cliente que no terminaron
  -- (2026-10-01). Primero la red: toda solicitud aprobada cuya venta todavía le
  -- da los puntos a otro que el cliente nuevo, aunque nadie haya anotado un
  -- error (la aprobación pudo cortarse entre el sistema y los puntos). Sólo la
  -- ÚLTIMA solicitud de cada venta: una segunda que la devuelve al original
  -- deja a la primera «desalineada» a propósito. Después, reintentar cada
  -- pendiente; el traspaso es una sola transacción, así que reintentar es
  -- seguro.
  IF NOT p_simular THEN
    WITH q AS (
      SELECT ar.id, (ar.metadata->>'invoice_id')::bigint AS inv, (ar.metadata->>'new_client_id')::bigint AS nuevo,
             ar.approver_id, ar.updated_at
        FROM public.approval_requests ar
       WHERE ar.type = 'CLIENT_CHANGE_REQUEST' AND ar.status = 'APPROVED'
         AND ar.updated_at >= (SELECT inicio FROM public.puntos_config WHERE id)::timestamp AT TIME ZONE 'America/El_Salvador'
         AND ar.metadata->>'invoice_id' ~ '^[0-9]+$' AND ar.metadata->>'new_client_id' ~ '^[0-9]+$'
    ), ult AS (
      SELECT DISTINCT ON (inv) * FROM q ORDER BY inv, updated_at DESC
    )
    INSERT INTO public.puntos_cambio_pendiente (solicitud_id, invoice_id, customer_nuevo, por, ultimo_error)
    SELECT u.id, u.inv, u.nuevo, u.approver_id, 'la aprobación no movió los puntos'
      FROM ult u
      JOIN public.puntos_lote l ON l.invoice_id = u.inv AND l.origen = 'venta'
     WHERE l.customer_id <> u.nuevo
       AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = u.nuevo)
    ON CONFLICT (solicitud_id) DO NOTHING;

    FOR rp IN SELECT solicitud_id FROM public.puntos_cambio_pendiente
               WHERE resuelto_at IS NULL AND created_at >= now() - interval '7 days'
    LOOP
      PERFORM public.puntos_cambio_reintentar(rp.solicitud_id);
    END LOOP;
  END IF;

  WITH v AS (
    SELECT l.customer_id, l.ganado_el AS dia, l.puntos, l.sucursal, l.invoice_id,
           coalesce(b.name, l.sucursal) AS sala, si.cod_vendedor, si.correlativo, si.created_at,
           -- Una visita nueva del mismo vendedor si pasó más de media hora: una
           -- compra partida en tres facturas seguidas es UNA visita.
           CASE WHEN si.created_at - lag(si.created_at) OVER (PARTITION BY l.customer_id, l.ganado_el, si.cod_vendedor
                                                               ORDER BY si.created_at) <= interval '30 minutes'
                THEN 0 ELSE 1 END AS visita_nueva
      FROM public.puntos_lote l
      JOIN public.sales_invoices si ON si.id = l.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = l.sucursal
     WHERE l.origen = 'venta' AND l.ganado_el >= v_desde
  ),
  dia AS (
    SELECT customer_id, dia, count(*) AS n, sum(puntos) AS p,
           count(DISTINCT sucursal) AS salas, count(DISTINCT cod_vendedor) AS vendedores,
           string_agg(DISTINCT sala, ', ') AS lista_salas,
           min(created_at) AS primera, max(created_at) AS ultima
      FROM v GROUP BY 1, 2
  ),
  h AS (
    -- 1 · Muchas ventas a la misma ficha en un día. La señal es la cantidad de
    -- VENDEDORES, no de facturas. OJO con de dónde salió el umbral: en el
    -- archivo del sistema anterior esos días parecían 321 al año, pero el 95%
    -- eran facturas reales del MISMO cliente registradas con meses de atraso,
    -- todas juntas (medido cruzando ticket con factura el 2026-10-01). Con la
    -- fecha real de la venta, que es la que mira esto, es mucho más raro.
    SELECT 'muchas_ventas' AS tipo, 'muchas:' || customer_id || ':' || dia AS clave, dia, customer_id,
           NULL::text AS sucursal, NULL::bigint AS invoice_id, NULL::uuid AS employee_id, p::int AS puntos,
           format('%s ventas en un día, de %s vendedores, entre %s y %s', n, vendedores,
                  to_char(primera AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM'),
                  to_char(ultima AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM')) AS nota,
           jsonb_build_object('ventas', n, 'vendedores', vendedores, 'salas', lista_salas) AS detalle
      FROM dia WHERE vendedores >= 4 OR n >= 8
    UNION ALL
    -- 2 · Muchos puntos en un día (si no es ya por muchas ventas).
    SELECT 'acumulacion_alta', 'alta:' || customer_id || ':' || dia, dia, customer_id,
           lista_salas, NULL, NULL, p::int,
           format('%s puntos en un día, en %s %s', p, n, CASE WHEN n = 1 THEN 'venta' ELSE 'ventas' END),
           jsonb_build_object('ventas', n)
      FROM dia WHERE p >= 500 AND NOT (vendedores >= 4 OR n >= 8)
    UNION ALL
    -- 3 · Compras en 3 o más salas el mismo día.
    SELECT 'varias_salas', 'salas:' || customer_id || ':' || dia, dia, customer_id,
           lista_salas, NULL, NULL, p::int,
           format('Compró en %s sucursales el mismo día (%s)', salas, lista_salas),
           jsonb_build_object('ventas', n, 'salas', lista_salas)
      FROM dia WHERE salas >= 3
    UNION ALL
    -- 4 · Un vendedor atiende a la misma ficha en 3+ visitas separadas (3 al año
    -- en el sistema anterior; contando facturas daba 502 y casi todas eran una
    -- compra partida).
    SELECT 'mismo_vendedor', 'vendedor:' || x.customer_id || ':' || x.cod_vendedor || ':' || x.dia, x.dia,
           x.customer_id, x.salas, NULL, e.id, x.p::int,
           format('%s le cargó ventas en %s momentos distintos del día (%s facturas)', coalesce(public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name), 'El vendedor ' || x.cod_vendedor), x.visitas, x.n),
           jsonb_build_object('ventas', x.n, 'visitas', x.visitas, 'cod_vendedor', x.cod_vendedor)
      FROM (SELECT customer_id, dia, cod_vendedor, count(*) n, sum(visita_nueva) visitas, sum(puntos) p,
                   string_agg(DISTINCT sala, ', ') salas
              FROM v WHERE cod_vendedor IS NOT NULL GROUP BY 1, 2, 3 HAVING sum(visita_nueva) >= 3) x
      LEFT JOIN public.employees e ON e.code = x.cod_vendedor
    UNION ALL
    -- 5 · Un empleado se factura a su propia ficha. Por DUI cuando lo tiene; si
    -- no, por nombre: su nombre del portal (primer nombre + apellido) completo
    -- dentro del de la ficha y con el mismo primer nombre. Hacía falta porque
    -- ningún empleado tiene el DUI cargado. Medido jul–sep 2026: 25 empleados,
    -- los 25 son la misma persona, pero son ~450 ventas — casi todas compras
    -- propias normales. Por eso se avisa por empleado y día, y sólo con 3+
    -- facturas o 50+ puntos (47 días en 92, ~1 cada 2 días).
    SELECT 'venta_a_si_mismo', 'propia:' || x.emp_id || ':' || x.dia, x.dia, x.customer_id,
           x.salas, NULL, x.emp_id, x.p::int,
           format('%s se facturó a su propia ficha %s %s en el día%s', x.corto, x.n,
                  CASE WHEN x.n = 1 THEN 'vez' ELSE 'veces' END,
                  CASE WHEN x.por_dui THEN '' ELSE ' (coincide por nombre; no tiene DUI cargado)' END),
           jsonb_build_object('ventas', x.n, 'documentos', x.docs, 'por_dui', x.por_dui)
      FROM (SELECT e.id AS emp_id, v.customer_id, v.dia, count(*) n, sum(v.puntos) p,
                   string_agg(DISTINCT v.sala, ', ') salas, bool_or(k.por_dui) por_dui,
                   jsonb_agg(v.correlativo) docs,
                   public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name) corto
              FROM v
              JOIN public.employees e ON e.code = v.cod_vendedor
              JOIN public.customers c ON c.id = v.customer_id
              CROSS JOIN LATERAL (SELECT
                  string_to_array(trim(regexp_replace(upper(translate(e.name, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUNNUU')), '[^A-Z]+', ' ', 'g')), ' ') AS te,
                  string_to_array(trim(regexp_replace(upper(translate(c.name, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUNNUU')), '[^A-Z]+', ' ', 'g')), ' ') AS tc,
                  length(regexp_replace(coalesce(e.dui, ''), '\D', '', 'g')) = 9
                    AND regexp_replace(coalesce(e.dui, ''), '\D', '', 'g') = regexp_replace(coalesce(c.dui, ''), '\D', '', 'g') AS por_dui) k
             WHERE k.por_dui OR (array_length(k.te, 1) >= 2 AND k.tc[1] = k.te[1] AND k.tc @> k.te)
             GROUP BY e.id, e.first_names, e.last_names, e.name, v.customer_id, v.dia) x
     WHERE x.n >= 3 OR x.p >= 50
    UNION ALL
    -- 6 · Puntos dados a mano. Los del cuadre del arranque no llevan autor.
    SELECT 'ajuste_suma', 'ajuste_lote:' || l.id, l.ganado_el, l.customer_id,
           NULL, NULL, l.creado_por, l.puntos,
           'Puntos dados a mano: ' || coalesce(l.motivo, 'sin motivo'), NULL
      FROM public.puntos_lote l
     WHERE l.origen = 'ajuste' AND l.ganado_el >= v_desde AND l.creado_por IS NOT NULL
    UNION ALL
    -- 7 · Puntos quitados a mano.
    SELECT 'ajuste_resta', 'ajuste_salida:' || s.id, (s.created_at AT TIME ZONE 'America/El_Salvador')::date,
           s.customer_id, NULL, NULL, s.autorizado_por, -s.puntos,
           'Puntos quitados a mano: ' || coalesce(s.motivo, 'sin motivo'), NULL
      FROM public.puntos_salida s
     WHERE s.tipo = 'ajuste' AND s.created_at >= v_desde::timestamp AT TIME ZONE 'America/El_Salvador'
       AND s.autorizado_por IS NOT NULL
    UNION ALL
    -- 8 · Canje grande, o canje hecho con puntos recién ganados.
    SELECT CASE WHEN s.puntos >= 2000 THEN 'canje_grande' ELSE 'canje_recien_ganado' END,
           'canje:' || s.id, (s.created_at AT TIME ZONE 'America/El_Salvador')::date,
           s.customer_id, s.sucursal, s.invoice_id, NULL, s.puntos,
           CASE WHEN s.puntos >= 2000 THEN format('Canje de %s puntos', s.puntos)
                ELSE format('Canjeó %s puntos y %s los ganó en los 3 días anteriores', s.puntos, rec.p) END,
           jsonb_build_object('ganados_3_dias', rec.p)
      FROM public.puntos_salida s
      CROSS JOIN LATERAL (
        SELECT coalesce(sum(l.puntos), 0) AS p FROM public.puntos_lote l
         WHERE l.customer_id = s.customer_id AND l.origen IN ('venta', 'ajuste')
           AND l.ganado_el BETWEEN (s.created_at AT TIME ZONE 'America/El_Salvador')::date - 3
                               AND (s.created_at AT TIME ZONE 'America/El_Salvador')::date) rec
     WHERE s.tipo = 'canje' AND s.revertida_at IS NULL
       AND s.created_at >= v_desde::timestamp AT TIME ZONE 'America/El_Salvador'
       AND (s.puntos >= 2000 OR (rec.p >= 300 AND rec.p * 2 >= s.puntos))
    UNION ALL
    -- 9 · Factura anulada cuando sus puntos ya se habían canjeado. Ya figura en
    -- Avisos por su cuenta; acá sólo se agrega para que llegue el aviso.
    SELECT 'anulada_gastada', 'anulada:' || g.invoice_id, (g.created_at AT TIME ZONE 'America/El_Salvador')::date,
           g.customer_id, g.sucursal, g.invoice_id, NULL, g.no_recuperados,
           format('Se anuló una factura cuyos puntos ya se habían canjeado: %s puntos no se recuperaron', g.no_recuperados),
           NULL
      FROM public.puntos_anulacion_gastada g
     WHERE g.created_at >= v_desde::timestamp AT TIME ZONE 'America/El_Salvador'
    UNION ALL
    -- 10 · Una venta pasada a otro cliente con sus puntos (2026-10-01). Siempre:
    -- es justo el movimiento que se querría esconder, y es raro.
    SELECT 'cambio_cliente', 'cambio:' || k.id, (k.created_at AT TIME ZONE 'America/El_Salvador')::date,
           k.a_customer, NULL, k.invoice_id, k.por, k.puntos,
           format('Recibió la compra de %s con sus %s puntos', coalesce(cd.name, 'otro cliente'), k.puntos)
           || CASE WHEN k.no_recuperados > 0
                   THEN format('; %s ya los había gastado y no se recuperaron', k.no_recuperados) ELSE '' END,
           jsonb_build_object('de_customer', k.de_customer, 'quitados', k.quitados, 'no_recuperados', k.no_recuperados)
      FROM public.puntos_cambio_cliente k
      LEFT JOIN public.customers cd ON cd.id = k.de_customer
     WHERE k.created_at >= v_desde::timestamp AT TIME ZONE 'America/El_Salvador'
    UNION ALL
    -- 11 · Un traspaso de puntos que ni reintentando entró. Se avisa cuando
    -- lleva 15 minutos pendiente: los 3 intentos de la aprobación y al menos 3
    -- del aviso. Se sigue reintentando solo; desde Avisos se reintenta o se
    -- marca como hecho a mano.
    SELECT 'cambio_cliente_fallido', 'cambio_fallido:' || pc.solicitud_id,
           (pc.created_at AT TIME ZONE 'America/El_Salvador')::date,
           pc.customer_nuevo, NULL, pc.invoice_id, pc.por, l.puntos,
           format('La venta %s se pasó a este cliente pero sus puntos no se movieron, ni reintentando. Último error: %s',
                  coalesce(si.correlativo, '#' || pc.invoice_id), left(coalesce(pc.ultimo_error, '—'), 200)),
           jsonb_build_object('solicitud_id', pc.solicitud_id)
      FROM public.puntos_cambio_pendiente pc
      LEFT JOIN public.sales_invoices si ON si.id = pc.invoice_id
      LEFT JOIN public.puntos_lote l ON l.invoice_id = pc.invoice_id AND l.origen = 'venta'
     WHERE pc.resuelto_at IS NULL AND pc.created_at < now() - interval '15 minutes'
    UNION ALL
    -- 12 · Una ficha con nombre de negocio (farmacia, clínica, ferretería…)
    -- que puede ser de una persona natural o de una empresa (2026-10-23,
    -- Reglamento v2, cláusula 2.2). Las de forma legal (S.A. DE C.V., ASOCIACIÓN…)
    -- ya quedaron jurídicas solas; éstas las decide una persona en la ficha.
    -- Mientras tanto acumula como persona natural.
    SELECT 'persona_por_evaluar', 'persona:' || c.id, v_hoy,
           c.id, NULL, NULL, NULL, NULL,
           'Su nombre parece de un negocio: hay que decidir si es persona natural o jurídica',
           NULL
      FROM public.customers c
     WHERE c.tipo_persona_revisar
  )
  SELECT coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) INTO v_hallazgos FROM h;

  IF p_simular THEN
    RETURN json_build_object('simulado', true, 'desde', v_desde, 'hallazgos', v_hallazgos);
  END IF;

  SELECT ARRAY[e.id] INTO v_dest
    FROM public.puntos_config pc JOIN public.employees e ON e.id = pc.avisar_fallas_a
   WHERE pc.id AND e.status = 'ACTIVO';
  IF v_dest IS NULL THEN
    SELECT array_agg(e.id) INTO v_dest FROM public.employees e
     WHERE e.status = 'ACTIVO' AND e.role_id IN (2, 3);
  END IF;

  FOR r IN
    WITH ins AS (
      INSERT INTO public.puntos_irregularidad
        (clave, tipo, dia, customer_id, sucursal, invoice_id, employee_id, puntos, nota, detalle)
      SELECT x.clave, x.tipo, x.dia, x.customer_id, x.sucursal, x.invoice_id, x.employee_id, x.puntos, x.nota, x.detalle
        FROM jsonb_to_recordset(v_hallazgos) AS x(clave text, tipo text, dia date, customer_id bigint, sucursal text,
             invoice_id bigint, employee_id uuid, puntos int, nota text, detalle jsonb)
      ON CONFLICT (clave) DO UPDATE
        SET puntos = EXCLUDED.puntos, nota = EXCLUDED.nota, detalle = EXCLUDED.detalle,
            sucursal = EXCLUDED.sucursal, updated_at = now()
        WHERE (puntos_irregularidad.puntos, puntos_irregularidad.nota)
              IS DISTINCT FROM (EXCLUDED.puntos, EXCLUDED.nota)
      RETURNING id, nota, customer_id, avisado_at
    )
    -- Desde la salida del INSERT y no releyendo la tabla: dentro del mismo
    -- comando la consulta de afuera no ve las filas recién insertadas.
    SELECT ins.id, ins.nota, ins.customer_id, c.name AS cliente
      FROM ins LEFT JOIN public.customers c ON c.id = ins.customer_id
     WHERE ins.avisado_at IS NULL
  LOOP
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'PUNTOS_IRREGULAR',
        'Puntos: movimiento fuera de lo normal',
        coalesce(r.cliente, 'Cliente ' || r.customer_id) || ' — ' || r.nota,
        '/puntos?tab=avisos', jsonb_build_object('check_key', 'puntos_irregular:' || r.id), true, NULL);
    END IF;
    UPDATE public.puntos_irregularidad SET avisado_at = now() WHERE id = r.id;
    v_nuevos := v_nuevos + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'hallazgos', jsonb_array_length(v_hallazgos), 'avisados', v_nuevos);
END;
$function$;

CREATE OR REPLACE FUNCTION public.quitar_extra_de_pedido(p_item_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := auth_employee_id();
    v_it    record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    SELECT * INTO v_it FROM public.pedido_items WHERE id = p_item_id FOR UPDATE;
    IF v_it.id IS NULL THEN
        RAISE EXCEPTION 'ITEM_NO_EXISTE';
    END IF;
    IF NOT v_it.es_extra THEN
        RAISE EXCEPTION 'NO_ES_EXTRA: ese producto venía en el pedido y no se puede quitar';
    END IF;
    IF auth_module_scope('pedidos') <> 'ALL'
       AND auth_employee_erp_sucursal_id() IS DISTINCT FROM v_it.erp_sucursal_id THEN
        RAISE EXCEPTION 'OTRA_SALA: lo quita la sucursal que lo anotó';
    END IF;
    IF v_it.status = 'anulado' THEN
        RETURN;
    END IF;
    IF v_it.resolucion_status IS NOT NULL AND v_it.resolucion_status <> 'propuesta' THEN
        RAISE EXCEPTION 'YA_EN_CURSO: bodega ya contestó esta diferencia; '
                        'no se puede quitar sin dejar rastro';
    END IF;
    IF NOT public.recepcion_corregible(v_it.pedido_id, v_it.erp_sucursal_id) THEN
        RAISE EXCEPTION 'PLAZO_VENCIDO: un error de la recepción se reporta hasta 2 días después '
                        'de cerrarla. Pasado ese plazo lo levanta un supervisor o administrador.';
    END IF;

    UPDATE public.pedido_items
       SET status              = 'anulado',
           error_tipo          = NULL,
           resolucion_status   = NULL,
           resolucion_tipo     = NULL,
           resolucion_nota     = NULL,
           resolucion_vence_at = NULL
     WHERE id = p_item_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    VALUES (p_item_id, v_it.pedido_id, v_it.erp_sucursal_id, 'extra_quitado',
            v_it.resolucion_tipo,
            CASE WHEN v_it.resolucion_status IS NOT NULL
                 THEN 'Se quitó con su propuesta sin contestar' END,
            v_actor);

    IF EXISTS (SELECT 1 FROM public.pedido_sucursal_status
                WHERE pedido_id = v_it.pedido_id AND erp_sucursal_id = v_it.erp_sucursal_id
                  AND recibido_erp_at IS NOT NULL) THEN
        PERFORM public.cerrar_pedido_si_todo_resuelto(v_it.pedido_id, v_it.erp_sucursal_id, v_actor);
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.quitar_renglon(p_renglon_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_r     public.promocion_renglon%ROWTYPE;
    v_prod  text;
    v_dec   integer;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;

    SELECT * INTO v_r FROM public.promocion_renglon WHERE id = p_renglon_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: el producto % no existe', p_renglon_id; END IF;

    SELECT count(*) INTO v_dec FROM public.promocion_excedente
     WHERE renglon_id = p_renglon_id AND estado <> 'por_decidir';
    IF v_dec > 0 THEN
        RAISE EXCEPTION 'TIENE_DECISIONES: ya se decidieron % excedentes de este producto; no se puede quitar', v_dec;
    END IF;

    SELECT nombre INTO v_prod FROM public.products WHERE id = v_r.erp_product_id;

    PERFORM public.promocion_log(
        v_r.promocion_id, NULL, NULL, 'renglon_quitado',
        v_prod, NULL, 'se quitó de la promoción');

    DELETE FROM public.promocion_renglon WHERE id = p_renglon_id;

    RETURN json_build_object('quitado', p_renglon_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.quitar_renglones_sin_salir(p_request_id uuid, p_motivo text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r      public.approval_requests%ROWTYPE;
    v_yo   uuid := public.auth_employee_id();
    v_mi   integer;
    v_todo boolean;
    v_org  integer;
    v_n    integer;
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'Sesión inválida.'; END IF;

    SELECT * INTO r FROM public.approval_requests
     WHERE id = p_request_id AND type = 'INVENTORY_TRANSFER_PUSH';
    IF r.id IS NULL THEN RAISE EXCEPTION 'Ese traslado no existe.'; END IF;
    IF r.status = 'CANCELLED' THEN RAISE EXCEPTION 'Ese traslado ya está cancelado.'; END IF;

    IF nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Escribe por qué quitas el producto del traslado.';
    END IF;

    -- Si no salió nada, la salida es cancelar el envío entero (`cancelar_envio`).
    IF NOT EXISTS (SELECT 1 FROM public.envio_linea l
                    WHERE l.request_id = p_request_id AND l.enviado_at IS NOT NULL) THEN
        RAISE EXCEPTION 'No salió nada de este traslado. Cancélalo entero.';
    END IF;

    -- Mismo permiso que cancelar: la sala de la que iba a salir, quien lo armó,
    -- o alcance sobre todas en traslados.
    v_org := nullif(r.metadata->>'origen_branch_id','')::integer;
    SELECT coalesce(public.sala_de_apoyo_vigente(id), branch_id) INTO v_mi FROM public.employees WHERE id = v_yo;
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
         WHERE e.id = v_yo
           AND EXISTS (SELECT 1 FROM public.role_permissions rp
                        WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))
                          AND rp.module_key = 'traslados' AND rp.scope = 'ALL')
    ) INTO v_todo;

    IF NOT v_todo AND v_yo IS DISTINCT FROM r.employee_id AND v_mi IS DISTINCT FROM v_org THEN
        RAISE EXCEPTION 'Esto lo resuelve la sucursal de la que iba a salir el producto.';
    END IF;

    -- Sólo lo que de verdad no salió: `enviado_at` y no el estado, igual que
    -- en `cancelar_envio`.
    UPDATE public.envio_linea
       SET estado = 'cancelada',
           error = 'Se quitó del envío antes de salir: ' || btrim(p_motivo),
           updated_at = now()
     WHERE request_id = p_request_id
       AND enviado_at IS NULL
       AND estado IN ('por_enviar', 'error');
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_n = 0 THEN
        RAISE EXCEPTION 'A este traslado no le queda nada sin salir.';
    END IF;

    RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.receta_app_de_dispensacion(p_dispensacion_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE d public.bitacora_dispensaciones;
BEGIN
  SELECT * INTO d FROM public.bitacora_dispensaciones WHERE id = p_dispensacion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese folio no existe.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.bitacora_exigir_acceso(d.branch_id, 'can_view');
  IF d.customer_id IS NULL THEN RETURN '[]'::json; END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'reserva_id', r.id, 'pedido', r.pedido, 'branch_id', r.branch_id, 'sala', b.name,
      'receta_ruta', r.receta_ruta, 'receta_revisada_at', r.receta_revisada_at,
      'revisada_por', e.name, 'revisada_por_id', r.receta_revisada_por, 'estado', r.estado)
      ORDER BY r.receta_revisada_at DESC)
      FROM public.app_reservas r
      JOIN public.branches b ON b.id = r.branch_id
      LEFT JOIN public.employees e ON e.id = r.receta_revisada_por
     WHERE r.customer_id = d.customer_id AND r.producto_id = d.erp_product_id
       AND r.receta_estado = 'aprobada' AND r.receta_ruta IS NOT NULL
       AND r.receta_revisada_at >= (d.fecha - 60)::timestamptz
       AND r.receta_revisada_at < (d.fecha + 1)::timestamptz), '[]'::json);
END $function$;

CREATE OR REPLACE FUNCTION public.reclamar_factura_compra(p_document_id bigint, p_branch_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp          uuid;
  v_nombre       text;
  v_rule         bigint;
  v_asignacion   text;
  v_linea        text;
  v_branch_linea bigint;
  v_origen       text;
  v_claim        bigint;
BEGIN
  PERFORM public.facturas_sala_guarda(p_branch_id, 'can_edit');

  -- Empleado ACTIVO, resuelto del JWT. Nunca de un parámetro.
  --
  -- `'ACTIVO'`, no `'ACTIVE'`. El valor lo fija `chk_employees_status`
  -- (ACTIVO/INACTIVO/BAJA/LIQUIDADO/SUSPENDIDO), así que `'ACTIVE'` no puede
  -- existir en ninguna fila: la comparación no devolvía «este empleado no está
  -- activo», devolvía NINGÚN empleado, siempre.
  SELECT e.id, e.name INTO v_emp, v_nombre
    FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Tu usuario no está activo.';
  END IF;

  -- Solo se puede tomar un documento que alguna regla habilite. Sin esto, el
  -- widget sería una puerta para apropiarse de cualquier factura de la empresa.
  SELECT r.id, r.asignacion, public.linea_telefonica_de(d.items_text)
    INTO v_rule, v_asignacion, v_linea
    FROM public.purchase_dte_documents d
    JOIN public.purchase_claim_rules r
      ON r.activo
     AND (r.emisor_nit  IS NULL OR d.emisor_nit = r.emisor_nit)
     AND (r.item_patron IS NULL OR d.items_norm ILIKE '%' || r.item_patron || '%')
   WHERE d.id = p_document_id AND NOT d.invalidado
   ORDER BY r.orden, r.id
   LIMIT 1;

  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'Esa factura no está habilitada para tomarse desde la sucursal.';
  END IF;

  -- La línea mapeada es la dueña del documento. La lista ya no se lo muestra a
  -- nadie más, pero el RPC es llamable por su cuenta: sin esta guarda, una sala
  -- podía quedarse con la factura de la línea de otra y el error solo se veía
  -- días después, cuando la dueña no encontraba la suya.
  IF v_asignacion = 'linea' AND v_linea IS NOT NULL THEN
    SELECT l.branch_id INTO v_branch_linea
      FROM public.purchase_claim_lines l
     WHERE l.rule_id = v_rule AND l.linea = v_linea;
  END IF;

  IF v_branch_linea IS NOT NULL AND v_branch_linea <> p_branch_id THEN
    RAISE EXCEPTION 'Esta factura es de la línea de otra sucursal.';
  END IF;

  v_origen := CASE WHEN v_branch_linea IS NOT NULL THEN 'linea' ELSE 'reclamo' END;

  -- El candado es el índice único parcial, no este INSERT. Si otra sala entró
  -- primero —aunque haya sido en el mismo segundo— Postgres levanta 23505 acá.
  BEGIN
    INSERT INTO public.purchase_dte_claims
           (document_id, rule_id, branch_id, origen, claimed_by, claimed_by_name)
    VALUES (p_document_id, v_rule, p_branch_id, v_origen, v_emp, v_nombre)
    RETURNING id INTO v_claim;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Otra sucursal tomó esta factura primero.';
  END;

  RETURN v_claim;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reclamo_registrar(p_programa text, p_branch_id bigint, p_tema text, p_customer_id bigint DEFAULT NULL::bigint, p_nombre text DEFAULT NULL::text, p_telefono text DEFAULT NULL::text)
 RETURNS reclamos_clientes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp uuid := public.auth_employee_id();
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_tel text := nullif(btrim(coalesce(p_telefono, '')), '');
  v_r public.reclamos_clientes;
  v_dest uuid[];
  v_sala text;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('reclamos_clientes', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF public.auth_module_scope('reclamos_clientes') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'Elige la sucursal donde se presenta el reclamo';
  END IF;
  IF coalesce(p_programa, '') NOT IN ('puntos', 'reservas', 'mayorista') THEN RAISE EXCEPTION 'Elige sobre qué es el reclamo'; END IF;
  IF nullif(btrim(coalesce(p_tema, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribe de qué se trata el reclamo'; END IF;
  IF p_customer_id IS NOT NULL THEN
    SELECT coalesce(v_nombre, c.name), coalesce(v_tel, nullif(btrim(c.phone), '')) INTO v_nombre, v_tel
      FROM public.customers c WHERE c.id = p_customer_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese cliente no existe'; END IF;
  END IF;
  IF v_nombre IS NULL THEN RAISE EXCEPTION 'Escribe el nombre de quien reclama'; END IF;

  INSERT INTO public.reclamos_clientes (programa, customer_id, cliente_nombre, cliente_telefono, tema, branch_id, recibido_por, vence)
  VALUES (p_programa, p_customer_id, v_nombre, v_tel, btrim(p_tema), p_branch_id, v_emp, public.sumar_dias_habiles(v_hoy, 10))
  RETURNING * INTO v_r;

  INSERT INTO public.audit_logs (action, target_id, user_id, user_name, source, severity, details, branch_id)
  VALUES ('REGISTRAR_RECLAMO_CLIENTE', v_r.id::text, v_emp, (SELECT name FROM public.employees WHERE id = v_emp),
          'ADMIN_PANEL', 'INFO', jsonb_build_object('folio', v_r.folio, 'programa', v_r.programa, 'vence', v_r.vence), p_branch_id);

  v_dest := public.reclamos_destinatarios();
  SELECT name INTO v_sala FROM public.branches WHERE id = p_branch_id;
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'RECLAMO_CLIENTE', 'Reclamo de un cliente en ' || coalesce(v_sala, 'sala'),
      v_nombre || ': ' || left(btrim(p_tema), 140) || ' · Hay que responder a más tardar el ' || to_char(v_r.vence, 'DD/MM/YYYY') || '.',
      '/reclamos-clientes', jsonb_build_object('reclamo_id', v_r.id, 'check_key', 'reclamo:' || v_r.id || ':nuevo'), true, NULL);
  END IF;
  RETURN v_r;
END $function$;

CREATE OR REPLACE FUNCTION public.regencia_registrar_visita(p_branch_id bigint, p_fecha date, p_entrada time without time zone, p_salida time without time zone, p_actividades text[], p_notas text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_yo       uuid := public.auth_employee_id();
  v_regente  uuid;
  v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_validas  text[] := ARRAY['controlados','recetas_antibioticos','vencidos','bitacoras','capacitacion',
                             'farmacovigilancia','autoinspeccion','recepcion','otro'];
  v_choque   record;
  v_id       bigint;
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  SELECT nullif(x.datos->'legal'->>'regentEmployeeId', '')::uuid INTO v_regente
    FROM public.sucursal_expediente x WHERE x.branch_id = p_branch_id;
  IF v_regente IS NULL THEN
    RAISE EXCEPTION 'SIN_REGENTE' USING HINT = 'Esta sucursal no tiene regente asignado en su expediente.';
  END IF;
  IF v_yo <> v_regente AND NOT (public.auth_has_module_permission('bitacoras_tab_regencia', 'can_edit')
                                AND public.auth_module_scope('bitacoras_tab_regencia') = 'ALL') THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'Sólo el regente de la sucursal anota sus visitas.';
  END IF;
  IF p_fecha IS NULL OR p_fecha > v_hoy THEN
    RAISE EXCEPTION 'FECHA_INVALIDA' USING HINT = 'La visita no puede ser de un día que no ha llegado.';
  END IF;
  IF p_fecha < v_hoy - 60 THEN
    RAISE EXCEPTION 'FECHA_INVALIDA' USING HINT = 'Sólo se anotan visitas de los últimos 60 días.';
  END IF;
  IF p_entrada IS NULL OR p_salida IS NULL OR p_salida <= p_entrada THEN
    RAISE EXCEPTION 'HORARIO_INVALIDO' USING HINT = 'La salida tiene que ser después de la entrada.';
  END IF;
  IF p_salida - p_entrada > interval '12 hours' THEN
    RAISE EXCEPTION 'HORARIO_INVALIDO' USING HINT = 'Una visita no puede pasar de 12 horas.';
  END IF;
  IF coalesce(array_length(p_actividades, 1), 0) = 0 THEN
    RAISE EXCEPTION 'SIN_ACTIVIDADES' USING HINT = 'Anota al menos una actividad realizada.';
  END IF;
  IF NOT (p_actividades <@ v_validas) THEN
    RAISE EXCEPTION 'ACTIVIDAD_INVALIDA';
  END IF;
  -- El mismo regente no puede estar en dos salas a la vez.
  SELECT v.fecha, v.entrada, v.salida, b.name AS sala INTO v_choque
    FROM public.regencia_visitas v JOIN public.branches b ON b.id = v.branch_id
   WHERE v.regente_id = v_regente AND v.fecha = p_fecha AND v.anulada_at IS NULL
     AND v.entrada < p_salida AND p_entrada < v.salida
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'CHOQUE_DE_HORARIO' USING HINT = format('Ese horario se cruza con la visita de %s a %s en %s.',
      to_char(v_choque.entrada, 'FMHH12:MI') || CASE WHEN v_choque.entrada < '12:00' THEN ' a. m.' ELSE ' p. m.' END, to_char(v_choque.salida, 'FMHH12:MI') || CASE WHEN v_choque.salida < '12:00' THEN ' a. m.' ELSE ' p. m.' END, v_choque.sala);
  END IF;

  INSERT INTO public.regencia_visitas (branch_id, regente_id, fecha, entrada, salida, actividades, notas, registrado_por)
  VALUES (p_branch_id, v_regente, p_fecha, p_entrada, p_salida, p_actividades, nullif(btrim(p_notas), ''), v_yo)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, branch_id, details)
  VALUES (v_yo, (SELECT e.name FROM public.employees e WHERE e.id = v_yo), 'REGENCIA_VISITA', v_id::text, 'ADMIN_PANEL', 'INFO', p_branch_id,
          jsonb_build_object('regente_id', v_regente, 'fecha', p_fecha, 'entrada', p_entrada, 'salida', p_salida,
                             'actividades', p_actividades, 'en_su_nombre', v_yo <> v_regente));
  RETURN json_build_object('id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_caja_de_impresion(p_branch_id bigint, p_nombre text, p_impresora text DEFAULT 'pos-80'::text)
 RETURNS TABLE(id uuid, token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['impresion'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_branch_id IS NULL OR btrim(coalesce(p_nombre,'')) = '' THEN
        RAISE EXCEPTION 'Falta la sucursal o el nombre de la caja.';
    END IF;

    RETURN QUERY
    INSERT INTO public.impresion_dispositivos (branch_id, nombre, impresora, created_by)
    VALUES (p_branch_id, btrim(p_nombre), coalesce(nullif(btrim(p_impresora),''), 'pos-80'),
            (SELECT auth_employee_id()))
    RETURNING impresion_dispositivos.id, impresion_dispositivos.token;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_pago_compra(p_emisor_nit text, p_fecha date, p_forma text, p_referencia text, p_aplicaciones jsonb, p_nota text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp uuid; v_pago bigint; v_total numeric(12,2) := 0; r record; v_saldo numeric(12,2);
  v_repetidas integer;
BEGIN
  IF NOT public.auth_has_module_permission('cuentas_por_pagar','can_edit') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar pagos.';
  END IF;

  SELECT e.id INTO v_emp FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Tu usuario no está activo.'; END IF;

  IF p_aplicaciones IS NULL OR jsonb_array_length(p_aplicaciones) = 0 THEN
    RAISE EXCEPTION 'Un pago tiene que decir a qué facturas se aplica.';
  END IF;

  -- En fila con cualquier otro pago a este proveedor: el saldo de abajo se lee
  -- después de que el anterior terminó de aplicar el suyo.
  PERFORM pg_advisory_xact_lock(hashtext('registrar_pago_compra:' || coalesce(p_emisor_nit, '')));

  -- La misma factura dos veces en el mismo pago: se dice antes de escribir
  -- nada, en vez de dejar que reviente el índice único.
  SELECT count(*) INTO v_repetidas FROM (
      SELECT (x->>'document_id')::bigint AS doc
        FROM jsonb_array_elements(p_aplicaciones) x
       GROUP BY 1 HAVING count(*) > 1) z;
  IF v_repetidas > 0 THEN
    RAISE EXCEPTION 'Una misma factura no puede ir dos veces en el mismo pago.';
  END IF;

  -- El monto del pago es la SUMA de lo aplicado, no un número aparte: así no
  -- puede haber un pago de $500 repartido en $300.
  SELECT sum((x->>'monto')::numeric) INTO v_total
    FROM jsonb_array_elements(p_aplicaciones) x;
  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'El monto del pago tiene que ser mayor que cero.';
  END IF;

  INSERT INTO public.compra_pagos (emisor_nit, fecha, monto, forma, referencia, nota, registrado_por)
  VALUES (p_emisor_nit, p_fecha, v_total, p_forma, nullif(btrim(p_referencia),''), nullif(btrim(p_nota),''), v_emp)
  RETURNING id INTO v_pago;

  FOR r IN SELECT (x->>'document_id')::bigint AS doc, (x->>'monto')::numeric AS monto
             FROM jsonb_array_elements(p_aplicaciones) x
  LOOP
    IF r.monto IS NULL OR r.monto <= 0 THEN
      RAISE EXCEPTION 'Cada aplicación tiene que ser mayor que cero.';
    END IF;

    SELECT (d.monto - d.aplicado - d.en_tramite) INTO v_saldo
      FROM public.compra_deuda_documentos d
     WHERE d.document_id = r.doc AND d.emisor_nit = p_emisor_nit;

    IF v_saldo IS NULL THEN
      RAISE EXCEPTION 'La factura % no es deuda de ese proveedor.', r.doc;
    END IF;
    -- `v_saldo` ya descuenta lo que otros pagos pendientes reservaron sobre esa
    -- factura: dos pagos en trámite no pueden sumar más de lo que se debe.
    IF r.monto > v_saldo THEN
      RAISE EXCEPTION 'A la factura % sólo le quedan % por pagar.', r.doc, v_saldo;
    END IF;

    INSERT INTO public.compra_pago_aplicado (pago_id, document_id, monto)
    VALUES (v_pago, r.doc, r.monto);
  END LOOP;

  RETURN v_pago;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_salida_de_bolsa(p_tipo text, p_monto numeric, p_repartos jsonb, p_entidad text DEFAULT NULL::text, p_numero_boleta text DEFAULT NULL::text, p_foto_url text DEFAULT NULL::text, p_nota text DEFAULT NULL::text, p_recibido_por uuid DEFAULT NULL::uuid, p_metodo text DEFAULT NULL::text, p_vale uuid DEFAULT NULL::uuid, p_motivo_sin_comprobante text DEFAULT NULL::text)
 RETURNS bolsas_operaciones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    t public.bolsas_tipos_salida; v_oper public.bolsas_operaciones;
    v_yo uuid := (SELECT auth_employee_id());
    v_scope text := (SELECT auth_module_scope('bolsas'));
    v_mia bigint := (SELECT auth_employee_branch_id());
    v_branch bigint; v_suma numeric := 0; v_codigo text; r record; b public.bolsas;
    v_vale public.identidad_vales;
    v_entidad text := nullif(btrim(coalesce(p_entidad, '')), '');
    v_del_catalogo text;
    v_paso numeric;
    v_regla json;
    v_autoriza boolean := false;
    v_motivo text := nullif(btrim(coalesce(p_motivo_sin_comprobante, '')), '');
    v_sol uuid;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO t FROM public.bolsas_tipos_salida WHERE codigo = p_tipo AND activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese motivo no existe.'; END IF;
    IF p_monto IS NULL OR p_monto < 0 THEN RAISE EXCEPTION 'Hay que decir cuánto.'; END IF;
    IF t.signo <> 0 AND p_monto = 0 THEN RAISE EXCEPTION 'Hay que decir cuánto.'; END IF;

    -- La entidad se exige sólo cuando la contesta una PERSONA. Con
    -- `entidad_la_dice_el_papel` sale de la boleta y puede no haber ninguna —un
    -- retiro por token no tiene remesadora—, así que pedirla acá dejaba sin
    -- forma de registrar la salida. Es la MISMA condición que aplica
    -- `SalidaDeBolsa`; escrita en dos sitios porque no hay uno solo que valga
    -- para los dos runtimes, y por eso se mueven juntas.
    IF t.etiqueta_entidad IS NOT NULL
       AND NOT coalesce(t.entidad_la_dice_el_papel, false)
       AND v_entidad IS NULL THEN
        RAISE EXCEPTION 'Falta el dato: %.', t.etiqueta_entidad; END IF;

    -- ── ¿En cuánto se reparte? Lo decide el MONTO, para todos los vales ─────
    -- $500 sale en billetes de $10, $55 en billetes de $5, $125.75 exacto. Ya
    -- no depende del motivo: ver `paso_de_monto`.
    v_paso := CASE WHEN t.signo = -1 THEN public.paso_de_monto(p_monto) END;

    -- El catálogo manda cuando existe. Se compara normalizado —sin espacios de
    -- sobra y sin distinguir mayúsculas— porque el valor viene de un
    -- desplegable, pero el nombre que se GUARDA es el de la fila: así el dato
    -- coincide con el catálogo por construcción y no por suerte.
    --
    -- Sólo sobre una entidad que LLEGÓ: sin `v_entidad IS NOT NULL`, una salida
    -- que legítimamente no trae entidad no emparejaba con ninguna fila y caía
    -- en «no está en la lista», que es el mismo bloqueo con otro texto.
    IF v_entidad IS NOT NULL
       AND t.etiqueta_entidad IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.bolsas_entidades e WHERE e.tipo = t.codigo AND e.activo) THEN
        SELECT e.nombre INTO v_del_catalogo
          FROM public.bolsas_entidades e
         WHERE e.tipo = t.codigo AND e.activo
           AND upper(btrim(e.nombre)) = upper(v_entidad);
        IF v_del_catalogo IS NULL THEN
            RAISE EXCEPTION 'Ese/a % no está en la lista.', lower(t.etiqueta_entidad); END IF;
        v_entidad := v_del_catalogo;
    END IF;

    IF t.pide_boleta AND btrim(coalesce(p_numero_boleta,'')) = '' THEN
        RAISE EXCEPTION 'Falta el número de boleta.'; END IF;
    IF t.foto = 'OBLIGATORIA' AND btrim(coalesce(p_foto_url,'')) = '' THEN
        RAISE EXCEPTION 'Falta la foto del comprobante.'; END IF;

    -- ── El juez de los movimientos de caja (auditoría 2026-10-21) ──────────
    -- El MISMO que usa `operar-caja`: «Otro» no acepta lo que va en otro lado,
    -- y lo que pide comprobante, sin foto, sale igual y queda pendiente de
    -- autorización (2026-10-22: desde una bolsa también). La identidad de
    -- quien retira ya la cuida `pide_receptor` abajo, por eso
    -- `p_tiene_receptor` va en true.
    IF t.caja_tipo IS NOT NULL THEN
        v_regla := public.caja_movimiento_regla(
            'SALIDA', t.caja_tipo,
            concat_ws(' · ', t.etiqueta, v_entidad, nullif(btrim(coalesce(p_nota, '')), '')),
            nullif(btrim(coalesce(p_foto_url, '')), '') IS NOT NULL,
            'EFECTIVO', true, true);
        IF v_regla ->> 'error' IS NOT NULL THEN RAISE EXCEPTION '%', v_regla ->> 'error'; END IF;
        v_autoriza := coalesce((v_regla ->> 'autoriza')::boolean, false);
        IF v_autoriza AND length(coalesce(v_motivo, '')) < 5 THEN
            RAISE EXCEPTION 'Sin foto del comprobante, explica por qué: queda pendiente de autorización.';
        END IF;
    END IF;

    IF t.pide_receptor THEN
        IF p_recibido_por IS NULL THEN RAISE EXCEPTION 'Falta quién se lleva el efectivo.'; END IF;
        IF p_vale IS NULL THEN
            RAISE EXCEPTION 'Falta comprobar la identidad de quien retira el efectivo.'; END IF;

        -- El vale lo emitió la comprobación de identidad y vale para UNA sola
        -- operación: se toma con FOR UPDATE y se marca usado en la misma
        -- transacción, así dos pestañas abiertas no pueden gastarlo dos veces.
        SELECT * INTO v_vale FROM public.identidad_vales
         WHERE token = p_vale FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Hay que comprobar la identidad de nuevo.'; END IF;
        IF v_vale.usado_at IS NOT NULL THEN
            RAISE EXCEPTION 'Esa comprobación ya se usó. Hay que hacerla de nuevo.'; END IF;
        IF v_vale.created_at < now() - interval '5 minutes' THEN
            RAISE EXCEPTION 'La comprobación de identidad vencio. Hay que hacerla de nuevo.'; END IF;
        IF v_vale.employee_id IS DISTINCT FROM p_recibido_por THEN
            RAISE EXCEPTION 'La identidad comprobada no es la de quien figura retirando el efectivo.'; END IF;

        UPDATE public.identidad_vales SET usado_at = now() WHERE token = p_vale;
    END IF;

    IF p_repartos IS NULL OR jsonb_array_length(p_repartos) = 0 THEN
        RAISE EXCEPTION 'Falta decir de qué bolsa sale.'; END IF;

    FOR r IN SELECT (x->>'bolsa_id')::bigint AS bolsa_id, round((x->>'monto')::numeric, 2) AS monto
               FROM jsonb_array_elements(p_repartos) x LOOP
        SELECT * INTO b FROM public.bolsas WHERE id = r.bolsa_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Esa bolsa no existe.'; END IF;
        IF v_scope IS DISTINCT FROM 'ALL' AND b.branch_id IS DISTINCT FROM v_mia THEN
            RAISE EXCEPTION 'FORBIDDEN'; END IF;
        IF b.estado <> 'ABIERTA' THEN RAISE EXCEPTION 'La bolsa % ya salió de la sucursal.', b.folio; END IF;
        IF v_branch IS NULL THEN v_branch := b.branch_id;
        ELSIF v_branch <> b.branch_id THEN
            RAISE EXCEPTION 'Las bolsas de una misma salida tienen que ser de la misma sucursal.'; END IF;

        -- Ninguna bolsa rompe sus monedas cuando el monto no lo exige.
        IF v_paso IS NOT NULL AND mod(r.monto, v_paso) <> 0 THEN
            RAISE EXCEPTION 'De la bolsa % tienen que salir billetes de %: % no lo es.',
                b.folio, to_char(v_paso, 'FM999,999,990.00'),
                to_char(r.monto, 'FM999,999,990.00'); END IF;

        IF t.signo = -1 THEN
            IF r.monto <= 0 THEN RAISE EXCEPTION 'Cada monto tiene que ser mayor que cero.'; END IF;
            IF r.monto > public.bolsa_saldo(b.id) THEN
                RAISE EXCEPTION 'La bolsa % sólo tiene %.', b.folio,
                    to_char(public.bolsa_saldo(b.id), 'FM999,999,990.00'); END IF;
        ELSIF t.signo = 1 THEN
            IF r.monto <= 0 THEN RAISE EXCEPTION 'Cada monto tiene que ser mayor que cero.'; END IF;
            IF r.monto > public.bolsa_reintegro_maximo(b.id) THEN
                RAISE EXCEPTION 'A la bolsa % sólo le faltan %: una bolsa no puede tener más de lo que se guardó.',
                    b.folio, to_char(public.bolsa_reintegro_maximo(b.id), 'FM999,999,990.00'); END IF;
        END IF;
        v_suma := v_suma + r.monto;
    END LOOP;

    IF t.signo <> 0 AND round(v_suma, 2) <> round(p_monto, 2) THEN
        RAISE EXCEPTION 'Lo que sale de las bolsas (%) no cuadra con el monto (%).',
            to_char(v_suma, 'FM999,999,990.00'), to_char(p_monto, 'FM999,999,990.00'); END IF;

    SELECT upper(btrim(coalesce(br.codigo, 'B'))) INTO v_codigo FROM public.branches br WHERE br.id = v_branch;

    INSERT INTO public.bolsas_operaciones
        (folio, branch_id, tipo, monto, entidad, numero_boleta, foto_url, nota,
         recibido_por, recibido_metodo, registrado_por)
    VALUES (t.prefijo || '-' || nextval('public.bolsas_operacion_folio_seq'),
         v_branch, t.codigo, round(p_monto, 2),
         v_entidad, nullif(btrim(coalesce(p_numero_boleta,'')), ''),
         nullif(btrim(coalesce(p_foto_url,'')), ''), nullif(btrim(coalesce(p_nota,'')), ''),
         CASE WHEN t.pide_receptor THEN p_recibido_por END,
         CASE WHEN t.pide_receptor THEN coalesce(v_vale.metodo, p_metodo) END, v_yo)
    RETURNING * INTO v_oper;

    FOR r IN SELECT (x->>'bolsa_id')::bigint AS bolsa_id, round((x->>'monto')::numeric, 2) AS monto
               FROM jsonb_array_elements(p_repartos) x LOOP
        INSERT INTO public.bolsas_movimientos (bolsa_id, operacion_id, vale_folio, monto, registrado_por)
        VALUES (r.bolsa_id, v_oper.id,
                'V-' || v_codigo || '-' || nextval('public.bolsas_vale_folio_seq'),
                t.signo * r.monto, v_yo);
        UPDATE public.bolsas SET updated_at = now() WHERE id = r.bolsa_id;
        INSERT INTO public.bolsas_eventos (bolsa_id, accion, monto, employee_id, nota)
        VALUES (r.bolsa_id,
                CASE WHEN t.signo = 0 THEN 'ABRIR' WHEN t.signo = 1 THEN 'REINTEGRO' ELSE 'SALIDA' END,
                t.signo * r.monto, v_yo, t.etiqueta || ' · ' || v_oper.folio);
    END LOOP;

    -- ── Sin comprobante: la salida ya ocurrió y queda esperando autorización ─
    -- La misma solicitud que el cajón, con `operacion_bolsa` en vez de
    -- `movimiento_portal`: así la ve y la resuelve la misma pantalla.
    IF v_autoriza THEN
        INSERT INTO public.approval_requests (type, employee_id, status, note, metadata)
        VALUES ('CAJA_INGRESO_AUTORIZACION', v_yo, 'PENDING', v_motivo,
                jsonb_build_object(
                  'operacion_bolsa', v_oper.id, 'folio', v_oper.folio, 'branch_id', v_branch,
                  'fecha', (v_oper.registrado_at AT TIME ZONE 'America/El_Salvador')::date,
                  'monto', v_oper.monto, 'forma_pago', 'EFECTIVO', 'sentido', 'SALIDA',
                  'concepto', concat_ws(' · ', t.etiqueta, v_oper.folio),
                  'detalle', concat_ws(' · ', t.etiqueta, v_entidad, v_oper.nota),
                  'tipo_codigo', t.caja_tipo, 'foto_url', NULL,
                  'numero_boleta', v_oper.numero_boleta,
                  'reenvio', false, 'rechazo_anterior', NULL))
        RETURNING id INTO v_sol;

        UPDATE public.bolsas_operaciones
           SET autorizacion = 'PENDIENTE', autorizacion_solicitud = v_sol, updated_at = now()
         WHERE id = v_oper.id
        RETURNING * INTO v_oper;
    END IF;

    RETURN v_oper;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reserva_ajustar(p_id bigint, p_cantidad integer, p_alternativa jsonb DEFAULT NULL::jsonb, p_motivo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas; k record; x public.app_reservas;
  v_emp uuid := public.auth_employee_id();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_t1 numeric; v_a1 numeric; v_resto numeric; v_cot json; v_t2 numeric := 0; v_a2 numeric := 0; v_sobra numeric;
  v_alt bigint; v_sobrante bigint;
  v_envio numeric; v_otra_abierta boolean; v_disp numeric; v_envio_a_favor boolean := false; v_codigo text;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF r.estado NOT IN ('pendiente', 'lista') THEN RAISE EXCEPTION 'Sólo se ajusta una reserva abierta.'; END IF;
  IF EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
    RAISE EXCEPTION 'El anticipo de esta reserva ya se aplicó a una factura.';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN RAISE EXCEPTION 'Escribe qué decidió el cliente.'; END IF;
  IF p_cantidad IS NULL OR p_cantidad < 0 OR p_cantidad > r.cantidad THEN RAISE EXCEPTION 'Del producto original se queda de 0 a %.', r.cantidad; END IF;
  IF p_cantidad = r.cantidad AND p_alternativa IS NULL THEN RAISE EXCEPTION 'Así no cambia nada.'; END IF;
  IF p_cantidad = 0 AND p_alternativa IS NULL THEN RAISE EXCEPTION 'Si no se lleva nada, cancela la reserva: lo pagado queda a su favor.'; END IF;
  IF EXISTS (SELECT 1 FROM public.app_encargos e WHERE e.reserva_id = p_id AND e.estado IN ('aceptado', 'pedido', 'listo')) THEN
    RAISE EXCEPTION 'Bodega ya pidió el resto de esta reserva: espera que llegue o habla con Bodega.';
  END IF;
  IF p_alternativa IS NOT NULL AND r.pedido IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.app_reservas y WHERE y.pedido = r.pedido AND coalesce(y.costo_envio, 0) > 0) THEN
    RAISE EXCEPTION 'Este pedido va a domicilio y la alternativa no viaja con él: ajusta lo que se queda; el resto queda a su favor para que pida la alternativa.';
  END IF;

  SELECT * INTO k FROM public.reserva_cuenta(p_id);
  v_envio := public.reserva_envio(p_id);
  v_otra_abierta := r.pedido IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.app_reservas y WHERE y.pedido = r.pedido AND y.id <> p_id
       AND y.estado IN ('en_revision', 'pendiente', 'lista', 'retirada'));
  -- Lo que se queda lleva su envío; si no se queda nada, el envío pasa al
  -- renglón que sigue (no es dinero de esta fila) o, sin ninguno, vuelve.
  v_t1 := round(coalesce(r.precio_unitario, 0) * p_cantidad + CASE WHEN p_cantidad > 0 THEN v_envio ELSE 0 END, 2);
  v_disp := round(k.pagado - CASE WHEN p_cantidad = 0 AND v_otra_abierta THEN least(v_envio, k.pagado) ELSE 0 END, 2);
  v_envio_a_favor := p_cantidad = 0 AND NOT v_otra_abierta AND v_envio > 0;
  v_a1 := least(v_disp, v_t1);
  v_resto := round(v_disp - v_a1, 2);

  IF p_alternativa IS NOT NULL THEN
    IF (p_alternativa->>'producto_id')::bigint = r.producto_id THEN RAISE EXCEPTION 'La alternativa tiene que ser otro producto.'; END IF;
    v_cot := public.apartado_cotizar(r.branch_id, jsonb_build_object('modo', 'nueva', 'customer_id', r.customer_id,
      'producto_id', p_alternativa->'producto_id', 'producto_nombre', p_alternativa->>'producto_nombre',
      'factor', p_alternativa->'factor', 'cantidad', p_alternativa->'cantidad', 'precio', p_alternativa->'precio'));
    v_t2 := (v_cot->>'total')::numeric;
    v_a2 := least(v_resto, v_t2);
    INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
        precio_unitario, precio_normal, estado, terminos_version, anticipo, lista_at, preparada_por,
        pago_estado, pago_metodo, pagado_at, ajuste_de)
    VALUES (r.customer_id, r.branch_id, 'sucursal', (p_alternativa->>'producto_id')::bigint, left(btrim(p_alternativa->>'producto_nombre'), 200),
        (p_alternativa->>'cantidad')::integer, greatest(coalesce((p_alternativa->>'factor')::integer, 1), 1),
        round((p_alternativa->>'precio')::numeric, 2), round((p_alternativa->>'precio')::numeric, 2), 'lista', r.terminos_version, v_a2, now(), v_emp,
        CASE WHEN v_a2 > 0 AND v_a2 >= v_t2 - 0.004 THEN 'pagado' WHEN v_a2 > 0 THEN 'anticipo' ELSE 'pendiente' END,
        CASE WHEN v_a2 > 0 THEN r.pago_metodo ELSE 'al_retirar' END, CASE WHEN v_a2 > 0 THEN now() END, p_id)
    RETURNING * INTO x;
    v_alt := x.id;
    UPDATE public.app_reservas SET vence_at = now() + make_interval(hours => public.reserva_horas_al_preparar(x)) WHERE id = v_alt;
  END IF;
  v_sobra := round(v_resto - v_a2, 2);

  UPDATE public.app_encargos SET estado = 'cancelado', cerrado_at = now(), updated_at = now(),
         nota_sucursal = left(coalesce(nota_sucursal || ' · ', '') || 'El cliente decidió otra cosa.', 300)
   WHERE reserva_id = p_id AND estado IN ('solicitado', 'confirmado');

  IF p_cantidad = 0 THEN
    UPDATE public.app_reservas
       SET estado = 'cancelada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now(),
           -- Lo que pasó a la alternativa ya no es de esta fila; lo que sobra sí.
           -- Sin 'pagado': el saldo lo pone esta función, no el trigger de
           -- `app_reservas_guardas` (que daría el total entero por pagado en línea).
           anticipo = v_sobra, pago_estado = CASE WHEN v_sobra > 0 THEN 'anticipo' ELSE 'pendiente' END,
           traslado_nota = left(format('El cliente cambió todo%s.', CASE WHEN v_alt IS NOT NULL THEN ' por R-' || lpad(v_alt::text, 6, '0') ELSE '' END), 300),
           saldo_favor = CASE WHEN v_sobra > 0 THEN v_sobra END,
           saldo_favor_vence = CASE WHEN v_sobra > 0 THEN v_hoy + public.saldo_favor_dias() END,
           saldo_favor_origen = CASE WHEN v_sobra > 0 THEN 'anticipo' END,
           saldo_incluye_envio = saldo_incluye_envio OR v_envio_a_favor
     WHERE id = p_id;
  ELSE
    UPDATE public.app_reservas
       SET cantidad = p_cantidad, anticipo = v_a1,
           pago_estado = CASE WHEN v_a1 > 0 AND v_a1 >= v_t1 - 0.004 THEN 'pagado' WHEN v_a1 > 0 THEN 'anticipo' ELSE 'pendiente' END,
           traslado_nota = left(format('El cliente se queda con %s de %s%s.', p_cantidad, r.cantidad,
             CASE WHEN v_alt IS NOT NULL THEN ' y lleva R-' || lpad(v_alt::text, 6, '0') ELSE '' END), 300),
           updated_at = now()
     WHERE id = p_id
    RETURNING * INTO x;
    IF x.estado = 'pendiente' AND x.traslado_llegaron >= x.cantidad THEN
      UPDATE public.app_reservas SET estado = 'lista', lista_at = now(), preparada_por = v_emp, traslado_estado = 'recibido',
             vence_at = now() + make_interval(hours => public.reserva_horas_al_preparar(x)), updated_at = now()
       WHERE id = p_id;
    END IF;
    IF v_sobra > 0 THEN
      INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
          precio_unitario, precio_normal, estado, terminos_version, anticipo, pago_estado, pago_metodo, pagado_at,
          cerrada_at, cerrada_por, saldo_favor, saldo_favor_vence, saldo_favor_origen, ajuste_de)
      VALUES (r.customer_id, r.branch_id, 'sucursal', r.producto_id, left('Sobrante de R-' || lpad(p_id::text, 6, '0') || ' · ' || r.producto_nombre, 200),
          1, r.factor, 0, 0, 'cancelada', r.terminos_version, v_sobra, 'anticipo', r.pago_metodo, now(),
          now(), v_emp, v_sobra, v_hoy + public.saldo_favor_dias(), 'anticipo', p_id)
      RETURNING id INTO v_sobrante;
    END IF;
  END IF;

  -- El cliente de la app se entera por la app de lo que quedó (la sala ya lo
  -- habló con él: el motivo dice qué decidió).
  IF r.origen = 'app' THEN
    v_codigo := coalesce(r.pedido, 'R-' || lpad(p_id::text, 6, '0'));
    INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
    VALUES (r.customer_id, 'reserva', 'base:ajuste:' || p_id || ':' || coalesce(v_alt, 0) || ':' || p_cantidad, 'Tu reserva cambió',
            CASE WHEN p_cantidad > 0
                 THEN format('Te quedas con %s de %s de %s.', p_cantidad, r.cantidad, coalesce(r.producto_nombre, 'tu reserva'))
                 ELSE format('Cambiaste %s por otro producto.', coalesce(r.producto_nombre, 'tu reserva')) END
              || CASE WHEN v_alt IS NOT NULL THEN format(' Te apartamos %s × %s en la sucursal.', (p_alternativa->>'cantidad')::integer, left(btrim(p_alternativa->>'producto_nombre'), 120)) ELSE '' END
              || CASE WHEN v_sobra > 0 THEN format(' %s quedan a tu favor por %s días, para otra compra en cualquier sucursal.',
                                                   to_char(v_sobra, 'FM$999,990.00'), public.saldo_favor_dias()) ELSE '' END,
            '/reservas')
    ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'RESERVA_AJUSTADA', p_id::text,
          jsonb_build_object('antes', r.cantidad, 'queda', p_cantidad, 'alternativa', p_alternativa, 'nueva', v_alt,
                             'pagado', k.pagado, 'queda_pagado', v_a1, 'pasa_a_alternativa', v_a2, 'a_favor', v_sobra, 'motivo', v_motivo,
                             'origen', r.origen, 'pago_metodo', r.pago_metodo, 'envio', v_envio, 'envio_a_favor', v_envio_a_favor),
          r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'alternativa', CASE WHEN v_alt IS NOT NULL THEN 'R-' || lpad(v_alt::text, 6, '0') END,
                           'a_favor', v_sobra, 'cancelada', p_cantidad = 0);
END $function$;

CREATE OR REPLACE FUNCTION public.reserva_saldo_pedir_devolucion(p_id bigint, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_motivo text := nullif(btrim(coalesce(p_motivo, '')), ''); v_dest uuid[]; v_cliente text; v_sala text;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN RAISE EXCEPTION 'Escribe por qué el cliente lo quiere en efectivo.'; END IF;
  IF coalesce(r.saldo_favor, 0) <= 0 OR r.saldo_favor_usado_at IS NOT NULL OR r.saldo_favor_devuelto_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esa reserva no tiene saldo a favor por devolver.';
  END IF;
  IF r.devolucion_pedida_at IS NOT NULL THEN RAISE EXCEPTION 'La devolución ya está pedida: la autoriza administración.'; END IF;
  UPDATE public.app_reservas SET devolucion_pedida_at = now(), devolucion_pedida_por = public.auth_employee_id(),
         devolucion_pedida_motivo = left(v_motivo, 300), updated_at = now() WHERE id = p_id;
  SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = r.customer_id;
  SELECT name INTO v_sala FROM public.branches WHERE id = r.branch_id;
  SELECT array_agg(DISTINCT e.id) INTO v_dest
    FROM public.employees e
    JOIN public.role_permissions rp ON rp.role_id IN (e.role_id, e.secondary_role_id)
     AND rp.module_key = 'dash_reservas_devolver_saldo' AND (rp.can_view OR rp.can_edit)
   WHERE e.status = 'ACTIVO';
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP', 'Devolución en efectivo por autorizar · R-' || lpad(p_id::text, 6, '0'),
      format('%s pide devolver $%s a %s: %s', coalesce(v_sala, 'Una sucursal'), to_char(r.saldo_favor, 'FM999990.00'),
             coalesce(v_cliente, 'un cliente'), left(v_motivo, 160)),
      '/reservas', jsonb_build_object('codigo', 'R-' || lpad(p_id::text, 6, '0'), 'check_key', 'devolucion_pedida:' || p_id), true, r.branch_id::integer);
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'SALDO_DEVOLUCION_PEDIDA', p_id::text, jsonb_build_object('monto', r.saldo_favor, 'motivo', v_motivo), r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.reserva_seguir_traslado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  m jsonb := coalesce(NEW.metadata, '{}'::jsonb);
  v_links jsonb := '[]'::jsonb; lk jsonb;
  it jsonb; v_i integer; v_id bigint; r public.app_reservas;
  v_origen text := coalesce(nullif(m->>'origen_branch_name', ''), 'la otra sucursal');
  v_llego boolean; v_cambio boolean; v_disp jsonb := '{}'::jsonb; v_hay numeric;
  v_quiere numeric; v_toma numeric; v_unid integer; v_motivo text;
BEGIN
  IF m->>'reserva_id' ~ '^[0-9]{1,12}$' THEN
    v_links := jsonb_build_array(jsonb_build_object('reserva_id', (m->>'reserva_id')::bigint));
  END IF;
  IF jsonb_typeof(m->'reservas') = 'array' THEN v_links := v_links || (m->'reservas'); END IF;
  IF jsonb_array_length(v_links) = 0 THEN RETURN NULL; END IF;
  v_llego := TG_OP = 'UPDATE' AND (NEW.metadata ? 'erp_recibido') AND NOT (coalesce(OLD.metadata, '{}'::jsonb) ? 'erp_recibido')
             AND NEW.status = 'APPROVED';
  v_cambio := TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status;
  IF TG_OP = 'UPDATE' AND NOT v_llego AND NOT v_cambio THEN RETURN NULL; END IF;

  FOR lk IN SELECT * FROM jsonb_array_elements(v_links) LOOP
    -- Un fallo acá nunca puede trabar el traslado: es su consecuencia, no su condición.
    BEGIN
      v_id := (lk->>'reserva_id')::bigint;
      SELECT * INTO r FROM public.app_reservas WHERE id = v_id FOR UPDATE;
      CONTINUE WHEN NOT FOUND OR r.origen NOT IN ('sucursal', 'app') OR r.branch_id::text IS DISTINCT FROM (m->>'branch_id');
      SELECT x.it, (x.n - 1)::integer INTO it, v_i
        FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS x(it, n)
       WHERE x.it->>'erp_product_id' = r.producto_id::text ORDER BY x.n LIMIT 1;
      CONTINUE WHEN it IS NULL;
      v_quiere := coalesce((lk->>'unidades')::numeric,
                           coalesce((it->>'cantidad')::numeric, 0) * greatest(coalesce((it->>'factor')::numeric, 1), 1));

      IF TG_OP = 'INSERT' THEN
        -- Sólo la reserva que lo pidió: las amarradas llegan con el traslado ya hecho.
        IF NOT (lk ? 'unidades') AND r.estado = 'pendiente' THEN
          UPDATE public.app_reservas
             SET traslado_request_id = NEW.id, traslado_estado = 'pedido',
                 traslado_desde = coalesce(nullif(m->>'origen_branch_id', '')::bigint, traslado_desde),
                 traslado_nota = left(format('Pedida a %s.', v_origen), 300), updated_at = now()
           WHERE id = v_id;
        END IF;
        CONTINUE;
      END IF;

      IF v_llego OR NEW.status = 'APPROVED' THEN
        v_hay := coalesce((v_disp->>v_i::text)::numeric,
                          public.traslado_enviada_del_renglon(m, v_i) * greatest(coalesce((it->>'factor')::numeric, 1), 1));
        v_toma := greatest(least(v_quiere, v_hay), 0);
        v_disp := v_disp || jsonb_build_object(v_i::text, v_hay - v_toma);
        v_unid := floor(v_toma / greatest(r.factor, 1));
      END IF;

      -- Llegó: cuenta aunque ya no sea el traslado vigente — lo que llega, llegó.
      IF v_llego THEN
        PERFORM public.reserva_sumar_llegada(v_id, v_unid, v_origen);
        CONTINUE;
      END IF;

      CONTINUE WHEN r.estado <> 'pendiente';
      IF NEW.status = 'APPROVED' THEN
        IF v_toma <= 0 THEN
          UPDATE public.app_reservas SET traslado_estado = 'rechazado',
                 traslado_nota = left(format('%s no tenía para mandar.', v_origen), 300), updated_at = now() WHERE id = v_id;
          PERFORM public.reserva_avisar_sala(v_id, 'El traslado no sale',
            format('%s no tenía %s para mandar. Pídelo a otra sucursal o a Bodega, o habla con el cliente.', v_origen, r.producto_nombre), 'reserva_sin_traslado');
        ELSIF v_toma < v_quiere THEN
          UPDATE public.app_reservas SET traslado_estado = 'parcial', traslado_por_llegar = traslado_por_llegar + v_unid,
                 traslado_nota = left(format('%s manda %s de %s.', v_origen, v_unid, floor(v_quiere / greatest(r.factor, 1))), 300),
                 updated_at = now() WHERE id = v_id;
          PERFORM public.reserva_avisar_sala(v_id, 'Viene sólo una parte',
            format('%s manda %s de %s × %s. Pide el resto a otra sucursal o a Bodega, o habla con el cliente.', v_origen, v_unid,
                   floor(v_quiere / greatest(r.factor, 1)), r.producto_nombre), 'reserva_parcial');
        ELSE
          -- Con el resto encargado a Bodega, la reserva sigue esperando a Bodega.
          UPDATE public.app_reservas SET traslado_estado = CASE WHEN traslado_estado = 'bodega' THEN 'bodega' ELSE 'enviado' END,
                 traslado_por_llegar = traslado_por_llegar + v_unid,
                 traslado_nota = left(format('%s lo mandó.', v_origen), 300), updated_at = now() WHERE id = v_id;
        END IF;
      ELSIF NEW.status IN ('REJECTED', 'CANCELLED') THEN
        v_motivo := nullif(btrim(coalesce(m->>'rejection_reason', NEW.approver_note, '')), '');
        UPDATE public.app_reservas SET traslado_estado = 'rechazado',
               traslado_nota = left(format('%s no lo manda%s.', v_origen, coalesce(': ' || lower(v_motivo), '')), 300), updated_at = now()
         WHERE id = v_id;
        PERFORM public.reserva_avisar_sala(v_id, 'El traslado no sale',
          format('%s no manda %s%s. Pídelo a otra sucursal o a Bodega, o habla con el cliente.', v_origen, r.producto_nombre,
                 coalesce(' (' || lower(v_motivo) || ')', '')), 'reserva_sin_traslado');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'reserva_seguir_traslado: solicitud % reserva % (%)', NEW.id, v_id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.reserva_sumar_llegada(p_id bigint, p_unidades integer, p_de text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_cliente text;
BEGIN
  IF coalesce(p_unidades, 0) <= 0 THEN RETURN; END IF;
  UPDATE public.app_reservas
     SET traslado_llegaron = traslado_llegaron + p_unidades,
         traslado_por_llegar = greatest(traslado_por_llegar - p_unidades, 0), updated_at = now()
   WHERE id = p_id AND estado = 'pendiente'
  RETURNING * INTO r;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = r.customer_id;
  IF r.traslado_llegaron >= r.cantidad THEN
    UPDATE public.app_reservas
       SET estado = 'lista', lista_at = now(), vence_at = now() + make_interval(hours => public.reserva_horas_al_preparar(r)),
           traslado_estado = 'recibido', traslado_nota = 'Llegó de ' || coalesce(p_de, 'otra sucursal') || '.', updated_at = now()
     WHERE id = p_id;
    PERFORM public.reserva_avisar_sala(p_id, 'Llegó y quedó apartada',
      format('%s × %s para %s llegó de %s. Ya está lista: avísale al cliente.', r.cantidad, r.producto_nombre,
             coalesce(v_cliente, 'el cliente'), coalesce(p_de, 'otra sucursal')), 'reserva_llego');
  ELSIF r.traslado_por_llegar > 0 THEN
    UPDATE public.app_reservas
       SET traslado_nota = format('Llegaron %s de %s; el resto viene en camino.', r.traslado_llegaron, r.cantidad), updated_at = now()
     WHERE id = p_id;
    PERFORM public.reserva_avisar_sala(p_id, 'Llegó una parte',
      format('De %s × %s para %s llegaron %s (de %s). El resto viene en camino: queda lista sola cuando llegue.',
             r.cantidad, r.producto_nombre, coalesce(v_cliente, 'el cliente'), r.traslado_llegaron, coalesce(p_de, 'otra sucursal')), 'reserva_parte');
  ELSE
    UPDATE public.app_reservas
       SET traslado_nota = format('Llegaron %s de %s.', r.traslado_llegaron, r.cantidad), updated_at = now()
     WHERE id = p_id;
    PERFORM public.reserva_avisar_sala(p_id, 'Llegó una parte',
      format('De %s × %s para %s llegaron %s. Pide el resto a otra sucursal o a Bodega, o habla con el cliente.',
             r.cantidad, r.producto_nombre, coalesce(v_cliente, 'el cliente'), r.traslado_llegaron), 'reserva_parte');
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.reservar_pago_bono(p_item text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_it    record;
    v_pago  public.promocion_pago%ROWTYPE;
    v_mov   public.caja_movimientos_portal%ROWTYPE;
    v_clave text;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

    SELECT * INTO v_it FROM public.bonos_producto_items() i WHERE i.item = p_item;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: ese bono no está por pagar'; END IF;
    IF NOT public.es_jefe_de_sala(v_actor, v_it.branch_id) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: el bono lo paga el jefe de sucursal'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_pago FROM public.promocion_pago WHERE item = p_item FOR UPDATE;

    IF FOUND THEN
        IF v_pago.estado IN ('pagado', 'fuera_del_portal') THEN
            RAISE EXCEPTION 'YA_PAGADO: ese bono ya se pagó';
        END IF;
        IF v_pago.estado = 'reservado' THEN
            -- El mismo intento que no llegó a la caja: la misma clave, para que
            -- un reintento no pueda escribir dos salidas.
            UPDATE public.promocion_pago SET monto = v_it.monto, updated_at = now()
             WHERE id = v_pago.id;
            v_clave := v_pago.clave_envio;
        ELSE
            -- 'enviado' con la caja sin contestar hace menos de 3 minutos: está
            -- en curso. Más viejo, o 'anulado', se puede volver a intentar con
            -- una clave nueva — la vieja ya no paga nada.
            IF v_pago.estado = 'enviado' THEN
                SELECT * INTO v_mov FROM public.caja_movimientos_portal WHERE id = v_pago.movimiento_id;
                IF v_mov.created_at > now() - interval '3 minutes' THEN
                    RAISE EXCEPTION 'EN_CURSO: ese pago se está registrando en la caja';
                END IF;
                -- H20: la caja no contestó, pero pudo haberlo anotado. Repetir
                -- con otra clave escribiría una segunda salida. Primero alguien
                -- mira la caja y lo resuelve (resolver_pago_bono_sin_confirmar).
                IF v_mov.id IS NOT NULL AND v_mov.anulado_at IS NULL THEN
                    RAISE EXCEPTION 'SIN_CONFIRMAR: la caja no confirmó la salida de $% de este bono. Revisa en la caja si salió antes de repetirla', v_pago.monto;
                END IF;
            END IF;
            v_clave := 'bono-' || gen_random_uuid();
            UPDATE public.promocion_pago
               SET estado = 'reservado', clave_envio = v_clave, monto = v_it.monto,
                   movimiento_id = NULL, reservado_por = v_actor, updated_at = now()
             WHERE id = v_pago.id;
        END IF;
    ELSE
        v_clave := 'bono-' || gen_random_uuid();
        INSERT INTO public.promocion_pago
            (item, tipo, promocion_id, excedente_id, branch_id, employee_id, monto,
             estado, clave_envio, reservado_por)
        VALUES (v_it.item, v_it.tipo, v_it.promocion_id, v_it.excedente_id, v_it.branch_id,
                v_it.employee_id, v_it.monto, 'reservado', v_clave, v_actor);
    END IF;

    RETURN json_build_object(
        'clave', v_clave, 'monto', v_it.monto, 'tipo', v_it.tipo,
        'branch_id', v_it.branch_id, 'employee_id', v_it.employee_id,
        'concepto', CASE v_it.tipo WHEN 'bodega' THEN 'Bono bodega '
                                   WHEN 'excedente' THEN 'Bono excedente '
                                   ELSE 'Bono ' END || v_it.promocion);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reservas_vencer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ids bigint[];
  t record;
  v_dest uuid[];
  v_v2 boolean := public.reservas_v2_rige();
  o record;
  v_ofertas json;
  f record;
BEGIN
  IF v_v2 THEN
    WITH c AS (
        UPDATE public.app_reservas r
           SET precio_unitario = r.precio_normal, updated_at = now()
         WHERE r.estado = 'lista' AND r.pago_estado = 'pendiente' AND coalesce(r.anticipo, 0) <= 0.004
           AND r.oferta_fin IS NOT NULL AND r.oferta_fin < v_hoy
           AND r.precio_normal IS NOT NULL AND r.precio_unitario IS DISTINCT FROM r.precio_normal
           AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id)
        RETURNING r.id, r.customer_id, r.origen, r.pedido, r.branch_id, r.producto_nombre, r.cantidad, r.precio_normal),
    g AS (
      SELECT c.customer_id, c.origen, coalesce(c.pedido, c.id::text) AS grupo, min(c.branch_id) AS branch_id,
             coalesce(c.pedido, 'R-' || lpad(min(c.id)::text, 6, '0')) AS codigo, min(c.id) AS id,
             count(*) AS productos, min(c.producto_nombre) AS producto,
             round(sum(c.precio_normal * c.cantidad), 2) AS total
        FROM c GROUP BY c.customer_id, c.origen, coalesce(c.pedido, c.id::text), c.pedido)
    SELECT coalesce(json_agg(g), '[]'::json) INTO v_ofertas FROM g;
    FOR o IN SELECT * FROM json_to_recordset(v_ofertas)
               AS x(customer_id bigint, origen text, grupo text, branch_id bigint, codigo text, id bigint, productos integer, producto text, total numeric)
    LOOP
      INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
      VALUES (o.customer_id, 'reserva', 'base:oferta_fin:' || o.grupo, 'La oferta de tu reserva terminó',
              'Tu reserva ' || o.codigo || ' sigue apartada, ahora a precio normal: $' || to_char(o.total, 'FM999990.00')
                || '. Si ya no la quieres, puedes cancelarla desde la app.',
              '/reservas')
      ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
      INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
      VALUES ('RESERVA_OFERTA_TERMINADA_PRECIO_NORMAL', o.id::text,
              jsonb_build_object('codigo', o.codigo, 'total', o.total, 'productos', o.productos), o.branch_id, 'SYSTEM');
    END LOOP;
  END IF;

  WITH v AS (
    UPDATE public.app_reservas r
       SET estado = 'vencida', cerrada_at = now(), updated_at = now(),
           vencida_motivo = CASE
             WHEN r.estado = 'en_revision' AND r.receta_estado = 'pendiente' THEN 'receta_sin_revisar'
             WHEN r.estado = 'en_revision' THEN 'sin_receta'
             WHEN r.estado = 'lista' THEN 'sin_retirar'
             WHEN r.origen = 'app' AND public.reserva_plazo_hasta(r) < now() THEN 'sin_preparar'
             ELSE 'oferta_terminada' END,
           saldo_favor = CASE WHEN r.anticipo > 0 AND NOT (r.pago_metodo = 'en_linea' AND r.pago_estado = 'pagado') AND r.saldo_favor IS NULL AND NOT coalesce(r.pago_prueba, false) THEN r.anticipo ELSE r.saldo_favor END,
           saldo_favor_vence = CASE WHEN r.anticipo > 0 AND NOT (r.pago_metodo = 'en_linea' AND r.pago_estado = 'pagado') AND r.saldo_favor IS NULL AND NOT coalesce(r.pago_prueba, false) THEN v_hoy + public.saldo_favor_dias() ELSE r.saldo_favor_vence END,
           saldo_favor_origen = CASE WHEN r.anticipo > 0 AND NOT (r.pago_metodo = 'en_linea' AND r.pago_estado = 'pagado') AND r.saldo_favor IS NULL AND NOT coalesce(r.pago_prueba, false) THEN 'anticipo' ELSE r.saldo_favor_origen END
     WHERE ((r.estado = 'en_revision' AND public.reserva_plazo_hasta(r) < now())
            OR (r.estado = 'pendiente' AND r.origen = 'app' AND public.reserva_plazo_hasta(r) < now())
            OR (r.estado = 'pendiente' AND r.oferta_fin IS NOT NULL AND r.oferta_fin < v_hoy
                AND CASE WHEN v_v2 THEN r.pago_estado = 'pendiente' AND coalesce(r.anticipo, 0) <= 0.004
                         ELSE r.pago_estado <> 'pagado' END)
            OR (r.estado = 'lista' AND (r.vence_at AT TIME ZONE 'America/El_Salvador')::date < v_hoy
                AND NOT public.prorroga_pendiente('reserva', r.id)))
       AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id)
       -- (2026-10-26) Un anticipo que quedaría a favor sobre un producto que
       -- ya se le facturó al cliente: no vence. Ver el encabezado.
       AND NOT (r.anticipo > 0 AND NOT (r.pago_metodo = 'en_linea' AND r.pago_estado = 'pagado') AND r.saldo_favor IS NULL
                AND NOT coalesce(r.pago_prueba, false) AND public.reserva_ventas_del_producto(r) IS NOT NULL)
    RETURNING r.id)
  SELECT array_agg(id) INTO v_ids FROM v;

  -- Las que el freno de arriba dejó abiertas: UN aviso a la sala por reserva.
  -- Mismas condiciones que el UPDATE; la marca es la fila de bitácora.
  FOR f IN
    SELECT r.id, r.branch_id, r.producto_nombre, r.anticipo, public.reserva_ventas_del_producto(r) AS ventas
      FROM public.app_reservas r
     WHERE ((r.estado = 'en_revision' AND public.reserva_plazo_hasta(r) < now())
            OR (r.estado = 'pendiente' AND r.origen = 'app' AND public.reserva_plazo_hasta(r) < now())
            OR (r.estado = 'pendiente' AND r.oferta_fin IS NOT NULL AND r.oferta_fin < v_hoy
                AND CASE WHEN v_v2 THEN r.pago_estado = 'pendiente' AND coalesce(r.anticipo, 0) <= 0.004
                         ELSE r.pago_estado <> 'pagado' END)
            OR (r.estado = 'lista' AND (r.vence_at AT TIME ZONE 'America/El_Salvador')::date < v_hoy
                AND NOT public.prorroga_pendiente('reserva', r.id)))
       AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id)
       AND r.anticipo > 0 AND NOT (r.pago_metodo = 'en_linea' AND r.pago_estado = 'pagado') AND r.saldo_favor IS NULL
       AND NOT coalesce(r.pago_prueba, false)
       AND NOT EXISTS (SELECT 1 FROM public.audit_logs l WHERE l.target_id = r.id::text AND l.action = 'RESERVA_NO_VENCE_YA_FACTURADA')
  LOOP
    CONTINUE WHEN f.ventas IS NULL;
    PERFORM public.reserva_avisar_sala(f.id, 'No venció: ya se facturó',
      format('A este cliente ya se le facturó %s después de reservar (factura %s). Para no dejar a favor un anticipo que quizá ya se usó, la reserva sigue abierta: cancélala desde Reservas y responde si el anticipo de $%s se descontó en esa venta.',
             f.producto_nombre, f.ventas -> 0 ->> 'factura', to_char(f.anticipo, 'FM999990.00')),
      'no_vence_ya_facturada');
    INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
    VALUES ('RESERVA_NO_VENCE_YA_FACTURADA', f.id::text,
            jsonb_build_object('anticipo', f.anticipo, 'ventas', f.ventas::jsonb), f.branch_id, 'SYSTEM');
  END LOOP;

  IF v_ids IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  SELECT g.customer_id, 'reserva', 'base:vencida:' || g.grupo,
         CASE g.motivo WHEN 'sin_receta' THEN 'Tu reserva venció sin la foto de la receta'
                       WHEN 'receta_sin_revisar' THEN 'Tu reserva venció'
                       WHEN 'sin_preparar' THEN 'Tu reserva venció'
                       WHEN 'oferta_terminada' THEN 'Tu reserva venció'
                       ELSE 'Tu reserva venció sin retirar' END,
         CASE g.motivo WHEN 'sin_receta' THEN 'No recibimos la foto de tu receta a tiempo. Puedes volver a reservar cuando quieras.'
                       WHEN 'receta_sin_revisar' THEN 'La sucursal no alcanzó a revisar tu receta a tiempo. Disculpa: puedes volver a reservar y no cuenta en tu contra.'
                       WHEN 'sin_preparar' THEN 'La sucursal no alcanzó a preparar tu pedido a tiempo. Disculpa: puedes volver a reservar y no cuenta en tu contra.'
                       WHEN 'oferta_terminada' THEN 'La oferta terminó antes de que se preparara.'
                       ELSE 'Se cumplió el plazo para retirarla.' END
           || CASE WHEN g.saldo > 0 THEN ' Te quedaron $' || to_char(g.saldo, 'FM999990.00') || ' a favor para otra compra en cualquier sucursal.' ELSE '' END,
         '/reservas'
    FROM (SELECT customer_id, coalesce(pedido, id::text) AS grupo, min(vencida_motivo) AS motivo,
                 coalesce(sum(saldo_favor), 0) AS saldo
            FROM public.app_reservas
           WHERE id = ANY (v_ids) AND origen = 'app'
           GROUP BY 1, 2) g
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;

  FOR t IN
    SELECT r.branch_id, r.vencida_motivo, coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0')) AS codigo,
           string_agg(DISTINCT r.producto_nombre, ', ') AS productos, min(r.id) AS id
      FROM public.app_reservas r
     WHERE r.id = ANY (v_ids) AND r.vencida_motivo IN ('sin_preparar', 'receta_sin_revisar')
     GROUP BY 1, 2, 3
  LOOP
    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (13 IN (e.role_id, e.secondary_role_id)
            OR (19 IN (e.role_id, e.secondary_role_id) AND e.branch_id = t.branch_id));
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        CASE t.vencida_motivo WHEN 'sin_preparar' THEN 'Reserva vencida sin preparar' ELSE 'Receta vencida sin revisar' END,
        format('%s (%s, %s) venció porque la sucursal no %s a tiempo. Al cliente no le cuenta en contra.',
               t.codigo, t.productos, (SELECT b.name FROM public.branches b WHERE b.id = t.branch_id),
               CASE t.vencida_motivo WHEN 'sin_preparar' THEN 'la preparó' ELSE 'revisó la receta' END),
        '/reservas', jsonb_build_object('check_key', 'reserva_sala_tarde:' || t.id, 'reserva_id', t.id),
        true, t.branch_id::integer);
    END IF;
  END LOOP;

  RETURN array_length(v_ids, 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reservas_vigilar()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_apagados integer := 0;
  v_avisos integer := 0;
  v_reversos integer := 0;
  v_encargos integer := 0;
  v_detenidas integer := 0;
  v_por_vencer integer := 0;
  v_hora integer := extract(hour FROM now() AT TIME ZONE 'America/El_Salvador')::integer;
  v_ids integer[];
  v_dest uuid[];
  v_clave text;
  v_monto numeric(12,2);
  v_usado numeric(12,2);
  v_queda numeric(12,2);
  v_codigo text;
  v_salida bigint;
  v_nota text;
  r public.app_reservas;
  m record;
  s record;
  x record;
BEGIN
  -- 0 · saldo usado que ninguna factura canjeó en una hora (2026-10-21).
  -- Lo usado se volvió puntos del titular para que la caja lo descuente como
  -- un canje. Si en una hora no hubo canje (la factura salió a otro nombre o
  -- como consumidor final), esos puntos se quitan del libro con una salida
  -- de ajuste y el monto vuelve a la reserva como movimiento 'reverso'. Si se
  -- canjeó una parte, vuelve sólo lo que quedó en el lote.
  FOR m IN
    SELECT mv.id, mv.reserva_id, mv.monto, mv.branch_id, mv.employee_id, mv.created_at,
           l.id AS lote_id, l.customer_id AS titular, l.restantes, l.puntos
      FROM public.saldo_favor_movimientos mv
      JOIN public.puntos_lote l ON l.id = mv.puntos_lote_id
     WHERE mv.tipo = 'uso' AND mv.created_at < now() - interval '1 hour'
       AND l.origen = 'saldo_favor' AND l.restantes > 0
       AND NOT EXISTS (SELECT 1 FROM public.saldo_favor_movimientos z
                        WHERE z.tipo = 'reverso' AND z.puntos_lote_id = mv.puntos_lote_id)
     ORDER BY mv.id
     FOR UPDATE OF l SKIP LOCKED
  LOOP
    SELECT * INTO r FROM public.app_reservas WHERE id = m.reserva_id FOR UPDATE;
    v_monto := round(m.restantes / 100.0, 2);
    v_usado := round((m.puntos - m.restantes) / 100.0, 2);
    v_codigo := coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0'));

    PERFORM 1 FROM public.puntos_cuenta WHERE customer_id = m.titular FOR UPDATE;
    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, monto, sucursal, motivo)
    VALUES (m.titular, 'ajuste', m.restantes, v_monto,
            (SELECT b.codigo_puntos FROM public.branches b WHERE b.id = m.branch_id),
            'Saldo a favor de la reserva ' || v_codigo || ' sin canjear en una hora: vuelve a la reserva')
    RETURNING id INTO v_salida;
    INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos) VALUES (v_salida, m.lote_id, m.restantes);
    UPDATE public.puntos_lote SET restantes = 0 WHERE id = m.lote_id;
    UPDATE public.puntos_cuenta
       SET saldo = saldo - m.restantes, usados = usados + m.restantes, updated_at = now()
     WHERE customer_id = m.titular;

    v_queda := coalesce(r.saldo_favor, 0) + v_monto;
    UPDATE public.app_reservas
       SET saldo_favor = v_queda,
           saldo_favor_usado_at = NULL, saldo_favor_usado_por = NULL, saldo_favor_usado_branch = NULL,
           updated_at = now()
     WHERE id = r.id;

    v_nota := CASE WHEN v_usado > 0
      THEN format('Se usaron %s del saldo de %s y la factura descontó sólo %s: los %s restantes volvieron a la reserva.',
                  to_char(m.monto, 'FM$999,990.00'), v_codigo, to_char(v_usado, 'FM$999,990.00'), to_char(v_monto, 'FM$999,990.00'))
      ELSE format('Se usaron %s del saldo de %s y en una hora ninguna factura a su nombre los descontó (¿salió a otro nombre o como consumidor final?): volvieron a la reserva.',
                  to_char(m.monto, 'FM$999,990.00'), v_codigo) END;

    INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, branch_id, puntos_lote_id, nota)
    VALUES (r.id, 'reverso', v_monto, v_queda, m.branch_id, m.lote_id,
            CASE WHEN v_usado > 0 THEN 'canje parcial: vuelve lo no descontado' ELSE 'sin canje en una hora' END);

    INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
    VALUES ('RESERVA_SALDO_FAVOR_REVERSO', r.id::text,
            jsonb_build_object('movimiento', m.id, 'lote', m.lote_id, 'usado', m.monto, 'canjeado', v_usado,
                               'devuelto', v_monto, 'queda', v_queda, 'salida', v_salida),
            m.branch_id, 'SYSTEM');

    PERFORM public.saldo_favor_anotar('saldo_reverso:' || m.id, 'saldo_favor_no_canjeado', r.customer_id,
      m.branch_id, NULL, m.employee_id, v_monto, v_nota,
      jsonb_build_object('reserva_id', r.id, 'codigo', v_codigo, 'usado', m.monto, 'canjeado', v_usado, 'movimiento', m.id));

    SELECT array_agg(DISTINCT d) INTO v_dest
      FROM unnest(coalesce(public.destinatarios_de_saldo_favor(m.branch_id), '{}'::uuid[])
                  || coalesce(public.destinatarios_de_saldo_favor(r.branch_id), '{}'::uuid[])) d;
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        'El saldo a favor no se descontó',
        v_nota || ' Si la venta ya salió sin el descuento, hay que revisarla con el cliente.',
        '/puntos?tab=avisos', jsonb_build_object('check_key', 'saldo_reverso:' || m.id, 'reserva_id', r.id),
        true, m.branch_id::integer);
      UPDATE public.puntos_irregularidad SET avisado_at = now() WHERE clave = 'saldo_reverso:' || m.id;
    END IF;
    v_reversos := v_reversos + 1;
  END LOOP;

  -- 1 · saldos vencidos
  FOR s IN
    SELECT id, saldo_favor, customer_id, branch_id, pedido FROM public.app_reservas
     WHERE saldo_favor > 0 AND saldo_favor_usado_at IS NULL AND saldo_favor_devuelto_at IS NULL
       AND saldo_favor_vence < v_hoy
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.app_reservas
       SET saldo_favor_inicial = coalesce(saldo_favor_inicial, saldo_favor), saldo_favor = 0, updated_at = now()
     WHERE id = s.id;
    INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, nota)
    VALUES (s.id, 'vencimiento', s.saldo_favor, 0, 'venció sin usarse');
    PERFORM public.saldo_favor_anotar('saldo_vencido:' || s.id, 'saldo_favor_vencido', s.customer_id,
      s.branch_id, NULL, NULL, s.saldo_favor,
      format('El saldo a favor de %s (%s) venció sin usarse.',
             coalesce(s.pedido, 'R-' || lpad(s.id::text, 6, '0')), to_char(s.saldo_favor, 'FM$999,990.00')),
      jsonb_build_object('reserva_id', s.id));
    v_apagados := v_apagados + 1;
  END LOOP;

  -- 2 · existencia por debajo de lo apartado
  SELECT array_agg(DISTINCT producto_id::int) INTO v_ids
    FROM public.app_reservas
   WHERE estado IN ('en_revision', 'pendiente', 'lista') AND producto_id IS NOT NULL;
  IF v_ids IS NOT NULL THEN
    FOR x IN
      SELECT e.product_id, e.branch_id, e.existencia, e.apartadas,
             (SELECT r2.producto_nombre FROM public.app_reservas r2
               WHERE r2.producto_id = e.product_id AND r2.branch_id = e.branch_id
                 AND r2.estado IN ('en_revision', 'pendiente', 'lista') ORDER BY r2.id LIMIT 1) AS producto,
             (SELECT count(*) FROM public.app_reservas r2
               WHERE r2.producto_id = e.product_id AND r2.branch_id = e.branch_id
                 AND r2.estado IN ('en_revision', 'pendiente', 'lista')) AS reservas
        FROM json_to_recordset(public.app_existencias_netas(v_ids))
             AS e(product_id int, branch_id bigint, existencia numeric, apartadas numeric, disponibles numeric)
       WHERE e.apartadas > 0 AND e.existencia < e.apartadas
    LOOP
      v_clave := 'reserva_sin_existencia:' || x.branch_id || ':' || x.product_id || ':' || v_hoy;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
                             WHERE n.metadata ? 'check_key' AND n.metadata->>'check_key' = v_clave);
      v_dest := public.destinatarios_de_reservas(x.branch_id);
      CONTINUE WHEN v_dest IS NULL;
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        'Falta existencia para una reserva',
        coalesce(x.producto, 'Un producto') || ': hay ' || trim(to_char(x.existencia, 'FM999,990'))
          || ' y ' || CASE WHEN x.reservas = 1 THEN 'una reserva aparta ' ELSE x.reservas || ' reservas apartan ' END
          || trim(to_char(x.apartadas, 'FM999,990')) || '. Revísalo antes de que el cliente llegue.',
        '/reservas', jsonb_build_object('check_key', v_clave, 'producto_id', x.product_id,
                                        'existencia', x.existencia, 'apartadas', x.apartadas),
        true, x.branch_id::integer);
      v_avisos := v_avisos + 1;
    END LOOP;
  END IF;

  -- 3 · encargos que llegaron y no se retiraron en su plazo (reglamento v2).
  -- No se cierran solos: la sala llama al cliente para confirmar y, si no lo
  -- va a retirar, lo pasa a saldo a favor (`encargo_pasar_a_saldo`).
  FOR x IN
    SELECT e.id, e.branch_id, e.producto_nombre, c.name AS cliente, c.phone
      FROM public.app_encargos e JOIN public.customers c ON c.id = e.customer_id
     WHERE e.estado = 'listo' AND e.aviso_sin_retirar_at IS NULL
       AND public.encargo_retirar_hasta(e) < v_hoy AND NOT public.prorroga_pendiente('encargo', e.id)
  LOOP
    v_dest := public.destinatarios_de_reservas(x.branch_id);
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        'Encargo sin retirar · E-' || lpad(x.id::text, 6, '0'),
        'Pasó el plazo y ' || coalesce(initcap(split_part(x.cliente, ' ', 1)), 'el cliente') || ' no ha retirado '
          || coalesce(x.producto_nombre, 'su encargo') || '. Llámalo' || coalesce(' al ' || x.phone, '')
          || ' para confirmar; si no lo va a retirar, pásalo a saldo a favor.',
        '/reservas', jsonb_build_object('check_key', 'encargo_sin_retirar:' || x.id, 'encargo_id', x.id),
        true, x.branch_id::integer);
    END IF;
    UPDATE public.app_encargos SET aviso_sin_retirar_at = now() WHERE id = x.id;
    v_encargos := v_encargos + 1;
  END LOOP;

  -- 4 · reservas detenidas (2026-10-26). Mientras lo que falta viene en
  -- camino el plazo de preparación se detiene (reglamento 3.5) y la reserva
  -- no vence sola; una pedida en la sala sin existencia tampoco tiene plazo.
  -- Si en 7 días no se movió, a la sala se le avisa una vez por semana: el
  -- cliente está esperando algo que puede no llegar nunca.
  FOR x IN
    SELECT ar.id, ar.branch_id, ar.producto_nombre, coalesce(ar.pedido, 'R-' || lpad(ar.id::text, 6, '0')) AS codigo,
           greatest(coalesce(ar.pendiente_at, ar.created_at), coalesce(ar.traslado_cambio_at, ar.created_at)) AS desde
      FROM public.app_reservas ar
     WHERE ar.estado = 'pendiente' AND public.reserva_plazo_hasta(ar) IS NULL
       AND greatest(coalesce(ar.pendiente_at, ar.created_at), coalesce(ar.traslado_cambio_at, ar.created_at)) < now() - interval '7 days'
  LOOP
    v_clave := 'reserva_detenida:' || x.id || ':' || to_char(v_hoy, 'IYYY-IW');
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
                           WHERE n.metadata ? 'check_key' AND n.metadata->>'check_key' = v_clave);
    v_dest := public.destinatarios_de_reservas(x.branch_id);
    CONTINUE WHEN v_dest IS NULL;
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
      'Reserva detenida · ' || x.codigo,
      coalesce(x.producto_nombre, 'Una reserva') || ' lleva ' || (v_hoy - (x.desde AT TIME ZONE 'America/El_Salvador')::date)
        || ' días esperando lo que falta. Revisa el traslado o el pedido a Bodega, y llama al cliente: puede esperar o cancelarla.',
      '/reservas', jsonb_build_object('check_key', v_clave, 'reserva_id', x.id), true, x.branch_id::integer);
    v_detenidas := v_detenidas + 1;
  END LOOP;

  -- 5 · encargos cuya fecha estimada ya pasó sin que llegaran. La fecha no es
  -- garantizada, pero si cambia hay que avisarle al cliente (reglamento 4.4).
  FOR x IN
    SELECT e.id, e.branch_id, e.producto_nombre, e.fecha_estimada
      FROM public.app_encargos e
     WHERE e.estado IN ('aceptado', 'pedido') AND e.fecha_estimada IS NOT NULL AND e.fecha_estimada < v_hoy
  LOOP
    v_clave := 'encargo_fecha_pasada:' || x.id || ':' || x.fecha_estimada;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
                           WHERE n.metadata ? 'check_key' AND n.metadata->>'check_key' = v_clave);
    v_dest := public.destinatarios_de_reservas(x.branch_id);
    CONTINUE WHEN v_dest IS NULL;
    PERFORM public.notify_employees(v_dest, 'ENCARGO_APP',
      'Encargo atrasado · E-' || lpad(x.id::text, 6, '0'),
      coalesce(x.producto_nombre, 'Un encargo') || ' debía llegar el ' || to_char(x.fecha_estimada, 'DD/MM')
        || ' y no ha llegado. Cambia la fecha estimada (el cliente recibe el aviso) o marca que el proveedor no entregó.',
      '/reservas', jsonb_build_object('check_key', v_clave, 'encargo_id', x.id), true, x.branch_id::integer);
  END LOOP;

  -- 6 · lo que la SALA tiene que mover antes de que se cierre solo (2026-10-26).
  -- Reglamento, cláusula 3: si la sucursal no prepara la reserva o no revisa la receta
  -- en sus 24 h, se cierra sin consecuencia para el cliente — y él pierde lo
  -- que ya estaba apartado. El aviso de `reservas_vencer` llega DESPUÉS; éste,
  -- seis horas antes. Este cron no corre de noche: a partir de las 21:00 se
  -- avisa también lo que vence antes de las 13:00 del día siguiente.
  FOR x IN
    SELECT DISTINCT ON (coalesce(ar.pedido, ar.id::text))
           ar.id, ar.branch_id, ar.producto_nombre, ar.estado, ar.traslado_estado, coalesce(ar.traslado_llegaron, 0) AS llegaron,
           coalesce(ar.pedido, 'R-' || lpad(ar.id::text, 6, '0')) AS codigo, public.reserva_plazo_hasta(ar) AS hasta
      FROM public.app_reservas ar
     WHERE ar.origen = 'app'
       AND (ar.estado = 'pendiente' OR (ar.estado = 'en_revision' AND ar.receta_estado = 'pendiente'))
       AND public.reserva_plazo_hasta(ar) > now()
       AND (public.reserva_plazo_hasta(ar) <= now() + interval '6 hours'
            OR (v_hora >= 21 AND public.reserva_plazo_hasta(ar)
                  <= (((v_hoy + 1)::timestamp + interval '13 hours') AT TIME ZONE 'America/El_Salvador')))
     ORDER BY coalesce(ar.pedido, ar.id::text), public.reserva_plazo_hasta(ar)
  LOOP
    v_clave := 'reserva_por_vencer_sala:' || x.id || ':' || to_char(x.hasta, 'YYYYMMDDHH24MI');
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
                           WHERE n.metadata ? 'check_key' AND n.metadata->>'check_key' = v_clave);
    v_dest := public.destinatarios_de_reservas(x.branch_id);
    CONTINUE WHEN v_dest IS NULL;
    v_nota := to_char(x.hasta AT TIME ZONE 'America/El_Salvador',
                      CASE WHEN (x.hasta AT TIME ZONE 'America/El_Salvador')::date = v_hoy THEN 'HH24:MI' ELSE 'DD/MM HH24:MI' END);
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
      CASE WHEN x.estado = 'en_revision' THEN 'Receta por revisar · ' ELSE 'Reserva por cerrarse · ' END || x.codigo,
      CASE
        WHEN x.estado = 'en_revision' THEN
          'La receta de ' || coalesce(x.producto_nombre, 'una reserva') || ' espera revisión. Si no se revisa antes de las ' || v_nota || ', la reserva se cierra sola.'
        WHEN x.traslado_estado = 'precio' THEN
          'Bodega dio otro precio para ' || coalesce(x.producto_nombre, 'una reserva') || '. Llama al cliente para que decida antes de las ' || v_nota || '; si no, la reserva se cierra sola.'
        WHEN x.traslado_estado IS NOT NULL AND x.llegaron > 0 THEN
          'Llegó sólo una parte de ' || coalesce(x.producto_nombre, 'una reserva') || '. Llama al cliente para que elija —lo que llegó, otro producto o cancelar— antes de las ' || v_nota || '; si no, la reserva se cierra sola y pierde lo que llegó.'
        WHEN x.traslado_estado IS NOT NULL THEN
          'El traslado de ' || coalesce(x.producto_nombre, 'una reserva') || ' no salió. Consíguelo en otra sucursal o llama al cliente antes de las ' || v_nota || '; si no, la reserva se cierra sola.'
        ELSE
          coalesce(x.producto_nombre, 'Una reserva') || ' espera que la preparen. Si no queda lista antes de las ' || v_nota || ', se cierra sola.'
      END,
      '/reservas', jsonb_build_object('check_key', v_clave, 'reserva_id', x.id), true, x.branch_id::integer);
    v_por_vencer := v_por_vencer + 1;
  END LOOP;

  RETURN json_build_object('saldos_apagados', v_apagados, 'avisos_existencia', v_avisos, 'saldos_devueltos', v_reversos,
                           'encargos_sin_retirar', v_encargos, 'reservas_detenidas', v_detenidas,
                           'por_vencer_en_sala', v_por_vencer);
END $function$;

CREATE OR REPLACE FUNCTION public.resolve_pedido_item(p_item_id integer, p_action text, p_user_id uuid DEFAULT NULL::uuid, p_tipo text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_pedido_id UUID;
    v_suc_id    INTEGER;
    v_cur_res   TEXT;
    v_actor     uuid := auth_employee_id();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    SELECT pedido_id, erp_sucursal_id, resolucion_status
    INTO   v_pedido_id, v_suc_id, v_cur_res
    FROM   pedido_items WHERE id = p_item_id FOR UPDATE;

    IF v_pedido_id IS NULL THEN
        RAISE EXCEPTION 'Item no encontrado.';
    END IF;

    -- El renglón tiene que ser de la sala de quien llama, salvo alcance de red
    -- (2026-10-08). El id viene del navegador: sin esto, un cargo de sala
    -- proponía, confirmaba o rechazaba diferencias de OTRA sucursal. La
    -- función viva no distingue turnos sala/bodega por acción —cualquiera con
    -- `pedidos` editar hace las tres—, y eso no se cambia acá.
    IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos']))
       AND v_suc_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
        RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: ese producto es de otra sucursal';
    END IF;

    IF p_action = 'proponer' THEN
        UPDATE pedido_items SET
            resolucion_status  = 'propuesta',
            resolucion_tipo    = p_tipo,
            resolucion_nota    = NULLIF(TRIM(COALESCE(p_nota, '')), ''),
            resuelto_por       = v_actor,
            resuelto_at        = NOW(),
            rechazado_por      = NULL,
            rechazado_at       = NULL,
            nota_rechazo       = NULL,
            confirmado_suc_por = NULL,
            confirmado_suc_at  = NULL
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_propuesta',
             p_tipo, NULLIF(TRIM(COALESCE(p_nota, '')), ''), v_actor);

    ELSIF p_action = 'confirmar' THEN
        IF v_cur_res <> 'propuesta' THEN
            RAISE EXCEPTION 'Solo se puede confirmar una propuesta activa.';
        END IF;

        UPDATE pedido_items SET
            resolucion_status  = 'confirmada',
            confirmado_suc_por = v_actor,
            confirmado_suc_at  = NOW()
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_confirmada',
             NULLIF(TRIM(COALESCE(p_nota, '')), ''), v_actor);

        PERFORM public.cerrar_pedido_si_todo_resuelto(v_pedido_id, v_suc_id, v_actor);

    ELSIF p_action = 'rechazar' THEN
        IF v_cur_res <> 'propuesta' THEN
            RAISE EXCEPTION 'Solo se puede rechazar una propuesta activa.';
        END IF;

        UPDATE pedido_items SET
            resolucion_status = 'rechazada',
            rechazado_por     = v_actor,
            rechazado_at      = NOW(),
            nota_rechazo      = NULLIF(TRIM(COALESCE(p_nota, '')), '')
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_rechazada',
             NULLIF(TRIM(COALESCE(p_nota, '')), ''), v_actor);

    ELSE
        RAISE EXCEPTION 'Acción desconocida: %', p_action;
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolver_diferencia_corte(p_corte_id bigint, p_via text, p_causa text, p_monto_esperado numeric, p_personas jsonb DEFAULT '[]'::jsonb, p_evidencia_ref text DEFAULT NULL::text, p_evidencia_foto text DEFAULT NULL::text, p_monto numeric DEFAULT NULL::numeric, p_mapfre_invoice_id bigint DEFAULT NULL::bigint)
 RETURNS cortes_caja_diferencias
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_corte    public.cortes_caja;
    v_scope    text;
    v_monto    numeric;
    v_cubierto numeric;
    v_resta    numeric;
    v_parte    numeric;
    v_dif      public.cortes_caja_diferencias;
    v_suma     numeric;
    v_cuenta   integer;
    v_ajeno    text;
    v_ref      text := NULLIF(btrim(coalesce(p_evidencia_ref, '')), '');
    v_foto     text := NULLIF(btrim(coalesce(p_evidencia_foto, '')), '');
    v_mapfre   json;
BEGIN
    IF NOT (SELECT auth_has_module_permission('cortes_caja_resolver', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_via NOT IN ('REPONE','RETIRA','JUSTIFICA') THEN
        RAISE EXCEPTION 'Via invalida: %', p_via;
    END IF;

    IF p_causa IS NULL OR btrim(p_causa) = '' THEN
        RAISE EXCEPTION 'Resolver una diferencia exige decir la causa.';
    END IF;

    IF p_mapfre_invoice_id IS NOT NULL AND p_via <> 'JUSTIFICA' THEN
        RAISE EXCEPTION 'Un pago de Mapfre sin anotar se liga a una causa encontrada.';
    END IF;

    -- El candado del corte serializa a dos personas resolviendo a la vez: sin
    -- él, dos causas parciales podrían sumar más que el tramo.
    SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_corte_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El corte no existe.'; END IF;

    v_scope := (SELECT auth_module_scope('cortes_caja'));
    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    -- La factura de Mapfre (2026-11-07): la valida `mapfre_cotizar` —de Mapfre,
    -- de esta sala, válida, con parte del asegurado y sin cobro—, y además
    -- tiene que ser del día del corte o de antes. Ella es el comprobante.
    IF p_mapfre_invoice_id IS NOT NULL THEN
        v_mapfre := public.mapfre_cotizar(v_corte.branch_id, p_mapfre_invoice_id);
        IF (v_mapfre->>'fecha')::date > v_corte.fecha THEN
            RAISE EXCEPTION 'Esa factura de Mapfre es posterior al corte. Su pago no pudo estar en esta caja.';
        END IF;
        v_ref := coalesce(v_ref, 'Mapfre Fac ' || coalesce(nullif(ltrim(split_part(v_mapfre->>'correlativo', '_', 1), '0'), ''), v_mapfre->>'correlativo'));
    END IF;

    -- Decidido con el usuario el 2026-09-25: una causa encontrada se respalda.
    IF p_via = 'JUSTIFICA' AND v_ref IS NULL AND v_foto IS NULL THEN
        RAISE EXCEPTION 'Una causa encontrada necesita su comprobante: el numero del documento que se corrigio o una foto.';
    END IF;

    IF v_corte.tipo <> 'C' THEN
        RAISE EXCEPTION 'El cierre del dia no tiene diferencia que resolver.';
    END IF;

    IF v_corte.estado = 'DESCARTADO' THEN
        RAISE EXCEPTION 'Un corte descartado no tiene diferencia que reponer.';
    END IF;

    -- El monto lo pone el servidor. Ver el encabezado de 20260814211953.
    v_monto := public.corte_tramo(p_corte_id);

    IF abs(v_monto) < 0.01 THEN
        RAISE EXCEPTION 'Este corte cuadra: no hay diferencia que resolver.';
    END IF;

    IF p_monto_esperado IS NULL OR abs(v_monto - p_monto_esperado) >= 0.01 THEN
        RAISE EXCEPTION 'La diferencia cambio mientras se resolvia: ahora es %, no %. Hay que abrirla de nuevo.',
            to_char(v_monto, 'FM999999990.00'), to_char(coalesce(p_monto_esperado, 0), 'FM999999990.00');
    END IF;

    -- Un pago que entró sin anotarse deja dinero DE MÁS: sólo explica un sobrante.
    IF p_mapfre_invoice_id IS NOT NULL AND v_monto < 0 THEN
        RAISE EXCEPTION 'Este corte tiene faltante: un pago de Mapfre sin anotar sólo explica un sobrante.';
    END IF;

    IF p_via = 'REPONE' AND v_monto > 0 THEN
        RAISE EXCEPTION 'Este corte tiene sobrante: no hay nada que reponer.';
    END IF;
    IF p_via = 'RETIRA' AND v_monto < 0 THEN
        RAISE EXCEPTION 'Este corte tiene faltante: no hay nada que retirar.';
    END IF;

    -- Lo que ya está cubierto por las resoluciones vivas, y lo que queda.
    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.corte_id = p_corte_id AND d.anulada_at IS NULL
                  AND d.via <> 'JUSTIFICA') THEN
        RAISE EXCEPTION 'Este corte ya tiene su diferencia resuelta.';
    END IF;

    SELECT coalesce(sum(abs(d.monto)), 0) INTO v_cubierto
      FROM public.cortes_caja_diferencias d
     WHERE d.corte_id = p_corte_id AND d.anulada_at IS NULL;

    v_resta := round(abs(v_monto) - v_cubierto, 2);
    IF v_resta < 0.01 THEN
        RAISE EXCEPTION 'Este corte ya tiene su diferencia resuelta.';
    END IF;

    -- Sin `p_monto`, la resolución cubre todo lo que queda: es lo que hacía
    -- antes, y lo que siguen mandando las pantallas viejas en caché.
    v_parte := round(abs(coalesce(p_monto, v_resta)), 2);

    IF p_via = 'JUSTIFICA' THEN
        IF v_parte < 0.01 THEN
            RAISE EXCEPTION 'Hay que decir cuanto explica la causa.';
        END IF;
        IF v_parte - v_resta >= 0.01 THEN
            RAISE EXCEPTION 'La causa explica % y quedan % por explicar: no puede explicar mas de lo que queda.',
                to_char(v_parte, 'FM999999990.00'), to_char(v_resta, 'FM999999990.00');
        END IF;
    ELSIF abs(v_parte - v_resta) >= 0.01 THEN
        -- La vía que mueve dinero cierra el corte: va por lo que queda, justo.
        RAISE EXCEPTION 'Quedan % sin causa y esta resolucion cubre %: tienen que ser iguales.',
            to_char(v_resta, 'FM999999990.00'), to_char(v_parte, 'FM999999990.00');
    END IF;

    SELECT count(*), coalesce(sum((x->>'monto')::numeric), 0)
      INTO v_cuenta, v_suma
      FROM jsonb_array_elements(coalesce(p_personas, '[]'::jsonb)) x;

    IF p_via = 'REPONE' THEN
        IF v_cuenta = 0 THEN
            RAISE EXCEPTION 'Falta decir quien responde por el faltante.';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_personas) x
                    WHERE coalesce((x->>'monto')::numeric, 0) <= 0) THEN
            RAISE EXCEPTION 'Cada responsable tiene que llevar una parte mayor que cero.';
        END IF;
        IF abs(v_suma - v_parte) >= 0.01 THEN
            RAISE EXCEPTION 'Las partes suman % y el faltante sin causa es %.',
                to_char(v_suma, 'FM999999990.00'), to_char(v_parte, 'FM999999990.00');
        END IF;

        -- Puede responder quien trabaja en la sala, o quien vendió en el tramo
        -- aunque su ficha sea de otra (estaba cubriendo).
        SELECT coalesce(e.name, 'Esa persona') INTO v_ajeno
          FROM jsonb_array_elements(p_personas) x
          LEFT JOIN public.employees e ON e.id = (x->>'employee_id')::uuid
         WHERE e.id IS NULL
            OR e.status <> 'ACTIVO'
            OR (e.branch_id IS DISTINCT FROM v_corte.branch_id
                AND NOT EXISTS (SELECT 1 FROM public.employee_branches eb
                                 WHERE eb.employee_id = e.id AND eb.branch_id = v_corte.branch_id)
                AND NOT EXISTS (SELECT 1 FROM public.corte_vendedores_del_tramo(p_corte_id) vt
                                 WHERE vt.employee_id = e.id))
         LIMIT 1;

        IF v_ajeno IS NOT NULL THEN
            RAISE EXCEPTION '% no trabaja en esa sucursal, no vendió en ese corte o ya no está activa. No puede responder por este faltante.', v_ajeno;
        END IF;
    ELSIF v_cuenta > 0 THEN
        RAISE EXCEPTION 'Solo un faltante sin causa lleva responsables.';
    END IF;

    -- El monto se guarda con el signo del tramo, como siempre.
    INSERT INTO public.cortes_caja_diferencias
        (corte_id, branch_id, fecha, monto, via, causa, registrado_por,
         evidencia_ref, evidencia_foto_url, mapfre_invoice_id)
    VALUES (p_corte_id, v_corte.branch_id, v_corte.fecha, sign(v_monto) * v_parte, p_via,
            btrim(p_causa), (SELECT auth_employee_id()), v_ref, v_foto, p_mapfre_invoice_id)
    RETURNING * INTO v_dif;

    IF v_cuenta > 0 THEN
        INSERT INTO public.cortes_caja_diferencia_personas
            (diferencia_id, employee_id, monto, del_turno)
        SELECT v_dif.id, (x->>'employee_id')::uuid, round((x->>'monto')::numeric, 2),
               coalesce((x->>'del_turno')::boolean, false)
          FROM jsonb_array_elements(p_personas) x;
    END IF;

    INSERT INTO public.cortes_caja_eventos
        (corte_id, accion, motivo, nota, employee_id)
    VALUES (p_corte_id, 'RESOLVER_DIFERENCIA', btrim(p_causa),
            p_via || ' ' || to_char(v_dif.monto, 'FM999999990.00')
              || CASE WHEN v_parte < abs(v_monto) - 0.005
                      THEN ' de ' || to_char(v_monto, 'FM999999990.00') ELSE '' END
              || CASE WHEN v_ref IS NOT NULL THEN ' · ' || v_ref ELSE '' END
              || CASE WHEN v_mapfre IS NOT NULL
                      THEN ' · pago Mapfre ' || to_char((v_mapfre->>'monto')::numeric, 'FM999999990.00') ELSE '' END,
            (SELECT auth_employee_id()));

    RETURN v_dif;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolver_envio_aparecido(p_request_id uuid, p_actor uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r        public.approval_requests%ROWTYPE;
    m        jsonb;
    v_org    integer;
    v_sala   text;
    v_nombre text;
    v_n      integer;
    v_prods  jsonb;
    v_uno    text;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
    v_resp   jsonb;
BEGIN
    -- Todavía queda algo en «no llegó»: la bolsa no se toca ni se avisa.
    IF EXISTS (SELECT 1 FROM public.envio_linea
                WHERE request_id = p_request_id AND estado = 'no_llego') THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'QUEDAN');
    END IF;

    SELECT count(*),
           jsonb_agg(jsonb_build_object('nombre', coalesce(el.descripcion, 'Producto #' || el.erp_product_id))
                     ORDER BY el.posicion),
           max(coalesce(el.descripcion, 'el producto #' || el.erp_product_id))
      INTO v_n, v_prods, v_uno
      FROM public.envio_linea el
      JOIN public.bolsa_faltante bf
        ON bf.request_id = el.request_id AND bf.posicion = el.posicion AND bf.familia = 'envio'
     WHERE el.request_id = p_request_id
       AND el.estado = 'aceptada'
       AND bf.estado = 'aparecio'
       AND el.decidido_at > bf.declarado_at;
    IF coalesce(v_n, 0) = 0 THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'NADA_APARECIO');
    END IF;

    -- Una sola vez por bolsa, aunque dos lleguen a la vez: el UPDATE con la
    -- marca es el candado. Si la bolsa era REJECTED pasa a APPROVED y se le
    -- quita el «No llegó»; si ya era APPROVED (aceptaron una parte y lo demás
    -- apareció después) sólo se marca.
    UPDATE public.approval_requests
       SET status      = CASE WHEN status = 'REJECTED' THEN 'APPROVED' ELSE status END,
           approver_id = CASE WHEN status = 'REJECTED' THEN p_actor ELSE approver_id END,
           metadata    = (coalesce(metadata, '{}'::jsonb)
                          - CASE WHEN status = 'REJECTED' THEN 'rejection_reason' ELSE '' END)
                         || jsonb_build_object('aparecio_avisado_at', now()),
           updated_at  = now()
     WHERE id = p_request_id
       AND type = 'INVENTORY_TRANSFER_PUSH'
       AND status IN ('REJECTED', 'APPROVED')
       AND NOT (coalesce(metadata, '{}'::jsonb) ? 'aparecio_avisado_at')
    RETURNING * INTO r;
    IF r.id IS NULL THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'YA_AVISADO');
    END IF;

    -- El aviso de faltante ya está resuelto: se apaga en la campana de quien
    -- lo recibió, con el desenlace.
    UPDATE public.notifications
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('resuelta', 'APARECIO'),
           read_at  = coalesce(read_at, now())
     WHERE type = 'REQUEST_PENDING'
       AND metadata->>'request_id' = p_request_id::text
       AND metadata ? 'faltantes';

    m      := coalesce(r.metadata, '{}'::jsonb);
    v_org  := nullif(m->>'origen_branch_id', '')::integer;
    v_sala := coalesce(nullif(m->>'branch_name', ''), 'La otra sucursal');
    IF v_org IS NULL THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'SIN_ORIGEN');
    END IF;

    -- Los mismos destinatarios que el aviso de resolución de siempre: quien
    -- armó el envío, la jefatura de su sala y quien esté en turno.
    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (e.id = r.employee_id
            -- A quien le dijeron «faltó» se le dice «apareció».
            OR e.id IN (SELECT n.recipient_id FROM public.notifications n
                         WHERE n.type = 'REQUEST_PENDING'
                           AND n.metadata->>'request_id' = p_request_id::text
                           AND n.metadata ? 'faltantes')
            OR (e.branch_id = v_org
                AND (public.rango_de_empleado(e.id) BETWEEN 1 AND 2
                     OR e.id IN (SELECT t.employee_id FROM public.empleados_en_turno(v_org) t))));
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN
        RETURN json_build_object('ok', true, 'avisado', false, 'motivo', 'SIN_DESTINATARIOS');
    END IF;

    SELECT name INTO v_nombre FROM public.employees WHERE id = p_actor;

    v_titulo := 'Apareció lo que faltaba de tu traslado'
             || coalesce(' ' || nullif(m->>'codigo_bolsa', ''), '');
    v_cuerpo := v_sala || ' encontró y recibió '
             || CASE WHEN v_n = 1 THEN v_uno || ', que había marcado como no llegado.'
                     ELSE 'los ' || v_n || ' productos que había marcado como no llegados.' END
             || ' Ya no hay que buscarlos en tu sucursal.';
    v_link   := '/traslados?tab=envios&envio=' || r.id;

    v_resp := jsonb_strip_nulls(jsonb_build_object(
        'tipo',       'envio',
        'estado',     'APARECIO',
        'quien',      v_nombre,
        'quien_id',   p_actor,
        'quien_foto', public.foto_de_empleado(p_actor),
        'sala',       nullif(m->>'branch_name', ''),
        'aceptados',  v_n,
        'productos',  v_prods));

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', r.id, 'request_type', r.type, 'resuelta', r.status,
                              'respuesta', v_resp),
           v_org, p_actor
      FROM unnest(v_dest) d;

    -- El cuerpo va entero al teléfono: `texto_de_push` resumiría una respuesta
    -- de envío como «Se quedó con N», que acá no explica nada.
    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)));

    RETURN json_build_object('ok', true, 'avisado', true, 'productos', v_n,
                             'destinatarios', array_length(v_dest, 1));
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolver_pago_bono_sin_confirmar(p_item text, p_salio boolean, p_nota text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- H20: un pago de bono quedó 'enviado' y la caja nunca confirmó. Quien paga
-- mira la caja y dice si la salida está o no. Si salió, el bono queda pagado;
-- si no, el movimiento del portal se anula y el bono vuelve a quedar por pagar.
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_pago  public.promocion_pago%ROWTYPE;
    v_mov   public.caja_movimientos_portal%ROWTYPE;
    v_nota  text := nullif(btrim(coalesce(p_nota, '')), '');
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF p_salio IS NULL THEN RAISE EXCEPTION 'FALTA_RESPUESTA: ¿salió o no salió de la caja?'; END IF;
    IF v_nota IS NULL THEN RAISE EXCEPTION 'MOTIVO_REQUERIDO: anota qué viste en la caja'; END IF;

    SELECT * INTO v_pago FROM public.promocion_pago WHERE item = p_item FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: ese bono no tiene un pago en curso'; END IF;
    IF NOT (public.es_jefe_de_sala(v_actor, v_pago.branch_id)
            OR (SELECT public.auth_can_edit_any(ARRAY['promociones']))) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: lo resuelve el jefe de sucursal' USING ERRCODE = '42501';
    END IF;
    IF v_pago.estado <> 'enviado' THEN
        RAISE EXCEPTION 'NO_PENDIENTE: ese pago ya no espera respuesta de la caja (%)', v_pago.estado;
    END IF;
    SELECT * INTO v_mov FROM public.caja_movimientos_portal WHERE id = v_pago.movimiento_id FOR UPDATE;
    IF FOUND AND v_mov.created_at > now() - interval '3 minutes' THEN
        RAISE EXCEPTION 'EN_CURSO: ese pago se está registrando en la caja';
    END IF;

    IF p_salio THEN
        UPDATE public.promocion_pago
           SET estado = 'pagado', updated_at = now(),
               nota = left('Confirmado a mano: ' || v_nota, 500)
         WHERE id = v_pago.id;
    ELSE
        IF FOUND AND v_mov.anulado_at IS NULL THEN
            -- El trigger caja_movimiento_sigue_bono lo pasa a 'anulado'.
            UPDATE public.caja_movimientos_portal
               SET anulado_at = now(), anulado_por = v_actor,
                   anulado_motivo = left('La caja no confirmó la salida: ' || v_nota, 500),
                   updated_at = now()
             WHERE id = v_mov.id;
        END IF;
        UPDATE public.promocion_pago
           SET estado = 'anulado', updated_at = now(),
               nota = left('No salió de la caja: ' || v_nota, 500)
         WHERE id = v_pago.id;
    END IF;

    RETURN json_build_object('item', p_item, 'estado', CASE WHEN p_salio THEN 'pagado' ELSE 'anulado' END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.retiro_cargar(p_request_id uuid, p_entrego_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_quien     uuid := public.auth_employee_id();
  v_meta      jsonb;
  v_tipo      text;
  v_origen    bigint;
  v_destino   bigint;
  v_propia    boolean;
  v_retiro    uuid;
  v_firma     uuid;
BEGIN
  IF v_quien IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Sesión inválida.');
  END IF;

  SELECT ar.type, ar.metadata INTO v_tipo, v_meta
  FROM public.approval_requests ar WHERE ar.id = p_request_id;

  IF v_tipo IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Ese traslado no existe.');
  END IF;
  IF v_tipo NOT IN ('INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH') THEN
    RETURN json_build_object('ok', false, 'error', 'Ese documento no es un traslado entre sucursales.');
  END IF;

  -- La verdad de JavaScript, igual que `get_traslados_por_recibir`: ausente,
  -- null, false y 0 son todos «no».
  IF coalesce(v_meta->>'erp_traslado', '') IN ('', 'false', '0') THEN
    RETURN json_build_object('ok', false, 'error', 'Ese paquete todavía no salió de la sucursal.');
  END IF;
  IF coalesce(v_meta->>'erp_recibido', '') NOT IN ('', 'false', '0') THEN
    RETURN json_build_object('ok', false, 'codigo', 'YA_RECIBIDO',
                             'error', 'Ese paquete ya se recibió.');
  END IF;

  v_origen  := nullif(v_meta->>'origen_branch_id', '')::bigint;
  v_destino := nullif(v_meta->>'branch_id', '')::bigint;

  v_propia := v_origen IS NOT NULL AND public.puede_entregar_de(v_quien, v_origen);

  -- ── La firma, si hay alguna que sirva ────────────────────────────────────
  --
  -- Tres caminos, y ninguno traba la carga:
  --   · el retirador es de esa sala        → no hace falta firma
  --   · viene un carné en esta llamada     → se valida y se guarda
  --   · ya firmó alguien en este recorrido → se hereda
  -- y si no hay ninguno, la bolsa se carga igual y queda marcada «falta firma».
  IF NOT v_propia THEN
    IF p_entrego_id IS NOT NULL THEN
      IF p_entrego_id = v_quien THEN
        RETURN json_build_object('ok', false, 'codigo', 'FIRMA_PROPIA',
          'error', 'Quien entrega tiene que ser alguien de esa sucursal, no tú.');
      END IF;
      IF v_origen IS NOT NULL AND NOT public.puede_entregar_de(p_entrego_id, v_origen) THEN
        RETURN json_build_object('ok', false, 'codigo', 'ENTREGA_AJENA',
          'error', 'Esa persona no puede entregar producto de esa sucursal.');
      END IF;
      v_firma := p_entrego_id;
    ELSIF v_origen IS NOT NULL THEN
      SELECT f.entrego_id INTO v_firma
      FROM public.retiro_firmas f
      JOIN public.retiros r ON r.id = f.retiro_id
      WHERE r.retirador_id = v_quien AND r.cerrado_at IS NULL
        AND public.puede_entregar_de(f.entrego_id, v_origen)
      ORDER BY f.firmado_at DESC LIMIT 1;
    END IF;
  END IF;

  SELECT r.id INTO v_retiro FROM public.retiros r
  WHERE r.retirador_id = v_quien AND r.cerrado_at IS NULL LIMIT 1;

  IF v_retiro IS NULL THEN
    INSERT INTO public.retiros (retirador_id) VALUES (v_quien) RETURNING id INTO v_retiro;
  END IF;

  IF v_firma IS NOT NULL THEN
    INSERT INTO public.retiro_firmas (retiro_id, entrego_id) VALUES (v_retiro, v_firma)
    ON CONFLICT (retiro_id, entrego_id) DO NOTHING;
  END IF;

  BEGIN
    INSERT INTO public.retiro_bultos (retiro_id, request_id, origen_branch_id, entrego_id, firma_requerida)
    VALUES (v_retiro, p_request_id, v_origen, CASE WHEN v_propia THEN NULL ELSE v_firma END,
            NOT v_propia);
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('ok', false, 'codigo', 'YA_CARGADA',
      'error', coalesce((
        SELECT 'Ese paquete ya lo lleva ' || e.name
        FROM public.retiro_bultos b
        JOIN public.retiros r2 ON r2.id = b.retiro_id
        JOIN public.employees e ON e.id = r2.retirador_id
        WHERE b.request_id = p_request_id AND b.entregado_at IS NULL LIMIT 1
      ), 'Ese paquete ya va en otro retiro.'));
  END;

  RETURN json_build_object(
    'ok', true, 'retiro_id', v_retiro,
    'origen_branch_id', v_origen, 'destino_branch_id', v_destino,
    'firma_propia', v_propia,
    -- Lo que la pantalla necesita para saber si tiene que insistir con el carné.
    'falta_firma', (NOT v_propia) AND v_firma IS NULL,
    'entrego', (SELECT e.name FROM public.employees e WHERE e.id = v_firma));
END;
$function$;

CREATE OR REPLACE FUNCTION public.retiro_firmar(p_entrego_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_quien  uuid := public.auth_employee_id();
  v_retiro uuid;
  v_nombre text;
  v_sala   bigint;
  v_n      int;
BEGIN
  IF v_quien IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Sesión inválida.');
  END IF;
  IF p_entrego_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Falta el carné de quien entrega.');
  END IF;
  IF p_entrego_id = v_quien THEN
    RETURN json_build_object('ok', false, 'codigo', 'FIRMA_PROPIA',
      'error', 'Quien entrega tiene que ser alguien de esa sucursal, no tú.');
  END IF;

  SELECT e.name, e.branch_id INTO v_nombre, v_sala
  FROM public.employees e WHERE e.id = p_entrego_id;

  IF v_nombre IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Ese carné no es de nadie.');
  END IF;
  -- Sin sala no responde por el producto de ninguna: firmar sería anotar una
  -- custodia que no dice de dónde salió nada.
  IF v_sala IS NULL THEN
    RETURN json_build_object('ok', false, 'codigo', 'SIN_SALA',
      'error', v_nombre || ' no está asignado a ninguna sucursal, así que no puede entregar producto.');
  END IF;

  SELECT r.id INTO v_retiro FROM public.retiros r
  WHERE r.retirador_id = v_quien AND r.cerrado_at IS NULL LIMIT 1;

  IF v_retiro IS NULL THEN
    INSERT INTO public.retiros (retirador_id) VALUES (v_quien) RETURNING id INTO v_retiro;
  END IF;

  INSERT INTO public.retiro_firmas (retiro_id, entrego_id) VALUES (v_retiro, p_entrego_id)
  ON CONFLICT (retiro_id, entrego_id) DO NOTHING;

  -- Lo que ya va encima y le corresponde a esta persona. `puede_entregar_de`
  -- decide de qué salas responde: la suya y las que cubre ahora mismo.
  UPDATE public.retiro_bultos b
     SET entrego_id = p_entrego_id
   WHERE b.retiro_id = v_retiro
     AND b.entregado_at IS NULL
     AND b.firma_requerida
     AND b.entrego_id IS NULL
     AND b.origen_branch_id IS NOT NULL
     AND public.puede_entregar_de(p_entrego_id, b.origen_branch_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN json_build_object('ok', true, 'retiro_id', v_retiro,
                           'firmadas', v_n, 'quien', v_nombre);
END;
$function$;

CREATE OR REPLACE FUNCTION public.revision_de_presentaciones()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('productos_tab_presentaciones', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN: no tienes acceso a las presentaciones de productos';
  END IF;

  RETURN json_build_object(
    -- Lo que cambió en los últimos 120 días y qué se convirtió.
    'cambios', (
      SELECT coalesce(json_agg(json_build_object(
               'id', c.id, 'erp_product_id', c.erp_product_id, 'nombre', p.nombre,
               'detectado_at', c.detectado_at, 'procesado_at', c.procesado_at,
               'resultado', c.resultado) ORDER BY c.procesado_at DESC NULLS FIRST), '[]'::json)
        FROM public.cambios_de_factor c
        JOIN public.products p ON p.id = c.erp_product_id
       WHERE c.detectado_at >= now() - interval '120 days'
         AND (c.procesado_at IS NULL
              OR c.resultado ? 'factor_antes'
              OR coalesce((c.resultado->>'ventas_sin_convertir')::int, 0) > 0)),

    -- La existencia que quedó contada en la unidad vieja: las filas de la foto
    -- que sacó el proceso al convertir (`existencia_por_corregir`), y sólo
    -- mientras sigan EXACTAMENTE como estaban. Una fila que cambió —se vendió,
    -- llegó una compra, alguien ya la corrigió en la caja— deja de ofrecerse:
    -- el botón descarta o carga sobre un número que ya no es el de la foto.
    'existencias', (
      WITH rec AS (
        SELECT DISTINCT ON (c.erp_product_id)
               c.id AS cambio_id, c.erp_product_id, c.detectado_at,
               (c.resultado->>'factor_antes')::int AS de,
               (c.resultado->>'factor_ahora')::int AS a,
               c.resultado->'existencia_por_corregir' AS lista
          FROM public.cambios_de_factor c
         WHERE c.procesado_at >= now() - interval '120 days'
           AND jsonb_typeof(c.resultado->'existencia_por_corregir') = 'array'
         ORDER BY c.erp_product_id, c.procesado_at DESC
      ),
      foto AS (
        SELECT r.*, e.x->>'sentido' AS sentido,
               (e.x->>'erp_sucursal_id')::int AS suc,
               nullif(btrim(coalesce(e.x->>'lote', '')), '') AS lote,
               nullif(e.x->>'vence', '')::date AS vence,
               e.x->>'presentacion' AS presentacion,
               (e.x->>'muestra')::int AS muestra,
               (e.x->>'esperado')::int AS esperado,
               (e.x->>'cargar')::int AS cargar, (e.x->>'sobran')::int AS sobran,
               e.x->>'carga_tipo' AS carga_tipo, (e.x->>'carga_factor')::int AS carga_factor
          FROM rec r
          CROSS JOIN LATERAL jsonb_array_elements(r.lista) e(x)
      ),
      vigente AS (
        SELECT f.* FROM foto f
         WHERE (f.sentido = 'achica' AND f.de > 1 AND f.a = 1
                AND EXISTS (SELECT 1 FROM public.inventory i
                             WHERE i.erp_product_id = f.erp_product_id
                               AND i.erp_sucursal_id = f.suc
                               AND NOT i.is_vencidos
                               AND nullif(btrim(coalesce(i.lote, '')), '') IS NOT DISTINCT FROM f.lote
                               AND upper(trim(i.presentacion)) = upper(f.presentacion)
                               AND i.cantidad = f.muestra))
            OR (f.sentido = 'crece' AND f.de = 1 AND f.a > 1
                -- Lo que el inventario muestra hoy tiene que ser lo que muestra
                -- si nadie tocó nada…
                AND (SELECT coalesce(sum(i.cantidad * coalesce(
                              (regexp_match(i.detalle, '\d+[xX](\d+)'))[1]::int, 1)), 0)
                       FROM public.inventory i
                      WHERE i.erp_product_id = f.erp_product_id
                        AND i.erp_sucursal_id = f.suc
                        AND NOT i.is_vencidos) = f.esperado
                -- …y como la existencia guardada no se ve entera (1 de 24 son 0
                -- cajas), una venta desde el cambio también la invalida.
                AND NOT EXISTS (SELECT 1
                                  FROM public.sales_invoice_items ii
                                  JOIN public.sales_invoices si ON si.id = ii.invoice_id
                                  JOIN public.erp_sucursal_map m2 ON m2.branch_id = si.branch_id
                                 WHERE ii.erp_product_id = f.erp_product_id
                                   AND m2.erp_sucursal_id = f.suc
                                   AND si.fecha >= (f.detectado_at AT TIME ZONE 'America/El_Salvador')::date
                                   AND public.venta_valida(si.estado)))
      )
      SELECT coalesce(json_agg(json_build_object(
               'cambio_id', v.cambio_id, 'erp_product_id', v.erp_product_id, 'nombre', p.nombre,
               'sentido', v.sentido,
               'sala', m.nombre, 'erp_sucursal_id', m.erp_sucursal_id, 'branch_id', m.branch_id,
               'presentacion', v.presentacion, 'lote', v.lote, 'vence', v.vence,
               'muestra', v.muestra, 'de', v.de, 'a', v.a,
               -- achica: 16 guardadas con caja de 1 son 1 caja; salen 15.
               -- crece:  1 guardada con caja de 24 es 1 caja; entra 1 caja
               --         (24) y queda 1 suelta de más que no se puede sacar
               --         sin una presentación de 1.
               'quedan',    CASE v.sentido WHEN 'achica' THEN v.muestra / v.de ELSE v.muestra END,
               'descartar', CASE v.sentido WHEN 'achica' THEN v.muestra - v.muestra / v.de END,
               'sueltas',   CASE v.sentido WHEN 'achica' THEN v.muestra % v.de END,
               -- Fotos anteriores al 29-oct no traen dónde cargar: caja nueva.
               'cargar',    CASE v.sentido WHEN 'crece'  THEN coalesce(v.cargar, v.muestra) END,
               'sobran',    CASE v.sentido WHEN 'crece'  THEN coalesce(v.sobran, v.muestra) END,
               'carga_tipo',   CASE v.sentido WHEN 'crece' THEN coalesce(v.carga_tipo, v.presentacion) END,
               'carga_factor', CASE v.sentido WHEN 'crece' THEN coalesce(v.carga_factor, v.a) END,
               -- Una carga de un perecedero sin fecha la rechaza la caja. La
               -- fecha sale de lo último que contó la sala (2026-10-30); si no
               -- contó con fecha, la pantalla la pide antes de corregir.
               'perecedero', coalesce(p.perecedero, false),
               'vence_contado', (
                 SELECT max(nullif(x->>'vence', '')::date)
                   FROM (SELECT coalesce(s2.conteo_2, s2.conteo_1) AS conteo
                           FROM public.consultas_existencia_salas s2
                           JOIN public.consultas_existencia c2 ON c2.id = s2.consulta_id
                          WHERE c2.erp_product_id = v.erp_product_id
                            AND s2.erp_sucursal_id = m.erp_sucursal_id
                            AND coalesce(s2.conteo_2, s2.conteo_1) IS NOT NULL
                          ORDER BY coalesce(s2.contado_2_at, s2.contado_1_at) DESC
                          LIMIT 1) u
                  CROSS JOIN LATERAL jsonb_array_elements(u.conteo) x
                  WHERE coalesce((x->>'cantidad')::int, 0) > 0
                    AND (v.lote IS NULL OR NOT coalesce(p.regulado, false)
                         OR upper(trim(x->>'lote')) = upper(v.lote))),
               'solicitud', (SELECT json_build_object('id', ar.id, 'status', ar.status,
                                    'aplicada', ar.metadata ? 'erp_aplicado', 'at', ar.created_at,
                                    'vence', ar.metadata->'items'->0->>'vence')
                               FROM public.approval_requests ar
                              WHERE ar.type = CASE v.sentido WHEN 'crece' THEN 'INVENTORY_LOAD_REQUEST'
                                                             ELSE 'INVENTORY_DISCARD_REQUEST' END
                                AND ar.metadata->'correccion_de_factor'->>'cambio_id' = v.cambio_id::text
                                AND (ar.metadata->>'erp_sucursal_id')::int = m.erp_sucursal_id
                                -- H28: la corrección es de UN lote.
                                AND nullif(btrim(coalesce(ar.metadata->'correccion_de_factor'->>'lote',
                                                          ar.metadata->'items'->0->>'lote', '')), '')
                                    IS NOT DISTINCT FROM v.lote
                                AND ar.status IN ('PENDING', 'APPROVED')
                              ORDER BY ar.created_at DESC LIMIT 1))
             ORDER BY p.nombre, m.erp_sucursal_id, v.lote), '[]'::json)
        FROM vigente v
        JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = v.suc
        JOIN public.products p ON p.id = v.erp_product_id),

    'sospechosos', (
      SELECT coalesce(json_agg(to_json(f) ORDER BY f.nombre, f.tipo), '[]'::json)
        FROM public.factores_sospechosos() f)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ruta_entregar_bolsa(p_id uuid, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ruta uuid;
BEGIN
  SELECT rb.ruta_id INTO v_ruta FROM public.ruta_bolsas rb
  WHERE rb.id = p_id AND rb.entregada_at IS NULL AND rb.soltada_at IS NULL;
  IF v_ruta IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Ese paquete ya no lo llevas.');
  END IF;
  IF NOT public._ruta_puede_operar(v_ruta) THEN
    RETURN json_build_object('ok', false, 'codigo', 'FORBIDDEN', 'error', 'Sólo el conductor de la ruta puede entregarlo.');
  END IF;
  IF public.sec_exige('ruta_firma_sala') THEN
    RETURN json_build_object('ok', false, 'codigo', 'FALTA_FIRMA', 'error', 'Falta la firma de la sucursal: pide el carné a quien recibe.');
  END IF;
  UPDATE public.ruta_bolsas
     SET entregada_at = now(), entregada_por = public.auth_employee_id(),
         entregada_lat = p_lat, entregada_lng = p_lng
   WHERE id = p_id AND entregada_at IS NULL AND soltada_at IS NULL;
  RETURN json_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ruta_entregar_bolsa_con_carne(p_id uuid, p_valor text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_b      record;
  v_sala   text;
  v_c      json;
  v_hit    uuid;
  v_nombre text;
BEGIN
  SELECT rb.* INTO v_b FROM public.ruta_bolsas rb
   WHERE rb.id = p_id AND rb.entregada_at IS NULL AND rb.soltada_at IS NULL FOR UPDATE;
  IF v_b.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Ese paquete ya no lo llevas.');
  END IF;
  IF NOT public._ruta_puede_operar(v_b.ruta_id) THEN
    RETURN json_build_object('ok', false, 'codigo', 'FORBIDDEN', 'error', 'Sólo el conductor de la ruta puede entregarlo.');
  END IF;
  SELECT name INTO v_sala FROM public.branches WHERE id = v_b.destino_branch_id;

  v_c := public._carne_a_empleado(p_valor);
  IF NOT coalesce((v_c->>'ok')::boolean, false) THEN RETURN v_c; END IF;
  v_hit := (v_c->>'id')::uuid;
  SELECT name INTO v_nombre FROM public.employees WHERE id = v_hit;

  IF v_hit = public.auth_employee_id() THEN
    RETURN json_build_object('ok', false, 'error', 'Ése es tu carné: firma alguien de la sucursal que recibe.');
  END IF;
  IF v_b.destino_branch_id IS NULL OR NOT public.puede_entregar_de(v_hit, v_b.destino_branch_id) THEN
    RETURN json_build_object('ok', false, 'error',
      coalesce(v_nombre, 'Esa persona') || ' no es de ' || coalesce(v_sala, 'la sucursal destino') || ': firma alguien de la sucursal que recibe.');
  END IF;

  UPDATE public.ruta_bolsas
     SET entregada_at = now(), entregada_por = public.auth_employee_id(),
         entregada_lat = p_lat, entregada_lng = p_lng,
         recibio_firma_por = v_hit, recibio_firma_at = now()
   WHERE id = p_id;
  RETURN json_build_object('ok', true, 'quien', v_nombre, 'sala', v_sala);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ruta_firma_sala_carne(p_stop_id uuid, p_valor text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_stop   record;
  v_branch bigint;
  v_sala   text;
  v_c      json;
  v_hit    uuid;
  v_nombre text;
  v_n      integer;
BEGIN
  SELECT rp.* INTO v_stop FROM public.ruta_pedidos rp WHERE rp.id = p_stop_id FOR UPDATE;
  IF v_stop.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Esa parada no existe.');
  END IF;
  IF NOT public._ruta_puede_operar(v_stop.ruta_id) THEN
    RETURN json_build_object('ok', false, 'error', 'Sólo el conductor de la ruta puede pedir la firma.');
  END IF;
  IF v_stop.firma_sala_por IS NOT NULL THEN
    SELECT name INTO v_nombre FROM public.employees WHERE id = v_stop.firma_sala_por;
    RETURN json_build_object('ok', true, 'ya', true, 'quien', v_nombre);
  END IF;

  SELECT m.branch_id INTO v_branch FROM public.erp_sucursal_map m WHERE m.erp_sucursal_id = v_stop.erp_sucursal_id;
  SELECT name INTO v_sala FROM public.branches WHERE id = v_branch;

  v_c := public._carne_a_empleado(p_valor);
  IF NOT coalesce((v_c->>'ok')::boolean, false) THEN RETURN v_c; END IF;
  v_hit := (v_c->>'id')::uuid;
  SELECT name INTO v_nombre FROM public.employees WHERE id = v_hit;

  IF v_hit = public.auth_employee_id() THEN
    RETURN json_build_object('ok', false, 'error', 'Ése es tu carné: firma alguien de la sucursal que recibe.');
  END IF;
  IF v_branch IS NULL OR NOT public.puede_entregar_de(v_hit, v_branch) THEN
    RETURN json_build_object('ok', false, 'error',
      coalesce(v_nombre, 'Esa persona') || ' no es de ' || coalesce(v_sala, 'esta sucursal') || ': firma alguien de la sucursal que recibe.');
  END IF;

  UPDATE public.ruta_pedidos SET firma_sala_at = now(), firma_sala_por = v_hit WHERE id = v_stop.id;
  -- Los paquetes que se quedan en esta parada: los que llevaba para esta sala
  -- (se entregan al marcar la parada) y los que ya se entregaron aquí.
  UPDATE public.ruta_bolsas SET recibio_firma_por = v_hit, recibio_firma_at = now()
   WHERE ruta_id = v_stop.ruta_id AND destino_erp_sucursal_id = v_stop.erp_sucursal_id
     AND soltada_at IS NULL AND recibio_firma_por IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN json_build_object('ok', true, 'quien', v_nombre, 'sala', v_sala, 'paquetes', v_n);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ruta_parada_no_entregada(p_ruta_id uuid, p_pedido_id uuid, p_sucursal_id integer, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor  uuid := auth_employee_id();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  r        public.rutas%ROWTYPE;
  rp       public.ruta_pedidos%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos_tab_rutas']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Rutas';
  END IF;
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos_tab_rutas'])) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: gestionar rutas es de Bodega';
  END IF;
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'MOTIVO_REQUERIDO: di por qué no se entregó';
  END IF;

  SELECT * INTO r FROM public.rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: esa ruta no existe';
  END IF;
  IF r.status NOT IN ('pendiente', 'en_ruta', 'con_alerta') THEN
    RAISE EXCEPTION 'RUTA_CERRADA: la ruta ya está %', r.status;
  END IF;

  SELECT * INTO rp FROM public.ruta_pedidos
   WHERE ruta_id = p_ruta_id AND pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: esa sucursal no va en esa ruta';
  END IF;
  IF rp.entregado_at IS NOT NULL THEN
    RAISE EXCEPTION 'YA_ENTREGADA: esa parada ya se marcó entregada';
  END IF;

  PERFORM public.liberar_parada_de_ruta(rp.id, v_motivo, v_actor, 'parada');

  RETURN jsonb_build_object('ruta_id', p_ruta_id, 'pedido_id', p_pedido_id,
                            'erp_sucursal_id', p_sucursal_id, 'reenvio_ciclo', rp.reenvio_ciclo,
                            'paradas_restantes', (SELECT count(*) FROM public.ruta_pedidos WHERE ruta_id = p_ruta_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.ruta_pedidos_exige_firma_sala()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.entregado_at IS NOT NULL AND OLD.entregado_at IS NULL
     AND NEW.firma_sala_por IS NULL
     AND public.sec_exige('ruta_firma_sala') THEN
    RAISE EXCEPTION 'Falta la firma de la sucursal: pide el carné a quien recibe.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ruta_recoger_bolsa(p_ruta_id uuid, p_codigo text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_quien  uuid := public.auth_employee_id();
  v_status text;
  v_cod    text := nullif(regexp_replace(upper(coalesce(p_codigo, '')), '[^A-Z0-9]', '', 'g'), '');
  v_id     uuid;
  v_tipo   text;
  v_meta   jsonb;
  v_b      record;
  v_nuevo  uuid;
BEGIN
  IF v_quien IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Sesión inválida.');
  END IF;
  SELECT r.status INTO v_status FROM public.rutas r WHERE r.id = p_ruta_id;
  IF v_status IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Esa ruta no existe.');
  END IF;
  IF NOT public._ruta_puede_operar(p_ruta_id) THEN
    RETURN json_build_object('ok', false, 'codigo', 'FORBIDDEN', 'error', 'Sólo el conductor de la ruta puede recoger paquetes en ella.');
  END IF;
  IF v_status NOT IN ('pendiente', 'en_ruta') THEN
    RETURN json_build_object('ok', false, 'error', 'Esta ruta ya terminó.');
  END IF;
  IF v_cod IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'No se leyó ningún código.');
  END IF;

  SELECT ar.id, ar.type, ar.metadata INTO v_id, v_tipo, v_meta
  FROM public.approval_requests ar
  WHERE (ar.type IN ('INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH')
         AND ar.metadata->'erp_traslado'->>'id_traslado' = v_cod)
     OR (ar.type = 'INVENTORY_TRANSFER_PUSH' AND ar.metadata->>'codigo_bolsa' = v_cod)
  ORDER BY ar.updated_at DESC LIMIT 1;

  IF v_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.pedido_traslado_linea l WHERE l.id_traslado = v_cod) THEN
      RETURN json_build_object('ok', false, 'codigo', 'ES_PEDIDO',
        'error', 'Ese ticket es del pedido de Bodega: ya va con las cajas de la ruta.');
    END IF;
    RETURN json_build_object('ok', false, 'codigo', 'NO_EXISTE',
      'error', 'No encontramos ese paquete. Puede que el código no se haya leído bien.');
  END IF;
  IF v_meta ? 'sobrante_de' THEN
    RETURN json_build_object('ok', false, 'error', 'Eso es lo que llegó de más a una sucursal, no un paquete.');
  END IF;

  SELECT * INTO v_b FROM public._bolsas_por_llevar() s WHERE s.request_id = v_id;
  IF v_b.request_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.ruta_bolsas rb WHERE rb.request_id = v_id AND rb.entregada_at IS NOT NULL) THEN
      RETURN json_build_object('ok', false, 'codigo', 'YA_ENTREGADA',
        'error', 'Ese paquete ya se entregó en ' || coalesce((
          SELECT bd.name || ' a las ' || to_char(rb.entregada_at AT TIME ZONE 'America/El_Salvador', 'FMHH12:MI AM')
          FROM public.ruta_bolsas rb LEFT JOIN public.branches bd ON bd.id = rb.destino_branch_id
          WHERE rb.request_id = v_id AND rb.entregada_at IS NOT NULL ORDER BY rb.entregada_at DESC LIMIT 1), 'su sucursal')
        || '; falta que la sucursal lo reciba.');
    END IF;
    IF coalesce(v_meta->>'erp_recibido', '') NOT IN ('', 'false', '0') THEN
      RETURN json_build_object('ok', false, 'codigo', 'YA_RECIBIDA', 'error', 'Ese paquete ya se recibió.');
    END IF;
    RETURN json_build_object('ok', false, 'codigo', 'NO_DESPACHADA',
      'error', 'Ese paquete todavía no salió de la sucursal (o ya se recibió).');
  END IF;
  IF v_b.llevada_por IS NOT NULL THEN
    IF v_b.llevada_en_ruta = p_ruta_id THEN
      RETURN json_build_object('ok', false, 'codigo', 'YA_LA_LLEVAS', 'error', 'Ese paquete ya lo llevas.');
    END IF;
    RETURN json_build_object('ok', false, 'codigo', 'YA_CARGADA', 'error', 'Ese paquete ya lo lleva ' || v_b.llevada_por || '.');
  END IF;

  BEGIN
    INSERT INTO public.ruta_bolsas (ruta_id, request_id, familia, codigo, origen_branch_id, destino_branch_id,
                                    destino_erp_sucursal_id, recogida_por, recogida_lat, recogida_lng)
    VALUES (p_ruta_id, v_id, v_b.familia, v_b.codigo, v_b.origen_branch_id, v_b.destino_branch_id,
            v_b.destino_erp, v_quien, p_lat, p_lng)
    RETURNING id INTO v_nuevo;
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('ok', false, 'codigo', 'YA_CARGADA', 'error', 'Ese paquete ya lo lleva otra persona.');
  END;

  RETURN json_build_object(
    'ok', true, 'id', v_nuevo, 'request_id', v_id, 'codigo', v_b.codigo,
    'origen', v_b.origen_nombre, 'destino', v_b.destino_nombre,
    'en_ruta', EXISTS (SELECT 1 FROM public.ruta_pedidos rp
                        WHERE rp.ruta_id = p_ruta_id AND rp.erp_sucursal_id = v_b.destino_erp));
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_proveedor_condiciones_credito(p_id bigint, p_dias_credito integer, p_limite_credito numeric, p_forma_pago text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Lo puede cambiar quien maneja proveedores o quien maneja las cuentas por
  -- pagar: las dos pantallas ofrecen el mismo campo, y quien registra un pago
  -- necesita poder poner el plazo que falta sin cambiar de módulo.
  IF NOT (public.auth_can_edit_any(ARRAY['proveedores'])
          OR public.auth_has_module_permission('cuentas_por_pagar','can_edit')) THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar las condiciones de un proveedor.';
  END IF;

  IF p_dias_credito IS NOT NULL AND (p_dias_credito < 0 OR p_dias_credito > 365) THEN
    RAISE EXCEPTION 'Los días de crédito van de 0 a 365.';
  END IF;
  IF p_limite_credito IS NOT NULL AND p_limite_credito < 0 THEN
    RAISE EXCEPTION 'El límite de crédito no puede ser negativo.';
  END IF;
  IF p_forma_pago IS NOT NULL
     AND p_forma_pago NOT IN ('efectivo','cheque','transferencia','otro') THEN
    RAISE EXCEPTION 'Forma de pago desconocida: %', p_forma_pago;
  END IF;

  UPDATE public.proveedores_maestro
     SET dias_credito   = p_dias_credito,
         limite_credito = p_limite_credito,
         forma_pago     = p_forma_pago,
         updated_at     = now()
   WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese proveedor no existe.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_proveedor_supplier(p_id bigint, p_supplier_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_otro text;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  BEGIN
    UPDATE public.proveedores_maestro
      SET supplier_id = p_supplier_id, updated_at = now()
      WHERE id = p_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT nombre INTO v_otro
      FROM public.proveedores_maestro
     WHERE supplier_id = p_supplier_id AND id <> p_id
     ORDER BY id LIMIT 1;
    RAISE EXCEPTION 'SUPPLIER_YA_VINCULADO: Ese proveedor ya está vinculado a %. Quita el vínculo allí antes de asignarlo aquí.',
      coalesce(nullif(btrim(v_otro), ''), 'otra ficha');
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sincronizar_conteo_en_vivo(p_conteo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_erp_sucursal_ids int[];
  v_scope_ids int[];
  v_actor uuid;
  v_agregados int := 0;
  v_productos json;
BEGIN
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO'; END IF;

  -- Los motivos por los que no hay nada que hacer se responden igual, con
  -- `agregados: 0` y el motivo escrito: quien llama es una sincronización de
  -- fondo, y hacerla lanzar convertiría "acá no aplica" en un aviso de error
  -- sobre la cara de alguien que está contando.
  IF v_conteo.status NOT IN ('BORRADOR','EN_PROGRESO') THEN
    RETURN jsonb_build_object('agregados', 0, 'motivo', 'CONTEO_CERRADO', 'productos', '[]'::jsonb);
  END IF;
  IF v_conteo.fuente_sistema <> 'VIVO' THEN
    RETURN jsonb_build_object('agregados', 0, 'motivo', 'NO_ES_EN_VIVO', 'productos', '[]'::jsonb);
  END IF;
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit')
     OR (public.auth_module_scope('conteo_inventario') <> 'ALL'
         AND v_conteo.branch_id <> public.auth_employee_branch_id()) THEN
    RETURN jsonb_build_object('agregados', 0, 'motivo', 'SIN_PERMISO', 'productos', '[]'::jsonb);
  END IF;

  SELECT array_agg(erp_sucursal_id) INTO v_erp_sucursal_ids
  FROM public.erp_sucursal_map WHERE branch_id = v_conteo.branch_id;
  IF v_erp_sucursal_ids IS NULL THEN
    RETURN jsonb_build_object('agregados', 0, 'motivo', 'SUCURSAL_SIN_MAPEO_ERP', 'productos', '[]'::jsonb);
  END IF;

  -- El alcance, resuelto a una lista de productos. NULL = sin recorte (TOTAL).
  IF v_conteo.scope_type = 'LABORATORIO' THEN
    SELECT array_agg(id) INTO v_scope_ids FROM public.products
    WHERE laboratorio_id = (v_conteo.scope_filter->>'laboratorio_id')::int;
  ELSIF v_conteo.scope_type = 'BAJO_RECETA' THEN
    v_scope_ids := public.antibioticos_del_cuadre();
  ELSIF v_conteo.scope_type IN ('MANUAL','CICLICO') THEN
    -- Su alcance es una lista elegida (o sorteada) al crear el conteo y no se
    -- guardó en `scope_filter`; se reconstruye desde los renglones que el
    -- conteo ya tiene. Así entra un LOTE nuevo de un producto de la muestra y
    -- NO entra un producto que nadie eligió: agrandar una muestra sorteada
    -- rompe justo lo que la hace auditable.
    SELECT array_agg(DISTINCT erp_product_id) INTO v_scope_ids
    FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id AND es_agregado_manual = false;
  END IF;

  -- Un alcance que se resolvió a lista VACÍA no es "todos": es "ninguno", y
  -- `array_agg` sobre cero filas da NULL, que acá significa lo contrario.
  IF v_conteo.scope_type <> 'TOTAL' AND v_scope_ids IS NULL THEN
    RETURN jsonb_build_object('agregados', 0, 'motivo', 'ALCANCE_VACIO', 'productos', '[]'::jsonb);
  END IF;

  v_actor := public.auth_employee_id();

  WITH existentes AS MATERIALIZED (
    -- La cerca es lo que hace rápida a la función entera: sin ella el
    -- planificador empuja los predicados del lote adentro del index scan, se
    -- estima 1 fila donde hay 1,991, y el anti-join se vuelve un nested loop.
    -- Las claves se normalizan acá una vez, para que arriba queden igualdades.
    SELECT erp_product_id, is_vencidos,
           COALESCE(grupo_key, '') AS gk,
           COALESCE(lote, '') AS lt,
           COALESCE(fecha_vencimiento::text, '') AS fv
    FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id
    UNION ALL
    -- La existencia contra la que se compara un renglón cuya etiqueta se
    -- corrigió: sin esto se lo tomaba por mercadería que llegó después.
    SELECT erp_product_id, is_vencidos,
           COALESCE(grupo_key, ''),
           COALESCE(lote_sistema, ''),
           COALESCE(vence_sistema::text, '')
    FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id AND etiqueta_corregida
  ), nuevos AS (
    INSERT INTO public.conteo_inventario_items (
      conteo_id, erp_product_id, source_inventory_id, source_sync_key,
      presentacion, detalle, lote, fecha_vencimiento, is_vencidos,
      sistema_cantidad, sistema_inicial, costo_unitario, grupo_key)
    SELECT
      p_conteo_id,
      s.erp_product_id,
      CASE WHEN count(*) = 1 THEN min(s.inv_id) END,
      CASE WHEN count(*) = 1 THEN min(s.sync_key) END,
      (array_agg(s.presentacion ORDER BY s.cantidad DESC, s.presentacion))[1],
      (array_agg(s.detalle      ORDER BY s.cantidad DESC, s.presentacion))[1],
      s.g_lote,
      s.g_fecha,
      s.is_vencidos,
      sum(s.cantidad)::int,
      sum(s.cantidad)::int,
      public.conteo_costo_unitario(
        s.erp_product_id,
        (array_agg(s.presentacion ORDER BY s.cantidad DESC, s.presentacion))[1]),
      s.gkey
    FROM (
      SELECT i.id AS inv_id, i.sync_key, i.erp_product_id, i.presentacion, i.detalle,
             i.cantidad, i.is_vencidos,
             CASE WHEN v_conteo.modo = 'SIMPLE' THEN NULL ELSE i.lote END AS g_lote,
             CASE WHEN v_conteo.modo = 'SIMPLE' THEN NULL ELSE i.fecha_vencimiento END AS g_fecha,
             COALESCE(g.grupo_key, 'P:' || upper(btrim(COALESCE(i.presentacion, '')))) AS gkey
      FROM public.inventory i
      LEFT JOIN public.conteo_presentacion_grupo g
             ON g.product_id = i.erp_product_id
            AND g.pres_key = upper(btrim(COALESCE(i.presentacion, '')))
      WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
        AND (v_scope_ids IS NULL OR i.erp_product_id = ANY(v_scope_ids))
    ) s
    -- El renglón que ya existe no se vuelve a crear, tenga cantidad o no. La
    -- clave es la misma con la que agrupa el snapshot.
    WHERE NOT EXISTS (
      SELECT 1 FROM existentes t
      WHERE t.erp_product_id = s.erp_product_id
        AND t.is_vencidos = s.is_vencidos
        AND t.gk = COALESCE(s.gkey, '')
        AND t.lt = COALESCE(s.g_lote, '')
        AND t.fv = COALESCE(s.g_fecha::text, ''))
    GROUP BY s.erp_product_id, s.is_vencidos, s.gkey, s.g_lote, s.g_fecha
    -- Sólo entra lo que HAY. Un grupo en cero no "llegó" a la sala, y un
    -- renglón que se materializa en cero no le pide nada a quien cuenta: sólo
    -- sube el "faltan N" con trabajo que no existe.
    HAVING sum(s.cantidad) > 0
    RETURNING id, erp_product_id, sistema_cantidad
  ), bitacora AS (
    INSERT INTO public.conteo_inventario_item_history
      (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
    SELECT n.id, NULL, n.sistema_cantidad, NULL, 'PENDIENTE',
           'Llegó a la sucursal después de iniciar el conteo', v_actor, 'ALTA_EN_VIVO'
    FROM nuevos n
    RETURNING 1
  )
  SELECT count(*)::int,
         COALESCE(json_agg(json_build_object('producto', pr.nombre, 'sistema', n.sistema_cantidad)
                           ORDER BY n.sistema_cantidad DESC), '[]'::json)
  INTO v_agregados, v_productos
  FROM nuevos n LEFT JOIN public.products pr ON pr.id = n.erp_product_id;

  RETURN jsonb_build_object('agregados', v_agregados, 'productos', v_productos::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.solicitar_devolucion_pedido(p_pedido_item_id integer, p_motivo text, p_cantidad integer, p_nota text DEFAULT NULL::text, p_evidencia jsonb DEFAULT '[]'::jsonb, p_caja jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor  uuid := auth_employee_id();
    v_it     record;
    v_max    integer;
    v_id     uuid;
    v_clave  text;
    v_caja   jsonb;
    v_lote   text;
    v_vence  text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;
    IF p_motivo IS NULL OR p_motivo NOT IN ('faltante', 'danado', 'vencido') THEN
        RAISE EXCEPTION 'MOTIVO_INVALIDO: %', coalesce(p_motivo, '(vacío)');
    END IF;

    SELECT pi.id, pi.pedido_id, pi.erp_sucursal_id, pi.erp_product_id, pi.status,
           pi.cantidad_asignada, pi.cantidad_enviada, pi.cantidad_recibida
      INTO v_it
      FROM public.pedido_items pi
     WHERE pi.id = p_pedido_item_id
       FOR UPDATE;
    IF v_it.id IS NULL THEN
        RAISE EXCEPTION 'ITEM_NO_EXISTE';
    END IF;

    -- La devolución la pide la sala que recibió. Es la que contó la caja y la
    -- única que sabe qué no llegó; y sobre todo, es de donde va a salir el
    -- producto. Supervisión —el CARGO, no el alcance— puede hacerlo por ella.
    IF NOT public.auth_es_supervision()
       AND auth_employee_erp_sucursal_id() IS DISTINCT FROM v_it.erp_sucursal_id THEN
        RAISE EXCEPTION 'SALA_AJENA: la devolución la pide la sucursal que recibió el pedido';
    END IF;

    IF v_it.status <> 'con_diferencia' THEN
        RAISE EXCEPTION 'SIN_DIFERENCIA: este producto no quedó con diferencia al recibirlo';
    END IF;

    -- El daño se muestra. Sin foto, Bodega tendría que decidir a ciegas si
    -- amerita la devolución o si el producto todavía se puede vender.
    IF p_motivo = 'danado' AND coalesce(jsonb_array_length(p_evidencia), 0) = 0 THEN
        RAISE EXCEPTION 'FOTO_REQUERIDA: el daño se muestra con una foto, para que Bodega decida '
                        'si amerita la devolución o si el producto todavía se puede vender';
    END IF;

    -- El tope depende del motivo, y son dos cosas distintas:
    --   faltante → lo que NO llegó (se envió 30, se contaron 28 → 2)
    --   dañado/vencido → sale de lo que SÍ llegó, así que el tope es lo contado
    v_max := CASE
        WHEN p_motivo = 'faltante'
        THEN coalesce(v_it.cantidad_enviada, v_it.cantidad_asignada) - coalesce(v_it.cantidad_recibida, 0)
        ELSE coalesce(v_it.cantidad_recibida, 0)
    END;
    IF p_cantidad IS NULL OR p_cantidad <= 0 OR p_cantidad > v_max THEN
        RAISE EXCEPTION 'CANTIDAD_FUERA_DE_RANGO: por % se puede devolver hasta % (se pidió %)',
                        p_motivo, v_max, coalesce(p_cantidad, 0);
    END IF;

    -- El lote de la caja (2026-11-13): sólo viaja algo que sale de la sala.
    IF p_caja IS NOT NULL AND p_motivo IN ('danado', 'vencido') THEN
        v_lote  := upper(btrim(coalesce(p_caja->>'lote', '')));
        v_vence := left(coalesce(p_caja->>'vence', ''), 10);
        IF v_lote = '' OR v_lote ~* '^gen[eé]rico$' OR length(v_lote) > 40 THEN
            RAISE EXCEPTION 'LOTE_INVALIDO: escribe el lote que trae la caja';
        END IF;
        IF v_vence !~ '^\d{4}-\d{2}-\d{2}$' OR v_vence::date <= current_date THEN
            RAISE EXCEPTION 'VENCE_INVALIDO: el vencimiento de la caja tiene que ser un mes futuro';
        END IF;
        v_caja := jsonb_build_object('lote', v_lote, 'vence', v_vence);
    END IF;

    -- La clave del despacho de ESTE renglón, reusada y no recalculada: dos
    -- fórmulas separadas se separan más. Vive en `clave_movimiento_de_item`,
    -- que es la misma puerta que usa la decisión de la diferencia.
    v_clave := public.clave_movimiento_de_item(p_pedido_item_id, 'DEV');

    INSERT INTO public.pedido_devolucion (
        pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id,
        motivo, viaja, cantidad, nota, evidencia_urls,
        estado, solicitada_por, clave, caja
    ) VALUES (
        v_it.pedido_id, v_it.erp_sucursal_id, v_it.id, v_it.erp_product_id,
        p_motivo, p_motivo <> 'faltante', p_cantidad,
        nullif(btrim(coalesce(p_nota, '')), ''), coalesce(p_evidencia, '[]'::jsonb),
        'solicitada', v_actor, v_clave, v_caja
    )
    RETURNING id INTO v_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    VALUES
        (v_it.id, v_it.pedido_id, v_it.erp_sucursal_id, 'devolucion_solicitada',
         'devolver_bodega', nullif(btrim(coalesce(p_nota, '')), ''), v_actor);

    RETURN jsonb_build_object('id', v_id, 'clave', v_clave, 'viaja', p_motivo <> 'faltante');
END;
$function$;

CREATE OR REPLACE FUNCTION public.soltar_factura_compra(p_claim_id bigint, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp        uuid;
  v_branch     bigint;
  v_registrada boolean;
  v_admin      boolean;
BEGIN
  -- `'ACTIVO'`: ver el comentario de `reclamar_factura_compra`. Acá el efecto
  -- era el mismo — «Soltar» y «Liberar» fallaban siempre —, sólo que nadie
  -- llegó a verlo porque no se podía tomar ninguna factura para soltarla.
  SELECT e.id INTO v_emp
    FROM public.employees e
   WHERE e.id = public.auth_employee_id() AND e.status = 'ACTIVO';
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Tu usuario no está activo.';
  END IF;

  SELECT c.branch_id, c.receipt_id IS NOT NULL
    INTO v_branch, v_registrada
    FROM public.purchase_dte_claims c
   WHERE c.id = p_claim_id AND c.released_at IS NULL;

  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Esa factura ya no está tomada.';
  END IF;

  v_admin := public.auth_can_edit_any(ARRAY['facturas_sala', 'compras', 'facturas_compra']);

  IF NOT v_admin THEN
    PERFORM public.facturas_sala_guarda(v_branch, 'can_edit');
    IF v_registrada THEN
      RAISE EXCEPTION 'Esta factura ya quedó registrada como compra. Pide en Compras que la liberen.';
    END IF;
  END IF;

  UPDATE public.purchase_dte_claims
     SET released_at = now(), released_by = v_emp, released_motivo = p_motivo
   WHERE id = p_claim_id AND released_at IS NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.solventado_interno_aplica(p_invoice_id bigint, p_rechazo_desde timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_si         public.sales_invoices%ROWTYPE;
  v_categoria  text;
  v_nrc        text;
  v_int        public.dte_mh_intentos%ROWTYPE;
BEGIN
  SELECT * INTO v_si FROM public.sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'freno', 'FACTURA_NO_EXISTE',
      'error', 'La factura no existe.');
  END IF;

  -- Freno 1 — el que no se negocia. Un sello son 40 caracteres: `IS NOT NULL`
  -- da por bueno el 'undefined' que esta columna llegó a guardar. Y se mira
  -- también en los intentos: el espejo puede venir un minuto atrás.
  IF length(v_si.recibido_mh) = 40
     OR EXISTS (SELECT 1 FROM public.dte_mh_intentos i
                 WHERE i.invoice_id = p_invoice_id AND length(i.sello) = 40) THEN
    RETURN json_build_object('ok', false, 'freno', 'TIENE_SELLO',
      'error', 'El MH sí recibió esta factura. Hay que invalidarla ante el MH.');
  END IF;

  -- Freno 2
  IF v_si.tipo_documento IS DISTINCT FROM 'CCF' THEN
    RETURN json_build_object('ok', false, 'freno', 'NO_ES_CCF',
      'error', 'Esta salida es sólo para el crédito fiscal emitido a quien no es contribuyente.');
  END IF;

  -- Freno 3 — las dos señales: si se contradicen, no se toma el atajo.
  SELECT c.categoria, c.nrc INTO v_categoria, v_nrc
    FROM public.customers c WHERE c.id = v_si.customer_id;
  IF v_categoria IN ('Contribuyente', 'Gran Contribuyente')
     OR (v_nrc IS NOT NULL AND btrim(v_nrc) <> '') THEN
    RETURN json_build_object('ok', false, 'freno', 'RECEPTOR_ES_CONTRIBUYENTE',
      'error', 'El crédito fiscal le corresponde a este cliente. No se cierra por aquí.');
  END IF;

  -- Freno 5 — Hacienda CONTESTÓ, y lo que contestó es el defecto que no se
  -- arregla. Se mira el ÚLTIMO intento: si después del rechazo hubo otro, manda
  -- ése. `p_rechazo_desde` lo pasa quien acaba de pedir el envío, para que un
  -- rechazo viejo no cuente como respuesta de un envío que no terminó.
  SELECT * INTO v_int FROM public.dte_mh_intentos i
   WHERE i.invoice_id = p_invoice_id
     AND (p_rechazo_desde IS NULL OR i.created_at >= p_rechazo_desde)
   ORDER BY i.created_at DESC, i.id DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'freno', 'SIN_RESPUESTA_DE_HACIENDA',
      'error', 'No hay respuesta del MH para este envío. No se sabe si entró, así que no se anula.');
  END IF;
  IF v_int.ok IS DISTINCT FROM false THEN
    RETURN json_build_object('ok', false, 'freno', 'NO_ES_RECHAZO',
      'error', 'El último envío al MH no fue un rechazo.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(coalesce(v_int.observaciones, '{}'::text[])) o
                  WHERE o ILIKE '%receptor/nrc%') THEN
    RETURN json_build_object('ok', false, 'freno', 'RECHAZO_POR_OTRA_COSA',
      'error', 'El MH la rechazó por otro motivo, no por el NRC del receptor: '
               || coalesce(v_int.error, v_int.descripcion_msg, 'sin detalle')
               || '. Eso se corrige y se reenvía.');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'invoice_id', p_invoice_id,
    'intento_id', v_int.id,
    'categoria', v_categoria,
    'motivo',
      'Crédito fiscal emitido a un cliente que no es contribuyente. El MH lo '
      'rechazó y nunca lo recibió, así que no hay sello que invalidar: se anula '
      'sólo en el sistema y la venta se vuelve a facturar como Consumidor Final '
      '(COF).',
    'instruccion', 'Hay que volver a facturar esta venta como Consumidor Final (COF).');
END;
$function$;

CREATE OR REPLACE FUNCTION public.texto_de_push(p_type text, p_body text, p_meta jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
-- La línea que llega al TELÉFONO (usuario, 24-sep). El cuerpo largo de cada
-- aviso era para la campana cuando la campana era texto; hoy la campana dibuja
-- la tarjeta y el cuerpo sólo lo lee el push, que muestra dos renglones. Esta
-- función arma una línea corta con lo esencial desde el MISMO metadata que
-- dibuja la tarjeta: «AGUA CRISTAL ×24 y 2 más · Monica Estrada».
--
-- Los nombres van CORTOS (nombre y primer apellido), por el mismo canónico de
-- la base, y el documento como CCF/COF. Sin nombre no se llama al canónico:
-- con los tres argumentos vacíos devuelve «Personal», y una línea terminaba en
-- «· Personal» o «lo lleva Personal».
--
-- Si el aviso no trae los datos, o algo falla, devuelve el cuerpo de siempre:
-- un push nunca sale vacío por culpa de esta función.
DECLARE
    m   jsonb := coalesce(p_meta, '{}'::jsonb);
    s   jsonb;
    v   text;
    n   integer;
    mas integer;
    p0  jsonb;
    t   numeric;
BEGIN
    BEGIN
        IF jsonb_typeof(m->'solicitud') = 'object' THEN
            s   := m->'solicitud';
            n   := coalesce(jsonb_array_length(s->'productos'), 0);
            mas := greatest(n - 1, 0) + coalesce((s->>'mas')::integer, 0);
            p0  := s->'productos'->0;
            IF s->>'tipo' = 'INVENTORY_TRANSFER_PUSH' THEN
                v := (n + coalesce((s->>'mas')::integer, 0)) || CASE WHEN n + coalesce((s->>'mas')::integer, 0) = 1 THEN ' producto' ELSE ' productos' END
                  || coalesce(', ' || trim(to_char((s->>'unidades')::numeric, 'FM999,999,990.##')) || ' unidades', '')
                  || coalesce(' · ' || nullif(split_part(s->>'motivo', ':', 1), ''), '');
            ELSIF s ? 'doc' THEN
                v := concat_ws(' · ',
                        -- CCF/COF: los avisos anteriores al 24-sep traen el nombre largo.
                        nullif(concat_ws(' ', CASE WHEN s->>'doc' ILIKE 'cr%dito fiscal' THEN 'CCF'
                                                   WHEN s->>'doc' ILIKE 'consumidor final' OR s->>'doc' = 'Factura' THEN 'COF'
                                                   ELSE s->>'doc' END,
                               CASE WHEN s->>'monto' IS NOT NULL THEN '$' || to_char((s->>'monto')::numeric, 'FM999,999,990.00') END), ''),
                        CASE WHEN s ? 'antes' AND s ? 'despues' THEN (s->>'antes') || ' → ' || (s->>'despues') END,
                        s->>'cliente');
            ELSIF p0 IS NOT NULL THEN
                v := concat_ws(' · ',
                        (p0->>'nombre') || coalesce(' ×' || trim(to_char((p0->>'cantidad')::numeric, 'FM999,999,990.##')), '')
                          || CASE WHEN mas > 0 THEN ' y ' || mas || ' más' ELSE '' END,
                        CASE WHEN nullif(btrim(s->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, s->>'quien') END);
            ELSIF s ? 'antes' AND s ? 'despues' THEN
                v := concat_ws(' · ', (s->>'antes') || ' → ' || (s->>'despues'), CASE WHEN nullif(btrim(s->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, s->>'quien') END);
            ELSE
                v := concat_ws(' · ', CASE WHEN nullif(btrim(s->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, s->>'quien') END, left(s->>'motivo', 90));
            END IF;

        ELSIF jsonb_typeof(m->'respuesta') = 'object' THEN
            s := m->'respuesta';
            IF s->>'tipo' = 'envio' THEN
                v := 'Se quedó con ' || coalesce(s->>'aceptados', '0')
                  || CASE WHEN coalesce(jsonb_array_length(s->'devueltos'), 0) > 0
                          THEN ' y te devuelve ' || jsonb_array_length(s->'devueltos') ELSE '' END
                  || CASE WHEN (s->>'no_llegaron')::integer > 0
                          THEN ' · ' || (s->>'no_llegaron') || ' no llegaron' ELSE '' END;
            ELSIF s->>'estado' = 'NO' THEN
                v := concat_ws(' · ', s->'productos'->0->>'nombre', s->>'motivo');
            ELSE
                n   := coalesce(jsonb_array_length(s->'productos'), 0);
                mas := greatest(n - 1, 0) + coalesce((s->>'mas')::integer, 0);
                p0  := s->'productos'->0;
                v := concat_ws(' · ',
                        (p0->>'nombre')
                          || CASE WHEN p0->>'enviada' IS NULL THEN ''
                                  WHEN (p0->>'enviada')::numeric < coalesce((p0->>'pedida')::numeric, 0)
                                    THEN ' ×' || (p0->>'enviada') || ' de ' || (p0->>'pedida')
                                  ELSE ' ×' || (p0->>'enviada') END
                          || CASE WHEN mas > 0 THEN ' y ' || mas || ' más' ELSE '' END,
                        CASE WHEN nullif(btrim(s->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, s->>'quien') END);
            END IF;

        ELSIF jsonb_typeof(m->'decision') = 'object' THEN
            s := m->'decision';
            v := CASE WHEN s->>'estado' = 'APPROVED'
                      THEN concat_ws(' · ', 'La aprobó ' || (CASE WHEN nullif(btrim(s->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, s->>'quien') END), left(s->>'instruccion', 90), left(s->>'nota', 90))
                      ELSE concat_ws(' · ', 'La rechazó ' || (CASE WHEN nullif(btrim(s->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, s->>'quien') END), left(s->>'nota', 110)) END;

        ELSIF p_type = 'CORTE_NUEVO' AND m ? 'tramo' THEN
            t := (m->>'tramo')::numeric;
            v := concat_ws(' · ',
                    CASE WHEN t IS NULL THEN 'Sin conteo de efectivo'
                         WHEN t <= -0.01 THEN 'Faltaron $' || to_char(abs(t), 'FM999,999,990.00')
                         WHEN t >=  0.01 THEN 'Sobraron $' || to_char(t, 'FM999,999,990.00')
                         ELSE 'Cuadró' END,
                    CASE WHEN nullif(btrim(m->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, m->>'quien') END);

        ELSIF jsonb_typeof(m->'hacienda') = 'object' THEN
            SELECT string_agg(concat_ws(' ', f->>'sala',
                                  CASE WHEN f->>'monto' IS NOT NULL THEN '$' || to_char((f->>'monto')::numeric, 'FM999,999,990.00') END), ' · ')
              INTO v
              FROM (SELECT f FROM jsonb_array_elements(coalesce(m->'hacienda'->'facturas', '[]'::jsonb)) f LIMIT 3) x;

        ELSIF jsonb_typeof(m->'diferencia') = 'object' THEN
            v := concat_ws(' · ', m->'diferencia'->>'producto', m->'diferencia'->>'salida');

        ELSIF p_type = 'MINMAX_PENDING' AND m ? 'min_nuevo' THEN
            v := concat_ws(' · ',
                    'Mín ' || coalesce(m->>'min_hoy', '—') || ' · Máx ' || coalesce(m->>'max_hoy', '—')
                      || ' → Mín ' || (m->>'min_nuevo') || ' · Máx ' || coalesce(m->>'max_nuevo', '—'),
                    m->>'producto');

        ELSIF p_type = 'APERTURAS_DE_LA_MANANA' AND m ? 'total' THEN
            IF coalesce(jsonb_array_length(m->'no_abrieron'), 0) > 0 THEN
                SELECT 'No abrió: ' || string_agg(x, ', ') INTO v FROM jsonb_array_elements_text(m->'no_abrieron') x;
            ELSE
                SELECT CASE WHEN count(*) = 0 THEN NULL
                            WHEN min(h) = max(h) THEN 'Abrieron a las ' || public.hora_12(min(h))
                            ELSE 'Abrieron entre las ' || public.hora_12(min(h)) || ' y las ' || public.hora_12(max(h)) END
                  INTO v
                  FROM (SELECT (x->>'hora')::time AS h FROM jsonb_array_elements(coalesce(m->'salas', '[]'::jsonb)) x
                         WHERE x->>'hora' ~ '^[0-9]{1,2}:[0-9]{2}') t;
            END IF;
            IF coalesce(jsonb_array_length(m->'sin_respuesta'), 0) > 0 THEN
                v := concat_ws(' · ', v, 'sin comprobar: ' || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(m->'sin_respuesta') x));
            END IF;

        ELSIF p_type = 'TRASLADO_RESPALDO' AND jsonb_typeof(m->'traslados') = 'array' THEN
            SELECT jsonb_array_length(m->'traslados') || CASE WHEN jsonb_array_length(m->'traslados') = 1 THEN ' traslado' ELSE ' traslados' END
                     || coalesce(', ' || trim(to_char(coalesce((m->>'unidades')::numeric, sum((x->>'unidades')::numeric)), 'FM999,999,990.##')) || ' unidades', '')
                     || coalesce(' · ' || string_agg(DISTINCT x->>'destino', ', '), '')
              INTO v
              FROM jsonb_array_elements(m->'traslados') x;

        ELSIF p_type = 'DEPOSITO_BANCO' AND m ? 'monto_banco' THEN
            v := concat_ws(' · ',
                    CASE WHEN (m->>'monto_banco')::numeric > 0
                         THEN '$' || to_char((m->>'monto_banco')::numeric, 'FM999,999,990.00') || ' al banco' END,
                    m->>'banco',
                    -- Sólo el nombre de quien lo lleva: `entregado_a` dice si es
                    -- personal o transportadora, no quién.
                    'lo lleva ' || CASE WHEN nullif(btrim(m->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, m->>'quien') END,
                    CASE WHEN (m->>'remanente')::numeric > 0
                         THEN 'quedan $' || to_char((m->>'remanente')::numeric, 'FM999,999,990.00') END);

        ELSIF p_type = 'CONTEO_CICLICO' AND m ? 'productos' THEN
            v := (m->>'productos') || ' productos por contar, a ciegas';

        ELSIF jsonb_typeof(m->'promo') = 'object' AND m->'promo'->>'tipo' = 'lote' THEN
            v := concat_ws(' · ', (m->'promo'->>'vendido') || ' de ' || (m->'promo'->>'asignado') || ' vendidas',
                           m->'promo'->>'producto');
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v := NULL;
    END;

    RETURN coalesce(nullif(btrim(v), ''), left(coalesce(p_body, ''), 180));
END;
$function$;

CREATE OR REPLACE FUNCTION public.tomar_ajuste_faltante(p_id uuid, p_responsable text, p_responsable_emp uuid DEFAULT NULL::uuid, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo   uuid := public.auth_employee_id();
    bf     public.bolsa_faltante%ROWTYPE;
    v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
BEGIN
    IF v_yo IS NULL THEN
        RETURN json_build_object('ok', false, 'codigo', 'SESION', 'error', 'No se pudo resolver quién eres.');
    END IF;
    IF NOT public.auth_supervisa_faltantes() THEN
        RETURN json_build_object('ok', false, 'codigo', 'FORBIDDEN', 'error', '«No apareció» lo cierra un supervisor o administrador.');
    END IF;
    IF p_responsable IS NULL OR p_responsable NOT IN ('origen', 'destino', 'persona') THEN
        RETURN json_build_object('ok', false, 'codigo', 'RESPONSABLE', 'error', 'Falta decir a cargo de quién queda.');
    END IF;
    IF p_responsable = 'persona' AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_responsable_emp) THEN
        RETURN json_build_object('ok', false, 'codigo', 'RESPONSABLE', 'error', 'Falta elegir la persona.');
    END IF;
    IF v_nota IS NULL THEN
        RETURN json_build_object('ok', false, 'codigo', 'NOTA', 'error', 'Escribe qué se averiguó: es lo que alguien va a leer después.');
    END IF;

    SELECT * INTO bf FROM public.bolsa_faltante WHERE id = p_id;
    IF bf.id IS NULL THEN
        RETURN json_build_object('ok', false, 'codigo', 'NO_EXISTE', 'error', 'No existe ese faltante.');
    END IF;
    IF bf.estado <> 'abierto' THEN
        RETURN json_build_object('ok', false, 'codigo', 'YA_CERRADO', 'error', 'Alguien ya lo había cerrado.');
    END IF;
    -- Un descarte que la caja contestó de forma ilegible pudo haber entrado:
    -- reintentarlo descontaría dos veces. Lo destraba una persona mirando el kardex.
    IF bf.ajuste ? 'incierto' THEN
        RETURN json_build_object('ok', false, 'codigo', 'INCIERTO',
            'error', 'El descuento anterior quedó sin confirmar. Revisa el kardex de la sucursal antes de reintentar.');
    END IF;

    UPDATE public.bolsa_faltante
       SET responsable             = p_responsable,
           responsable_employee_id = CASE WHEN p_responsable = 'persona' THEN p_responsable_emp END,
           resolucion              = v_nota,
           ajuste_en_curso_at      = now(),
           ajuste_en_curso_por     = v_yo,
           updated_at              = now()
     WHERE id = p_id AND estado = 'abierto'
       AND (ajuste_en_curso_at IS NULL OR ajuste_en_curso_at < now() - interval '3 minutes')
    RETURNING * INTO bf;
    IF bf.id IS NULL THEN
        RETURN json_build_object('ok', false, 'codigo', 'YA_EN_CURSO',
            'error', 'Alguien más está cerrando este faltante en este momento.');
    END IF;

    RETURN json_build_object('ok', true, 'actor', v_yo, 'faltante', to_json(bf));
END;
$function$;

CREATE OR REPLACE FUNCTION public.traslado_avisar_propuesta(p_request_id uuid, p_evento text, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m        jsonb;
    v_prop   jsonb;
    v_pide   integer;
    v_origen integer;
    v_sala   text;
    v_osala  text;
    v_que    text;
    v_titulo text;
    v_cuerpo text;
    v_meta   jsonb;
BEGIN
    SELECT metadata INTO m FROM public.approval_requests WHERE id = p_request_id;
    v_prop   := m->'propuesta_lote';
    IF v_prop IS NULL THEN RETURN; END IF;
    v_pide   := nullif(m->>'branch_id', '')::integer;
    v_origen := nullif(m->>'origen_branch_id', '')::integer;
    v_sala   := coalesce(nullif(m->>'branch_name', ''), 'La sucursal que pidió');
    v_osala  := coalesce(nullif(m->>'origen_branch_name', ''), 'La otra sucursal');

    -- «ACETAMINOFEN: lote K221, vence 02/2027 (pediste L1, vence 08/2028)»
    SELECT string_agg(
               coalesce(l->>'producto', 'Un producto') || ': lote '
               || coalesce(l->>'lote', '—')
               || ', vence ' || coalesce(to_char((l->>'vence')::date, 'MM/YYYY'), 'sin fecha')
               || coalesce(' (pediste ' || (l->'pedido'->0->>'lote')
                           || coalesce(', vence ' || to_char((l->'pedido'->0->>'vence')::date, 'MM/YYYY'), '')
                           || ')', ''),
               ' · ')
      INTO v_que
      FROM jsonb_array_elements(coalesce(v_prop->'lineas', '[]'::jsonb)) l;

    v_meta := jsonb_build_object('request_id', p_request_id, 'evento', p_evento);

    IF p_evento IN ('propuesta', 'recordatorio') THEN
        v_titulo := CASE p_evento WHEN 'propuesta'
                        THEN v_osala || ' te propone otro lote'
                        ELSE 'Recordatorio: ' || v_osala || ' espera tu respuesta' END;
        v_cuerpo := 'No tiene el lote que pediste y el que puede mandar vence antes. ' || coalesce(v_que, '')
                 || '. Acéptalo o recházalo en Traslados; si nadie contesta, se acepta solo a las '
                 || public.hora_12((((v_prop->>'propuesta_at')::timestamptz + interval '3 hours') AT TIME ZONE 'America/El_Salvador')::time)
                 || '.';
        PERFORM public.notify_branch_como(p_actor, v_pide, 'TRASLADO_PROPUESTA', v_titulo, v_cuerpo,
                                          '/traslados', v_meta, true);

    ELSIF p_evento = 'aceptada' THEN
        PERFORM public.notify_branch_como(p_actor, v_origen, 'TRASLADO_PROPUESTA',
            v_sala || ' aceptó el lote', coalesce(v_que, '') || '. Ya puedes enviarlo.',
            '/traslados', v_meta, true);

    ELSIF p_evento = 'rechazada' THEN
        PERFORM public.notify_branch_como(p_actor, v_origen, 'TRASLADO_PROPUESTA',
            v_sala || ' no aceptó el lote', coalesce(v_que, '')
            || '. Elige otro lote o rechaza la solicitud.',
            '/traslados', v_meta, true);

    ELSIF p_evento = 'auto' THEN
        PERFORM public.notify_branch_como(NULL, v_origen, 'TRASLADO_PROPUESTA',
            'Lote aceptado solo: ' || v_sala || ' no contestó en 3 horas',
            coalesce(v_que, '') || '. Ya puedes enviarlo.', '/traslados', v_meta, true);
        PERFORM public.notify_branch_como(NULL, v_pide, 'TRASLADO_PROPUESTA',
            'Se aceptó solo el lote que propuso ' || v_osala,
            'Nadie contestó en 3 horas. ' || coalesce(v_que, '') || '.', '/traslados', v_meta, true);
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.traslado_proponer_lote(p_request_id uuid, p_lineas jsonb, p_actor uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_prop jsonb;
BEGIN
    IF jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
        RETURN json_build_object('ok', false, 'error', 'La propuesta no trae productos.');
    END IF;
    v_prop := jsonb_build_object(
        'estado', 'pendiente', 'propuesta_at', now(), 'propuesta_por', p_actor, 'lineas', p_lineas);
    UPDATE public.approval_requests
       SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{propuesta_lote}', v_prop)
     WHERE id = p_request_id AND type = 'INVENTORY_TRANSFER_REQUEST' AND status = 'PENDING';
    IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'error', 'La solicitud ya no está pendiente.');
    END IF;
    PERFORM public.traslado_avisar_propuesta(p_request_id, 'propuesta', p_actor);
    RETURN json_build_object('ok', true, 'propuesta', v_prop);
END;
$function$;

CREATE OR REPLACE FUNCTION public.traslado_responder_propuesta(p_request_id uuid, p_acepta boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo     uuid := public.auth_employee_id();
    v_sala   integer := public.auth_employee_branch_id();
    m        jsonb;
    v_status text;
    v_estado text;
BEGIN
    IF v_yo IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'Sesión inválida.');
    END IF;
    SELECT metadata, status INTO m, v_status
      FROM public.approval_requests
     WHERE id = p_request_id AND type = 'INVENTORY_TRANSFER_REQUEST'
       FOR UPDATE;
    IF NOT FOUND OR v_status <> 'PENDING' THEN
        RETURN json_build_object('ok', false, 'error', 'La solicitud ya no está pendiente.');
    END IF;
    -- El alcance: sólo la sala que pidió. El id de la sala sale de la sesión,
    -- nunca de un parámetro.
    IF v_sala IS NULL OR v_sala::text IS DISTINCT FROM (m->>'branch_id') THEN
        RETURN json_build_object('ok', false, 'error', 'Sólo la sucursal que pidió puede contestar la propuesta.');
    END IF;
    IF coalesce(m->'propuesta_lote'->>'estado', '') <> 'pendiente' THEN
        RETURN json_build_object('ok', false, 'error', 'Ya no hay una propuesta por contestar.');
    END IF;

    v_estado := CASE WHEN p_acepta THEN 'aceptada' ELSE 'rechazada' END;
    UPDATE public.approval_requests
       SET metadata = jsonb_set(metadata, '{propuesta_lote}',
               (m->'propuesta_lote') || jsonb_build_object(
                   'estado', v_estado, 'respondido_at', now(), 'respondido_por', v_yo, 'auto', false))
     WHERE id = p_request_id;
    PERFORM public.traslado_avisar_propuesta(p_request_id, v_estado, v_yo);
    RETURN json_build_object('ok', true, 'estado', v_estado);
END;
$function$;

CREATE OR REPLACE FUNCTION public.traslados_en_camino_a_sala(p_branch_id bigint, p_producto_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- plpgsql y no sql: con `SET` una sql nace con plan genérico (CLAUDE.md, trampa 4).
  RETURN (SELECT coalesce(json_agg(json_build_object(
           'id', t.id, 'origen', t.origen, 'origen_branch_id', t.origen_branch_id,
           'unidades', t.unidades - t.tomadas, 'total', t.unidades, 'estado', t.estado, 'pedido_at', t.created_at)
           ORDER BY t.created_at), '[]'::json)
    FROM (
      SELECT ar.id, ar.created_at,
             coalesce(nullif(ar.metadata->>'origen_branch_name', ''), 'otra sucursal') AS origen,
             nullif(ar.metadata->>'origen_branch_id', '')::bigint AS origen_branch_id,
             CASE WHEN ar.status = 'APPROVED' AND ar.metadata ? 'erp_traslado' THEN 'enviado' ELSE 'pedido' END AS estado,
             floor(CASE WHEN ar.status = 'APPROVED' AND ar.metadata ? 'erp_traslado'
                        THEN public.traslado_enviada_del_renglon(ar.metadata, x.n::integer - 1)
                        ELSE coalesce((x.it->>'cantidad')::numeric, 0) END
                   * greatest(coalesce((x.it->>'factor')::numeric, 1), 1)) AS unidades,
             -- Lo tomado por reservas abiertas: las amarradas con sus unidades
             -- y, si lo pidió una reserva, todo.
             CASE WHEN EXISTS (SELECT 1 FROM public.app_reservas r
                                WHERE r.id::text = ar.metadata->>'reserva_id' AND r.estado IN ('en_revision', 'pendiente', 'lista'))
                  THEN 1e9
                  ELSE coalesce((SELECT sum((y->>'unidades')::numeric)
                                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ar.metadata->'reservas') = 'array'
                                                                  THEN ar.metadata->'reservas' ELSE '[]'::jsonb END) y
                                   JOIN public.app_reservas r ON r.id = (y->>'reserva_id')::bigint
                                  WHERE r.producto_id = p_producto_id AND r.estado IN ('en_revision', 'pendiente', 'lista')), 0) END AS tomadas
        FROM public.approval_requests ar
        CROSS JOIN LATERAL (
          SELECT it, n FROM jsonb_array_elements(coalesce(ar.metadata->'items', '[]'::jsonb)) WITH ORDINALITY AS e(it, n)
           WHERE it->>'erp_product_id' = p_producto_id::text ORDER BY n LIMIT 1) x
       WHERE ar.type = 'INVENTORY_TRANSFER_REQUEST'
         AND ar.status IN ('PENDING', 'APPROVED')
         AND ar.metadata->>'branch_id' = p_branch_id::text
         AND NOT (ar.metadata ? 'erp_recibido')
         AND ar.created_at > now() - interval '30 days'
    ) t
   WHERE t.unidades - t.tomadas > 0);
END $function$;

CREATE OR REPLACE FUNCTION public.update_pedido_sucursal_lifecycle(p_pedido_id uuid, p_sucursal_id integer, p_stage text, p_user_id uuid DEFAULT NULL::uuid, p_razon text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid;
BEGIN
    IF pg_trigger_depth() = 0 THEN
        v_actor := auth_employee_id();
        IF v_actor IS NULL THEN
            RAISE EXCEPTION 'UNAUTHENTICATED';
        END IF;
        IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
        END IF;
        -- Decisión 2026-10-02: preparar, pausar, finalizar y corregir son de
        -- Bodega; llegada, recepción y diferencias, de la sala, y sólo la suya.
        IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
            IF p_stage IN ('iniciar', 'pausar', 'reanudar', 'finalizar', 'corregir_bodega') THEN
                RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: ese paso del pedido es de Bodega';
            END IF;
            IF p_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
                RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: sólo puedes mover el pedido de tu sucursal';
            END IF;
        END IF;
    ELSE
        v_actor := p_user_id;
    END IF;

    -- La parte de esta sala se anuló (anular_pedido_sucursal, 2026-11-06):
    -- una pantalla que no recargó todavía puede ofrecer «Iniciar».
    IF EXISTS (
        SELECT 1 FROM pedido_sucursal_status
         WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
           AND anulado_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'La parte de esta sucursal fue anulada: ya no se puede mover.';
    END IF;

    INSERT INTO pedido_sucursal_status (pedido_id, erp_sucursal_id)
    VALUES (p_pedido_id, p_sucursal_id)
    ON CONFLICT (pedido_id, erp_sucursal_id) DO NOTHING;

    IF p_stage = 'iniciar' THEN
        UPDATE pedido_sucursal_status
        SET iniciado_at  = NOW(), iniciado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NULL;

    ELSIF p_stage = 'pausar' THEN
        IF EXISTS (
            SELECT 1 FROM pedido_pausa_historial
            WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
              AND reanudado_at IS NULL
        ) THEN RETURN; END IF;
        UPDATE pedido_sucursal_status
        SET pausado_at = NOW(), pausa_razon = p_razon, reanudado_at = NULL, reanudado_por = NULL
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NOT NULL AND finalizado_at IS NULL;
        INSERT INTO pedido_pausa_historial
            (pedido_id, erp_sucursal_id, pausado_at, razon, pausado_por)
        VALUES (p_pedido_id, p_sucursal_id, NOW(), p_razon, v_actor);

    ELSIF p_stage = 'reanudar' THEN
        UPDATE pedido_pausa_historial
        SET reanudado_at = NOW(), reanudado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND reanudado_at IS NULL;
        UPDATE pedido_sucursal_status
        SET reanudado_at = NOW(), reanudado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND pausado_at IS NOT NULL AND reanudado_at IS NULL AND finalizado_at IS NULL;

    ELSIF p_stage = 'finalizar' THEN
        IF EXISTS (
            SELECT 1 FROM pedido_pausa_historial
            WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
              AND reanudado_at IS NULL
        ) THEN
            RAISE EXCEPTION 'No se puede finalizar: hay una pausa activa sin reanudar.';
        END IF;
        UPDATE pedido_sucursal_status
        SET finalizado_at = NOW(), finalizado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NOT NULL AND finalizado_at IS NULL
          AND (pausado_at IS NULL OR reanudado_at IS NOT NULL);

    ELSIF p_stage = 'confirmar_llegada' THEN
        UPDATE pedido_sucursal_status
        SET llegada_fisica_at  = NOW(), llegada_fisica_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND llegada_fisica_at IS NULL;

    ELSIF p_stage = 'recibir_erp' THEN
        UPDATE pedido_sucursal_status
        SET recibido_erp_at  = NOW(), recibido_erp_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND recibido_erp_at IS NULL;

    ELSIF p_stage = 'reportar_diferencias' THEN
        UPDATE pedido_sucursal_status
        SET diferencias_reportadas_at  = NOW(),
            diferencias_reportadas_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSIF p_stage = 'corregir_bodega' THEN
        UPDATE pedido_sucursal_status
        SET corregido_bodega_at   = NOW(),
            corregido_bodega_por  = v_actor,
            corregido_bodega_nota = p_nota
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSIF p_stage = 'confirmar_correccion' THEN
        UPDATE pedido_sucursal_status
        SET confirmado_correccion_at  = NOW(),
            confirmado_correccion_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSE
        RAISE EXCEPTION 'stage desconocido: %', p_stage;
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validar_envio_producto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m           jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_items     jsonb   := m->'items';
    it          jsonb;
    v_org_erp   integer := nullif(m->>'origen_erp_sucursal_id', '')::integer;
    v_dst_erp   integer := nullif(m->>'erp_sucursal_id', '')::integer;
    -- De qué ESTANTE de la sala de origen sale. La clave ausente significa el
    -- de operación, que es como lo leen la edge function y el modal.
    v_venc      boolean := coalesce((m->>'origen_vencidos')::boolean, false);
    v_org_bid   integer;
    v_dst_bid   integer;
    v_org_bod   boolean;
    v_dst_bod   boolean;
    v_org_nom   text;
    v_dst_nom   text;
    v_ok        text[];
    v_solo_bod  text[];
    v_prod      integer;
    v_unid      numeric;
    v_tiene     numeric;
    v_total     numeric := 0;
    v_dest      uuid[];
    v_esc       text;
    v_motivo    text;
    v_detalle   text;
    v_mi_bid    integer;
    v_todo      boolean;
    v_fotos     integer;
    v_cargo_ap  integer;
    v_apoyo     integer;
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_PUSH' THEN RETURN NEW; END IF;

    -- Sobrante de traslado (2026-11-12): lo arma `declarar_sobrantes`, que ya
    -- validó la bolsa, los renglones y la existencia del origen. Sólo entra
    -- con su marca de transacción: un insert directo con `sobrante_de` rebota.
    IF coalesce(NEW.metadata, '{}'::jsonb) ? 'sobrante_de' THEN
        IF coalesce(current_setting('portal.sobrante_de', true), '') <> NEW.metadata->>'sobrante_de' THEN
            RAISE EXCEPTION 'Lo que llegó de más se declara al recibir el paquete.';
        END IF;
        RETURN NEW;
    END IF;

    IF NOT public.puede_enviar_producto(NEW.employee_id) THEN
        RAISE EXCEPTION 'No tienes permiso para enviar producto a otra sucursal.';
    END IF;

    v_motivo := nullif(btrim(coalesce(m->>'motivo_tipo', '')), '');
    IF v_motivo IS NULL OR NOT (v_motivo = ANY (public.motivos_envio())) THEN
        RAISE EXCEPTION 'El traslado necesita un motivo. Los aceptados son %.',
            array_to_string(public.motivos_envio(), ', ');
    END IF;

    v_detalle := nullif(btrim(coalesce(m->>'reason', NEW.note, '')), '');
    IF v_detalle IS NULL THEN
        RAISE EXCEPTION 'Escribe por qué mandas este producto: el motivo es obligatorio.';
    END IF;
    IF length(v_detalle) < 4 OR lower(v_detalle) = lower(v_motivo) THEN
        RAISE EXCEPTION 'El motivo tiene que explicar por qué mandas el producto, no repetir la categoría.';
    END IF;

    IF v_org_erp IS NULL OR v_dst_erp IS NULL THEN
        RAISE EXCEPTION 'Falta la sucursal que envía o la que recibe.';
    END IF;
    IF v_org_erp = v_dst_erp THEN
        RAISE EXCEPTION 'No se puede enviar producto a la misma sucursal.';
    END IF;

    SELECT em.branch_id, coalesce(em.es_bodega, false), coalesce(b.name, 'la sucursal que envía')
      INTO v_org_bid, v_org_bod, v_org_nom
      FROM public.erp_sucursal_map em
      LEFT JOIN public.branches b ON b.id = em.branch_id
     WHERE em.erp_sucursal_id = v_org_erp;
    SELECT em.branch_id, coalesce(em.es_bodega, false), coalesce(b.name, 'la sucursal que recibe')
      INTO v_dst_bid, v_dst_bod, v_dst_nom
      FROM public.erp_sucursal_map em
      LEFT JOIN public.branches b ON b.id = em.branch_id
     WHERE em.erp_sucursal_id = v_dst_erp;
    IF v_org_bid IS NULL THEN
        RAISE EXCEPTION 'La sucursal que envía (%) no existe en el mapa.', v_org_erp;
    END IF;
    IF v_dst_bid IS NULL THEN
        RAISE EXCEPTION 'La sucursal que recibe (%) no existe en el mapa.', v_dst_erp;
    END IF;

    -- Sólo Bodega tiene área de vencidos. Un envío que dijera salir de la de
    -- una sala que no la tiene produciría un despacho sin ubicación de origen,
    -- y eso se descubre recién con la caja armada: se corta acá. Misma guarda
    -- —y misma redacción— que en `validar_solicitud_traslado`.
    IF v_venc AND NOT EXISTS (
        SELECT 1 FROM public.erp_sucursal_map m2,
                      jsonb_array_elements(coalesce(m2.inv_ubicaciones, '[]'::jsonb)) u
         WHERE m2.erp_sucursal_id = v_org_erp
           AND coalesce((u->>'isVencidos')::boolean, false)
    ) THEN
        RAISE EXCEPTION 'La sucursal que envía (%) no tiene área de vencidos.', v_org_erp;
    END IF;

    -- ── La ÚNICA regla del circuito ───────────────────────────────────────
    --
    -- El motivo tiene que valer entre estos dos extremos. La dirección no se
    -- comprueba aparte: sale de acá. Entre salas el único motivo es «Baja
    -- rotación» —o sea *me sobra*—, y con eso «te lo mando porque lo
    -- necesitás» sigue sin tener etiqueta: para eso está la solicitud, donde
    -- el otro lado decide ANTES de que el producto salga.
    --
    -- El ESTANTE no entra en esta cuenta a propósito: el área de vencidos es
    -- un estante de Bodega, no una dirección. Recortarle los motivos vaciaría
    -- la intersección de una composición que saque de ahí y de una sala a la
    -- vez, y esa intersección nunca puede quedar vacía.
    v_ok := public.motivos_envio_por_direccion(v_org_bod, v_dst_bod);
    IF NOT (v_motivo = ANY (v_ok)) THEN
        -- Los que sólo viajan HACIA Bodega, por diferencia contra los de esta
        -- dirección. Se calcula en vez de escribirse para que el mensaje no se
        -- quede viejo el día que se agregue un motivo — que es exactamente lo
        -- que pasó con «Retiro del mercado» y volvió a pasar con «Avería».
        SELECT coalesce(array_agg(x), ARRAY[]::text[]) INTO v_solo_bod
          FROM unnest(public.motivos_envio_por_direccion(false, true)) x
         WHERE NOT (x = ANY (v_ok));

        RAISE EXCEPTION '%',
            CASE
              WHEN NOT v_org_bod AND NOT v_dst_bod THEN
                format('Entre sucursales sólo se manda por %s. Si %s lo necesita, tiene que pedirlo%s.',
                    array_to_string(v_ok, ' o '),
                    v_dst_nom,
                    CASE WHEN coalesce(array_length(v_solo_bod, 1), 0) > 0
                         THEN format('; y si es por %s, mándalo a Bodega',
                                     array_to_string(v_solo_bod, ' o '))
                         ELSE '' END)
              WHEN v_dst_bod THEN
                format('A Bodega se manda por %s. «%s» no vale hacia Bodega.',
                    array_to_string(v_ok, ' o '), v_motivo)
              ELSE
                format('De Bodega a %s se manda por %s. «%s» no vale en esa dirección.',
                    v_dst_nom, array_to_string(v_ok, ' o '), v_motivo)
            END;
    END IF;

    -- ── La foto, donde el motivo la vuelve la única prueba ────────────────
    --
    -- Se comprueban las DOS cosas por separado —que sea un arreglo, y que
    -- traiga al menos una URL del bucket de evidencia— y no en un solo `OR`:
    -- `jsonb_array_elements_text` sobre algo que no es arreglo LANZA, y en un
    -- `OR` no hay corto circuito garantizado. Con un `evidencia_urls` que
    -- llegara como texto, el envío habría fallado con un error de tipos en vez
    -- de decir qué falta.
    IF v_motivo = ANY (public.motivos_envio_con_foto()) THEN
        IF coalesce(jsonb_typeof(m->'evidencia_urls'), 'null') <> 'array' THEN
            RAISE EXCEPTION 'Un traslado por «%» necesita foto. Adjunta al menos una.', v_motivo;
        END IF;
        SELECT count(*) INTO v_fotos
          FROM jsonb_array_elements_text(m->'evidencia_urls') u
         WHERE position('/inventario-evidencia/' in coalesce(u, '')) > 0;
        IF coalesce(v_fotos, 0) = 0 THEN
            RAISE EXCEPTION 'Un traslado por «%» necesita foto. Adjunta al menos una.', v_motivo;
        END IF;
    END IF;

    -- La sala y el cargo EFECTIVOS de quien manda, con la precedencia de
    -- `auth_yo()` y del perfil del portal: apoyo vigente → sala elegida (si
    -- todavía la cubre) → ficha. En los días de un apoyo con cargo, el cargo es
    -- el que cubre y nada más. Con la ficha a secas, quien estaba de apoyo veía
    -- en pantalla el producto de la sala del apoyo y la base se lo rebotaba.
    SELECT coalesce(public.sala_de_apoyo_vigente(e.id)::integer,
                    (SELECT sa.branch_id::integer FROM public.sala_activa sa
                      WHERE sa.employee_id = e.id
                        AND EXISTS (SELECT 1 FROM public.employee_branches eb
                                     WHERE eb.employee_id = sa.employee_id AND eb.branch_id = sa.branch_id)),
                    e.branch_id::integer),
           public.cargo_de_apoyo_vigente(e.id)::integer
      INTO v_mi_bid, v_cargo_ap
      FROM public.employees e WHERE e.id = NEW.employee_id;
    SELECT EXISTS (
        SELECT 1 FROM public.employees e
         WHERE e.id = NEW.employee_id
           AND (false /* llave maestra retirada 2026-08-28: ya no hay quien la porte — ver docs/PLAN-ROLES-SIN-SYSTEM-ROLE-2026-08-28.md */
                OR EXISTS (SELECT 1 FROM public.role_permissions rp
                            WHERE rp.role_id IN (coalesce(v_cargo_ap, e.role_id),
                                                 CASE WHEN v_cargo_ap IS NULL THEN e.secondary_role_id END)
                              AND rp.module_key = 'traslados' AND rp.scope = 'ALL'))
    ) INTO v_todo;

    -- Con un apoyo vigente HOY, estricto: sólo la sala del apoyo. Ni la de
    -- respaldo cerrada ni el alcance sobre todas — el día del apoyo la persona
    -- está en esa sala y en ninguna otra. Al día siguiente sin apoyo, vuelve
    -- sola a la regla de abajo (`sala_de_apoyo_vigente` mira la fecha de SV).
    v_apoyo := public.sala_de_apoyo_vigente(NEW.employee_id)::integer;
    IF v_apoyo IS NOT NULL THEN
        IF v_org_bid IS DISTINCT FROM v_apoyo THEN
            RAISE EXCEPTION 'Hoy estás de apoyo en %: sólo puedes enviar producto de esa sucursal.',
                coalesce((SELECT b.name FROM public.branches b WHERE b.id = v_apoyo), 'otra sucursal');
        END IF;
    ELSIF NOT v_todo
       AND v_mi_bid IS DISTINCT FROM v_org_bid
       AND NOT (v_org_bid = ANY (coalesce(public.salas_que_cubre_ahora(v_mi_bid), ARRAY[]::integer[]))) THEN
        RAISE EXCEPTION 'Sólo se puede enviar producto desde tu propia sucursal.';
    END IF;

    IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION 'El traslado no lleva ningún producto.';
    END IF;

    IF jsonb_array_length(v_items) > public.tope_renglones_envio() THEN
        RAISE EXCEPTION 'Un traslado admite hasta % productos y este lleva %. Manda el resto en otro traslado.',
            public.tope_renglones_envio(), jsonb_array_length(v_items);
    END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        v_prod := coalesce(nullif(it->>'erp_product_id', '')::integer, 0);
        IF v_prod <= 0 THEN
            RAISE EXCEPTION 'Hay una línea sin producto.';
        END IF;
        IF nullif(btrim(coalesce(it->>'presentacion_tipo', '')), '') IS NULL THEN
            RAISE EXCEPTION 'La línea del producto % no dice qué presentación es.', v_prod;
        END IF;
        IF coalesce(nullif(it->>'factor', '')::integer, 0) <= 0 THEN
            RAISE EXCEPTION 'La presentación del producto % no trae su factor.', v_prod;
        END IF;
        IF coalesce(nullif(it->>'cantidad', '')::numeric, 0) <= 0 THEN
            RAISE EXCEPTION 'La línea del producto % no tiene cantidad.', v_prod;
        END IF;

        v_unid  := (it->>'cantidad')::numeric * (it->>'factor')::integer;
        v_total := v_total + v_unid;

        -- Y sale del ESTANTE que el envío nombra. Medir el área de vencidos
        -- contra la existencia normal —que filtra `is_vencidos = false`— da 0
        -- y rebota el envío entero sobre mercadería que está ahí: es lo mismo
        -- que rebotaba las solicitudes antes del 2026-08-19.
        IF v_venc THEN
            SELECT coalesce(d.unidades, 0) INTO v_tiene
              FROM public.v_inventario_disponible_vencidos d
             WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;
        ELSE
            SELECT coalesce(d.unidades, 0) INTO v_tiene
              FROM public.v_inventario_disponible d
             WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;
        END IF;

        IF coalesce(v_tiene, 0) < v_unid THEN
            RAISE EXCEPTION 'No tienes % unidades del producto % para enviar (tienes %).',
                v_unid, v_prod, coalesce(v_tiene, 0);
        END IF;
    END LOOP;

    SELECT r.destinatarios, r.escalon INTO v_dest, v_esc
      FROM public.resolver_destinatarios_traslado(v_dst_bid) r;

    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN
        RAISE EXCEPTION 'No hay a quién avisarle en la sucursal de destino.';
    END IF;

    NEW.approver_id := v_dest[1];
    NEW.metadata := m
        || jsonb_build_object(
             'origen_branch_id', v_org_bid,
             'branch_id',        v_dst_bid,
             'destinatarios',    to_jsonb(v_dest),
             'escalon_aviso',    v_esc,
             'total_unidades',   v_total);

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validar_solicitud_facturacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_estado text;
    v_id     bigint;
    v_branch bigint;
BEGIN
    IF NEW.type NOT IN ('ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                        'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST') THEN
        RETURN NEW;
    END IF;

    -- Antes de mirar la factura: no depende de ella y el motivo es distinto.
    IF NEW.type = 'PAYMENT_CHANGE_REQUEST'
       AND lower(coalesce(NEW.metadata->>'new_pago', '')) = 'credito' THEN
        RAISE EXCEPTION 'PAGO_A_CREDITO_NO: una venta emitida no se puede pasar a crédito; hay que anularla y volver a facturarla.';
    END IF;

    BEGIN
        v_id := (NEW.metadata->>'invoice_id')::bigint;
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'SOLICITUD_SIN_FACTURA: la solicitud no identifica una factura.';
    END;

    IF v_id IS NULL THEN
        RAISE EXCEPTION 'SOLICITUD_SIN_FACTURA: la solicitud no identifica una factura.';
    END IF;

    -- La sala sale de la FACTURA, nunca del `metadata` que mandó el navegador.
    SELECT estado, branch_id INTO v_estado, v_branch FROM public.sales_invoices WHERE id = v_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FACTURA_NO_EXISTE: esa factura ya no está en el portal.';
    END IF;

    -- Una factura anulada no se anula otra vez, y tampoco se le cambia el
    -- cliente, la forma de pago ni el vendedor: ya no es un documento vivo.
    IF upper(coalesce(v_estado, '')) = 'NULA'
       OR (public.factura_esta_anulada(v_estado) AND NEW.type <> 'ANNULMENT_REQUEST') THEN
        RAISE EXCEPTION 'FACTURA_ANULADA: esa factura ya está anulada.';
    END IF;

    -- Sólo la anulación: el efectivo devuelto sale de una caja abierta de esa sala.
    IF NEW.type = 'ANNULMENT_REQUEST'
       AND NOT public.sala_con_caja_abierta(v_branch) THEN
        RAISE EXCEPTION 'CAJA_CERRADA: esa sucursal ya hizo su cierre del día. No hay caja de dónde descontar.';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validar_solicitud_movimiento_inventario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m          jsonb := coalesce(NEW.metadata, '{}'::jsonb);
    v_items    jsonb := m->'items';
    it         jsonb;
    v_sub      text  := nullif(btrim(coalesce(m->>'subtipo', '')), '');
    v_suc      integer;
    v_ubic     integer;
    v_branch   integer;
    v_dice     integer;
    -- Los cuatro exactos del <select> del ERP. Cualquier otro valor lo rechaza
    -- el ERP con un 200 y un typeinfo Error, que es justo lo que no queremos
    -- descubrir después de aprobar.
    v_subtipos text[] := ARRAY['VENCIMIENTO','DESCARTE','PRODUCTO DAÑADO','CONSUMO INTERNO'];
BEGIN
    IF NEW.type NOT IN ('INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST') THEN
        RETURN NEW;
    END IF;

    -- La causa: es lo que va al `concepto` del ERP y queda en el kardex.
    IF nullif(btrim(coalesce(m->>'reason', NEW.note, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La solicitud necesita una causa: es lo que queda escrito en el movimiento.';
    END IF;

    IF NEW.type = 'INVENTORY_DISCARD_REQUEST' THEN
        IF v_sub IS NULL THEN
            RAISE EXCEPTION 'Un descarte necesita su tipo (%).', array_to_string(v_subtipos, ', ');
        END IF;
        IF NOT (v_sub = ANY (v_subtipos)) THEN
            RAISE EXCEPTION 'Tipo de descarte no válido: "%". Los aceptados son %.',
                v_sub, array_to_string(v_subtipos, ', ');
        END IF;
    ELSIF v_sub IS NOT NULL THEN
        RAISE EXCEPTION 'Una carga no lleva tipo de descarte.';
    END IF;

    -- Sucursal y ubicación: los ids del ERP, no los del portal. Son
    -- numeraciones distintas y el ERP acepta la equivocada sin protestar.
    v_suc  := nullif(m->>'erp_sucursal_id', '')::integer;
    v_ubic := nullif(m->>'erp_ubicacion_id', '')::integer;

    IF v_suc IS NULL OR v_ubic IS NULL THEN
        RAISE EXCEPTION 'Falta la sucursal o la ubicación en la solicitud.';
    END IF;
    SELECT branch_id INTO v_branch FROM public.erp_sucursal_map WHERE erp_sucursal_id = v_suc;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La sucursal % no existe.', v_suc;
    END IF;

    -- H2: una sola sala. La del rótulo tiene que ser la que se mueve.
    v_dice := nullif(m->>'branch_id', '')::integer;
    IF v_dice IS NOT NULL AND v_dice IS DISTINCT FROM v_branch THEN
        RAISE EXCEPTION 'La sucursal de la solicitud no coincide con la sucursal del movimiento.';
    END IF;
    m := m || jsonb_build_object('branch_id', v_branch);
    NEW.metadata := m;

    -- H2: con alcance de sucursal, sólo la propia (o la que se está cubriendo).
    -- Sin sesión de empleado (edge function con la llave del servidor) no hay
    -- a quién comparar: ese camino valida por su cuenta.
    IF public.auth_employee_id() IS NOT NULL
       AND 'ALL' <> ALL (ARRAY[coalesce(public.auth_module_scope('requests'), ''),
                               coalesce(public.auth_module_scope('requests_inventario'), ''),
                               coalesce(public.auth_module_scope('dash_inv_movement'), '')])
       AND v_branch IS DISTINCT FROM public.auth_employee_branch_id()
       AND NOT (v_branch = ANY (coalesce(public.salas_que_cubro_ahora(), ARRAY[]::integer[]))) THEN
        RAISE EXCEPTION 'Sólo puedes pedir movimientos de inventario de tu sucursal.'
            USING ERRCODE = '42501';
    END IF;

    IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION 'La solicitud no tiene ni un producto.';
    END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        IF coalesce(nullif(it->>'erp_product_id','')::integer, 0) <= 0 THEN
            RAISE EXCEPTION 'Hay una línea sin producto.';
        END IF;

        -- El significado de la presentación, no su id: «UNIDAD» + factor 1.
        -- Con eso la Edge Function encuentra la opción del ERP por etiqueta.
        IF nullif(btrim(coalesce(it->>'presentacion_tipo','')), '') IS NULL THEN
            RAISE EXCEPTION 'La línea del producto % no dice qué presentación es.',
                it->>'erp_product_id';
        END IF;
        IF coalesce(nullif(it->>'factor','')::integer, 0) <= 0 THEN
            RAISE EXCEPTION 'La presentación del producto % no trae su factor.',
                it->>'erp_product_id';
        END IF;

        IF coalesce(nullif(it->>'cantidad','')::numeric, 0) <= 0 THEN
            RAISE EXCEPTION 'La línea del producto % no tiene cantidad.',
                it->>'erp_product_id';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validar_solicitud_traslado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m           jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_items     jsonb   := m->'items';
    it          jsonb;
    v_org_erp   integer := nullif(m->>'origen_erp_sucursal_id', '')::integer;
    v_dst_erp   integer := nullif(m->>'erp_sucursal_id', '')::integer;
    v_venc      boolean := coalesce((m->>'origen_vencidos')::boolean, false);
    v_org_bid   integer;
    v_prod      integer;
    v_unid      numeric;
    v_tiene     numeric;
    v_dest      uuid[];
    v_esc       text;
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_REQUEST' THEN RETURN NEW; END IF;

    IF nullif(btrim(coalesce(m->>'reason', NEW.note, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La solicitud necesita decir para qué se pide.';
    END IF;

    IF v_org_erp IS NULL OR v_dst_erp IS NULL THEN
        RAISE EXCEPTION 'Falta la sucursal de origen o la de destino.';
    END IF;
    IF v_org_erp = v_dst_erp THEN
        RAISE EXCEPTION 'El origen y el destino son la misma sucursal.';
    END IF;

    SELECT branch_id INTO v_org_bid FROM public.erp_sucursal_map
     WHERE erp_sucursal_id = v_org_erp;
    IF v_org_bid IS NULL THEN
        RAISE EXCEPTION 'La sucursal de origen % no existe en el mapa.', v_org_erp;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map WHERE erp_sucursal_id = v_dst_erp) THEN
        RAISE EXCEPTION 'La sucursal de destino % no existe en el mapa.', v_dst_erp;
    END IF;

    -- Sólo Bodega tiene área de vencidos. Pedirle a una sala que no la tiene un
    -- traslado «de vencidos» produciría un despacho sin ubicación de origen, y
    -- eso se descubre recién al apretar el botón del otro lado: se corta acá.
    IF v_venc AND NOT EXISTS (
        SELECT 1 FROM public.erp_sucursal_map m2,
                      jsonb_array_elements(coalesce(m2.inv_ubicaciones, '[]'::jsonb)) u
         WHERE m2.erp_sucursal_id = v_org_erp
           AND coalesce((u->>'isVencidos')::boolean, false)
    ) THEN
        RAISE EXCEPTION 'La sucursal de origen % no tiene área de vencidos.', v_org_erp;
    END IF;

    IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION 'La solicitud no pide ni un producto.';
    END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        v_prod := coalesce(nullif(it->>'erp_product_id', '')::integer, 0);
        IF v_prod <= 0 THEN
            RAISE EXCEPTION 'Hay una línea sin producto.';
        END IF;
        IF nullif(btrim(coalesce(it->>'presentacion_tipo', '')), '') IS NULL THEN
            RAISE EXCEPTION 'La línea del producto % no dice qué presentación es.', v_prod;
        END IF;
        IF coalesce(nullif(it->>'factor', '')::integer, 0) <= 0 THEN
            RAISE EXCEPTION 'La presentación del producto % no trae su factor.', v_prod;
        END IF;
        IF coalesce(nullif(it->>'cantidad', '')::numeric, 0) <= 0 THEN
            RAISE EXCEPTION 'La línea del producto % no tiene cantidad.', v_prod;
        END IF;

        v_unid := (it->>'cantidad')::numeric * (it->>'factor')::integer;

        -- Lo disponible ya trae descontado lo que salió y el sync no trajo.
        -- Y sale del estante que la solicitud nombra: medir el área de vencidos
        -- contra la existencia normal es lo que rebotaba estas solicitudes.
        IF v_venc THEN
            SELECT coalesce(d.unidades, 0) INTO v_tiene
              FROM public.v_inventario_disponible_vencidos d
             WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;
        ELSE
            SELECT coalesce(d.unidades, 0) INTO v_tiene
              FROM public.v_inventario_disponible d
             WHERE d.erp_product_id = v_prod AND d.erp_sucursal_id = v_org_erp;
        END IF;

        -- Y nada más: que la sala quede en cero es decisión de quien despacha.
        IF coalesce(v_tiene, 0) < v_unid THEN
            RAISE EXCEPTION 'La sucursal de origen no tiene % unidades del producto % (tiene %).',
                v_unid, v_prod, coalesce(v_tiene, 0);
        END IF;
    END LOOP;

    SELECT r.destinatarios, r.escalon INTO v_dest, v_esc
      FROM public.resolver_destinatarios_traslado(v_org_bid) r;

    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN
        RAISE EXCEPTION 'No hay a quién pedirle el traslado en esa sucursal.';
    END IF;

    NEW.approver_id := v_dest[1];
    NEW.metadata := m
        || jsonb_build_object(
             'origen_branch_id', v_org_bid,
             'destinatarios',    to_jsonb(v_dest),
             'escalon_aviso',    v_esc);

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.vencer_impresiones_atrasadas(p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_n integer := 0;
    r record;
BEGIN
    FOR r IN
        WITH vencidos AS (
            UPDATE public.cola_impresion c
               SET estado = 'ERROR',
                   error  = 'No se imprimió: esperó más de 10 minutos a que la caja respondiera. Si todavía hace falta, vuelve a imprimirlo.'
             WHERE c.estado = 'PENDIENTE'
               AND c.created_at < now() - interval '10 minutes'
               AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
            RETURNING c.id, c.titulo, c.branch_id, c.creado_por
        )
        SELECT v.*, b.name AS sala FROM vencidos v LEFT JOIN public.branches b ON b.id = v.branch_id
    LOOP
        v_n := v_n + 1;
        IF r.creado_por IS NOT NULL THEN
            PERFORM public.notify_employees(
                ARRAY[r.creado_por],
                'IMPRESION_VENCIDA',
                'Tu ticket no se imprimió',
                format('«%s» esperó más de 10 minutos y la caja de %s no respondió. Si todavía hace falta, reimprímelo.',
                       coalesce(nullif(btrim(r.titulo), ''), 'Documento'), coalesce(r.sala, 'la sucursal')),
                NULL,
                jsonb_build_object('impresion_id', r.id, 'titulo', r.titulo),
                true,
                r.branch_id::integer
            );
        END IF;
    END LOOP;
    RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.vigilar_servicios()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  ABRIR_CON     constant integer  := 3;
  VENTANA       constant interval := interval '10 minutes';
  CALMA         constant interval := interval '15 minutes';
  FOTO_TARDE    constant interval := interval '2 hours';
  INGRESO_TARDE constant interval := interval '20 minutes';
  NOMBRE        constant jsonb := '{"archivos":"El servicio de archivos","base":"La base de datos","funciones":"Las funciones del servidor","caja":"El sistema de la caja"}';
  v_dest      uuid[];
  r           record;
  v_aviso     record;
  v_n         integer;
BEGIN
  -- 0. Las fotos que ya llegaron dejan de estar pendientes.
  UPDATE public.caja_movimientos_portal m
     SET foto_pendiente_desde = NULL
   WHERE m.foto_pendiente_desde IS NOT NULL
     AND public.foto_esta_guardada(m.foto_url);
  UPDATE public.bolsas_operaciones o
     SET foto_pendiente_desde = NULL
   WHERE o.foto_pendiente_desde IS NOT NULL
     AND public.foto_esta_guardada(o.foto_url);

  SELECT array_agg(DISTINCT e.id) INTO v_dest
    FROM public.employees e
    JOIN public.roles ro ON ro.id = ANY (public.roles_efectivos_de(e.id))
   WHERE ro.name = 'Sistema — Alertas Técnicas' AND e.status = 'ACTIVO';

  -- 1. Abrir un aviso por servicio con 3+ fallas en 10 minutos.
  FOR r IN
    SELECT f.servicio, count(*) AS n, count(DISTINCT f.branch_id) AS salas,
           count(*) FILTER (WHERE f.rescatada) AS salvadas
      FROM public.fallas_de_servicio f
     WHERE f.created_at > now() - VENTANA
     GROUP BY f.servicio
    HAVING count(*) >= ABRIR_CON
  LOOP
    INSERT INTO public.avisos_de_servicio (servicio, fallas, destinatarios)
    VALUES (r.servicio, r.n, coalesce(cardinality(v_dest), 0))
    ON CONFLICT (servicio) WHERE cerrado_at IS NULL DO NOTHING;
    IF NOT FOUND THEN CONTINUE; END IF;   -- ya había uno abierto: no se repite

    IF coalesce(cardinality(v_dest), 0) > 0 THEN
      PERFORM public.notify_employees(
        v_dest, 'SISTEMA_SERVICIO_FALLANDO',
        (NOMBRE ->> r.servicio) || ' está fallando',
        r.n || ' fallas en los últimos 10 minutos, en ' || r.salas || ' sucursal(es)'
          || CASE WHEN r.salvadas = r.n THEN '. Hasta ahora el portal las esquivó todas: nadie quedó frenado.'
                  WHEN r.salvadas > 0 THEN '. ' || r.salvadas || ' las esquivó el portal; el resto llegó a la pantalla.'
                  ELSE '. Las sucursales lo están sufriendo.' END,
        '/actualizacion-de-datos',
        jsonb_build_object('servicio', r.servicio, 'fallas', r.n),
        true, NULL);
    END IF;
  END LOOP;

  -- 2. Cerrar el aviso tras 15 minutos sin fallas.
  FOR v_aviso IN
    SELECT a.* FROM public.avisos_de_servicio a
     WHERE a.cerrado_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.fallas_de_servicio f
                        WHERE f.servicio = a.servicio AND f.created_at > now() - CALMA)
  LOOP
    SELECT count(*) INTO v_n FROM public.fallas_de_servicio f
     WHERE f.servicio = v_aviso.servicio AND f.created_at >= v_aviso.abierto_at - VENTANA;
    UPDATE public.avisos_de_servicio SET cerrado_at = now(), fallas = v_n WHERE id = v_aviso.id;
    IF coalesce(cardinality(v_dest), 0) > 0 THEN
      PERFORM public.notify_employees(
        v_dest, 'SISTEMA_SERVICIO_NORMAL',
        (NOMBRE ->> v_aviso.servicio) || ' se normalizó',
        'Lleva 15 minutos sin fallas. En total fueron ' || v_n || ' desde las '
          || to_char(v_aviso.abierto_at AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM') || '.',
        '/actualizacion-de-datos',
        jsonb_build_object('servicio', v_aviso.servicio, 'fallas', v_n),
        true, NULL);
    END IF;
  END LOOP;

  -- 3. Fotos que no llegaron en 2 horas (caja y bolsas), una vez cada una.
  FOR r IN
    SELECT 'caja' AS de, m.id, m.monto, m.numero_boleta, m.foto_pendiente_desde, b.name AS sala
      FROM public.caja_movimientos_portal m
      LEFT JOIN public.branches b ON b.id = m.branch_id
     WHERE m.foto_pendiente_desde < now() - FOTO_TARDE
       AND m.foto_pendiente_avisada_at IS NULL
    UNION ALL
    SELECT 'bolsa', o.id, o.monto, o.numero_boleta, o.foto_pendiente_desde, b.name
      FROM public.bolsas_operaciones o
      LEFT JOIN public.branches b ON b.id = o.branch_id
     WHERE o.foto_pendiente_desde < now() - FOTO_TARDE
       AND o.foto_pendiente_avisada_at IS NULL
  LOOP
    IF r.de = 'caja' THEN
      UPDATE public.caja_movimientos_portal SET foto_pendiente_avisada_at = now() WHERE id = r.id;
    ELSE
      UPDATE public.bolsas_operaciones SET foto_pendiente_avisada_at = now() WHERE id = r.id;
    END IF;
    IF coalesce(cardinality(v_dest), 0) > 0 THEN
      PERFORM public.notify_employees(
        v_dest, 'SISTEMA_FOTO_SIN_LLEGAR',
        CASE WHEN r.de = 'caja' THEN 'Una foto de caja no llegó' ELSE 'Una foto de bolsa no llegó' END,
        coalesce(r.sala, 'Una sucursal') || ': el movimiento de $' || to_char(r.monto, 'FM999990.00')
          || coalesce(' (boleta ' || r.numero_boleta || ')', '')
          || ' se anotó a las ' || to_char(r.foto_pendiente_desde AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM')
          || ' y su foto sigue en el equipo donde se tomó. Si ese equipo no vuelve a entrar al portal, la foto no va a llegar.',
        CASE WHEN r.de = 'caja' THEN '/caja' ELSE '/bolsas' END,
        jsonb_build_object(CASE WHEN r.de = 'caja' THEN 'movimiento_id' ELSE 'operacion_id' END, r.id),
        true, NULL);
    END IF;
  END LOOP;

  -- 4. Ingresos en efectivo que llevan 20 minutos sin llegar a la caja.
  --    Normalmente el equipo que lo anotó lo manda solo en cuanto la caja
  --    responde; si no llegó, alguien tiene que mirarlo antes del corte.
  FOR r IN
    SELECT m.id, m.monto, m.concepto, m.created_at, b.name AS sala
      FROM public.caja_movimientos_portal m
      LEFT JOIN public.branches b ON b.id = m.branch_id
     WHERE m.erp_movimiento_id IS NULL AND m.anulado_at IS NULL
       AND m.tipo = 'ENTRADA'
       AND coalesce(m.forma_pago, 'EFECTIVO') = 'EFECTIVO'
       AND m.created_at < now() - INGRESO_TARDE
       AND m.created_at > now() - interval '2 days'
       AND m.envio_avisado_at IS NULL
  LOOP
    UPDATE public.caja_movimientos_portal SET envio_avisado_at = now() WHERE id = r.id;
    IF coalesce(cardinality(v_dest), 0) > 0 THEN
      PERFORM public.notify_employees(
        v_dest, 'SISTEMA_INGRESO_SIN_CAJA',
        'Un ingreso no llegó a la caja',
        coalesce(r.sala, 'Una sucursal') || ': el ingreso de $' || to_char(r.monto, 'FM999990.00')
          || ' («' || left(coalesce(r.concepto, ''), 40) || '») se anotó a las '
          || to_char(r.created_at AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM')
          || ' y todavía no está en la caja. Se puede mandar desde Mi caja con «Mandar a la caja».',
        '/caja',
        jsonb_build_object('movimiento_id', r.id),
        true, NULL);
    END IF;
  END LOOP;

  -- 5. Retención: las fallas son diagnóstico, no historia de negocio.
  DELETE FROM public.fallas_de_servicio WHERE created_at < now() - interval '90 days';
END;
$function$;

CREATE OR REPLACE FUNCTION public.zero_out_product_all_branches(p_erp_product_id integer, p_motivo text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_now       TIMESTAMPTZ := NOW();
  v_count     INTEGER;
  v_publisher TEXT := (SELECT auth.email());
  v_total     BOOLEAN := (SELECT public.auth_can_edit_scope_all(ARRAY['minmax']));
  v_motivo    TEXT := coalesce(nullif(btrim(p_motivo), ''), 'otro');
  v_nota      TEXT := nullif(btrim(p_nota), '');
BEGIN
  IF NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  IF NOT v_total
     AND NOT (SELECT public.auth_has_module_permission('minmax_cero_en_todas', 'can_view')) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: poner un producto en 0 en todas las sucursales requiere ese permiso';
  END IF;

  IF v_motivo NOT IN ('otro', 'ya_no_rota') THEN
    RAISE EXCEPTION 'MOTIVO_INVALIDO: el motivo tiene que ser «otro» o «ya_no_rota»';
  END IF;
  IF v_motivo = 'ya_no_rota' AND NOT v_total THEN
    RAISE EXCEPTION 'MOTIVO_DENEGADO: «ya no rota» sólo lo puede poner quien decide sobre todas las sucursales';
  END IF;
  IF v_nota IS NULL THEN
    RAISE EXCEPTION 'FALTA_MOTIVO: escribe por qué se pone en 0 en todas las sucursales';
  END IF;

  INSERT INTO product_stock_params (
    erp_product_id, erp_sucursal_id,
    min_units, max_units,
    draft_min, draft_max, draft_status,
    manual_min, manual_max,
    manual_motivo, manual_nota, manual_cliente_unidades, manual_cliente_dias,
    manual_at, manual_por,
    published_at, published_by, updated_at
  )
  SELECT
    p_erp_product_id,
    m.erp_sucursal_id,
    0, 0,
    NULL, NULL, 'none',
    NULL, NULL,
    v_motivo, v_nota, NULL, NULL,
    v_now, v_publisher,
    v_now, v_publisher, v_now
  FROM erp_sucursal_map m
  ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
    min_units    = 0,
    max_units    = 0,
    draft_min    = NULL,
    draft_max    = NULL,
    draft_status = 'none',
    manual_min   = NULL,
    manual_max   = NULL,
    manual_motivo = v_motivo,
    manual_nota   = v_nota,
    manual_cliente_unidades = NULL,
    manual_cliente_dias     = NULL,
    manual_at    = v_now,
    manual_por   = v_publisher,
    published_at = v_now,
    published_by = v_publisher,
    updated_at   = v_now
  WHERE product_stock_params.is_hidden IS NOT TRUE;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated', v_count, 'at', v_now);
END;
$function$;
