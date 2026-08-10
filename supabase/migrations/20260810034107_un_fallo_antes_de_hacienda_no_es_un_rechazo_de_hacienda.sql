SET lock_timeout = '5s';

-- ── Corrección de la migración anterior (20260810033739) ──────────────────
--
-- La condición decía `NOT accionable OR intentos >= 2`, y `accionable` se
-- calcula preguntándole a `clasificar_observacion_mh` por cada motivo. Sin
-- motivos, el EXISTS da false, o sea **no accionable**, o sea entraba de una.
--
-- Y sin motivos es exactamente la forma de un fallo que ocurrió ANTES de
-- Hacienda: el ERP no armó el documento, la sesión se cayó. Lo dice el propio
-- barrido al registrarlo:
--
--   «Un rechazo DE Hacienda trae sus observaciones enteras; un fallo ANTES de
--    Hacienda no tiene ninguna.»
--
-- Ésos sí se resuelven solos —el barrido de mañana los reintenta y suelen
-- entrar—, así que publicarlos al primer tropiezo es la clase de ruido que
-- enseña a ignorar la pestaña. Justo lo que la regla venía a evitar.
--
-- La condición correcta separa las dos cosas:
--   · hay motivo y NO es accionable  → el circuito no lo va a corregir nunca,
--                                      entra ya (es el caso `fecEmi`)
--   · ≥ 2 intentos sin sello          → se reintentó y no alcanzó, sea cual sea
--                                      la causa. Acá caen los fallos antes de
--                                      Hacienda que resultaron no ser pasajeros
--
-- Ejercitada contra los 7 escenarios (accionable × intentos × forma del sello):
-- el único que cambia de veredicto es «fallo antes de Hacienda, 1 intento»,
-- que pasa de entrar a no entrar. Hoy no cambia ninguna fila real (0 facturas
-- alcanzadas por la regla en ambas versiones); se corrige ahora porque el día
-- que un sync falle dos veces seguidas nadie va a estar mirando esta condición.
--
-- La firma no cambia, así que CREATE OR REPLACE conserva los grants.

CREATE OR REPLACE FUNCTION public.get_invoice_observations(
    p_desde date,
    p_hasta date,
    p_branch_id bigint DEFAULT NULL::bigint,
    p_dias_gracia_sello integer DEFAULT 2
)
RETURNS TABLE(
    id bigint, branch_id bigint, fecha date, tipo_documento text, correlativo text,
    erp_invoice_id text, cliente text, estado text, total numeric, recibido_mh text,
    observaciones text[], motivos_mh text[]
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $function$
    WITH ultimo AS (
        -- El último intento de cada factura. `dte_mh_intentos` es chica (104
        -- filas hoy); se resuelve entera antes de tocar `sales_invoices`, que
        -- tiene 344 mil y se recorre por rango de fecha.
        SELECT DISTINCT ON (i.invoice_id)
               i.invoice_id, i.sello, i.observaciones, i.descripcion_msg
          FROM public.dte_mh_intentos i
         ORDER BY i.invoice_id, i.created_at DESC
    ),
    veces AS (
        SELECT i.invoice_id, count(*) AS intentos_sin_sello
          FROM public.dte_mh_intentos i
         WHERE i.sello IS NULL
         GROUP BY i.invoice_id
    ),
    rechazo AS (
        SELECT u.invoice_id,
               m.motivos,
               v.intentos_sin_sello,
               EXISTS (
                   SELECT 1
                     FROM unnest(m.motivos) t(motivo)
                     CROSS JOIN LATERAL public.clasificar_observacion_mh(t.motivo) c
                    WHERE c.accionable
               ) AS accionable
          FROM ultimo u
          JOIN veces v ON v.invoice_id = u.invoice_id
          CROSS JOIN LATERAL (
              SELECT array_remove(
                         coalesce(u.observaciones, '{}'::text[])
                           || coalesce(u.descripcion_msg, ''::text),
                         ''::text) AS motivos
          ) m
         WHERE u.sello IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM public.dte_excluidas_del_barrido e
                WHERE e.invoice_id = u.invoice_id)
    )
    SELECT si.id, si.branch_id, si.fecha, si.tipo_documento, si.correlativo,
           si.erp_invoice_id, si.cliente, si.estado, si.total, si.recibido_mh,
           obs.observaciones, r.motivos
    FROM public.sales_invoices si
    LEFT JOIN rechazo r ON r.invoice_id = si.id
    CROSS JOIN LATERAL (
        SELECT array_remove(ARRAY[
            -- Sin gracia: un 'undefined' guardado es un defecto desde el
            -- instante cero, no un estado por el que la factura pasa.
            CASE WHEN si.recibido_mh IS NOT NULL AND length(si.recibido_mh) <> 40
                 THEN 'SELLO_INVALIDO' END,
            -- Hacienda contestó que no, y ya no se arregla solo.
            -- `IS DISTINCT FROM 40` cubre el NULL: sin sello y sin sello válido
            -- son la misma cosa acá, que es toda la lección de §5 del doc.
            CASE WHEN r.invoice_id IS NOT NULL
                  AND length(si.recibido_mh) IS DISTINCT FROM 40
                  AND (r.intentos_sin_sello >= 2
                       OR (cardinality(r.motivos) > 0 AND NOT r.accionable))
                 THEN 'RECHAZADA_POR_HACIENDA' END,
            -- Con gracia y CON sello: si tampoco llegó el sello, la factura
            -- está esperando a Hacienda y eso es Pendiente MH, no una anomalía.
            CASE WHEN si.codigo_generacion IS NULL AND si.recibido_mh IS NOT NULL
                  AND si.estado = 'FINALIZADA'
                  AND si.fecha <= current_date - p_dias_gracia_sello
                 THEN 'SIN_CODIGO_VENCIDO' END,
            -- Catch-alls: un valor nuevo se reporta solo.
            CASE WHEN si.estado IS NULL
                   OR si.estado NOT IN ('FINALIZADA', 'DTE INVALIDADO EN MH', 'NULA')
                 THEN 'ESTADO_DESCONOCIDO' END,
            CASE WHEN si.tipo_documento IS NULL
                   OR si.tipo_documento NOT IN ('CCF', 'COF')
                 THEN 'TIPO_DOC_DESCONOCIDO' END,
            CASE WHEN si.correlativo IS NULL OR btrim(si.correlativo) = ''
                 THEN 'SIN_CORRELATIVO' END,
            CASE WHEN si.total IS NULL OR si.total < 0
                 THEN 'TOTAL_INVALIDO' END,
            -- La RETENCIÓN entra en la cuenta: el total ya viene con ella
            -- restada. Sin este término la regla marcaba las 44 facturas con
            -- retención de toda la base y ninguna otra.
            CASE WHEN abs(coalesce(si.subtotal, 0) + coalesce(si.iva, 0)
                          - coalesce(si.retencion, 0) - coalesce(si.total, 0)) > 0.01
                 THEN 'SUMA_NO_CUADRA' END
        ], NULL) AS observaciones
    ) obs
    WHERE si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND cardinality(obs.observaciones) > 0
    ORDER BY si.fecha DESC, si.branch_id, si.correlativo;
$function$;


-- ── Y el aviso de las 8 apuntaba a la vista equivocada ────────────────────
-- `alertar_barrido_dte` dice «el detalle de cada una está en la bitácora» y
-- manda a `/audit`, que en este portal es **Auditoría de Tiempos**. La bitácora
-- es `/auditview`. Era el único `'/audit'` de todas las funciones de la base.
--
-- Ahora que el rechazo tiene pantalla propia, el aviso lleva ahí: la bitácora
-- guarda el JSON de la corrida, pero lo que hace falta para corregir una
-- factura —el motivo, el cliente, el id— está en Observaciones.
CREATE OR REPLACE FUNCTION public.alertar_barrido_dte()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_corrida    public.audit_logs%ROWTYPE;
    v_hubo       boolean;
    v_fallidas   int;
    v_resueltas  int;
    v_restantes  int;
    v_dest       uuid[];
    v_titulo     text;
    v_cuerpo     text;
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
        v_titulo := '🚨 El barrido de Hacienda no corrió anoche';
        v_cuerpo := 'No quedó registro de la corrida de las 22:30. '
                 || 'Las facturas anuladas sin invalidar y las que están sin sello siguen esperando. '
                 || 'Revisá que la función `regularizar-dte` siga desplegada con --no-verify-jwt.';
    ELSE
        v_titulo := '⚠️ El barrido de Hacienda terminó con fallas';
        v_cuerpo := v_fallidas || ' factura' || CASE WHEN v_fallidas = 1 THEN '' ELSE 's' END
                 || ' no se pudo completar ante Hacienda'
                 || CASE WHEN v_resueltas > 0 THEN ', ' || v_resueltas || ' sí' ELSE '' END
                 || '. ' || CASE WHEN v_restantes > 0
                                 THEN 'Quedan ' || v_restantes || ' en cola. ' ELSE '' END
                 || 'Las que ya no se arreglan solas están en Facturación, en Observaciones.';
    END IF;

    PERFORM public.notify_employees(
        v_dest, 'SYSTEM', v_titulo, v_cuerpo, '/facturacion?tab=observaciones',
        jsonb_build_object('origen', 'regularizar-dte',
                           'corrida', v_corrida.id,
                           'fallidas', v_fallidas),
        true, NULL
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.alertar_barrido_dte() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.alertar_barrido_dte() TO service_role;
