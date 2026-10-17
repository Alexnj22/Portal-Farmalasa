SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Una factura que el sistema de ventas ELIMINA deja de contar en el portal.
--
-- Salud 3, 16-oct-2026: la 0000062354_COF ($15.55, efectivo, con sello de
-- Hacienda) se ocultó/eliminó en el origen después de emitida. El sync sólo
-- agrega y actualiza lo que viene en el listado, así que esa fila quedó viva
-- acá como FINALIZADA: el cierre del día pidió «$15.55 sin contar» que ningún
-- corte podía contar (la caja ya no la sumaba) y la sala tuvo que cerrar a mano.
-- La pestaña Saltos tampoco la vio: el salto existe en el origen, pero acá el
-- correlativo seguía presente.
--
-- La pieza: la fila NO se borra —se conserva como evidencia— sino que pasa al
-- estado 'DESAPARECIDA EN ORIGEN'. `venta_valida` es `estado = 'FINALIZADA'`,
-- así que deja de contar en todas partes a la vez (caja, Ventas, metas,
-- puntos) sin tocar las ~100 funciones que la usan.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. El seguimiento de la ausencia ────────────────────────────────────────
-- Sin FK a `sales_invoices` a propósito: crearla toma un lock sobre la tabla
-- más caliente de la base (incidente 2026-07-08). El índice por invoice_id es
-- la PK.
CREATE TABLE IF NOT EXISTS public.ventas_desaparecidas (
    invoice_id        bigint PRIMARY KEY,
    branch_id         integer NOT NULL,
    erp_invoice_id    text NOT NULL,
    primera_ausencia  timestamptz NOT NULL DEFAULT now(),
    marcada_at        timestamptz,
    estado_previo     text,
    reaparecio_at     timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ventas_desaparecidas_branch_idx
    ON public.ventas_desaparecidas (branch_id, marcada_at);

ALTER TABLE public.ventas_desaparecidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ventas_desaparecidas_select ON public.ventas_desaparecidas;
CREATE POLICY ventas_desaparecidas_select ON public.ventas_desaparecidas
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('facturacion', 'can_view')));
REVOKE ALL ON public.ventas_desaparecidas FROM anon;

-- ── 2. El juez: qué falta del listado y cuándo se marca ─────────────────────
--
-- Lo llama `sync-dte-sales` en cada corrida con TODO lo que vino en el listado
-- del origen para esa sala y ese rango de fechas, y `hacer-corte-caja` con una
-- lectura fresca justo antes de frenar un cierre.
--
-- Tres frenos contra marcar de más, porque una venta marcada por error deja de
-- contar en la caja y en las metas:
--   · listado vacío → no se mira nada (el origen no contestó, no «no hay ventas»);
--   · dos lecturas: la primera ausencia sólo se ANOTA; se marca cuando sigue
--     faltando 3 minutos después (`p_inmediato` lo salta: la lectura del cierre
--     es deliberada y fresca);
--   · tope: si en una sola lectura faltarían más de max(5, 5%) del listado, es
--     el listado el que está mal — no se marca nada y queda en la bitácora.
CREATE OR REPLACE FUNCTION public.marcar_ventas_desaparecidas(
    p_branch_id integer, p_fini date, p_ffin date, p_vistos text[],
    p_inmediato boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
                      || CASE WHEN length(u.recibido_mh) = 40 THEN ', con sello de Hacienda' ELSE '' END,
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
                          THEN ' Hacienda la tiene recibida: hay que invalidarla o restituirla.'
                          WHEN v_con_sello > 0
                          THEN ' Hacienda tiene recibidas ' || v_con_sello || ': hay que invalidarlas o restituirlas.'
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
$$;
REVOKE EXECUTE ON FUNCTION public.marcar_ventas_desaparecidas(integer, date, date, text[], boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_ventas_desaparecidas(integer, date, date, text[], boolean)
    TO service_role;

-- ── 3. Saltos la ve ─────────────────────────────────────────────────────────
-- Una desaparecida no ocupa su correlativo: el salto aparece igual que en el
-- origen, y `desaparecidas` dice qué había ahí (para no tener que adivinarlo).
-- Columna nueva al FINAL: `CREATE OR REPLACE VIEW` sólo admite agregar ahí.
CREATE OR REPLACE VIEW public.sales_invoice_gaps WITH (security_invoker = true) AS
 WITH parsed AS (
         SELECT sales_invoices.branch_id,
            sales_invoices.tipo_documento,
            sales_invoices.correlativo,
            sales_invoices.fecha,
            (regexp_match(sales_invoices.correlativo, '^(\d+)_'::text))[1]::bigint AS num
           FROM sales_invoices
          WHERE sales_invoices.correlativo ~ '^\d+_[A-Z]+$'::text
            AND sales_invoices.estado IS DISTINCT FROM 'DESAPARECIDA EN ORIGEN'
        ), with_lag AS (
         SELECT parsed.branch_id,
            parsed.tipo_documento,
            parsed.num,
            parsed.fecha,
            parsed.correlativo,
            lag(parsed.num) OVER (PARTITION BY parsed.branch_id, parsed.tipo_documento ORDER BY parsed.num) AS prev_num
           FROM parsed
        )
 SELECT w.branch_id,
    w.tipo_documento,
    w.prev_num + 1 AS gap_from,
    w.num - 1 AS gap_to,
    (w.num - w.prev_num - 1)::integer AS gap_count,
    w.correlativo AS siguiente_correlativo,
    w.fecha AS fecha_siguiente,
    (SELECT json_agg(json_build_object(
                'correlativo', d.correlativo, 'fecha', d.fecha, 'hora', d.hora,
                'total', d.total, 'tipo_pago', d.tipo_pago, 'cliente', d.cliente,
                'erp_invoice_id', d.erp_invoice_id, 'codigo_generacion', d.codigo_generacion,
                'con_sello', length(d.recibido_mh) = 40, 'eliminada_el', vd.marcada_at)
              ORDER BY d.correlativo)
       FROM public.sales_invoices d
       LEFT JOIN public.ventas_desaparecidas vd ON vd.invoice_id = d.id
      WHERE d.branch_id = w.branch_id
        AND d.tipo_documento = w.tipo_documento
        AND d.estado = 'DESAPARECIDA EN ORIGEN'
        AND d.correlativo ~ '^\d+_[A-Z]+$'
        AND (regexp_match(d.correlativo, '^(\d+)_'))[1]::bigint BETWEEN w.prev_num + 1 AND w.num - 1
    ) AS desaparecidas
   FROM with_lag w
  WHERE w.prev_num IS NOT NULL AND w.num > (w.prev_num + 1)
  ORDER BY w.branch_id, w.tipo_documento, (w.prev_num + 1);
REVOKE ALL ON public.sales_invoice_gaps FROM anon;

-- ── 4. Los que nombran estados a mano ──────────────────────────────────────
-- El estado nuevo es CONOCIDO: no es «un estado que nadie revisó».
-- venta-a-mano: el vigilante pregunta «¿es un estado que alguien conoce?» y
-- Pendiente MH «¿existe todavía en el origen y no está anulada?»; ninguna de las
-- dos es «¿cuenta como venta?». Se respeta la redacción viva de cada una.
CREATE OR REPLACE FUNCTION public.avisar_estados_de_venta_desconocidos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    r        record;
    v_dest   uuid[];
    v_n      integer := 0;
BEGIN
    FOR r IN
        SELECT coalesce(si.estado, '(vacío)') AS estado,
               count(*)                       AS facturas,
               sum(si.total)                  AS monto,
               min(si.fecha)                  AS desde,
               max(si.fecha)                  AS hasta
          FROM public.sales_invoices si
         WHERE (si.estado <> 'FINALIZADA'
                AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH', 'DESAPARECIDA EN ORIGEN'))
            OR si.estado IS NULL
         GROUP BY 1
    LOOP
        CONTINUE WHEN EXISTS (
            SELECT 1 FROM public.audit_logs
             WHERE action = 'ESTADO_DE_VENTA_DESCONOCIDO'
               AND details->>'estado' = r.estado);

        IF v_dest IS NULL THEN
            SELECT array_agg(e.id) INTO v_dest
              FROM public.employees e
              JOIN public.roles ro ON ro.name = 'Sistema — Alertas Técnicas'
             WHERE e.status = 'ACTIVO'
               AND (e.role_id = ro.id OR e.secondary_role_id = ro.id);
        END IF;

        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
        VALUES ('ESTADO_DE_VENTA_DESCONOCIDO', r.estado, 'Vigilante', 'SYSTEM', 'CRITICAL',
                jsonb_build_object('estado', r.estado, 'facturas', r.facturas,
                                   'monto', r.monto, 'desde', r.desde, 'hasta', r.hasta,
                                   'avisados', coalesce(array_length(v_dest, 1), 0)));

        IF coalesce(array_length(v_dest, 1), 0) > 0 THEN
            PERFORM public.notify_employees(
                v_dest, 'SYSTEM',
                'Apareció un estado de venta nuevo',
                r.facturas || ' factura' || CASE WHEN r.facturas = 1 THEN '' ELSE 's' END
                  || ' en estado «' || r.estado || '» (' || to_char(r.desde, 'DD/MM/YYYY')
                  || CASE WHEN r.hasta <> r.desde THEN ' al ' || to_char(r.hasta, 'DD/MM/YYYY') ELSE '' END
                  || '). Mientras nadie lo revise, NO cuentan como venta en metas, Ventas ni caja.',
                '/ventas',
                jsonb_build_object('origen', 'estado-de-venta-desconocido', 'estado', r.estado,
                                   'facturas', r.facturas, 'monto', r.monto),
                true, NULL);
        END IF;
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$function$;

-- Pendiente MH: una factura que ya no existe en el origen no se puede
-- transmitir (el envío le pide al origen que arme el DTE).
CREATE OR REPLACE FUNCTION public.get_pending_mh_invoices(p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('facturacion','can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN: sin permiso para ver Facturación';
  END IF;

  -- `RETURNS json` + `json_agg` (Patrón C de CLAUDE.md): el tope de 1000 filas
  -- de PostgREST no aplica a un único valor JSON, así que la cola entera viaja
  -- en un viaje y sin bucle de `.range()`. `json_agg`, NUNCA `jsonb_agg` —
  -- jsonb arma el binario completo en memoria y spillea a disco.
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    SELECT si.id, si.branch_id, si.tipo_documento, si.correlativo,
           si.erp_invoice_id, si.cliente, si.fecha, si.hora, si.total,
           si.estado, si.recibido_mh, si.tipo_pago,
           c.categoria AS cliente_categoria
    FROM public.sales_invoices si
    LEFT JOIN public.customers c ON c.id = si.customer_id
    -- Un sello son 40 caracteres. `IS NOT NULL` daba por buena la cadena
    -- 'undefined' y por eso una factura del 16-may-2025 figuró un año como
    -- confirmada; ésta es la misma definición que usa el barrido nocturno.
    WHERE length(si.recibido_mh) IS DISTINCT FROM 40
    -- `<>`/`NOT IN` y no `IS DISTINCT FROM`: con `estado` en NULL la comparación
    -- da NULL y la fila queda afuera, que es lo que hacía el filtro del
    -- navegador. Esas facturas no se pierden — son de la pestaña de
    -- anuladas/estado nulo. Una DESAPARECIDA ya no existe en el origen: no hay
    -- nada que transmitir, y vive en Saltos.
      AND si.estado NOT IN ('NULA', 'DESAPARECIDA EN ORIGEN')
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ORDER BY si.branch_id, si.fecha, si.hora
  ) t;

  RETURN v;
END;
$function$;

-- ── 5. Cerrar el día con la diferencia reconocida ───────────────────────────
-- Regla del usuario (17-oct): si el freno «efectivo sin contar» no se puede
-- satisfacer, la sala puede cerrar igual, SIEMPRE con un motivo de una lista
-- fija. La lista es tabla (regla «un rótulo no es una clave»): la pantalla la
-- lee, el servidor valida contra ella, y lo que se guarda es el `id`.
CREATE TABLE IF NOT EXISTS public.caja_motivos_cierre_con_diferencia (
    id         text PRIMARY KEY,
    rotulo     text NOT NULL,
    orden      smallint NOT NULL DEFAULT 0,
    activo     boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.caja_motivos_cierre_con_diferencia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS caja_motivos_cierre_select ON public.caja_motivos_cierre_con_diferencia;
CREATE POLICY caja_motivos_cierre_select ON public.caja_motivos_cierre_con_diferencia
    FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.caja_motivos_cierre_con_diferencia FROM anon;

INSERT INTO public.caja_motivos_cierre_con_diferencia (id, rotulo, orden) VALUES
  ('venta_que_la_caja_no_cuenta', 'Una venta del día no aparece en la caja (se eliminó o se ocultó)', 1),
  ('ya_contado',                  'El dinero ya se contó en el último corte', 2),
  ('autorizado_por_supervision',  'Supervisión autorizó cerrar con esta diferencia', 3)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.caja_cierres_con_diferencia (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id    integer NOT NULL REFERENCES public.branches(id),
    fecha        date NOT NULL,
    falta        numeric(12,2) NOT NULL,
    motivo_id    text NOT NULL REFERENCES public.caja_motivos_cierre_con_diferencia(id),
    employee_id  uuid REFERENCES public.employees(id),
    detalle      jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS caja_cierres_con_diferencia_branch_idx
    ON public.caja_cierres_con_diferencia (branch_id, fecha);
CREATE INDEX IF NOT EXISTS caja_cierres_con_diferencia_motivo_idx
    ON public.caja_cierres_con_diferencia (motivo_id);
ALTER TABLE public.caja_cierres_con_diferencia ENABLE ROW LEVEL SECURITY;
-- Append-only: lo escribe `hacer-corte-caja` con la llave del servidor. Sin
-- policy de escritura para nadie más.
DROP POLICY IF EXISTS caja_cierres_con_diferencia_select ON public.caja_cierres_con_diferencia;
CREATE POLICY caja_cierres_con_diferencia_select ON public.caja_cierres_con_diferencia
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('caja_vales', 'can_view')));
REVOKE ALL ON public.caja_cierres_con_diferencia FROM anon;
