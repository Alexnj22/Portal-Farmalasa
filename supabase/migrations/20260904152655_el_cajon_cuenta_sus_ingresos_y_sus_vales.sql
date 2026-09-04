SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE ENTRA Y SALE DEL CAJÓN TAMBIÉN ES EFECTIVO DEL DÍA
--
-- ── El defecto, reportado desde la sala (4-sep) ────────────────────────────
-- «en caja no debería haber $118.75 sumando el dolar de ingreso?»
--
-- Salud 1 esa mañana: apertura $0.00, ventas en efectivo $117.75, y una prueba
-- de glucosa de $1.00 anotada a las 07:56. En el cajón había $118.75 y el
-- portal decía $117.75 — ni la tarjeta «En la caja» ni el panel del día
-- contaban ese dólar, porque NINGUNA de las dos piezas de las que salían lo
-- incluye:
--
--   * `registrado` = apertura + ventas FINALIZADAS del día. Medido el 3-sep
--     contra el panel del origen: seis salas, exacto al centavo, y el residuo
--     de las entradas y salidas dio `entradas − salidas` — o sea que el panel
--     del origen TAMPOCO las cuenta ahí.
--   * `caja_efectivo_piezas` sólo le quitaba las ventas que no fueron en
--     efectivo y lo ya embolsado.
--
-- Así que todo lo que el cajón recibe o entrega fuera de una venta —una
-- aplicación de inyección, una prueba de glucosa, el pago de un recibo, un
-- abono a un crédito, una compra urgente, una remesa— quedaba fuera de la
-- cuenta del portal. El comprobante del corte SÍ los cuenta
-- (`TOTAL CAJA = ingresos + venta − vales + cobros`), así que el descuadre
-- aparecía recién al cortar y sin decir de dónde venía.
--
-- ── De dónde salen, y por qué NO del espejo del portal ─────────────────────
-- `caja_movimientos_portal` guarda lo que anotó el PORTAL, que es un
-- subconjunto: el 3-sep el origen tenía 98 movimientos y el portal 94; el
-- 31-ago, 187 y CERO. Sumar de ahí daría un número que crece a medida que la
-- gente use el portal y que hoy sería casi siempre cero — «no miré» leído como
-- «no había».
--
-- La fuente es `cortes_caja_movimientos`, el espejo del origen que
-- `sync-cortes-caja` refresca cada 30 s. Enfrentado contra el comprobante en
-- los 90 últimos cortes de día (20-ago → 3-sep):
--
--     ENTRADA sin «POR ABONO A CREDITO»  =  tk_ingresos        90 de 90
--     SALIDA                             =  tk_vales           90 de 90
--     ENTRADA «POR ABONO A CREDITO»      =  tk_cobros_credito  87 de 90
--
-- O sea que es EXACTAMENTE lo que el papel llama INGRESOS y VALES. Los abonos
-- entran a la suma sin una línea aparte a propósito: son billetes en el cajón
-- igual que los otros, y sólo aparecen los que se cobraron en efectivo —los de
-- transferencia no dejan movimiento (verificado en los 12 abonos del portal:
-- los 6 en efectivo tienen su movimiento, los 6 de transferencia no).
--
-- Se le suman los del portal que TODAVÍA no están en el espejo (hasta ~4 min
-- de atraso), sin contarlos dos veces: se comparan por `erp_movimiento_id`.
-- Y los `desaparecido_at` NO cuentan: el origen no anula movimientos, los
-- borra, y contar uno borrado inventa dinero.
--
-- ── `en_bolsas` reemplaza a `embolsado_hoy − vales_ya_anotados` ────────────
-- Es la misma resta con otro nombre, y el nombre importa porque ahora se
-- muestra en pantalla: lo que queda DENTRO de las bolsas de hoy. La plata que
-- se embolsó salió del cajón; la que después se pagó desde una bolsa ya no
-- está en ninguno de los dos, y su vale es una SALIDA del origen que este
-- cálculo ya resta por el otro lado. Restar las dos la contaría dos veces.
--
-- ── La apertura entra como parámetro ──────────────────────────────────────
-- Antes se recibía `registrado` (= apertura + ventas) y se le quitaban las
-- ventas que no fueron en efectivo. Con la apertura y las ventas en efectivo
-- por separado, la cuenta que se muestra en pantalla SUMA a la vista —cada
-- renglón es una pieza y el total es su suma—, que es lo que pidió el usuario:
-- «debe mostrar todo, ahí mismo debe decir + Ingresos y − Vales».
-- ═══════════════════════════════════════════════════════════════════════════

-- La firma cambia, así que la vieja se va: dejarlas conviviendo haría que la
-- llamada por nombre de PostgREST quedara ambigua («function is not unique»),
-- que es el modo de falla del que ya avisa CLAUDE.md con las sobrecargas.
DROP FUNCTION IF EXISTS public.caja_efectivo_piezas(integer, date);

CREATE OR REPLACE FUNCTION public.caja_efectivo_piezas(
    p_branch_id integer, p_dia date, p_apertura numeric DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ef  numeric; v_ne  numeric;
  v_ent numeric; v_sal numeric;
  v_emb numeric; v_val numeric; v_bol numeric;
  v_ap  numeric := round(coalesce(p_apertura, 0), 2);
BEGIN
  SELECT round(coalesce(sum(si.total) FILTER (WHERE coalesce(si.tipo_pago,'') =  'efectivo'), 0), 2),
         round(coalesce(sum(si.total) FILTER (WHERE coalesce(si.tipo_pago,'') <> 'efectivo'), 0), 2)
    INTO v_ef, v_ne
    FROM public.sales_invoices si
   WHERE si.branch_id = p_branch_id AND si.fecha = p_dia
     AND si.estado = 'FINALIZADA';

  -- El espejo del origen MÁS lo que el portal escribió y el espejo todavía no
  -- vio. Sin la segunda mitad, un ingreso anotado hace treinta segundos no
  -- está; sin comparar por `erp_movimiento_id`, estaría dos veces.
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
         AND (p.erp_movimiento_id IS NULL
              OR NOT EXISTS (SELECT 1 FROM public.cortes_caja_movimientos m2
                              WHERE m2.branch_id = p.branch_id
                                AND m2.erp_movimiento_id = p.erp_movimiento_id))
  )
  SELECT round(coalesce(sum(monto) FILTER (WHERE tipo = 'ENTRADA'), 0), 2),
         round(coalesce(sum(monto) FILTER (WHERE tipo = 'SALIDA'),  0), 2)
    INTO v_ent, v_sal
    FROM mov;

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
      'vales',              v_sal,
      'en_bolsas',          v_bol,
      -- Las dos piezas de las que sale `en_bolsas`, para poder auditar la
      -- resta sin volver a correrla.
      'embolsado_hoy',      v_emb,
      'vales_ya_anotados',  v_val,
      'efectivo', greatest(0, round(v_ap + v_ef + v_ent - v_sal - v_bol, 2))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.caja_efectivo_piezas(integer, date, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.caja_efectivo_piezas(integer, date, numeric) TO service_role;

COMMENT ON FUNCTION public.caja_efectivo_piezas(integer, date, numeric) IS
    'Los BILLETES que hay en el cajón, pieza por pieza: apertura + ventas en efectivo + ingresos − vales − lo que quedó en las bolsas de hoy. La usan caja_estado y operar-caja. No se expone a authenticated: ese número es la respuesta del conteo a ciegas del corte.';

-- ── El estado de la caja usa las piezas nuevas ─────────────────────────────
CREATE OR REPLACE FUNCTION public.caja_estado(p_branch_id integer)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
      'error', 'Solo puedes mirar la caja de tu propia sala.');
  END IF;

  SELECT * INTO v_ap
    FROM public.cortes_caja_aperturas a
   WHERE a.branch_id = p_branch_id AND a.cerrada_at IS NULL
   ORDER BY a.abierta_el DESC, a.turno DESC
   LIMIT 1;

  v_dia := coalesce(v_ap.abierta_el, (now() - interval '6 hours')::date);

  SELECT coalesce(json_agg(to_json(c) ORDER BY c.hora), '[]'::json) INTO v_cortes
    FROM (SELECT id, tipo, hora, total_declarado, esperado, diferencia_erp, estado
            FROM public.cortes_caja
           WHERE branch_id = p_branch_id AND fecha = v_dia) c;

  IF v_ap.branch_id IS NULL THEN
    RETURN json_build_object(
      'ok', true, 'abierta', false, 'caja', NULL, 'turno', NULL,
      'turno_corriendo', false, 'registrado', NULL, 'apertura', NULL,
      'quien', NULL, 'desde', NULL, 'dia', v_dia, 'cortes', v_cortes,
      'efectivo', NULL, 'efectivo_piezas', NULL, 'frescura_seg', NULL);
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
   WHERE s.branch_id = p_branch_id AND s.fecha = v_dia AND s.estado = 'FINALIZADA';

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
    'frescura_seg', round(extract(epoch FROM now() - v_ap.vista_at)));
END;
$$;

COMMENT ON FUNCTION public.caja_estado(integer) IS
  'El estado de la caja de una sala armado con datos del portal, sin raspar el sistema de la caja. Reemplaza la acción `estado` de `operar-caja` en el camino crítico de /caja.';

REVOKE EXECUTE ON FUNCTION public.caja_estado(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.caja_estado(integer) TO authenticated, service_role;
