-- El vencimiento del inventario es de MES, no de día (medido el 2026-11-03):
-- 6,735 de 6,760 lotes con lote real traen el día 1. «01/11/2026» es lo que la
-- caja imprime como «11/2026», y se puede vender hasta el 30 de noviembre.
-- Leído al pie de la letra, el 2 de noviembre ya figuraba vencido —en el
-- resumen de la sala y en el «vencido al vender» del libro bajo receta—.
--
-- `vence_efectivo` es la regla, UNA vez: un día 1 vale como el último día de
-- su mes; cualquier otro día, tal cual (los 25 lotes con día propio). Va sin
-- `SET search_path` y en `sql` IMMUTABLE para que se inline.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.vence_efectivo(p_vence date)
RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT CASE WHEN extract(day FROM p_vence) = 1
                THEN (date_trunc('month', p_vence) + interval '1 month - 1 day')::date
                ELSE p_vence END;
$$;
GRANT EXECUTE ON FUNCTION public.vence_efectivo(date) TO authenticated, service_role;

-- El juez del libro (PENDIENTES 22) mira el vencimiento efectivo.
CREATE OR REPLACE FUNCTION public.libro_lote_motivo(p_lote text, p_vence date, p_fecha date)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
    SELECT CASE
        WHEN coalesce(btrim(p_lote), '') = '' THEN 'sin_lote'
        WHEN upper(btrim(p_lote)) = 'GENERICO' THEN 'generico'
        WHEN p_lote LIKE '%\_%' OR p_lote ~ '\d{5,}\s*[-/, ]\s*\d{5,}' THEN 'fundido'
        WHEN p_vence IS NOT NULL AND public.vence_efectivo(p_vence) < p_fecha THEN 'vencido'
    END;
$$;

-- Y la corrección de la sala, con la misma regla. Se parte de la definición
-- VIVA y se cambia sólo esa comparación.
DO $$
DECLARE v_def text := pg_get_functiondef('public.libro_lote_corregir(bigint,jsonb,boolean,text)'::regprocedure);
BEGIN
    IF position('IF v_vence < d.fecha THEN' in v_def) = 0 THEN
        RAISE EXCEPTION 'libro_lote_corregir cambió: revisar a mano';
    END IF;
    EXECUTE replace(v_def, 'IF v_vence < d.fecha THEN', 'IF public.vence_efectivo(v_vence) < d.fecha THEN');
END $$;

-- El resumen de la sala: vencido = su mes ya pasó; por vencer = dentro de 60
-- días, sin repetir el producto por cada lote. Y fuera el producto 0, que es
-- un renglón sin ficha.
DO $$
DECLARE v_def text := pg_get_functiondef('public.resumen_sala_indicadores(bigint,date)'::regprocedure);
BEGIN
    v_def := replace(v_def,
        'AND i.fecha_vencimiento IS NOT NULL AND i.fecha_vencimiento <= p_fecha + 60',
        'AND i.fecha_vencimiento IS NOT NULL AND public.vence_efectivo(i.fecha_vencimiento) <= p_fecha + 60');
    v_def := replace(v_def,
        'SELECT i.erp_product_id, i.descripcion, i.lote, i.fecha_vencimiento AS vence, sum(i.cantidad) AS unidades',
        'SELECT i.erp_product_id, i.descripcion, i.lote, public.vence_efectivo(i.fecha_vencimiento) AS vence, sum(i.cantidad) AS unidades');
    v_def := replace(v_def, 'FILTER (WHERE vence <= p_fecha), ''[]''::jsonb)', 'FILTER (WHERE vence < p_fecha + 1), ''[]''::jsonb)');
    v_def := replace(v_def, 'FILTER (WHERE vence > p_fecha), ''[]''::jsonb))', 'FILTER (WHERE vence >= p_fecha + 1 AND primero), ''[]''::jsonb))');
    v_def := replace(v_def,
        '         GROUP BY 1, 2, 3, 4
    )',
        '         GROUP BY 1, 2, 3, 4
    ), l2 AS (
        SELECT l.*, row_number() OVER (PARTITION BY l.erp_product_id ORDER BY l.vence) = 1 AS primero FROM l
    )');
    v_def := replace(v_def, '      INTO v_venc FROM l;', '      INTO v_venc FROM l2;');
    v_def := replace(v_def,
        'WHERE sp.erp_sucursal_id = v_suc AND sp.abc_class = ''A''',
        'WHERE sp.erp_sucursal_id = v_suc AND sp.abc_class = ''A'' AND sp.erp_product_id > 0');
    IF v_def !~ 'FROM l2;' OR v_def !~ 'erp_product_id > 0' OR v_def !~ 'vence >= p_fecha \+ 1 AND primero' THEN
        RAISE EXCEPTION 'resumen_sala_indicadores cambió: revisar a mano';
    END IF;
    EXECUTE v_def;
END $$;
