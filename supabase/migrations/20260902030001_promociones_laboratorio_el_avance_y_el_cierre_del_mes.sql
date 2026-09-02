-- El avance del tipo laboratorio, y el cierre del mes.
--
-- ── Por qué el cálculo se muda a su propia función ──────────────────────────
-- `get_promocion_laboratorio` empieza con la guarda de permiso y devuelve NULL
-- sin ella. El cron corre como `service_role`, que no es un empleado: llamarla
-- desde el ciclo diario habría devuelto NULL y el mes se habría cerrado con la
-- matriz vacía — sin error, sin fila de menos visible, y con el bono de todo el
-- mundo en cero. Es el mismo reparto que ya tiene el tipo producto entre
-- `promocion_avance` (sin guarda, sólo service_role) y sus lectores.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- promocion_laboratorio_avance — el cálculo, sin guarda, sólo para el servidor
-- ─────────────────────────────────────────────────────────────────────────────
-- `force_custom_plan` no es adorno: el plan bueno depende del RANGO DE FECHAS.
-- Sin él, `plpgsql` cambia al plan genérico en la sexta llamada de cada conexión
-- —el planificador deja de saber que el mes filtra— y la función se degrada en
-- producción sin que nadie toque una línea. Cuesta ~3 ms de planificación.
-- Medido con el flag puesto: 36.6 ms la primera llamada y 22.x las siete
-- siguientes, sin salto en la sexta.
CREATE OR REPLACE FUNCTION public.promocion_laboratorio_avance(
    p_id         bigint,
    p_year_month text
) RETURNS TABLE (
    branch_id         bigint,
    sala              text,
    venta             numeric,
    personas          integer,
    nivel             smallint,
    monto_por_persona numeric,
    costo             numeric,
    siguiente_nivel   smallint,
    siguiente_umbral  numeric,
    falta             numeric,
    siguiente_monto   numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $function$
DECLARE
    v_ini date;
    v_fin date;
BEGIN
    IF coalesce(p_year_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'MES_INVALIDO: el mes se escribe como AAAA-MM';
    END IF;
    v_ini := (p_year_month || '-01')::date;
    v_fin := (v_ini + interval '1 month' - interval '1 day')::date;

    RETURN QUERY
    WITH facturas AS MATERIALIZED (
        -- SÓLO (id, branch_id): es lo que cubre idx_si_fecha_estado_branch.
        -- Una columna más rompe el index-only y el plan pasa de 26 a 210 ms.
        SELECT si.id, si.branch_id
          FROM public.sales_invoices si
         WHERE si.fecha >= v_ini AND si.fecha <= v_fin
           AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    ),
    -- La CERCA de ids. Sale de `facturas` y NUNCA de un `min(id) … WHERE fecha`
    -- suelto, que recorre la PK descartando 338,764 filas (3,130 ms).
    cerca AS MATERIALIZED (
        SELECT min(f.id) AS lo, max(f.id) AS hi FROM facturas f
    ),
    prods AS MATERIALIZED (
        SELECT p.id FROM public.products p
         WHERE p.laboratorio_id IN (
                 SELECT pl.laboratorio_id FROM public.promocion_laboratorio pl
                  WHERE pl.promocion_id = p_id)
    ),
    lineas AS MATERIALIZED (
        -- El rango entra como CONDICIÓN del índice (erp_product_id, invoice_id),
        -- no como filtro. La cerca es una optimización pura: quien decide qué
        -- factura cuenta sigue siendo el join con `facturas`.
        SELECT ii.invoice_id, ii.total_linea
          FROM public.sales_invoice_items ii, cerca c
         WHERE ii.erp_product_id IN (SELECT pr.id FROM prods pr)
           AND ii.invoice_id BETWEEN c.lo AND c.hi
    ),
    venta AS (
        SELECT f.branch_id AS bid, sum(l.total_linea)::numeric(12,2) AS venta
          FROM lineas l JOIN facturas f ON f.id = l.invoice_id
         GROUP BY f.branch_id
    ),
    padron AS (
        -- No toda ficha de `employees` es una persona: la cuenta de pruebas y el
        -- contador externo no cobran bono, y contarlos infla el costo.
        SELECT e.branch_id AS bid, count(*)::int AS personas
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
           AND e.branch_id IS NOT NULL
         GROUP BY e.branch_id
    ),
    -- El padrón de salas sale de los UMBRALES: una sala sin umbral escrito no
    -- participa, y mostrarla en cero se leería como que no vendió.
    base AS (
        SELECT b.id AS bid, b.name AS sala,
               coalesce(v.venta, 0)::numeric(12,2) AS venta,
               coalesce(pd.personas, 0)            AS personas
          FROM (SELECT DISTINCT nu.branch_id
                  FROM public.promocion_nivel_umbral nu
                 WHERE nu.promocion_id = p_id) u
          JOIN public.branches b ON b.id = u.branch_id
          LEFT JOIN venta  v  ON v.bid  = b.id
          LEFT JOIN padron pd ON pd.bid = b.id
    )
    SELECT s.bid, s.sala, s.venta, s.personas,
           alc.nivel,
           coalesce(n.monto_por_persona, 0)::numeric(10,2),
           round(coalesce(n.monto_por_persona, 0) * s.personas, 2),
           sig.nivel, sig.umbral_venta,
           CASE WHEN sig.umbral_venta IS NULL THEN NULL
                ELSE round(sig.umbral_venta - s.venta, 2) END,
           sm.monto_por_persona
      FROM base s
      -- `max(nivel)` vale porque la escritura garantiza umbrales crecientes.
      LEFT JOIN LATERAL (
            SELECT max(nu.nivel) AS nivel
              FROM public.promocion_nivel_umbral nu
             WHERE nu.promocion_id = p_id AND nu.branch_id = s.bid
               AND nu.umbral_venta <= s.venta
      ) alc ON true
      LEFT JOIN public.promocion_nivel n
             ON n.promocion_id = p_id AND n.nivel = alc.nivel
      LEFT JOIN LATERAL (
            SELECT nu.nivel, nu.umbral_venta
              FROM public.promocion_nivel_umbral nu
             WHERE nu.promocion_id = p_id AND nu.branch_id = s.bid
               AND nu.umbral_venta > s.venta
             ORDER BY nu.umbral_venta LIMIT 1
      ) sig ON true
      LEFT JOIN public.promocion_nivel sm
             ON sm.promocion_id = p_id AND sm.nivel = sig.nivel
     ORDER BY s.sala;
END;
$function$;

COMMENT ON FUNCTION public.promocion_laboratorio_avance(bigint, text) IS
  'Venta del mes por sala de los laboratorios de la promocion, con el nivel alcanzado, el costo y cuanto falta para el siguiente. SIN guarda de permiso: la ponen sus llamadores. Solo service_role.';

REVOKE EXECUTE ON FUNCTION public.promocion_laboratorio_avance(bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.promocion_laboratorio_avance(bigint, text)
    TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_promocion_laboratorio — ahora sobre la función de arriba
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_promocion_laboratorio(
    p_id         bigint,
    p_year_month text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_pm        public.promociones%ROWTYPE;
    v_ym        text;
    v_simula    boolean;
    v_congelado boolean;
    v_salas     json;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_view') THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_pm FROM public.promociones WHERE id = p_id;
    IF NOT FOUND OR v_pm.tipo <> 'laboratorio' THEN
        RETURN NULL;
    END IF;

    v_ym := coalesce(nullif(btrim(coalesce(p_year_month,'')), ''), v_pm.year_month);
    IF v_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'MES_INVALIDO: el mes se escribe como AAAA-MM';
    END IF;
    v_simula := (v_ym IS DISTINCT FROM v_pm.year_month);

    -- Un mes ya cerrado devuelve lo CONGELADO, no un recálculo: el padrón de la
    -- sala cambia y el número que se pagó tiene que seguir siendo ése. La
    -- simulación siempre recalcula, porque justamente pregunta por otro mes.
    v_congelado := NOT v_simula
        AND EXISTS (SELECT 1 FROM public.promocion_cierre_sala WHERE promocion_id = p_id);

    IF v_congelado THEN
        SELECT coalesce(json_agg(to_json(x) ORDER BY x.sala), '[]'::json) INTO v_salas
          FROM (
            SELECT c.branch_id, b.name AS sala, c.venta, c.nivel,
                   c.monto_por_persona, c.personas, c.costo,
                   NULL::smallint AS siguiente_nivel,
                   NULL::numeric  AS siguiente_umbral,
                   NULL::numeric  AS falta,
                   NULL::numeric  AS siguiente_monto
              FROM public.promocion_cierre_sala c
              JOIN public.branches b ON b.id = c.branch_id
             WHERE c.promocion_id = p_id
          ) x;
    ELSE
        SELECT coalesce(json_agg(to_json(a) ORDER BY a.sala), '[]'::json) INTO v_salas
          FROM public.promocion_laboratorio_avance(p_id, v_ym) a;
    END IF;

    RETURN json_build_object(
        'id',          v_pm.id,
        'tipo',        v_pm.tipo,
        'nombre',      v_pm.nombre,
        'estado',      v_pm.estado,
        'nota',        v_pm.nota,
        'year_month',  v_pm.year_month,
        'mes_medido',  v_ym,
        'simulacion',  v_simula,
        'congelado',   v_congelado,
        'paga',        v_pm.paga,
        'supplier_id', v_pm.supplier_id,
        'proveedor',   (SELECT s.name FROM public.suppliers s WHERE s.id = v_pm.supplier_id),
        'creado_por',  (SELECT e.name FROM public.employees e WHERE e.id = v_pm.creado_por),
        'created_at',  v_pm.created_at,
        'bonificaciones_activas', public.metas_bono_activo(v_ym),
        'laboratorios', coalesce((
            SELECT json_agg(json_build_object('id', lb.id, 'nombre', lb.nombre)
                            ORDER BY lb.nombre)
              FROM public.promocion_laboratorio pl
              JOIN public.laboratorios lb ON lb.id = pl.laboratorio_id
             WHERE pl.promocion_id = p_id), '[]'::json),
        'niveles', coalesce((
            SELECT json_agg(json_build_object('nivel', nv.nivel,
                                              'monto', nv.monto_por_persona)
                            ORDER BY nv.nivel)
              FROM public.promocion_nivel nv WHERE nv.promocion_id = p_id), '[]'::json),
        'umbrales', coalesce((
            SELECT json_agg(json_build_object('nivel', nu.nivel,
                                              'branch_id', nu.branch_id,
                                              'umbral', nu.umbral_venta)
                            ORDER BY nu.branch_id, nu.nivel)
              FROM public.promocion_nivel_umbral nu WHERE nu.promocion_id = p_id), '[]'::json),
        'salas',       coalesce(v_salas, '[]'::json),
        'venta_total', coalesce((SELECT sum((s ->> 'venta')::numeric)
                                   FROM json_array_elements(coalesce(v_salas,'[]'::json)) s), 0),
        'costo_total', coalesce((SELECT sum((s ->> 'costo')::numeric)
                                   FROM json_array_elements(coalesce(v_salas,'[]'::json)) s), 0),
        'personas_pagadas', coalesce((SELECT sum((s ->> 'personas')::int)
                                        FROM json_array_elements(coalesce(v_salas,'[]'::json)) s
                                       WHERE (s ->> 'nivel') IS NOT NULL), 0)
    );
END;
$function$;

COMMENT ON FUNCTION public.get_promocion_laboratorio(bigint, text) IS
  'La matriz de una promocion de laboratorio: venta del mes por sala, nivel alcanzado, cuanto falta para el siguiente y el costo. Con p_year_month mide el mismo programa contra otro mes (simulador). Un mes cerrado devuelve lo congelado.';

REVOKE EXECUTE ON FUNCTION public.get_promocion_laboratorio(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_promocion_laboratorio(bigint, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- promociones_cerrar_meses_de_laboratorio — congelar el mes que terminó
-- ─────────────────────────────────────────────────────────────────────────────
-- Aparte del ciclo diario y no dentro, para poder correrla sola al depurar. El
-- ciclo la llama.
CREATE OR REPLACE FUNCTION public.promociones_cerrar_meses_de_laboratorio()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_hoy   date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_n     integer := 0;
    v_pm    record;
    v_costo numeric;
    v_dest  uuid[];
BEGIN
    FOR v_pm IN
        SELECT pm.id, pm.nombre, pm.year_month
          FROM public.promociones pm
         WHERE pm.tipo = 'laboratorio'
           AND pm.estado = 'activa'
           -- El mes tiene que haber TERMINADO. Un borrador nunca llega acá
           -- porque no está activa: cerrar un borrador congelaría una matriz
           -- que nadie decidió.
           AND ((pm.year_month || '-01')::date
                + interval '1 month')::date <= v_hoy
           AND NOT EXISTS (SELECT 1 FROM public.promocion_cierre_sala c
                            WHERE c.promocion_id = pm.id)
    LOOP
        INSERT INTO public.promocion_cierre_sala
            (promocion_id, branch_id, venta, nivel, monto_por_persona, personas, costo)
        SELECT v_pm.id, a.branch_id, a.venta, a.nivel,
               a.monto_por_persona, a.personas, a.costo
          FROM public.promocion_laboratorio_avance(v_pm.id, v_pm.year_month) a;

        SELECT coalesce(sum(c.costo), 0) INTO v_costo
          FROM public.promocion_cierre_sala c WHERE c.promocion_id = v_pm.id;

        UPDATE public.promociones
           SET estado = 'finalizada', updated_at = now()
         WHERE id = v_pm.id;

        PERFORM public.promocion_log(v_pm.id, NULL, NULL, 'mes_cerrado',
            'activa', 'finalizada',
            v_pm.year_month || ' congelado · costo ' || to_char(v_costo, 'FM999999990.00'));
        v_n := v_n + 1;

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
                'Cerró el mes — ' || v_pm.nombre,
                'Los niveles de ' || v_pm.year_month || ' quedaron congelados. '
                  || 'Costo del programa: $' || to_char(v_costo, 'FM999999990.00') || '.',
                '/promociones?tab=historico',
                jsonb_build_object('promocion_id', v_pm.id,
                                   'year_month',   v_pm.year_month),
                false, NULL);
        END IF;
    END LOOP;

    RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.promociones_cerrar_meses_de_laboratorio() IS
  'Congela la matriz de las promociones de laboratorio cuyo mes ya termino y las finaliza. Idempotente: una promocion con cierre escrito no se vuelve a tocar.';

REVOKE EXECUTE ON FUNCTION public.promociones_cerrar_meses_de_laboratorio()
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.promociones_cerrar_meses_de_laboratorio()
    TO service_role;
