-- U2 paso 2 — las funciones que leen facturas usan `venta_valida` / `venta_fiscal`.
--
-- Plan: docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md §E2. Paso 1 (definiciones y
-- vigilante): 20260926150011_u2_venta_valida_y_venta_fiscal.
--
-- ── Qué cambia y qué NO ─────────────────────────────────────────────────────
-- En 59 funciones, SÓLO el filtro que decide si una factura cuenta:
--
--   estado NOT IN ('NULA','DTE INVALIDADO EN MH')        → public.venta_valida(estado)
--   estado = 'FINALIZADA'                                → public.venta_valida(estado)
--   estado = 'FINALIZADA' AND length(recibido_mh) = 40   → public.venta_fiscal(estado, recibido_mh)
--
-- Hoy dan las MISMAS filas: existen sólo tres estados y ninguno es nulo
-- (medido el 2026-09-26), así que ningún total se mueve. Lo que cambia es que
-- un estado NUEVO deja de contar en todas a la vez —decisión del usuario «A»—
-- en vez de contar en unas y no en otras. `venta_valida` se inlinea: el
-- planificador ve la misma comparación de antes y usa los mismos índices.
--
-- Quedan FUERA a propósito las del circuito de Hacienda —`alertar_barrido_dte`,
-- `avisar_rechazos_sin_arreglo`, `pedir_dato_a_la_sala`,
-- `get_invoice_observations`—: preguntan «¿está anulada?», no «¿cuenta como
-- venta?», y una factura en un estado nuevo tiene que seguir yendo a Hacienda.
-- Y el `'finalizada'` en minúsculas de las PROMOCIONES es otro estado, de otra
-- tabla: no se toca.
--
-- ── Por qué la migración reescribe y no trae los cuerpos ───────────────────
-- Son ~250 kB de funciones. Pegarlos a mano es donde se cuela un error de
-- transcripción en una función de dinero. Acá se toma la definición VIVA de
-- cada función por su firma, se le aplica el mismo cambio, y si el número de
-- reemplazos no es el esperado se aborta TODO (la migración es una sola
-- transacción). Verificado antes en producción con BEGIN…ROLLBACK, y después
-- comparando cada definición resultante, byte por byte, con la generada fuera.

SET lock_timeout = '5s';

DO $u2$
DECLARE
    f        record;
    d        text;
    hechos   integer;
BEGIN
    FOR f IN SELECT * FROM (VALUES
    ('public._docs_sin_numero_control()', 2),
    ('public.backfill_daily_stats_chunk()', 1),
    ('public.bono_meta_sala_interno(bigint,text)', 3),
    ('public.caja_efectivo_piezas(integer,date,numeric)', 1),
    ('public.caja_estado(integer)', 1),
    ('public.calculate_stock_params(integer)', 1),
    ('public.cerrar_periodo_fiscal(date,text,numeric)', 1),
    ('public.close_ventas_month(date)', 4),
    ('public.fn_update_product_last_sale()', 1),
    ('public.generar_csv_libro(text,date,date,bigint)', 2),
    ('public.get_cheques_de_bolsa(bigint)', 1),
    ('public.get_corte_z_dias(bigint,date)', 1),
    ('public.get_cortes_z(date,date,bigint)', 4),
    ('public.get_inyecciones_aplicadas(integer,date,date)', 1),
    ('public.get_last_sale_dates(integer)', 1),
    ('public.get_libro_ventas_consumidor(date,date,bigint)', 1),
    ('public.get_libro_ventas_contribuyente(date,date,bigint)', 1),
    ('public.get_meta_sala(bigint)', 1),
    ('public.get_metas_dashboard(text)', 1),
    ('public.get_metas_mes_en_curso(bigint)', 2),
    ('public.get_minmax_contexto_producto(integer,integer)', 1),
    ('public.get_no_sales_products(integer)', 1),
    ('public.get_periodo_fiscal(date)', 1),
    ('public.get_periodos_fiscales()', 1),
    ('public.get_product_drill_lines(integer,date,date,integer)', 1),
    ('public.get_product_drill_summary(integer,date,date,integer)', 1),
    ('public.get_product_last_sales(integer,integer)', 1),
    ('public.get_product_sales_agg_base(date,date,integer,text)', 3),
    ('public.get_product_sales_total(date,date,integer)', 3),
    ('public.get_product_trend(integer,integer,date,date)', 1),
    ('public.get_products_sold_no_minmax(integer)', 1),
    ('public.get_promocion(bigint)', 1),
    ('public.get_puntos_canjeados(date,date,integer,time without time zone)', 1),
    ('public.get_resumen_fiscal(date,date,bigint)', 1),
    ('public.get_stagnant_inventory_base(integer)', 1),
    ('public.get_top_productos_mes(date,date,integer)', 1),
    ('public.get_vendedor_diario(bigint,text,date,date)', 1),
    ('public.get_vendedor_diario(text,date,date)', 1),
    ('public.get_vendedores_resumen(date,date,bigint)', 1),
    ('public.get_ventas_fuera_del_libro(date,date,bigint)', 1),
    ('public.get_ventas_por_forma_de_pago(date,date)', 1),
    ('public.get_ventas_receta_stats(date,date,bigint,text,text,boolean)', 2),
    ('public.get_ventas_stats(date,date,integer,time without time zone)', 2),
    ('public.productos_parados_de_sala(integer)', 1),
    ('public.promocion_avance(boolean)', 1),
    ('public.promocion_corte_del_lote(bigint)', 1),
    ('public.promocion_laboratorio_avance(bigint,text)', 1),
    ('public.puntos_panel_resumen()', 1),
    ('public.puntos_panel_serie(integer)', 1),
    ('public.rebuild_product_sales_monthly_agg(date,date)', 1),
    ('public.refresh_customer_activity()', 5),
    ('public.refresh_product_last_sale()', 1),
    ('public.refresh_product_sales_monthly_agg(integer)', 1),
    ('public.refresh_product_sales_rollup()', 1),
    ('public.refresh_sales_daily_stats(integer)', 1),
    ('public.resumen_ventas_diario(date,date,bigint)', 1),
    ('public.ventas_elegibles_puntos(date,date,numeric,integer)', 1),
    ('public.ventas_para_puntos(date,date,numeric,integer,boolean)', 1),
    ('public.ventas_por_mes_de_producto(integer,bigint)', 1)
    ) v(firma, esperado)
    LOOP
        d := pg_get_functiondef(f.firma::regprocedure);

        -- El `'ANULADA'` es el estado de una BOLSA; en facturas no existe.
        d := replace(d, $$si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH', 'ANULADA')$$,
                        'public.venta_valida(si.estado)');
        d := regexp_replace(d,
            $$((?:\w+\.)?estado)\s*=\s*'FINALIZADA'(\s+[Aa][Nn][Dd]\s+)[Ll][Ee][Nn][Gg][Tt][Hh]\(\s*((?:\w+\.)?recibido_mh)\s*\)\s*=\s*40$$,
            'public.venta_fiscal(\1, \3)', 'g');
        d := regexp_replace(d,
            $$((?:\w+\.)?estado)\s+[Nn][Oo][Tt]\s+[Ii][Nn]\s*\(\s*'(?:NULA'\s*,\s*'DTE INVALIDADO EN MH|DTE INVALIDADO EN MH'\s*,\s*'NULA)'\s*\)$$,
            'public.venta_valida(\1)', 'g');
        d := regexp_replace(d,
            $$(?<![\w.'])(?<![Ss][Ee][Tt] )((?:\w+\.)?estado)\s*=\s*'FINALIZADA'$$,
            'public.venta_valida(\1)', 'g');

        hechos := (length(d) - length(replace(d, 'public.venta_', ''))) / length('public.venta_');
        IF hechos <> f.esperado THEN
            RAISE EXCEPTION 'U2: % reemplazos en %, se esperaban %', hechos, f.firma, f.esperado;
        END IF;
        EXECUTE d;
    END LOOP;
END
$u2$;