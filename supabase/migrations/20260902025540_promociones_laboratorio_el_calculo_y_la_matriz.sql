-- El cálculo del tipo laboratorio: la matriz de salas × niveles.
--
-- ── Por qué la consulta está escrita así ────────────────────────────────────
-- La forma obvia cuesta 1,511 ms y ésta 26. El detalle está en la migración
-- 20260902025309; lo que hay que respetar al tocarla es que las tres piezas se
-- sostienen entre sí:
--   · `facturas` trae SÓLO (id, branch_id) — una columna más rompe el
--     index-only y el mismo plan pasa a 210 ms;
--   · la CERCA de ids convierte el rango en condición del índice
--     (erp_product_id, invoice_id), no en filtro;
--   · la cerca sale del CTE `facturas`, nunca de un `min(id) … WHERE fecha`
--     suelto, que recorre la PK descartando 338,764 filas → 3,130 ms.
--
-- ── Lo que NO se filtra, y por qué no hace falta ────────────────────────────
-- El resto del módulo excluye las facturas de `ventas_sin_producto`. Acá no se
-- escribe ese NOT EXISTS: la consulta entra POR renglón de producto, así que
-- una factura sin productos no tiene por dónde aparecer. Medido desde junio:
-- CERO facturas marcadas «sin producto» tienen un renglón con laboratorio. El
-- filtro costaría un subplan por cada una de las 21,603 facturas del mes para
-- descartar nada.
--
-- ── El padrón: `tipo_ficha = 'empleado'` ────────────────────────────────────
-- «Persona base» es todo empleado ACTIVO de la sala (§9b del plan de Metas),
-- pero no toda ficha de `employees` es una persona: hoy hay una `tecnica` (la
-- cuenta de pruebas) y un `servicio_externo` (el contador). Contarlos infla el
-- costo del programa con plata que nadie va a cobrar.
--
-- ── El nivel alcanzado es `max(nivel)` y eso EXIGE umbrales crecientes ──────
-- Con un nivel 3 más barato que el 2, `max` premiaría un nivel que la sala no
-- alcanzó. Por eso `crear/editar` valida que los umbrales de cada sala suban
-- con el nivel: la lectura puede ser simple porque la escritura no deja entrar
-- el caso raro.
--
-- NOTA: el cuerpo de `get_promocion_laboratorio` que define esta migración fue
-- reemplazado el mismo día por 20260902030001, que muda el cálculo a
-- `promocion_laboratorio_avance` para que el cron —que no es un empleado y no
-- pasa la guarda de permiso— pueda usarlo. Se conserva tal cual se aplicó.

SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- get_promocion_laboratorio — la matriz de una promoción de laboratorio
-- ─────────────────────────────────────────────────────────────────────────────
-- `p_year_month` sirve para el SIMULADOR: medir el mismo programa contra otro
-- mes responde «si hubiera corrido en julio, habría costado $X» con datos
-- reales. Es una lectura: no escribe nada ni toca el cierre congelado.
--
-- ⚠️ Este cuerpo lo reemplaza 20260902030001. Ver la nota del encabezado.
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
    v_ini       date;
    v_fin       date;
    v_simula    boolean;
    v_congelado boolean;
    v_salas     json;
    v_out       json;
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
    v_ini    := (v_ym || '-01')::date;
    v_fin    := (v_ini + interval '1 month' - interval '1 day')::date;

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
                   NULL::smallint      AS siguiente_nivel,
                   NULL::numeric       AS siguiente_umbral,
                   NULL::numeric       AS falta,
                   NULL::numeric       AS siguiente_monto
              FROM public.promocion_cierre_sala c
              JOIN public.branches b ON b.id = c.branch_id
             WHERE c.promocion_id = p_id
          ) x;
    ELSE
        WITH facturas AS MATERIALIZED (
            SELECT si.id, si.branch_id
              FROM public.sales_invoices si
             WHERE si.fecha >= v_ini AND si.fecha <= v_fin
               AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
        ),
        cerca AS MATERIALIZED (
            SELECT min(id) AS lo, max(id) AS hi FROM facturas
        ),
        prods AS MATERIALIZED (
            SELECT p.id
              FROM public.products p
             WHERE p.laboratorio_id IN (
                     SELECT pl.laboratorio_id FROM public.promocion_laboratorio pl
                      WHERE pl.promocion_id = p_id)
        ),
        lineas AS MATERIALIZED (
            SELECT ii.invoice_id, ii.total_linea
              FROM public.sales_invoice_items ii, cerca c
             WHERE ii.erp_product_id IN (SELECT id FROM prods)
               AND ii.invoice_id BETWEEN c.lo AND c.hi
        ),
        venta AS (
            SELECT f.branch_id, sum(l.total_linea)::numeric(12,2) AS venta
              FROM lineas l JOIN facturas f ON f.id = l.invoice_id
             GROUP BY f.branch_id
        ),
        padron AS (
            SELECT e.branch_id, count(*)::int AS personas
              FROM public.employees e
             WHERE e.status = 'ACTIVO'
               AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
               AND e.branch_id IS NOT NULL
             GROUP BY e.branch_id
        ),
        -- El padrón de salas sale de los UMBRALES, no de `branches`: una sala
        -- sin umbral escrito no participa del programa, y mostrarla en cero se
        -- leería como que no vendió.
        salas AS (
            SELECT b.id AS branch_id, b.name AS sala,
                   coalesce(v.venta, 0)::numeric(12,2) AS venta,
                   coalesce(pd.personas, 0)            AS personas
              FROM (SELECT DISTINCT nu.branch_id
                      FROM public.promocion_nivel_umbral nu
                     WHERE nu.promocion_id = p_id) u
              JOIN public.branches b  ON b.id = u.branch_id
              LEFT JOIN venta v       ON v.branch_id  = b.id
              LEFT JOIN padron pd     ON pd.branch_id = b.id
        )
        SELECT coalesce(json_agg(to_json(x) ORDER BY x.sala), '[]'::json) INTO v_salas
          FROM (
            SELECT s.branch_id, s.sala, s.venta, s.personas,
                   alc.nivel,
                   coalesce(n.monto_por_persona, 0)::numeric(10,2) AS monto_por_persona,
                   round(coalesce(n.monto_por_persona, 0) * s.personas, 2) AS costo,
                   sig.nivel        AS siguiente_nivel,
                   sig.umbral_venta AS siguiente_umbral,
                   CASE WHEN sig.umbral_venta IS NULL THEN NULL
                        ELSE round(sig.umbral_venta - s.venta, 2) END AS falta,
                   sm.monto_por_persona AS siguiente_monto
              FROM salas s
              LEFT JOIN LATERAL (
                    SELECT max(nu.nivel) AS nivel
                      FROM public.promocion_nivel_umbral nu
                     WHERE nu.promocion_id = p_id
                       AND nu.branch_id    = s.branch_id
                       AND nu.umbral_venta <= s.venta
              ) alc ON true
              LEFT JOIN public.promocion_nivel n
                     ON n.promocion_id = p_id AND n.nivel = alc.nivel
              LEFT JOIN LATERAL (
                    SELECT nu.nivel, nu.umbral_venta
                      FROM public.promocion_nivel_umbral nu
                     WHERE nu.promocion_id = p_id
                       AND nu.branch_id    = s.branch_id
                       AND nu.umbral_venta > s.venta
                     ORDER BY nu.umbral_venta
                     LIMIT 1
              ) sig ON true
              LEFT JOIN public.promocion_nivel sm
                     ON sm.promocion_id = p_id AND sm.nivel = sig.nivel
          ) x;
    END IF;

    SELECT json_build_object(
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
    ) INTO v_out;

    RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.get_promocion_laboratorio(bigint, text) IS
  'La matriz de una promocion de laboratorio: venta del mes por sala, nivel alcanzado, cuanto falta para el siguiente y el costo. Con p_year_month mide el mismo programa contra otro mes (simulador). Un mes cerrado devuelve lo congelado.';

REVOKE EXECUTE ON FUNCTION public.get_promocion_laboratorio(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_promocion_laboratorio(bigint, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_promociones — la lista, ahora con los dos tipos
-- ─────────────────────────────────────────────────────────────────────────────
-- Sigue sin calcular ventas a propósito: el avance se ve al abrir una. Lo que
-- cambia es que una promoción de laboratorio no tiene renglones, así que su
-- vigencia y su resumen salen de otro lado.
CREATE OR REPLACE FUNCTION public.get_promociones(
    p_estado text DEFAULT NULL,
    p_tipo   text DEFAULT NULL
) RETURNS json
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

    SELECT coalesce(json_agg(to_json(x) ORDER BY x.inicio DESC NULLS LAST, x.nombre), '[]'::json)
      INTO v_out
      FROM (
        SELECT pm.id, pm.nombre, pm.estado, pm.nota, pm.created_at,
               pm.tipo, pm.year_month, pm.paga, pm.supplier_id,
               CASE pm.tipo
                 WHEN 'laboratorio' THEN (pm.year_month || '-01')::date
                 ELSE r.inicio END AS inicio,
               CASE pm.tipo
                 WHEN 'laboratorio'
                   THEN ((pm.year_month || '-01')::date
                         + interval '1 month' - interval '1 day')::date
                 ELSE r.fin END AS fin,
               r.renglones, r.lote_total, r.abiertos,
               CASE pm.tipo
                 WHEN 'laboratorio' THEN lab.nombres
                 ELSE r.laboratorios END AS laboratorios,
               lab.niveles, lab.salas
          FROM public.promociones pm
          LEFT JOIN LATERAL (
              SELECT min(rr.inicio) AS inicio,
                     max(rr.fin)    AS fin,
                     count(*)::int  AS renglones,
                     sum(rr.lote_total)::int AS lote_total,
                     count(*) FILTER (WHERE rr.estado = 'abierto')::int AS abiertos,
                     (SELECT json_agg(DISTINCT coalesce(lb.nombre,'Sin laboratorio'))
                        FROM public.promocion_renglon r2
                        JOIN public.products p2 ON p2.id = r2.erp_product_id
                        LEFT JOIN public.laboratorios lb ON lb.id = p2.laboratorio_id
                       WHERE r2.promocion_id = pm.id) AS laboratorios
                FROM public.promocion_renglon rr
               WHERE rr.promocion_id = pm.id
          ) r ON pm.tipo = 'producto'
          LEFT JOIN LATERAL (
              SELECT (SELECT json_agg(lb.nombre ORDER BY lb.nombre)
                        FROM public.promocion_laboratorio pl
                        JOIN public.laboratorios lb ON lb.id = pl.laboratorio_id
                       WHERE pl.promocion_id = pm.id) AS nombres,
                     (SELECT count(*)::int FROM public.promocion_nivel nv
                       WHERE nv.promocion_id = pm.id) AS niveles,
                     (SELECT count(DISTINCT nu.branch_id)::int
                        FROM public.promocion_nivel_umbral nu
                       WHERE nu.promocion_id = pm.id) AS salas
          ) lab ON pm.tipo = 'laboratorio'
         WHERE (p_estado IS NULL OR pm.estado = p_estado)
           AND (p_tipo   IS NULL OR pm.tipo   = p_tipo)
      ) x;

    RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.get_promociones(text, text) IS
  'La lista de promociones de los dos tipos. La de producto deriva su vigencia de los renglones; la de laboratorio, de su mes. NO calcula ventas a proposito: el avance se ve al abrir una.';

REVOKE EXECUTE ON FUNCTION public.get_promociones(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_promociones(text, text) TO authenticated, service_role;
