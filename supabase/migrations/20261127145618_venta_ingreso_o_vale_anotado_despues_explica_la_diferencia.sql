-- Una venta, un ingreso o un vale anotado DESPUÉS explica la diferencia de un
-- corte anterior, y el sistema mueve el efectivo (2026-11-27).
--
-- Salud 2, 26-nov: el corte de las 19:04 cerró con +$11.85. Se vendió un
-- producto y no se facturó. Facturarlo hoy suma $11.85 a lo esperado de la caja
-- de HOY, pero ese efectivo está en la bolsa de AYER: hoy saldría un faltante
-- y el sobrante de ayer seguiría abierto. La salida que había era pasar el
-- dinero a mano de una bolsa cerrada a la caja de hoy (decisión del usuario:
-- «mejor que el sistema haga los movimientos de efectivo, así no se toca el
-- dinero de los cortes anteriores»). Es el mismo razonamiento que el pago de
-- Mapfre sin anotar (20261107173943), generalizado.
--
-- Ahora la causa encontrada de una diferencia puede ligar el DOCUMENTO que se
-- anotó después:
--   · sobrante → una venta en efectivo o un ingreso en efectivo;
--   · faltante → un vale en efectivo.
-- El documento es de un día POSTERIOR al del corte (hasta 7 días). Lo que
-- explica deja de contar en lo esperado de los cortes de SU día: el dinero se
-- queda en la bolsa donde está y nadie mueve efectivo.
--
--   · `cortes_caja_diferencias.documento_*`: qué documento y cuándo pasó. Sin
--     FK: `sales_invoices` es tabla caliente. Índices únicos parciales: un
--     documento explica una sola diferencia viva.
--   · `efectivo_de_otro_corte(sala, día, hora)`: el canónico. Con signo: una
--     venta o un ingreso RESTA de lo esperado, un vale SUMA.
--   · `cortes_caja.efectivo_otro_corte`: el sello en la fila, igual que
--     `cobros_portal_efectivo` y por el mismo motivo (ocho lugares leen un
--     corte). Lo escriben dos triggers.
--   · `corte_diferencia` gana el octavo argumento; sus cinco llamadores lo pasan.
--   · `caja_efectivo_piezas` descuenta lo mismo por día: sin eso el freno
--     «efectivo sin contar» del cierre vería $11.85 que nunca entraron.
--   · `documentos_para_explicar_corte` y `explicar_diferencia_con_documentos`.
-- Anular la resolución libera el documento y lo devuelve a lo esperado de su
-- día (todo mira `anulada_at IS NULL`).
SET lock_timeout = '5s';

-- ── 1. El documento, en la resolución ───────────────────────────────────────
ALTER TABLE public.cortes_caja_diferencias
  ADD COLUMN IF NOT EXISTS documento_tipo text,
  ADD COLUMN IF NOT EXISTS documento_invoice_id bigint,
  ADD COLUMN IF NOT EXISTS documento_movimiento_id bigint,
  ADD COLUMN IF NOT EXISTS documento_fecha date,
  ADD COLUMN IF NOT EXISTS documento_hora time;

ALTER TABLE public.cortes_caja_diferencias
  DROP CONSTRAINT IF EXISTS cortes_caja_diferencias_documento_ck;
ALTER TABLE public.cortes_caja_diferencias
  ADD CONSTRAINT cortes_caja_diferencias_documento_ck CHECK (
    documento_tipo IS NULL
    OR (via = 'JUSTIFICA'
        AND documento_fecha IS NOT NULL AND documento_hora IS NOT NULL
        AND ((documento_tipo = 'VENTA' AND documento_invoice_id IS NOT NULL AND documento_movimiento_id IS NULL)
          OR (documento_tipo IN ('INGRESO', 'VALE') AND documento_movimiento_id IS NOT NULL AND documento_invoice_id IS NULL))));

COMMENT ON COLUMN public.cortes_caja_diferencias.documento_tipo IS
  'VENTA / INGRESO / VALE anotado en un día posterior que explica esta causa. Lo que explica deja de contar en lo esperado de los cortes de ese día (efectivo_de_otro_corte).';
COMMENT ON COLUMN public.cortes_caja_diferencias.documento_invoice_id IS
  'La venta (sales_invoices.id). Sin FK a propósito: sales_invoices es tabla caliente.';
COMMENT ON COLUMN public.cortes_caja_diferencias.documento_movimiento_id IS
  'El ingreso o vale (caja_movimientos_portal.id).';

CREATE UNIQUE INDEX IF NOT EXISTS cortes_caja_diferencias_venta_viva
  ON public.cortes_caja_diferencias (documento_invoice_id)
  WHERE documento_invoice_id IS NOT NULL AND anulada_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cortes_caja_diferencias_movimiento_vivo
  ON public.cortes_caja_diferencias (documento_movimiento_id)
  WHERE documento_movimiento_id IS NOT NULL AND anulada_at IS NULL;
CREATE INDEX IF NOT EXISTS cortes_caja_diferencias_documento_dia
  ON public.cortes_caja_diferencias (branch_id, documento_fecha)
  WHERE documento_tipo IS NOT NULL AND anulada_at IS NULL;

-- ── 2. El canónico ──────────────────────────────────────────────────────────
-- Cuánto efectivo que los documentos de ese día traen a lo esperado NO está en
-- esta caja porque se cobró en un corte anterior. Con signo: positivo = hay que
-- RESTARLO de lo esperado (venta, ingreso); negativo = hay que SUMARLO (vale).
-- Cuenta lo que la causa EXPLICA (`monto`), no el total del documento: una
-- venta de $15 que explica $11.85 trajo $3.15 que sí están en la caja de hoy.
CREATE OR REPLACE FUNCTION public.efectivo_de_otro_corte(
    p_branch integer, p_fecha date, p_hasta time
) RETURNS numeric LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    SELECT coalesce(sum(CASE WHEN d.documento_tipo = 'VALE' THEN -abs(d.monto)
                             ELSE abs(d.monto) END), 0)::numeric(12,2)
      FROM public.cortes_caja_diferencias d
     WHERE d.branch_id = p_branch
       AND d.documento_fecha = p_fecha
       AND d.documento_tipo IS NOT NULL
       AND d.anulada_at IS NULL
       AND d.documento_hora <= p_hasta
$$;
REVOKE EXECUTE ON FUNCTION public.efectivo_de_otro_corte(integer, date, time) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.efectivo_de_otro_corte(integer, date, time) TO authenticated, service_role;

-- ── 3. El sello en la fila del corte ────────────────────────────────────────
ALTER TABLE public.cortes_caja
  ADD COLUMN IF NOT EXISTS efectivo_otro_corte numeric(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.cortes_caja.efectivo_otro_corte IS
  'Efectivo que el comprobante cuenta en lo esperado y está en un corte ANTERIOR (una venta, ingreso o vale ligado a la causa de su diferencia). Se RESTA de lo esperado; negativo = se suma. Lo sella un trigger, no el cliente.';

CREATE OR REPLACE FUNCTION public.cortes_caja_sella_cobros_portal()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
    NEW.cobros_portal_efectivo :=
        public.cobros_portal_en_efectivo(NEW.branch_id, NEW.fecha, NEW.hora);
    NEW.efectivo_otro_corte :=
        public.efectivo_de_otro_corte(NEW.branch_id, NEW.fecha, NEW.hora);
    RETURN NEW;
END $$;

-- La otra mitad: cuando nace, cambia o se anula una resolución con documento,
-- se re-sellan los cortes del día del documento.
CREATE OR REPLACE FUNCTION public.diferencias_resella_cortes()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
    v_dia record;
BEGIN
    FOR v_dia IN
        SELECT DISTINCT x.branch_id::integer AS branch_id, x.fecha
          FROM (VALUES (NEW.branch_id, NEW.documento_fecha),
                       (CASE WHEN TG_OP = 'UPDATE' THEN OLD.branch_id END,
                        CASE WHEN TG_OP = 'UPDATE' THEN OLD.documento_fecha END)) x(branch_id, fecha)
         WHERE x.fecha IS NOT NULL
    LOOP
        UPDATE public.cortes_caja c
           SET efectivo_otro_corte = public.efectivo_de_otro_corte(c.branch_id, c.fecha, c.hora)
         WHERE c.branch_id = v_dia.branch_id
           AND c.fecha = v_dia.fecha
           AND c.efectivo_otro_corte IS DISTINCT FROM
                 public.efectivo_de_otro_corte(c.branch_id, c.fecha, c.hora);
    END LOOP;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS diferencias_resella_cortes ON public.cortes_caja_diferencias;
CREATE TRIGGER diferencias_resella_cortes
    AFTER INSERT OR UPDATE OF anulada_at, monto, documento_tipo, documento_fecha, documento_hora
    ON public.cortes_caja_diferencias
    FOR EACH ROW EXECUTE FUNCTION public.diferencias_resella_cortes();

-- ── 4. El juez de la diferencia, con la pieza nueva ─────────────────────────
-- Se quita la de siete argumentos: con las dos vivas, una llamada de siete
-- sería ambigua. La nueva tiene `DEFAULT 0` para que nada que llame con siete
-- se rompa; los cinco llamadores de abajo pasan la columna.
DROP FUNCTION IF EXISTS public.corte_diferencia(numeric, numeric, numeric, numeric, numeric, numeric, numeric);
CREATE OR REPLACE FUNCTION public.corte_diferencia(
    p_declarado numeric, p_dif_erp numeric, p_total_caja numeric, p_subtotal numeric,
    p_vales numeric, p_cobros_tk numeric, p_cobros_portal numeric,
    p_otro_corte numeric DEFAULT 0)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT CASE
        -- Sin las tres piezas no hay dos cifras que contrastar: queda la del
        -- formulario, que es todo lo que hay. Misma rama que `contraste`
        -- devolviendo `null` y `diferenciaDelCorte` cayendo a «guardada».
        WHEN p_declarado IS NULL OR p_dif_erp IS NULL OR p_total_caja IS NULL
            THEN coalesce(p_dif_erp, 0)
        ELSE round(
            p_declarado - (
                p_total_caja
                -- Lo que entro al cajon y el comprobante NO conto. Se resta lo
                -- que YA conto para no sumarlo dos veces, y el piso en cero es
                -- deliberado: si el comprobante conto MAS que el portal, son
                -- cobros hechos en la pantalla de la caja —que el portal no ve—
                -- y no un hallazgo.
                + greatest(0, round(
                    coalesce(p_cobros_portal, 0)
                    - CASE
                        WHEN p_subtotal IS NOT NULL AND p_vales IS NOT NULL
                            THEN round(p_total_caja - p_subtotal + p_vales, 2)
                        ELSE coalesce(p_cobros_tk, 0)
                      END, 2))
                -- Lo que el comprobante cuenta y se cobro en un corte anterior
                -- (2026-11-27): no esta en este cajon. Con signo.
                - coalesce(p_otro_corte, 0)
            ), 2)
    END;
$function$;
REVOKE EXECUTE ON FUNCTION public.corte_diferencia(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.corte_diferencia(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) TO authenticated, service_role;

-- corte_tramo: partir de la viva; sólo pasa la columna nueva.
CREATE OR REPLACE FUNCTION public.corte_tramo(p_corte_id bigint)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v      public.cortes_caja;
    v_dif  numeric;
    v_base numeric;
BEGIN
    SELECT * INTO v FROM public.cortes_caja WHERE id = p_corte_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El corte no existe.'; END IF;
    IF v.tipo <> 'C' THEN RAISE EXCEPTION 'El cierre del dia no tiene tramo.'; END IF;
    IF public.corte_no_conto_efectivo(v.tipo, v.total_declarado, v.diferencia_erp, v.tk_total_caja) THEN
        RAISE EXCEPTION 'Este corte no conto el efectivo: no tiene diferencia que medir.';
    END IF;

    v_dif := public.corte_diferencia(v.total_declarado, v.diferencia_erp, v.tk_total_caja,
                                     v.tk_subtotal, v.tk_vales, v.tk_cobros_credito,
                                     v.cobros_portal_efectivo, v.efectivo_otro_corte);

    -- La base es el ultimo CONFIRMADO anterior. Los sin conteo no pueden serlo
    -- —`resolver_corte_caja` ya no los deja confirmar— asi que no hace falta
    -- excluirlos aca: la condicion de estado alcanza.
    SELECT public.corte_diferencia(c2.total_declarado, c2.diferencia_erp, c2.tk_total_caja,
                                   c2.tk_subtotal, c2.tk_vales, c2.tk_cobros_credito,
                                   c2.cobros_portal_efectivo, c2.efectivo_otro_corte)
      INTO v_base
      FROM public.cortes_caja c2
     WHERE c2.branch_id = v.branch_id
       AND c2.fecha     = v.fecha
       AND c2.tipo      = 'C'
       AND c2.estado    = 'CONFIRMADO'
       AND (c2.hora, c2.id) < (v.hora, v.id)
     ORDER BY c2.hora DESC, c2.id DESC
     LIMIT 1;

    RETURN round(v_dif - coalesce(v_base, 0), 2);
END;
$function$;

-- caja_falta_contra_corte: partir de la viva; sólo pasa la columna nueva.
CREATE OR REPLACE FUNCTION public.caja_falta_contra_corte(p_branch_id integer, p_dia date, p_corte_id bigint, p_piezas json DEFAULT NULL::json)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ap     numeric;
  v_pz     json := p_piezas;
  v_espera numeric;
  v_c      public.cortes_caja%ROWTYPE;
  v_medido numeric;
BEGIN
  IF v_pz IS NULL THEN
    SELECT round(coalesce(a.monto_apertura, 0), 2) INTO v_ap
      FROM public.cortes_caja_aperturas a
     WHERE a.branch_id = p_branch_id AND a.abierta_el = p_dia
     ORDER BY a.turno DESC, a.id DESC
     LIMIT 1;
    -- Las mismas piezas que la pantalla usa para «cuánto hay en el cajón», pero
    -- SIN restar las bolsas: acá se pregunta cuánto ENTRÓ en total, no cuánto
    -- quedó suelto. Un solo sitio arma la suma.
    v_pz := public.caja_efectivo_piezas(p_branch_id, p_dia, coalesce(v_ap, 0));
  END IF;

  v_espera := round( (v_pz->>'apertura')::numeric
                   + (v_pz->>'ventas_efectivo')::numeric
                   + (v_pz->>'entradas')::numeric
                   - (v_pz->>'vales')::numeric, 2);

  -- El corte lo elige quien pregunta. Sin corte = todavía no se midió nada.
  IF p_corte_id IS NOT NULL THEN
    SELECT * INTO v_c
      FROM public.cortes_caja c
     WHERE c.id = p_corte_id AND c.branch_id = p_branch_id AND c.fecha = p_dia;
  END IF;

  IF p_corte_id IS NULL OR NOT FOUND THEN
    RETURN json_build_object(
      'medido', true, 'hay_corte', false, 'desde', NULL,
      'espera', v_espera, 'ya_medido', 0,
      'falta', greatest(0, v_espera));
  END IF;

  IF v_c.tk_total_caja IS NULL THEN
    RETURN json_build_object(
      'medido', false, 'hay_corte', true,
      'desde', to_char(v_c.hora, 'HH24:MI'),
      'espera', v_espera, 'ya_medido', NULL, 'falta', NULL);
  END IF;

  -- Lo que el corte dio por medido se DESPEJA del canónico, no se copia su
  -- fórmula: `declarado − corte_diferencia(...)`.
  v_medido := round(v_c.total_declarado - public.corte_diferencia(
      v_c.total_declarado, v_c.diferencia_erp, v_c.tk_total_caja,
      v_c.tk_subtotal, v_c.tk_vales, v_c.tk_cobros_credito,
      v_c.cobros_portal_efectivo, v_c.efectivo_otro_corte), 2);

  RETURN json_build_object(
    'medido', true, 'hay_corte', true,
    'desde', to_char(v_c.hora, 'HH24:MI'),
    'espera', v_espera, 'ya_medido', v_medido,
    'falta', round(v_espera - v_medido, 2));
END;
$function$;

-- caja_efectivo_piezas: partir de la viva. Lo que un documento de HOY explica
-- en un corte anterior no entró a este cajón: sale de su pieza (venta, entrada
-- o vale). Sin esto, el freno «efectivo sin contar» del cierre y el «cuánto hay
-- en el cajón» de Mi caja verían dinero que está en la bolsa de otro día.
CREATE OR REPLACE FUNCTION public.caja_efectivo_piezas(p_branch_id integer, p_dia date, p_apertura numeric DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ef  numeric; v_ne  numeric;
  v_ent numeric; v_sal numeric;
  v_emb numeric; v_val numeric; v_bol numeric;
  v_ent_ne numeric;
  v_ap  numeric := round(coalesce(p_apertura, 0), 2);
  v_ot_venta numeric; v_ot_ent numeric; v_ot_vale numeric;
BEGIN
  SELECT round(coalesce(sum(si.total) FILTER (WHERE coalesce(si.tipo_pago,'') =  'efectivo'), 0), 2),
         round(coalesce(sum(si.total) FILTER (WHERE coalesce(si.tipo_pago,'') <> 'efectivo'), 0), 2)
    INTO v_ef, v_ne
    FROM public.sales_invoices si
   WHERE si.branch_id = p_branch_id AND si.fecha = p_dia
     AND public.venta_valida(si.estado);

  -- El espejo del origen MÁS lo que el portal escribió y el espejo todavía no
  -- vio. Sin la segunda mitad, un ingreso anotado hace treinta segundos no
  -- está; sin comparar por `erp_movimiento_id`, estaría dos veces.
  -- Y de la mitad del portal, sólo el EFECTIVO: un ingreso con tarjeta o
  -- transferencia nunca va a la caja ni al cajón (2026-10-17).
  WITH mov AS (
      SELECT m.tipo, m.monto
        FROM public.cortes_caja_movimientos m
       WHERE m.branch_id = p_branch_id AND m.fecha = p_dia
         AND m.desaparecido_at IS NULL
      UNION ALL
      SELECT p.tipo, p.monto
        FROM public.caja_movimientos_portal p
       WHERE p.branch_id = p_branch_id AND p.fecha = p_dia
         AND p.anulado_at IS NULL
         AND p.forma_pago = 'EFECTIVO'
         AND (p.erp_movimiento_id IS NULL
              OR NOT EXISTS (SELECT 1 FROM public.cortes_caja_movimientos m2
                              WHERE m2.branch_id = p.branch_id
                                AND m2.erp_movimiento_id = p.erp_movimiento_id))
  )
  SELECT round(coalesce(sum(monto) FILTER (WHERE tipo = 'ENTRADA'), 0), 2),
         round(coalesce(sum(monto) FILTER (WHERE tipo = 'SALIDA'),  0), 2)
    INTO v_ent, v_sal
    FROM mov;

  -- Lo que se cobró en un corte anterior (2026-11-27). Mismo filtro que
  -- `efectivo_de_otro_corte`, sin la hora: las piezas son «hasta ahora».
  SELECT round(coalesce(sum(abs(d.monto)) FILTER (WHERE d.documento_tipo = 'VENTA'),   0), 2),
         round(coalesce(sum(abs(d.monto)) FILTER (WHERE d.documento_tipo = 'INGRESO'), 0), 2),
         round(coalesce(sum(abs(d.monto)) FILTER (WHERE d.documento_tipo = 'VALE'),    0), 2)
    INTO v_ot_venta, v_ot_ent, v_ot_vale
    FROM public.cortes_caja_diferencias d
   WHERE d.branch_id = p_branch_id AND d.documento_fecha = p_dia
     AND d.documento_tipo IS NOT NULL AND d.anulada_at IS NULL;

  v_ef  := round(v_ef  - v_ot_venta, 2);
  v_ent := round(v_ent - v_ot_ent, 2);
  v_sal := round(v_sal - v_ot_vale, 2);

  SELECT round(coalesce(sum(p.monto), 0), 2) INTO v_ent_ne
    FROM public.caja_movimientos_portal p
   WHERE p.branch_id = p_branch_id AND p.fecha = p_dia
     AND p.anulado_at IS NULL AND p.forma_pago <> 'EFECTIVO';

  SELECT round(coalesce(sum(b.monto_inicial), 0), 2) INTO v_emb
    FROM public.bolsas b
   WHERE b.branch_id = p_branch_id AND b.fecha = p_dia AND b.estado <> 'ANULADA';

  SELECT round(coalesce(sum(v.monto), 0), 2) INTO v_val
    FROM public.caja_vales_portal v
   WHERE v.branch_id = p_branch_id AND v.fecha = p_dia
     AND v.estado IN ('ANOTADO', 'CERRADO');

  -- Lo que queda DENTRO de las bolsas de hoy. Con piso en cero por el hueco de
  -- unos segundos entre que el vale se escribe en el origen y su fila existe
  -- acá: sin él, ese instante inventaría dinero en el cajón.
  v_bol := greatest(0, round(v_emb - v_val, 2));

  RETURN json_build_object(
      'apertura',           v_ap,
      'ventas_efectivo',    v_ef,
      'ventas_no_efectivo', v_ne,
      'entradas',           v_ent,
      -- Ingresos con tarjeta o transferencia: se informan, no están en el cajón.
      'entradas_no_efectivo', v_ent_ne,
      'vales',              v_sal,
      'en_bolsas',          v_bol,
      -- Las dos piezas de las que sale `en_bolsas`, para poder auditar la
      -- resta sin volver a correrla.
      'embolsado_hoy',      v_emb,
      'vales_ya_anotados',  v_val,
      -- Lo que ya se descontó de venta, entradas y vales porque se cobró en un
      -- corte anterior. Se informa para poder auditar la resta.
      'de_otro_corte',      json_build_object('ventas', v_ot_venta, 'entradas', v_ot_ent, 'vales', v_ot_vale),
      'efectivo', greatest(0, round(v_ap + v_ef + v_ent - v_sal - v_bol, 2))
  );
END;
$function$;

-- ── 5. Elegir el documento ──────────────────────────────────────────────────
-- Los mismos frenos de `resolver_diferencia_corte`: ver resolver, y sin alcance
-- ALL sólo la propia sala.
CREATE OR REPLACE FUNCTION public.documentos_para_explicar_corte(p_corte_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_corte  public.cortes_caja;
    v_tramo  numeric;
    v_resta  numeric;
    v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_hasta  date;
    v_docs   json;
BEGIN
    IF NOT (SELECT auth_has_module_permission('cortes_caja_resolver', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_corte_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El corte no existe.'; END IF;
    IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
       AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF v_corte.tipo <> 'C' OR v_corte.estado = 'DESCARTADO' THEN
        RETURN json_build_object('tramo', NULL, 'pendiente', 0, 'documentos', '[]'::json);
    END IF;

    v_tramo := public.corte_tramo(p_corte_id);
    SELECT round(abs(v_tramo) - coalesce(sum(abs(d.monto)), 0), 2) INTO v_resta
      FROM public.cortes_caja_diferencias d
     WHERE d.corte_id = p_corte_id AND d.anulada_at IS NULL;
    v_hasta := least(v_hoy, v_corte.fecha + 7);

    IF v_tramo >= 0.01 THEN
        -- Dinero de más: una venta en efectivo o un ingreso en efectivo que se
        -- anotó después.
        SELECT coalesce(json_agg(x ORDER BY x.fecha DESC, x.hora DESC), '[]'::json) INTO v_docs FROM (
            SELECT 'VENTA'::text AS tipo, si.id,
                   coalesce(nullif(ltrim(split_part(si.correlativo, '_', 1), '0'), ''), si.correlativo) AS numero,
                   round(si.total, 2) AS monto, si.fecha, si.hora, si.cliente AS detalle
              FROM public.sales_invoices si
             WHERE si.branch_id = v_corte.branch_id
               AND si.fecha > v_corte.fecha AND si.fecha <= v_hasta
               AND public.venta_valida(si.estado)
               AND coalesce(si.tipo_pago, '') = 'efectivo'
               AND NOT EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                                WHERE d.documento_invoice_id = si.id AND d.anulada_at IS NULL)
            UNION ALL
            SELECT 'INGRESO', p.id,
                   coalesce(p.erp_movimiento_id, p.id)::text,
                   round(p.monto, 2), p.fecha,
                   (coalesce(p.registrado_at, p.created_at) AT TIME ZONE 'America/El_Salvador')::time,
                   coalesce(nullif(btrim(p.concepto), ''), p.tipo_codigo)
              FROM public.caja_movimientos_portal p
             WHERE p.branch_id = v_corte.branch_id
               AND p.fecha > v_corte.fecha AND p.fecha <= v_hasta
               AND p.tipo = 'ENTRADA' AND p.forma_pago = 'EFECTIVO'
               AND p.anulado_at IS NULL
               AND coalesce(p.tipo_codigo, '') <> 'ABONO_FALTANTE'
               AND NOT EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                                WHERE d.documento_movimiento_id = p.id AND d.anulada_at IS NULL)
        ) x;
    ELSIF v_tramo <= -0.01 THEN
        -- Dinero de menos: un vale en efectivo que se anotó después.
        SELECT coalesce(json_agg(x ORDER BY x.fecha DESC, x.hora DESC), '[]'::json) INTO v_docs FROM (
            SELECT 'VALE'::text AS tipo, p.id,
                   coalesce(p.erp_movimiento_id, p.id)::text AS numero,
                   round(p.monto, 2) AS monto, p.fecha,
                   (coalesce(p.registrado_at, p.created_at) AT TIME ZONE 'America/El_Salvador')::time AS hora,
                   coalesce(nullif(btrim(p.concepto), ''), p.tipo_codigo) AS detalle
              FROM public.caja_movimientos_portal p
             WHERE p.branch_id = v_corte.branch_id
               AND p.fecha > v_corte.fecha AND p.fecha <= v_hasta
               AND p.tipo = 'SALIDA' AND p.forma_pago = 'EFECTIVO'
               AND p.anulado_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                                WHERE d.documento_movimiento_id = p.id AND d.anulada_at IS NULL)
        ) x;
    END IF;

    RETURN json_build_object(
        'tramo', v_tramo,
        'pendiente', greatest(0, v_resta),
        'desde', v_corte.fecha + 1,
        'hasta', v_hasta,
        'documentos', coalesce(v_docs, '[]'::json));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.documentos_para_explicar_corte(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.documentos_para_explicar_corte(bigint) TO authenticated, service_role;

-- ── 6. Ligar los documentos ─────────────────────────────────────────────────
-- Una resolución JUSTIFICA por documento, todas en la misma transacción, por
-- `resolver_diferencia_corte` (permisos, candado del corte, monto del servidor
-- y tope de lo que queda viven ahí y no se copian). Cada documento explica lo
-- que trae o lo que queda, lo que sea menor.
CREATE OR REPLACE FUNCTION public.explicar_diferencia_con_documentos(
    p_corte_id bigint, p_monto_esperado numeric, p_documentos jsonb, p_causa text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_corte  public.cortes_caja;
    v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_doc    jsonb;
    v_tipo   text;
    v_id     bigint;
    v_si     public.sales_invoices%ROWTYPE;
    v_mv     public.caja_movimientos_portal%ROWTYPE;
    v_monto  numeric;
    v_fecha  date;
    v_hora   time;
    v_ref    text;
    v_causa  text;
    v_tramo  numeric;
    v_resta  numeric;
    v_parte  numeric;
    v_dif    public.cortes_caja_diferencias;
    v_ids    bigint[] := ARRAY[]::bigint[];
    v_vistos text[]   := ARRAY[]::text[];
    v_otro   record;
BEGIN
    IF NOT (SELECT auth_has_module_permission('cortes_caja_resolver', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_documentos IS NULL OR jsonb_typeof(p_documentos) <> 'array' OR jsonb_array_length(p_documentos) = 0 THEN
        RAISE EXCEPTION 'Elige al menos una venta, un ingreso o un vale.';
    END IF;

    SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_corte_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El corte no existe.'; END IF;
    IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
       AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF v_corte.tipo <> 'C' THEN
        RAISE EXCEPTION 'El cierre del dia no tiene diferencia que resolver.';
    END IF;
    v_tramo := public.corte_tramo(p_corte_id);

    FOR v_doc IN SELECT value FROM jsonb_array_elements(p_documentos) LOOP
        v_tipo := upper(coalesce(v_doc->>'tipo', ''));
        v_id   := (v_doc->>'id')::bigint;
        IF v_id IS NULL OR v_tipo NOT IN ('VENTA', 'INGRESO', 'VALE') THEN
            RAISE EXCEPTION 'Documento invalido.';
        END IF;
        IF (v_tipo || ':' || v_id) = ANY (v_vistos) THEN
            RAISE EXCEPTION 'El mismo documento va dos veces.';
        END IF;
        v_vistos := v_vistos || (v_tipo || ':' || v_id);

        IF v_tipo IN ('VENTA', 'INGRESO') AND v_tramo < 0 THEN
            RAISE EXCEPTION 'Este corte tiene faltante: una venta o un ingreso sólo explica dinero de más.';
        END IF;
        IF v_tipo = 'VALE' AND v_tramo > 0 THEN
            RAISE EXCEPTION 'Este corte tiene sobrante: un vale sólo explica dinero de menos.';
        END IF;

        IF v_tipo = 'VENTA' THEN
            SELECT * INTO v_si FROM public.sales_invoices WHERE id = v_id;
            IF NOT FOUND THEN RAISE EXCEPTION 'Esa venta no existe.'; END IF;
            IF v_si.branch_id <> v_corte.branch_id THEN RAISE EXCEPTION 'Esa venta es de otra sucursal.'; END IF;
            IF NOT public.venta_valida(v_si.estado) THEN RAISE EXCEPTION 'Esa venta está anulada.'; END IF;
            IF coalesce(v_si.tipo_pago, '') <> 'efectivo' THEN
                RAISE EXCEPTION 'Esa venta no fue en efectivo: su dinero no está en ninguna caja.';
            END IF;
            v_monto := round(v_si.total, 2);
            v_fecha := v_si.fecha;
            v_hora  := v_si.hora;
            v_ref   := 'Fac ' || coalesce(nullif(ltrim(split_part(v_si.correlativo, '_', 1), '0'), ''), v_si.correlativo);
        ELSE
            SELECT * INTO v_mv FROM public.caja_movimientos_portal WHERE id = v_id;
            IF NOT FOUND THEN RAISE EXCEPTION 'Ese movimiento no existe.'; END IF;
            IF v_mv.branch_id <> v_corte.branch_id THEN RAISE EXCEPTION 'Ese movimiento es de otra sucursal.'; END IF;
            IF v_mv.anulado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese movimiento está anulado.'; END IF;
            IF v_mv.forma_pago IS DISTINCT FROM 'EFECTIVO' THEN
                RAISE EXCEPTION 'Ese movimiento no fue en efectivo: no pasó por la caja.';
            END IF;
            -- Entre paréntesis: sin ellos plpgsql toma el THEN del CASE por el del IF.
            IF v_mv.tipo IS DISTINCT FROM (CASE v_tipo WHEN 'INGRESO' THEN 'ENTRADA' ELSE 'SALIDA' END) THEN
                RAISE EXCEPTION 'Ese movimiento no es un %.', lower(v_tipo);
            END IF;
            IF v_tipo = 'INGRESO' AND v_mv.tipo_codigo = 'ABONO_FALTANTE' THEN
                RAISE EXCEPTION 'Un abono a un faltante no explica un sobrante.';
            END IF;
            v_monto := round(v_mv.monto, 2);
            v_fecha := v_mv.fecha;
            v_hora  := (coalesce(v_mv.registrado_at, v_mv.created_at) AT TIME ZONE 'America/El_Salvador')::time;
            v_ref   := initcap(v_tipo) || ' ' || coalesce(v_mv.erp_movimiento_id, v_mv.id)::text;
        END IF;

        IF v_fecha <= v_corte.fecha THEN
            RAISE EXCEPTION 'Ese documento es del día del corte o de antes: ya estaba en esa caja.';
        END IF;
        IF v_fecha > v_hoy OR v_fecha > v_corte.fecha + 7 THEN
            RAISE EXCEPTION 'Ese documento es de más de 7 días después del corte.';
        END IF;
        IF v_monto < 0.01 THEN RAISE EXCEPTION 'Ese documento no tiene monto.'; END IF;

        IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                    WHERE d.anulada_at IS NULL
                      AND ((v_tipo = 'VENTA' AND d.documento_invoice_id = v_id)
                        OR (v_tipo <> 'VENTA' AND d.documento_movimiento_id = v_id))) THEN
            RAISE EXCEPTION '% ya explica otra diferencia.', v_ref;
        END IF;

        -- Ligarlo cambia lo esperado de los cortes de su día desde esa hora. Si
        -- alguno ya tiene su diferencia resuelta, esa resolución quedaría sobre
        -- un número que ya no es: primero se anula.
        SELECT c.hora INTO v_otro
          FROM public.cortes_caja c
         WHERE c.branch_id = v_corte.branch_id AND c.fecha = v_fecha
           AND c.tipo = 'C' AND c.estado <> 'DESCARTADO' AND c.hora >= v_hora
           AND EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                        WHERE d.corte_id = c.id AND d.anulada_at IS NULL)
         ORDER BY c.hora LIMIT 1;
        IF FOUND THEN
            RAISE EXCEPTION 'El corte de las % del % ya tiene su diferencia resuelta y este documento cambia lo que se esperaba en él. Anula esa resolución primero.',
                public.hora_12(v_otro.hora), to_char(v_fecha, 'DD/MM');
        END IF;

        SELECT round(abs(v_tramo) - coalesce(sum(abs(d.monto)), 0), 2) INTO v_resta
          FROM public.cortes_caja_diferencias d
         WHERE d.corte_id = p_corte_id AND d.anulada_at IS NULL;
        IF v_resta < 0.01 AND coalesce(array_length(v_ids, 1), 0) = 0 THEN
            RAISE EXCEPTION 'Esta diferencia ya está explicada.';
        ELSIF v_resta < 0.01 THEN
            RAISE EXCEPTION 'Con los documentos anteriores ya se explica toda la diferencia. Quita %.', v_ref;
        END IF;
        v_parte := least(v_monto, v_resta);

        v_causa := coalesce(nullif(btrim(coalesce(p_causa, '')), ''),
            CASE v_tipo WHEN 'VENTA'   THEN 'Se facturó después'
                        WHEN 'INGRESO' THEN 'El ingreso se anotó después'
                        ELSE                'El vale se anotó después' END
            || ', el ' || to_char(v_fecha, 'DD/MM'));

        v_dif := public.resolver_diferencia_corte(
            p_corte_id, 'JUSTIFICA', v_causa, p_monto_esperado, '[]'::jsonb,
            v_ref, NULL, v_parte, NULL);

        UPDATE public.cortes_caja_diferencias
           SET documento_tipo = v_tipo,
               documento_invoice_id = CASE WHEN v_tipo = 'VENTA' THEN v_id END,
               documento_movimiento_id = CASE WHEN v_tipo <> 'VENTA' THEN v_id END,
               documento_fecha = v_fecha,
               documento_hora = v_hora
         WHERE id = v_dif.id;

        v_ids := v_ids || v_dif.id;
    END LOOP;

    RETURN json_build_object('ok', true, 'diferencias', to_json(v_ids));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.explicar_diferencia_con_documentos(bigint, numeric, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.explicar_diferencia_con_documentos(bigint, numeric, jsonb, text) TO authenticated, service_role;

-- ── 7. Los otros tres llamadores del juez ───────────────────────────────────
-- Son largos (avisos del día y Mi caja) y el cambio es pasar UNA columna más,
-- así que se parte de la definición VIVA en el momento de aplicar y se cambia
-- sólo esa llamada. Si la llamada no está como se espera, se aborta: un
-- llamador sin la columna seguiría andando (el argumento tiene DEFAULT 0) y
-- daría otra cifra en silencio.
DO $$
DECLARE
    v_def   text;
    v_nuevo text;
BEGIN
    v_def := pg_get_functiondef('public.avisar_cierre_del_dia(date,boolean)'::regprocedure);
    v_nuevo := regexp_replace(v_def,
        'c\.cobros_portal_efectivo\),(\s*)2\)(\s+)AS diferencia',
        'c.cobros_portal_efectivo, c.efectivo_otro_corte),\12)\2AS diferencia');
    IF v_nuevo = v_def THEN RAISE EXCEPTION 'avisar_cierre_del_dia: no se encontró la llamada a corte_diferencia'; END IF;
    EXECUTE v_nuevo;

    v_def := pg_get_functiondef('public.avisar_diferencia_de_ayer(date)'::regprocedure);
    v_nuevo := regexp_replace(v_def,
        'c\.cobros_portal_efectivo\),(\s*)2\)(\s+)AS acum',
        'c.cobros_portal_efectivo, c.efectivo_otro_corte),\12)\2AS acum');
    IF v_nuevo = v_def THEN RAISE EXCEPTION 'avisar_diferencia_de_ayer: no se encontró la llamada a corte_diferencia'; END IF;
    EXECUTE v_nuevo;

    -- Mi caja: la columna viaja con cada corte (la lee `contraste` en la
    -- pantalla) y entra en la diferencia del juez.
    v_def := pg_get_functiondef('public.caja_estado(integer)'::regprocedure);
    v_nuevo := regexp_replace(v_def,
        '(\s+)cobros_portal_efectivo,(\s+)CASE',
        '\1cobros_portal_efectivo, efectivo_otro_corte,\2CASE');
    v_nuevo := regexp_replace(v_nuevo,
        'tk_cobros_credito,(\s+)cobros_portal_efectivo\)',
        'tk_cobros_credito,\1cobros_portal_efectivo, efectivo_otro_corte)');
    IF v_nuevo = v_def OR position('efectivo_otro_corte)' IN v_nuevo) = 0
       OR position('efectivo_otro_corte,' IN v_nuevo) = 0 THEN
        RAISE EXCEPTION 'caja_estado: no se encontraron las dos piezas a cambiar';
    END IF;
    EXECUTE v_nuevo;
END $$;
