SET lock_timeout = '5s';

-- Octava tanda de tarjetas de la campana (usuario, 24-sep: «sigamos con las que
-- faltan»): conteo cíclico, envío a Hacienda y promociones. Mandan en el
-- metadata lo que dibuja la tarjeta y el título dice el hecho sin emoji. De
-- paso: «22:30» pasa a 12 horas y «Podés/llevás» al tú del portal.

CREATE OR REPLACE FUNCTION public.crear_conteos_ciclicos_programados()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record;
  v_conteo_id uuid;
  v_ids int[];
  v_composicion jsonb;
  v_creados jsonb := '[]'::jsonb;
  v_saltados jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT b.id, b.name, b.conteo_ciclico_tamano AS tamano
    FROM public.branches b
    WHERE b.conteo_ciclico_activo = true
      AND EXISTS (SELECT 1 FROM public.erp_sucursal_map m WHERE m.branch_id = b.id)
    ORDER BY b.id
  LOOP
    -- Una sucursal con un conteo abierto no recibe otro: se pisarían leyendo el
    -- mismo stock en vivo. Se salta y queda registrado, no se rompe la corrida.
    IF EXISTS (SELECT 1 FROM public.conteos_inventario
               WHERE branch_id = r.id AND status IN ('BORRADOR','EN_PROGRESO')) THEN
      v_saltados := v_saltados || jsonb_build_object('branch', r.name, 'motivo', 'conteo_abierto');
      CONTINUE;
    END IF;

    SELECT array_agg(s.erp_product_id), jsonb_object_agg(s.segmento, s.n)
    INTO v_ids, v_composicion
    FROM (
      SELECT erp_product_id, segmento, count(*) OVER (PARTITION BY segmento) n
      FROM public.seleccionar_muestra_ciclica(r.id, r.tamano)
    ) s;

    IF v_ids IS NULL THEN
      v_saltados := v_saltados || jsonb_build_object('branch', r.name, 'motivo', 'muestra_vacia');
      CONTINUE;
    END IF;

    -- created_by queda NULL: no hay empleado detrás, lo creó el sistema. El
    -- scope_filter deja constancia de eso y de cómo se sorteó.
    INSERT INTO public.conteos_inventario (branch_id, created_by, scope_type, scope_filter, incluye_vencidos, status)
    VALUES (r.id, NULL, 'CICLICO',
            jsonb_build_object('tamano', r.tamano, 'composicion', v_composicion,
                               'productos', array_length(v_ids, 1), 'programado', true),
            true, 'EN_PROGRESO')
    RETURNING id INTO v_conteo_id;

    INSERT INTO public.conteo_inventario_items (conteo_id, erp_product_id, source_inventory_id, source_sync_key, presentacion, detalle, lote, fecha_vencimiento, is_vencidos, sistema_cantidad, sistema_inicial, costo_unitario)
    SELECT v_conteo_id, i.erp_product_id, i.id, i.sync_key, i.presentacion, i.detalle, i.lote, i.fecha_vencimiento, i.is_vencidos, i.cantidad, i.cantidad,
           public.conteo_costo_unitario(i.erp_product_id, i.presentacion)
    FROM public.inventory i
    JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND m.branch_id = r.id
    WHERE i.erp_product_id = ANY(v_ids);

    -- Crear el conteo y no avisarle a nadie lo dejaría esperando a que alguien
    -- entre a mirar.
    -- El título lleva la sala y el mes (24-sep); la tarjeta dibuja cuántos y
    -- de qué clase son.
    PERFORM public.notify_branch(
      r.id::int,
      'CONTEO_CICLICO',
      r.name || ' · Conteo cíclico de ' || (ARRAY['enero','febrero','marzo','abril','mayo','junio','julio',
            'agosto','septiembre','octubre','noviembre','diciembre'])
            [extract(month from (now() AT TIME ZONE 'America/El_Salvador'))::int],
      format('Ya está listo el conteo de %s productos de este mes. Se cuenta a ciegas: anota lo que ves en el estante.', array_length(v_ids, 1)),
      '/conteo-inventario/' || v_conteo_id::text,
      jsonb_build_object('conteo_id', v_conteo_id, 'composicion', v_composicion,
                         'sala', r.name, 'productos', array_length(v_ids, 1)),
      true
    );

    v_creados := v_creados || jsonb_build_object(
      'branch', r.name, 'conteo_id', v_conteo_id,
      'productos', array_length(v_ids, 1), 'composicion', v_composicion);
  END LOOP;

  RETURN jsonb_build_object('creados', v_creados, 'saltados', v_saltados, 'at', now());
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
       AND (e.role_id = r.id OR e.secondary_role_id = r.id);

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
                AND (recibido_mh IS NULL OR recibido_mh NOT LIKE repeat('_', 40)));

        v_titulo := 'El envío a Hacienda no corrió anoche';
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
        v_titulo := CASE WHEN v_fallidas = 1 THEN 'Una factura no entró a Hacienda anoche'
                         ELSE v_fallidas || ' facturas no entraron a Hacienda anoche' END;

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
                 || ' no se pudo completar ante Hacienda'
                 || CASE WHEN v_resueltas > 0 THEN ', ' || v_resueltas || ' sí' ELSE '' END
                 || '. ' || CASE WHEN v_restantes > 0
                                 THEN 'Quedan ' || v_restantes || ' en cola. ' ELSE '' END
                 || 'Las que ya no se arreglan solas están en Facturación, en Observaciones.';
    END IF;

    PERFORM public.notify_employees(
        v_dest, 'SYSTEM', v_titulo, v_cuerpo, '/facturacion?tab=observaciones',
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
        true, NULL
    );
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
            ELSE ' Ya no queda en ninguna otra sala.' END;

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

        -- Y a supervisión, que es quien puede mover producto entre salas.
        SELECT array_agg(e.id) INTO v_dest
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND coalesce(e.tipo_ficha,'empleado') = 'empleado'
           AND EXISTS (SELECT 1 FROM public.role_permissions rp
                        WHERE rp.module_key = 'promociones' AND rp.can_view
                          AND rp.role_id IN (e.role_id, e.secondary_role_id));

        IF v_dest IS NOT NULL THEN
            PERFORM public.notify_employees(
                v_dest, 'PROMO_LOTE_BAJO',
                v_sala.sala || ': ' || v_titulo, v_cuerpo, '/promociones',
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
                true, NULL);
        END IF;

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

    -- ── 5 · Congelar el mes de las promociones de LABORATORIO ────────────────
    -- Va al final a propósito: los pasos 1-4 son del tipo producto y ninguno
    -- toca estas filas, así que el orden no cambia el resultado — pero un paso
    -- que escribe el cierre definitivo de un mes se lee mejor último.
    v_lab := public.promociones_cerrar_meses_de_laboratorio();

    -- Lo que queda en `cron.job_run_details.return_message`. Un cron que
    -- devuelve siempre lo mismo no deja ver si hizo algo.
    IF v_lote  > 0 THEN v_salida := v_salida || 'cerrados_por_lote='  || v_lote  || ' '; END IF;
    IF v_fecha > 0 THEN v_salida := v_salida || 'cerrados_por_fecha=' || v_fecha || ' '; END IF;
    IF v_final > 0 THEN v_salida := v_salida || 'finalizadas='        || v_final || ' '; END IF;
    IF v_avisos> 0 THEN v_salida := v_salida || 'avisos='             || v_avisos|| ' '; END IF;
    IF v_lab   > 0 THEN v_salida := v_salida || 'meses_cerrados='     || v_lab   || ' '; END IF;

    RETURN coalesce(nullif(btrim(v_salida), ''), 'sin novedades');
END;
$function$;

CREATE OR REPLACE FUNCTION public.promociones_cerrar_meses_de_laboratorio()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_hoy   date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_n     integer := 0;
    v_pm    record;
    v_costo numeric;
    v_dest  uuid[];
BEGIN
    FOR v_pm IN
        SELECT pm.id, pm.nombre, pm.year_month
          FROM public.promociones pm
         WHERE pm.tipo = 'laboratorio'
           AND pm.estado = 'activa'
           -- El mes tiene que haber TERMINADO. Un borrador nunca llega acá
           -- porque no está activa: cerrar un borrador congelaría una matriz
           -- que nadie decidió.
           AND ((pm.year_month || '-01')::date
                + interval '1 month')::date <= v_hoy
           AND NOT EXISTS (SELECT 1 FROM public.promocion_cierre_sala c
                            WHERE c.promocion_id = pm.id)
    LOOP
        INSERT INTO public.promocion_cierre_sala
            (promocion_id, branch_id, venta, nivel, monto_por_persona, personas, costo)
        SELECT v_pm.id, a.branch_id, a.venta, a.nivel,
               a.monto_por_persona, a.personas, a.costo
          FROM public.promocion_laboratorio_avance(v_pm.id, v_pm.year_month) a;

        SELECT coalesce(sum(c.costo), 0) INTO v_costo
          FROM public.promocion_cierre_sala c WHERE c.promocion_id = v_pm.id;

        UPDATE public.promociones
           SET estado = 'finalizada', updated_at = now()
         WHERE id = v_pm.id;

        PERFORM public.promocion_log(v_pm.id, NULL, NULL, 'mes_cerrado',
            'activa', 'finalizada',
            v_pm.year_month || ' congelado · costo ' || to_char(v_costo, 'FM999999990.00'));
        v_n := v_n + 1;

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
                'Cerró el mes — ' || v_pm.nombre,
                'Los niveles de ' || v_pm.year_month || ' quedaron congelados. '
                  || 'Costo del programa: $' || to_char(v_costo, 'FM999999990.00') || '.',
                '/promociones?tab=historico',
                jsonb_build_object('promocion_id', v_pm.id,
                                   'year_month',   v_pm.year_month,
                                   -- La tarjeta (24-sep): el costo y el nivel
                                   -- al que llegó cada sala.
                                   'promo', jsonb_strip_nulls(jsonb_build_object(
                                       'tipo',   'mes',
                                       'nombre', v_pm.nombre,
                                       'mes',    v_pm.year_month,
                                       'costo',  v_costo,
                                       'salas',  (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                                          'sala', b.name, 'nivel', c.nivel,
                                                          'venta', c.venta, 'costo', c.costo)) ORDER BY b.name)
                                                    FROM public.promocion_cierre_sala c
                                                    JOIN public.branches b ON b.id = c.branch_id
                                                   WHERE c.promocion_id = v_pm.id)))),
                true, NULL);
        END IF;
    END LOOP;

    RETURN v_n;
END;
$function$;
