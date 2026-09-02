-- Promociones — el excedente: lo vendido por encima del lote.
--
-- Decisión del usuario (2026-09-01): «notifica a supervisión, si aprueba se
-- pagan. si no, se deja constancia de la razón». Y mientras nadie decide, esas
-- unidades **se muestran aparte y no suman** — nadie ve un número que después le
-- baja.
--
-- ── Dónde se corta el lote, y por qué el orden importa ──────────────────────
-- El lote se agota en un instante concreto: la unidad 500 se vendió un día a una
-- hora. Todo lo que viene después es excedente. Eso significa que **el orden de
-- las ventas decide quién queda del otro lado del corte**, y no hay forma de
-- evitarlo: es la consecuencia de que el lote sea finito.
--
-- Lo que sí se evita es que esa persona pierda el bono en silencio. Por eso el
-- excedente no se descarta ni se paga solo: queda registrado con nombre y monto,
-- y alguien decide.
--
-- ── La sutileza de la unidad ────────────────────────────────────────────────
-- El lote está en unidades BASE y el bono se paga en la unidad de la
-- presentación elegida. Una venta que cae justo sobre el corte queda partida, y
-- su parte pagable hay que PRORRATEARLA — si no, media caja se pagaría entera o
-- se perdería entera. Se hace con la razón `u_pago / u_base` de esa misma línea.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- promocion_corte_del_lote — qué parte de lo vendido entra en el lote
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.promocion_corte_del_lote(p_promocion_id bigint DEFAULT NULL)
RETURNS TABLE (
    renglon_id      bigint,
    promocion_id    bigint,
    cod_vendedor    text,
    employee_id     uuid,
    branch_id       bigint,
    u_dentro        numeric,
    u_excedente     numeric,
    monto_dentro    numeric,
    monto_excedente numeric
)
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
     WHERE p_promocion_id IS NULL OR r.promocion_id = p_promocion_id;

    IF v_ini IS NULL THEN RETURN; END IF;

    RETURN QUERY
    WITH facturas AS MATERIALIZED (
        SELECT si.id, si.branch_id, si.cod_vendedor, si.fecha
          FROM public.sales_invoices si
         WHERE si.fecha >= v_ini AND si.fecha <= v_fin
           AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    ),
    items AS MATERIALIZED (
        SELECT ii.id, ii.invoice_id, ii.erp_product_id, ii.factor_unidades, ii.cantidad
          FROM public.sales_invoice_items ii
         WHERE ii.erp_product_id = ANY (v_prods)
    ),
    lineas AS (
        SELECT r.id AS renglon_id, r.promocion_id, r.lote_total,
               f.id AS invoice_id, i.id AS item_id,
               f.branch_id, f.cod_vendedor, f.fecha,
               (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric AS u_base,
               CASE WHEN r.factor_unidades IS NULL
                    THEN (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric
                    ELSE i.cantidad::numeric
               END AS u_pago
          FROM items i
          JOIN facturas f ON f.id = i.invoice_id
          JOIN public.promocion_renglon r
            ON r.erp_product_id = i.erp_product_id
           AND f.fecha BETWEEN r.inicio AND r.fin
           AND (r.factor_unidades IS NULL OR i.factor_unidades = r.factor_unidades)
           AND (p_promocion_id IS NULL OR r.promocion_id = p_promocion_id)
         WHERE NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v
                            WHERE v.invoice_id = f.id)
    ),
    con_tarifa AS (
        SELECT l.*, t.bono_vendedor
          FROM lineas l
          JOIN LATERAL (
              SELECT tt.bono_vendedor FROM public.promocion_renglon_tarifa tt
               WHERE tt.renglon_id = l.renglon_id AND tt.desde <= l.fecha
               ORDER BY tt.desde DESC LIMIT 1
          ) t ON true
    ),
    -- El acumulado en el ORDEN en que se vendió. `item_id` desempata dos ventas
    -- del mismo día para que el corte sea estable entre corridas: sin él, dos
    -- llamadas podrían partir la misma línea en lugares distintos.
    ordenadas AS (
        SELECT c.*,
               sum(c.u_base) OVER (PARTITION BY c.renglon_id
                                   ORDER BY c.fecha, c.invoice_id, c.item_id
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acum
          FROM con_tarifa c
    ),
    partidas AS (
        SELECT o.*,
               -- Cuánto de ESTA línea cabe todavía en el lote.
               greatest(least(o.u_base, o.lote_total - (o.acum - o.u_base)), 0) AS cabe
          FROM ordenadas o
    )
    SELECT p.renglon_id, p.promocion_id, p.cod_vendedor,
           e.id, p.branch_id,
           sum(p.cabe),
           sum(p.u_base - p.cabe),
           -- El prorrateo: la parte pagable de una línea partida sale de la
           -- razón entre su unidad de pago y su unidad base.
           round(sum(p.cabe            * (p.u_pago / nullif(p.u_base,0)) * p.bono_vendedor), 2),
           round(sum((p.u_base - p.cabe) * (p.u_pago / nullif(p.u_base,0)) * p.bono_vendedor), 2)
      FROM partidas p
      LEFT JOIN public.employees e
             ON e.code = p.cod_vendedor AND e.status = 'ACTIVO'
     GROUP BY p.renglon_id, p.promocion_id, p.cod_vendedor, e.id, p.branch_id
    HAVING sum(p.u_base) > 0;
END;
$function$;

COMMENT ON FUNCTION public.promocion_corte_del_lote(bigint) IS
  'Parte lo vendido de cada persona en «dentro del lote» y «excedente», cortando en el orden en que se vendió. Una línea que cae sobre el corte se PRORRATEA: el lote está en unidades base y el bono se paga en la unidad de la presentación.';

ALTER FUNCTION public.promocion_corte_del_lote(bigint) SET plan_cache_mode = 'force_custom_plan';

REVOKE EXECUTE ON FUNCTION public.promocion_corte_del_lote(bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.promocion_corte_del_lote(bigint) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- promociones_registrar_excedentes — abre la cola, sin repetir
-- ─────────────────────────────────────────────────────────────────────────────
-- Sólo registra excedentes de quien TIENE dueño: si el código de la factura no
-- da con nadie activo, ese bono no se paga y no hay a quién preguntarle. Va en
-- la fila «sin dueño» del seguimiento, no en la cola de decisión.
CREATE OR REPLACE FUNCTION public.promociones_registrar_excedentes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_n integer := 0;
BEGIN
    WITH nuevos AS (
        INSERT INTO public.promocion_excedente
            (renglon_id, employee_id, branch_id, unidades, monto)
        SELECT c.renglon_id, c.employee_id, c.branch_id,
               floor(c.u_excedente)::integer, c.monto_excedente
          FROM public.promocion_corte_del_lote(NULL) c
          JOIN public.promocion_renglon r ON r.id = c.renglon_id
          JOIN public.promociones pm      ON pm.id = r.promocion_id
         WHERE c.employee_id IS NOT NULL
           AND c.u_excedente >= 1
           AND pm.estado <> 'borrador'
        -- La misma persona no entra dos veces por el mismo renglón: si vendió
        -- más después, se actualiza el monto MIENTRAS nadie haya decidido.
        ON CONFLICT (renglon_id, employee_id) DO UPDATE
           SET unidades = EXCLUDED.unidades,
               monto    = EXCLUDED.monto
         WHERE promocion_excedente.estado = 'por_decidir'
        RETURNING 1
    )
    SELECT count(*)::integer INTO v_n FROM nuevos;
    RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.promociones_registrar_excedentes() IS
  'Abre (o actualiza) la cola de excedentes. Sólo de quien tiene dueño: lo que no se puede atribuir no tiene a quién preguntarle. Una decisión ya tomada no se pisa.';

REVOKE EXECUTE ON FUNCTION public.promociones_registrar_excedentes() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.promociones_registrar_excedentes() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_excedentes — la cola, para la pantalla
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_excedentes(p_estado text DEFAULT 'por_decidir')
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_out json;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_view') THEN
        RETURN NULL;
    END IF;

    SELECT coalesce(json_agg(to_json(x) ORDER BY x.created_at DESC), '[]'::json)
      INTO v_out
      FROM (
        SELECT ex.id, ex.unidades, ex.monto, ex.estado, ex.motivo,
               ex.decidido_at, ex.created_at,
               e.name  AS persona,
               b.name  AS sala,
               p.nombre AS producto,
               pm.id    AS promocion_id,
               pm.nombre AS promocion,
               r.lote_total,
               d.name  AS decidido_por
          FROM public.promocion_excedente ex
          JOIN public.promocion_renglon r  ON r.id  = ex.renglon_id
          JOIN public.promociones       pm ON pm.id = r.promocion_id
          JOIN public.products          p  ON p.id  = r.erp_product_id
          JOIN public.employees         e  ON e.id  = ex.employee_id
          LEFT JOIN public.branches     b  ON b.id  = ex.branch_id
          LEFT JOIN public.employees    d  ON d.id  = ex.decidido_por
         WHERE p_estado IS NULL OR ex.estado = p_estado
      ) x;

    RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.get_excedentes(text) IS
  'La cola de excedentes por decidir, con quién vendió, cuánto y de qué promoción.';

-- ─────────────────────────────────────────────────────────────────────────────
-- decidir_excedente — aprobar paga; negar EXIGE el motivo
-- ─────────────────────────────────────────────────────────────────────────────
-- Negar sin decir por qué deja a la persona sin nada que reclamar, así que el
-- motivo es obligatorio para negar — el mismo freno que ya tiene devolver una
-- meta y decidir una diferencia de pedido.
CREATE OR REPLACE FUNCTION public.decidir_excedente(
    p_id      bigint,
    p_aprobar boolean,
    p_motivo  text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
        RAISE EXCEPTION 'MOTIVO_REQUERIDO: decí por qué no se paga, que lo va a leer quien vendió';
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

COMMENT ON FUNCTION public.decidir_excedente(bigint, boolean, text) IS
  'Aprueba o niega un excedente. Negar exige el motivo: sin él la persona se queda sin nada que reclamar. Avisa a quien vendió en los dos casos.';

REVOKE EXECUTE ON FUNCTION public.get_excedentes(text)                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decidir_excedente(bigint, boolean, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_excedentes(text)                 TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.decidir_excedente(bigint, boolean, text) TO authenticated, service_role;
