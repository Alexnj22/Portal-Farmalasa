-- El pago de Mapfre que se cobró y no se anotó se explica en el corte (2026-11-07).
--
-- Salud 5, 6-nov: el asegurado de la Fac 20312 pagó $34.55 en efectivo y nadie
-- lo anotó. El corte de las 19:18 salió con +$29.55 (34.55 menos $5 de un
-- anticipo que faltó descartar). El cobro normal de Mapfre (`operar-caja`) sólo
-- entra a la caja ABIERTA: hacerlo al día siguiente sumaba $34.55 al esperado
-- de hoy sin que el dinero estuviera en el cajón —está en la bolsa de ayer— y
-- fabricaba un faltante. Y sin cobro, la factura seguía «por cobrar» para
-- siempre, lista para cobrarse dos veces.
--
-- Ahora la causa encontrada de un SOBRANTE puede ligar la factura de Mapfre:
--   · `cortes_caja_diferencias.mapfre_invoice_id` (sin FK: `sales_invoices` es
--     tabla caliente y la FK le pediría lock; lo valida la función).
--   · Índice único parcial: una factura, una sola causa viva.
--   · `resolver_diferencia_corte` gana `p_mapfre_invoice_id`: misma sala, de
--     Mapfre, válida, del día del corte o antes, sin cobro anotado y sólo en un
--     sobrante. El comprobante por defecto es el número de la factura.
--   · `mapfre_facturas` la da por COBRADA, y `mapfre_cotizar` rechaza cobrarla.
--   · `mapfre_facturas_de_corte`: las que esperan el pago, para elegir.
-- Anular la resolución libera la factura (todo mira `anulada_at IS NULL`).
SET lock_timeout = '5s';

ALTER TABLE public.cortes_caja_diferencias ADD COLUMN IF NOT EXISTS mapfre_invoice_id bigint;
COMMENT ON COLUMN public.cortes_caja_diferencias.mapfre_invoice_id IS
  'Factura de Mapfre cuyo pago del asegurado explica esta causa (cobrado sin anotar). Sin FK a propósito: sales_invoices es tabla caliente.';
CREATE UNIQUE INDEX IF NOT EXISTS cortes_caja_diferencias_mapfre_viva
  ON public.cortes_caja_diferencias (mapfre_invoice_id)
  WHERE mapfre_invoice_id IS NOT NULL AND anulada_at IS NULL;

-- ¿La factura ya tiene su pago, por la caja o por una causa? Un solo juez.
CREATE OR REPLACE FUNCTION public.mapfre_ya_cobrada(p_invoice_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.caja_movimientos_portal
                  WHERE invoice_id = p_invoice_id AND tipo_codigo = 'MAPFRE' AND anulado_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.cortes_caja_diferencias
                  WHERE mapfre_invoice_id = p_invoice_id AND anulada_at IS NULL);
$function$;
REVOKE EXECUTE ON FUNCTION public.mapfre_ya_cobrada(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapfre_ya_cobrada(bigint) TO authenticated, service_role;

-- mapfre_cotizar: partir de la viva; sólo cambia el chequeo del cobro.
CREATE OR REPLACE FUNCTION public.mapfre_cotizar(p_branch_id integer, p_invoice_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_si    public.sales_invoices%ROWTYPE;
  v_monto numeric;
  v_n     integer;
BEGIN
  SELECT * INTO v_si FROM public.sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa factura no existe.'; END IF;
  IF v_si.customer_id IS DISTINCT FROM public.mapfre_customer_id() THEN
    RAISE EXCEPTION 'Esa factura no es de Mapfre.';
  END IF;
  IF v_si.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Esa factura es de otra sala.'; END IF;
  IF NOT public.venta_valida(v_si.estado) THEN RAISE EXCEPTION 'Esa factura está anulada.'; END IF;

  SELECT round(sum(i.total_linea), 2), count(*) INTO v_monto, v_n
    FROM public.sales_invoice_items i
   WHERE i.invoice_id = v_si.id AND i.erp_product_id = 0;
  IF v_n = 0 OR coalesce(v_monto, 0) <= 0 THEN
    RAISE EXCEPTION 'Esa factura no trae la parte del asegurado (el descuento con puntos).';
  END IF;

  IF public.mapfre_ya_cobrada(v_si.id) THEN
    RAISE EXCEPTION 'Esa factura de Mapfre ya tiene su pago anotado.';
  END IF;

  RETURN json_build_object('invoice_id', v_si.id, 'correlativo', v_si.correlativo,
                           'fecha', v_si.fecha, 'monto', v_monto, 'total_mapfre', v_si.total);
END $function$;

-- mapfre_facturas: partir de la viva; el cobro puede venir de una causa.
CREATE OR REPLACE FUNCTION public.mapfre_facturas(p_branch_id integer, p_buscar text DEFAULT NULL::text, p_dias integer DEFAULT 60)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  -- Desde que el cobro existe (2026-10-19, decisión del usuario: «que tome en
  -- cuenta desde ahora»). Lo anterior se anotó como «Otro» y no se reabre.
  v_desde  date := greatest(v_hoy - greatest(least(coalesce(p_dias, 60), 120), 0), DATE '2026-10-19');
  v_buscar text := nullif(upper(btrim(coalesce(p_buscar, ''))), '');
  v_mapfre bigint := public.mapfre_customer_id();
  v_out    json;
BEGIN
  IF NOT (SELECT auth_has_module_permission('caja_vales', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce((SELECT auth_module_scope('caja_vales')), '') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_mapfre IS NULL THEN RETURN '[]'::json; END IF;

  WITH f AS (
    SELECT si.id, si.fecha, si.hora, si.correlativo, si.total
      FROM public.sales_invoices si
     WHERE si.branch_id = p_branch_id AND si.customer_id = v_mapfre
       AND si.fecha >= v_desde AND public.venta_valida(si.estado)
  ), d AS (
    SELECT f.*,
           (SELECT round(sum(i.total_linea), 2) FROM public.sales_invoice_items i
             WHERE i.invoice_id = f.id AND i.erp_product_id = 0) AS asegurado,
           (SELECT json_agg(json_build_object('descripcion', i.descripcion, 'cantidad', i.cantidad) ORDER BY i.linea_num)
              FROM public.sales_invoice_items i
             WHERE i.invoice_id = f.id AND i.erp_product_id <> 0) AS productos
      FROM f
  ), c AS (
    SELECT d.*,
           coalesce(
             (SELECT json_build_object('movimiento', m.id, 'monto', m.monto, 'forma_pago', m.forma_pago,
                                       'autorizacion', m.autorizacion, 'registrado_at', m.registrado_at,
                                       'asegurado', cu.name)
                FROM public.caja_movimientos_portal m
                LEFT JOIN public.customers cu ON cu.id = m.customer_id
               WHERE m.invoice_id = d.id AND m.tipo_codigo = 'MAPFRE' AND m.anulado_at IS NULL
               LIMIT 1),
             -- Cobrada sin anotar y explicada en el corte de ese día (2026-11-07).
             (SELECT json_build_object('diferencia', df.id, 'corte', df.corte_id, 'monto', d.asegurado,
                                       'forma_pago', 'EFECTIVO', 'autorizacion', NULL,
                                       'registrado_at', df.registrado_at, 'asegurado', NULL)
                FROM public.cortes_caja_diferencias df
               WHERE df.mapfre_invoice_id = d.id AND df.anulada_at IS NULL
               LIMIT 1)) AS cobro,
           (SELECT json_build_object('movimiento', m.id, 'concepto', m.concepto, 'registrado_at', m.registrado_at)
              FROM public.caja_movimientos_portal m
             WHERE m.branch_id = p_branch_id AND m.fecha = d.fecha AND m.tipo = 'ENTRADA'
               AND m.anulado_at IS NULL AND coalesce(m.tipo_codigo, 'OTRO_ENTRADA') = 'OTRO_ENTRADA'
               AND abs(m.monto - d.asegurado) < 0.01
             ORDER BY m.id LIMIT 1) AS como_otro
      FROM d
     WHERE d.asegurado > 0
  )
  SELECT coalesce(json_agg(json_build_object(
           'id', c.id, 'fecha', c.fecha, 'hora', c.hora, 'correlativo', c.correlativo,
           'total_mapfre', c.total, 'asegurado', c.asegurado, 'productos', c.productos,
           'cobro', c.cobro, 'como_otro', CASE WHEN c.cobro IS NULL THEN c.como_otro END,
           'estado', CASE WHEN c.cobro IS NOT NULL THEN 'COBRADA'
                          WHEN c.como_otro IS NOT NULL THEN 'ANOTADA_COMO_OTRO'
                          ELSE 'POR_COBRAR' END)
         ORDER BY (c.cobro IS NULL AND c.como_otro IS NULL) DESC, c.fecha DESC, c.hora DESC), '[]'::json)
    INTO v_out
    FROM c
   WHERE v_buscar IS NULL
      OR c.correlativo ILIKE '%' || v_buscar || '%'
      OR EXISTS (SELECT 1 FROM json_array_elements(coalesce(c.productos, '[]'::json)) p
                  WHERE upper(p ->> 'descripcion') LIKE '%' || v_buscar || '%');
  RETURN v_out;
END $function$;

-- Las facturas de Mapfre que un corte puede explicar: de su sala, hasta su
-- día, desde que el cobro existe, y que nadie cobró ni anotó como «Otro».
CREATE OR REPLACE FUNCTION public.mapfre_facturas_de_corte(p_corte_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_corte  public.cortes_caja;
  v_mapfre bigint := public.mapfre_customer_id();
BEGIN
  IF NOT (SELECT auth_has_module_permission('cortes_caja_resolver', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_corte_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El corte no existe.'; END IF;
  IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
     AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_mapfre IS NULL THEN RETURN '[]'::json; END IF;

  RETURN (
    WITH f AS (
      SELECT si.id, si.fecha, si.hora, si.correlativo,
             (SELECT round(sum(i.total_linea), 2) FROM public.sales_invoice_items i
               WHERE i.invoice_id = si.id AND i.erp_product_id = 0) AS asegurado
        FROM public.sales_invoices si
       WHERE si.branch_id = v_corte.branch_id AND si.customer_id = v_mapfre
         AND si.fecha BETWEEN greatest(v_corte.fecha - 30, DATE '2026-10-19') AND v_corte.fecha
         AND public.venta_valida(si.estado)
    )
    SELECT coalesce(json_agg(json_build_object('id', f.id, 'fecha', f.fecha, 'hora', f.hora,
                                               'correlativo', f.correlativo, 'asegurado', f.asegurado)
                             ORDER BY f.fecha DESC, f.hora DESC), '[]'::json)
      FROM f
     WHERE f.asegurado > 0
       AND NOT public.mapfre_ya_cobrada(f.id)
       AND NOT EXISTS (SELECT 1 FROM public.caja_movimientos_portal m
                        WHERE m.branch_id = v_corte.branch_id AND m.fecha = f.fecha AND m.tipo = 'ENTRADA'
                          AND m.anulado_at IS NULL AND coalesce(m.tipo_codigo, 'OTRO_ENTRADA') = 'OTRO_ENTRADA'
                          AND abs(m.monto - f.asegurado) < 0.01)
  );
END $function$;
REVOKE EXECUTE ON FUNCTION public.mapfre_facturas_de_corte(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapfre_facturas_de_corte(bigint) TO authenticated, service_role;

-- resolver_diferencia_corte: la firma cambia, así que la vieja se BORRA (si no,
-- queda una sobrecarga con sus propios permisos). Cuerpo: el vivo + Mapfre.
DROP FUNCTION IF EXISTS public.resolver_diferencia_corte(bigint, text, text, numeric, jsonb, text, text, numeric);
CREATE FUNCTION public.resolver_diferencia_corte(p_corte_id bigint, p_via text, p_causa text, p_monto_esperado numeric, p_personas jsonb DEFAULT '[]'::jsonb, p_evidencia_ref text DEFAULT NULL::text, p_evidencia_foto text DEFAULT NULL::text, p_monto numeric DEFAULT NULL::numeric, p_mapfre_invoice_id bigint DEFAULT NULL::bigint)
 RETURNS cortes_caja_diferencias
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_corte    public.cortes_caja;
    v_scope    text;
    v_monto    numeric;
    v_cubierto numeric;
    v_resta    numeric;
    v_parte    numeric;
    v_dif      public.cortes_caja_diferencias;
    v_suma     numeric;
    v_cuenta   integer;
    v_ajeno    text;
    v_ref      text := NULLIF(btrim(coalesce(p_evidencia_ref, '')), '');
    v_foto     text := NULLIF(btrim(coalesce(p_evidencia_foto, '')), '');
    v_mapfre   json;
BEGIN
    IF NOT (SELECT auth_has_module_permission('cortes_caja_resolver', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_via NOT IN ('REPONE','RETIRA','JUSTIFICA') THEN
        RAISE EXCEPTION 'Via invalida: %', p_via;
    END IF;

    IF p_causa IS NULL OR btrim(p_causa) = '' THEN
        RAISE EXCEPTION 'Resolver una diferencia exige decir la causa.';
    END IF;

    IF p_mapfre_invoice_id IS NOT NULL AND p_via <> 'JUSTIFICA' THEN
        RAISE EXCEPTION 'Un pago de Mapfre sin anotar se liga a una causa encontrada.';
    END IF;

    -- El candado del corte serializa a dos personas resolviendo a la vez: sin
    -- él, dos causas parciales podrían sumar más que el tramo.
    SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_corte_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El corte no existe.'; END IF;

    v_scope := (SELECT auth_module_scope('cortes_caja'));
    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    -- La factura de Mapfre (2026-11-07): la valida `mapfre_cotizar` —de Mapfre,
    -- de esta sala, válida, con parte del asegurado y sin cobro—, y además
    -- tiene que ser del día del corte o de antes. Ella es el comprobante.
    IF p_mapfre_invoice_id IS NOT NULL THEN
        v_mapfre := public.mapfre_cotizar(v_corte.branch_id, p_mapfre_invoice_id);
        IF (v_mapfre->>'fecha')::date > v_corte.fecha THEN
            RAISE EXCEPTION 'Esa factura de Mapfre es posterior al corte: su pago no pudo estar en este cajón.';
        END IF;
        v_ref := coalesce(v_ref, 'Mapfre Fac ' || coalesce(nullif(ltrim(split_part(v_mapfre->>'correlativo', '_', 1), '0'), ''), v_mapfre->>'correlativo'));
    END IF;

    -- Decidido con el usuario el 2026-09-25: una causa encontrada se respalda.
    IF p_via = 'JUSTIFICA' AND v_ref IS NULL AND v_foto IS NULL THEN
        RAISE EXCEPTION 'Una causa encontrada necesita su comprobante: el numero del documento que se corrigio o una foto.';
    END IF;

    IF v_corte.tipo <> 'C' THEN
        RAISE EXCEPTION 'El cierre del dia no tiene diferencia que resolver.';
    END IF;

    IF v_corte.estado = 'DESCARTADO' THEN
        RAISE EXCEPTION 'Un corte descartado no tiene diferencia que reponer.';
    END IF;

    -- El monto lo pone el servidor. Ver el encabezado de 20260814211953.
    v_monto := public.corte_tramo(p_corte_id);

    IF abs(v_monto) < 0.01 THEN
        RAISE EXCEPTION 'Este corte cuadra: no hay diferencia que resolver.';
    END IF;

    IF p_monto_esperado IS NULL OR abs(v_monto - p_monto_esperado) >= 0.01 THEN
        RAISE EXCEPTION 'La diferencia cambio mientras se resolvia: ahora es %, no %. Hay que abrirla de nuevo.',
            to_char(v_monto, 'FM999999990.00'), to_char(coalesce(p_monto_esperado, 0), 'FM999999990.00');
    END IF;

    -- Un pago que entró sin anotarse deja dinero DE MÁS: sólo explica un sobrante.
    IF p_mapfre_invoice_id IS NOT NULL AND v_monto < 0 THEN
        RAISE EXCEPTION 'Este corte tiene faltante: un pago de Mapfre sin anotar sólo explica un sobrante.';
    END IF;

    IF p_via = 'REPONE' AND v_monto > 0 THEN
        RAISE EXCEPTION 'Este corte tiene sobrante: no hay nada que reponer.';
    END IF;
    IF p_via = 'RETIRA' AND v_monto < 0 THEN
        RAISE EXCEPTION 'Este corte tiene faltante: no hay nada que retirar.';
    END IF;

    -- Lo que ya está cubierto por las resoluciones vivas, y lo que queda.
    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.corte_id = p_corte_id AND d.anulada_at IS NULL
                  AND d.via <> 'JUSTIFICA') THEN
        RAISE EXCEPTION 'Este corte ya tiene su diferencia resuelta.';
    END IF;

    SELECT coalesce(sum(abs(d.monto)), 0) INTO v_cubierto
      FROM public.cortes_caja_diferencias d
     WHERE d.corte_id = p_corte_id AND d.anulada_at IS NULL;

    v_resta := round(abs(v_monto) - v_cubierto, 2);
    IF v_resta < 0.01 THEN
        RAISE EXCEPTION 'Este corte ya tiene su diferencia resuelta.';
    END IF;

    -- Sin `p_monto`, la resolución cubre todo lo que queda: es lo que hacía
    -- antes, y lo que siguen mandando las pantallas viejas en caché.
    v_parte := round(abs(coalesce(p_monto, v_resta)), 2);

    IF p_via = 'JUSTIFICA' THEN
        IF v_parte < 0.01 THEN
            RAISE EXCEPTION 'Hay que decir cuanto explica la causa.';
        END IF;
        IF v_parte - v_resta >= 0.01 THEN
            RAISE EXCEPTION 'La causa explica % y quedan % por explicar: no puede explicar mas de lo que queda.',
                to_char(v_parte, 'FM999999990.00'), to_char(v_resta, 'FM999999990.00');
        END IF;
    ELSIF abs(v_parte - v_resta) >= 0.01 THEN
        -- La vía que mueve dinero cierra el corte: va por lo que queda, justo.
        RAISE EXCEPTION 'Quedan % sin causa y esta resolucion cubre %: tienen que ser iguales.',
            to_char(v_resta, 'FM999999990.00'), to_char(v_parte, 'FM999999990.00');
    END IF;

    SELECT count(*), coalesce(sum((x->>'monto')::numeric), 0)
      INTO v_cuenta, v_suma
      FROM jsonb_array_elements(coalesce(p_personas, '[]'::jsonb)) x;

    IF p_via = 'REPONE' THEN
        IF v_cuenta = 0 THEN
            RAISE EXCEPTION 'Falta decir quien responde por el faltante.';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_personas) x
                    WHERE coalesce((x->>'monto')::numeric, 0) <= 0) THEN
            RAISE EXCEPTION 'Cada responsable tiene que llevar una parte mayor que cero.';
        END IF;
        IF abs(v_suma - v_parte) >= 0.01 THEN
            RAISE EXCEPTION 'Las partes suman % y el faltante sin causa es %.',
                to_char(v_suma, 'FM999999990.00'), to_char(v_parte, 'FM999999990.00');
        END IF;

        -- Puede responder quien trabaja en la sala, o quien vendió en el tramo
        -- aunque su ficha sea de otra (estaba cubriendo).
        SELECT coalesce(e.name, 'Esa persona') INTO v_ajeno
          FROM jsonb_array_elements(p_personas) x
          LEFT JOIN public.employees e ON e.id = (x->>'employee_id')::uuid
         WHERE e.id IS NULL
            OR e.status <> 'ACTIVO'
            OR (e.branch_id IS DISTINCT FROM v_corte.branch_id
                AND NOT EXISTS (SELECT 1 FROM public.employee_branches eb
                                 WHERE eb.employee_id = e.id AND eb.branch_id = v_corte.branch_id)
                AND NOT EXISTS (SELECT 1 FROM public.corte_vendedores_del_tramo(p_corte_id) vt
                                 WHERE vt.employee_id = e.id))
         LIMIT 1;

        IF v_ajeno IS NOT NULL THEN
            RAISE EXCEPTION '% no trabaja en esa sala ni vendio en ese corte, o ya no esta activa: no puede responder por este faltante.', v_ajeno;
        END IF;
    ELSIF v_cuenta > 0 THEN
        RAISE EXCEPTION 'Solo un faltante sin causa lleva responsables.';
    END IF;

    -- El monto se guarda con el signo del tramo, como siempre.
    INSERT INTO public.cortes_caja_diferencias
        (corte_id, branch_id, fecha, monto, via, causa, registrado_por,
         evidencia_ref, evidencia_foto_url, mapfre_invoice_id)
    VALUES (p_corte_id, v_corte.branch_id, v_corte.fecha, sign(v_monto) * v_parte, p_via,
            btrim(p_causa), (SELECT auth_employee_id()), v_ref, v_foto, p_mapfre_invoice_id)
    RETURNING * INTO v_dif;

    IF v_cuenta > 0 THEN
        INSERT INTO public.cortes_caja_diferencia_personas
            (diferencia_id, employee_id, monto, del_turno)
        SELECT v_dif.id, (x->>'employee_id')::uuid, round((x->>'monto')::numeric, 2),
               coalesce((x->>'del_turno')::boolean, false)
          FROM jsonb_array_elements(p_personas) x;
    END IF;

    INSERT INTO public.cortes_caja_eventos
        (corte_id, accion, motivo, nota, employee_id)
    VALUES (p_corte_id, 'RESOLVER_DIFERENCIA', btrim(p_causa),
            p_via || ' ' || to_char(v_dif.monto, 'FM999999990.00')
              || CASE WHEN v_parte < abs(v_monto) - 0.005
                      THEN ' de ' || to_char(v_monto, 'FM999999990.00') ELSE '' END
              || CASE WHEN v_ref IS NOT NULL THEN ' · ' || v_ref ELSE '' END
              || CASE WHEN v_mapfre IS NOT NULL
                      THEN ' · pago Mapfre ' || to_char((v_mapfre->>'monto')::numeric, 'FM999999990.00') ELSE '' END,
            (SELECT auth_employee_id()));

    RETURN v_dif;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.resolver_diferencia_corte(bigint, text, text, numeric, jsonb, text, text, numeric, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_diferencia_corte(bigint, text, text, numeric, jsonb, text, text, numeric, bigint) TO authenticated, service_role;
