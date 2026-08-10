SET lock_timeout = '5s';

-- ── El rechazo de Hacienda que ya no se arregla solo es una observación ────
--
-- Decisión del usuario, 2026-08-09: *«si tienen observaciones (no tienen sello,
-- las que después de corregir, y volver a enviar y aun así no se envían) que
-- estén ahí, para poder ver y corregirlas»*.
--
-- No es una regla nueva: es la que la pestaña ya tenía, aplicada hasta el
-- final. La frontera entre Pendiente MH y Observaciones nunca fue «tiene sello
-- o no» — está escrita en `fetchPendingMhInvoices`, y es **¿se resuelve solo o
-- hay que tocarlo?**:
--
--   «un sello presente pero corrupto NO es una espera. Esa factura no va a
--    cambiar sola por más que pase el plazo — hay que corregirla —, así que su
--    lugar es Observaciones.»
--
-- Una factura que Hacienda rechazó, que el circuito ya corrigió, reenvió, y que
-- volvió a rebotar, por esa misma definición **no es una espera**. Hoy se queda
-- en Pendiente MH indistinguible de las que sí van a entrar esta noche, y su
-- motivo —lo único que permite corregirla— sólo existe en la bitácora, en JSON.
--
-- ── Por qué NO es el viejo `SIN_SELLO_VENCIDO` ────────────────────────────
-- Ese código existió y se quitó a propósito (migración 20260731203801): marcaba
-- «sin sello + vencido el plazo», que sí es una espera y sí es Pendiente MH.
-- Éste no mira el plazo: mira que **Hacienda ya contestó que no** y que el
-- reintento automático ya se ejercitó. Son poblaciones distintas y la anterior
-- sigue sin emitirse. Anotado acá para que no se relea el comentario de aquella
-- migración y se deshaga ésta.
--
-- ── Cuándo entra ──────────────────────────────────────────────────────────
--   · sin sello VÁLIDO (length <> 40, NULL incluido — el tipo manda), y
--   · el último intento ante Hacienda no trajo sello, y
--   · alguna de estas dos:
--       – el motivo NO es accionable (`fecEmi`, `emisor.*`, sin ruta): el
--         circuito no lo corrige nunca, por diseño. Por el criterio literal del
--         usuario no aparecería jamás; por su intención —verla para poder
--         hacer algo— es justamente la que más necesita un humano.
--       – es accionable pero ya se intentó ≥ 2 veces: la segunda vuelta corrige
--         y reenvía la MISMA noche, así que un segundo rechazo ya es «se
--         corrigió y no alcanzó».
--
-- Un rechazo accionable con un solo intento NO entra: está en curso, lo va a
-- tomar la corrida de esta noche. Avisar de algo que se está arreglando solo es
-- cómo se entrena a la gente a ignorar la pestaña.
--
-- Las excluidas del barrido (`dte_excluidas_del_barrido`, decisión de negocio)
-- quedan fuera: nunca van a tener sello, y una fila que no se puede resolver ni
-- descartar es ruido permanente.
--
-- ── El motivo viaja como TEXTO ────────────────────────────────────────────
-- `motivos_mh` es nuevo en el retorno. Un código no dice qué corregir: hay que
-- leer lo que contestó Hacienda. Se unen `observaciones` y `descripcion_msg`
-- porque **3 de cada 4 rechazos vinieron sólo en el segundo** (medido al armar
-- `dte_rechazos_vigentes`).

DROP FUNCTION IF EXISTS public.get_invoice_observations(date, date, bigint, integer);

CREATE FUNCTION public.get_invoice_observations(
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
            -- Hacienda contestó que no, y el reintento automático ya se agotó.
            -- `IS DISTINCT FROM 40` cubre el NULL: sin sello y sin sello válido
            -- son la misma cosa acá, que es toda la lección de §5 del doc.
            CASE WHEN r.invoice_id IS NOT NULL
                  AND length(si.recibido_mh) IS DISTINCT FROM 40
                  AND (NOT r.accionable OR r.intentos_sin_sello >= 2)
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

-- El DROP se llevó los grants: se reponen idénticos a los que tenía
-- (authenticated + service_role, nunca anon).
REVOKE EXECUTE ON FUNCTION public.get_invoice_observations(date, date, bigint, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_invoice_observations(date, date, bigint, integer) TO authenticated, service_role;


-- ── El cuarto sitio del mismo defecto ─────────────────────────────────────
-- `dte_rechazos_vigentes` nació en el arreglo que enseñó que «sin sello»
-- significa **sin sello válido**… y filtra `recibido_mh IS NULL OR = ''`, que
-- es el test flojo. Una factura con `recibido_mh = 'undefined'` —los 40
-- caracteres que no están— desaparece de la vista y por lo tanto del conteo de
-- rechazos accionables que dispara la segunda vuelta.
--
-- Hoy no esconde nada: 0 sellos basura sobre 344,852 facturas, medido antes de
-- esta migración. Es el cuarto sitio de los tres de §5, y se cierra ahora
-- porque el día que vuelva a aparecer uno nadie va a estar mirando.
CREATE OR REPLACE VIEW public.dte_rechazos_vigentes
WITH (security_invoker = true) AS
 WITH ultimo AS (
         SELECT DISTINCT ON (i.invoice_id) i.id,
            i.invoice_id, i.erp_invoice_id, i.correlativo, i.branch_id, i.bolsa,
            i.ok, i.sello, i.codigo_msg, i.descripcion_msg, i.observaciones,
            i.fh_procesamiento, i.error, i.correccion, i.created_at
           FROM dte_mh_intentos i
          WHERE i.sello IS NULL
          ORDER BY i.invoice_id, i.created_at DESC
        ), con_motivo AS (
         SELECT u.invoice_id, u.correlativo, u.branch_id, u.codigo_msg,
            u.created_at, m.motivo
           FROM ultimo u
             CROSS JOIN LATERAL unnest(array_remove(COALESCE(u.observaciones, '{}'::text[]) || COALESCE(u.descripcion_msg, ''::text), ''::text)) m(motivo)
        )
 SELECT cm.invoice_id, cm.correlativo, cm.branch_id, cm.codigo_msg,
    cm.created_at AS ultimo_intento, cm.motivo,
    c2.familia, c2.ruta, c2.campo_ficha, c2.accionable,
    cl.id AS customer_id, cl.erp_id, cl.name AS cliente, cl.categoria,
    cl.departamento, cl.municipio, cl.distrito, cl.dui
   FROM con_motivo cm
     CROSS JOIN LATERAL clasificar_observacion_mh(cm.motivo) c2(familia, ruta, campo_ficha, accionable)
     LEFT JOIN sales_invoices si ON si.id = cm.invoice_id
     LEFT JOIN customers cl ON cl.id = si.customer_id
  WHERE length(si.recibido_mh) IS DISTINCT FROM 40
    AND NOT (EXISTS ( SELECT 1
           FROM dte_excluidas_del_barrido e
          WHERE e.invoice_id = cm.invoice_id));
