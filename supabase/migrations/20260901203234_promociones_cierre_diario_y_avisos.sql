-- Promociones — el cierre diario y los avisos.
--
-- Una promoción termina por DOS causas y hay que decir cuál fue: se vendió el
-- lote, o venció la fecha. Cierra SOLA y queda en bitácora — no espera a que
-- alguien mire, porque una alarma que espera a que alguien entre no cierra el
-- circuito.
--
-- El aviso sale al 80% del lote DE CADA SALA (no del total): la sala que se
-- queda sin producto es la que necesita saberlo, y necesita las tres cosas que
-- hacen falta para actuar — cuánto le queda, en qué salas sí hay, y a quién
-- pedirle. Segundo aviso al 100%.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- promocion_avance — cuánto lleva vendido cada renglón, por sala
-- ─────────────────────────────────────────────────────────────────────────────
-- Misma forma medida en `get_promocion`: dos CTE materializados y hash join.
-- Entrar por producto sin acotar la fecha, o dejar que el planificador estime
-- el conjunto de renglones, cuesta 13× más (930 ms contra 72).
CREATE OR REPLACE FUNCTION public.promocion_avance(p_solo_abiertos boolean DEFAULT true)
RETURNS TABLE (renglon_id bigint, branch_id bigint, vendido numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_ini   date;
    v_fin   date;
    v_prods integer[];
BEGIN
    SELECT min(r.inicio), max(r.fin), array_agg(DISTINCT r.erp_product_id)
      INTO v_ini, v_fin, v_prods
      FROM public.promocion_renglon r
      JOIN public.promociones pm ON pm.id = r.promocion_id
     WHERE NOT p_solo_abiertos
        OR (r.estado = 'abierto' AND pm.estado = 'activa');

    IF v_ini IS NULL THEN RETURN; END IF;

    RETURN QUERY
    WITH facturas AS MATERIALIZED (
        SELECT si.id, si.branch_id, si.fecha
          FROM public.sales_invoices si
         WHERE si.fecha >= v_ini AND si.fecha <= v_fin
           AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
    ),
    items AS MATERIALIZED (
        SELECT ii.invoice_id, ii.erp_product_id, ii.factor_unidades, ii.cantidad
          FROM public.sales_invoice_items ii
         WHERE ii.erp_product_id = ANY (v_prods)
    )
    SELECT r.id, f.branch_id,
           sum(i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric
      FROM items i
      JOIN facturas f ON f.id = i.invoice_id
      JOIN public.promocion_renglon r
        ON r.erp_product_id = i.erp_product_id
       AND f.fecha BETWEEN r.inicio AND r.fin
       AND (r.factor_unidades IS NULL OR i.factor_unidades = r.factor_unidades)
      JOIN public.promociones pm ON pm.id = r.promocion_id
     WHERE (NOT p_solo_abiertos OR (r.estado = 'abierto' AND pm.estado = 'activa'))
       AND NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v
                        WHERE v.invoice_id = f.id)
     GROUP BY r.id, f.branch_id;
END;
$function$;

COMMENT ON FUNCTION public.promocion_avance(boolean) IS
  'Unidades base vendidas por renglón y por sala. En unidades BASE siempre: es lo único comparable con el lote y con la factura de compra.';

ALTER FUNCTION public.promocion_avance(boolean) SET plan_cache_mode = 'force_custom_plan';

REVOKE EXECUTE ON FUNCTION public.promocion_avance(boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.promocion_avance(boolean) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- promociones_ciclo_diario — cierra lo que terminó y avisa a quien se le acaba
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.promociones_ciclo_diario()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_lote     integer := 0;
    v_fecha    integer := 0;
    v_final    integer := 0;
    v_avisos   integer := 0;
    v_fila     record;
    v_sala     record;
    v_dest     uuid[];
    v_donde    text;
    v_titulo   text;
    v_cuerpo   text;
    v_salida   text := '';
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
        SELECT pm.id, pm.nombre
          FROM public.promociones pm
         WHERE pm.estado = 'activa'
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
                'Cerró su último producto. Podés ver cómo quedó en Promociones.',
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

    -- Lo que queda en `cron.job_run_details.return_message`. Un cron que
    -- devuelve siempre lo mismo no deja ver si hizo algo.
    IF v_lote  > 0 THEN v_salida := v_salida || 'cerrados_por_lote='  || v_lote  || ' '; END IF;
    IF v_fecha > 0 THEN v_salida := v_salida || 'cerrados_por_fecha=' || v_fecha || ' '; END IF;
    IF v_final > 0 THEN v_salida := v_salida || 'finalizadas='        || v_final || ' '; END IF;
    IF v_avisos> 0 THEN v_salida := v_salida || 'avisos='             || v_avisos|| ' '; END IF;

    RETURN coalesce(nullif(btrim(v_salida), ''), 'sin novedades');
END;
$function$;

COMMENT ON FUNCTION public.promociones_ciclo_diario() IS
  'Cierra los renglones que terminaron (lote agotado o fin de vigencia), finaliza la promoción cuando cerró el último, y avisa al 80% y al 100% del lote de cada sala diciendo dónde sí hay.';

REVOKE EXECUTE ON FUNCTION public.promociones_ciclo_diario() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.promociones_ciclo_diario() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- El cron — 13:30 UTC = 7:30 SV, antes de que abran las salas
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.unschedule('promociones-ciclo-diario')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'promociones-ciclo-diario');

SELECT cron.schedule(
    'promociones-ciclo-diario',
    '30 13 * * *',
    $cron$SELECT public.promociones_ciclo_diario()$cron$
);
