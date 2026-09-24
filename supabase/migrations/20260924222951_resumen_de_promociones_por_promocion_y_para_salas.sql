SET lock_timeout = '5s';

-- El resumen diario de promociones se enciende POR PROMOCIÓN y se elige a
-- quién le llega (usuario, 24-sep): a supervisión (todas las salas), a las
-- salas (cada una sólo lo suyo), o a las dos. Las que ya existen quedan sin
-- resumen hasta que alguien lo encienda.

ALTER TABLE public.promociones
    ADD COLUMN IF NOT EXISTS resumen_supervision boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS resumen_salas       boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.promociones.resumen_supervision IS
  'El resumen de las 7:30 a. m. le llega a supervisión con todas las salas.';
COMMENT ON COLUMN public.promociones.resumen_salas IS
  'El resumen de las 7:30 a. m. le llega a la jefatura de cada sala, con lo suyo.';

CREATE OR REPLACE FUNCTION public.resumen_de_promocion(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- A quién le llega el resumen diario de una promoción.
BEGIN
    IF NOT public.auth_has_module_permission('promociones', 'can_view') THEN
        RETURN NULL;
    END IF;
    RETURN (SELECT json_build_object('supervision', p.resumen_supervision, 'salas', p.resumen_salas)
              FROM public.promociones p WHERE p.id = p_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ajustar_resumen_promocion(p_id bigint, p_supervision boolean, p_salas boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- Encender, apagar o cambiar a quién le llega el resumen diario de una
-- promoción. Queda en el historial de la promoción.
DECLARE
    v_row public.promociones%ROWTYPE;
    v_antes text;
    v_despues text;
BEGIN
    IF public.auth_employee_id() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('promociones', 'can_edit') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere editar en Promociones';
    END IF;

    SELECT * INTO v_row FROM public.promociones WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: la promoción % no existe', p_id; END IF;

    v_antes := CASE WHEN v_row.resumen_supervision AND v_row.resumen_salas THEN 'supervisión y salas'
                    WHEN v_row.resumen_supervision THEN 'supervisión'
                    WHEN v_row.resumen_salas THEN 'salas' ELSE 'sin resumen' END;
    v_despues := CASE WHEN p_supervision AND p_salas THEN 'supervisión y salas'
                      WHEN p_supervision THEN 'supervisión'
                      WHEN p_salas THEN 'salas' ELSE 'sin resumen' END;
    IF v_antes = v_despues THEN
        RETURN json_build_object('supervision', p_supervision, 'salas', p_salas, 'sin_cambio', true);
    END IF;

    UPDATE public.promociones
       SET resumen_supervision = coalesce(p_supervision, false),
           resumen_salas       = coalesce(p_salas, false),
           updated_at          = now()
     WHERE id = p_id;

    PERFORM public.promocion_log(p_id, NULL, NULL, 'resumen_diario', v_antes, v_despues, NULL);

    RETURN json_build_object('supervision', p_supervision, 'salas', p_salas);
END;
$function$;

REVOKE ALL ON FUNCTION public.resumen_de_promocion(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumen_de_promocion(bigint) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ajustar_resumen_promocion(bigint, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustar_resumen_promocion(bigint, boolean, boolean) TO authenticated, service_role;

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
                  || CASE WHEN coalesce(v_n_bajo, 0) = 1 THEN ', 1 sala por agotarse'
                          WHEN coalesce(v_n_bajo, 0) > 1 THEN ', ' || v_n_bajo || ' salas por agotarse'
                          ELSE '' END,
                'Cómo va cada promoción y cada sala.',
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
                'Cuánto lleva vendido tu sala en cada promoción.',
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
