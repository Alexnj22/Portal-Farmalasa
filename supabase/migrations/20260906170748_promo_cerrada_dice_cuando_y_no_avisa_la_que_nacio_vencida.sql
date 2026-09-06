SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El aviso de «Promoción terminada» dice CUÁNDO terminó, y no sale cuando la
-- promoción se cargó ya vencida.
--
-- Reportado por el usuario el 2026-09-06: «me llegó notificación de promoción
-- finalizada AD, pero fue retroactiva, ¿por qué me llegó si finalizó hace
-- bastante?».
--
-- No llegó tarde. La promoción AD (id 35) se creó y se activó el **5-sep a las
-- 09:00 SV** con sus tres productos vigentes del **25-jul al 31-ago** — o sea
-- nació vencida hacía cinco días. `promociones_ciclo_diario` corre una vez al
-- día a las 07:30 SV y en su primera pasada hizo exactamente lo que le toca:
-- cerró los tres por `fin_de_vigencia`, finalizó la promoción y avisó.
--
-- El aviso decía «Cerró su último producto», que es cierto —cerró hoy— pero no
-- decía cuándo había vencido, así que se lee como noticia de algo que acaba de
-- pasar. Dos correcciones, y son distintas:
--
-- 1 · **El cuerpo nombra la fecha.** «Venció el 31 de agosto» en vez de «cerró
--     su último producto». Vale siempre, no sólo para este caso: una promoción
--     que termina el domingo se cierra el lunes y el aviso ya no confunde el
--     día del cierre con el del vencimiento. Cuando lo que la cerró fue el lote
--     y no la fecha, lo dice así.
--
-- 2 · **La que nunca estuvo viva no se anuncia.** Si el último producto venció
--     ANTES del día en que la promoción se activó, no hubo campaña que contar:
--     se cierra igual, queda en el histórico y en la liquidación, pero no le
--     llega a nadie. El anclaje es la **activación** (`promocion_historial`
--     evento `activada`) y no la creación: una promoción puede pasar semanas en
--     borrador y eso no dice nada de si corrió. Sin registro de activación
--     —promociones anteriores al historial— cae a `created_at`.
--
--     Y no se silencia en silencio: queda un `finalizada_sin_aviso` en la
--     bitácora de la promoción diciendo por qué. Un aviso que no sale y no deja
--     rastro es indistinguible de uno que se perdió.
--
-- El resto de la función no se toca.
-- ═══════════════════════════════════════════════════════════════════════════

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
        END || ' Podés ver cómo quedó en Promociones.';

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
                'Promoción terminada — ' || v_fila.nombre,
                v_cuerpo,
                '/promociones?tab=historico',
                jsonb_build_object('promocion_id', v_fila.id),
                false, NULL);
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
        SELECT string_agg(x.sala || ' ' || x.queda::int, ' · ' ORDER BY x.queda DESC)
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
            v_cuerpo := v_sala.promocion || ': llevás ' || v_sala.vendido::int ||
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
                                   'branch_id',    v_sala.branch_id),
                false, v_sala.branch_id::integer);
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
                                   'branch_id',    v_sala.branch_id),
                false, NULL);
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
