SET lock_timeout = '5s';

-- Una consulta lenta deja de poder retener una conexión del portal dos minutos.
--
-- El riesgo, medido el 2026-08-21:
--   max_connections                        60
--   conexiones que sostiene PostgREST      19  (su pool, en pg_stat_activity)
--   statement_timeout de `authenticated`  120s
--
-- O sea que 19 consultas lentas en vuelo agotan el pool, y cada una puede
-- quedarse hasta dos minutos. Es el mecanismo exacto del apagón del 2026-07-08
-- escrito en CLAUDE.md: el pool se agota, toda lectura posterior se encola
-- detrás, el portal entero devuelve 504 y el navegador lo muestra como «error
-- de CORS» — engañoso, no es CORS. El `lock_timeout = 8s` de `authenticator`
-- cubre la variante de las migraciones; nada cubría la de la consulta lenta.
--
-- POR QUÉ 30s: sale de medir, no de elegir. En pg_stat_statements desde que
-- Postgres arrancó, la ÚNICA consulta real del portal que pasó de 8 segundos
-- fue search_ventas_ids con un máximo de 9,837 ms — y ésa la arregla la
-- migración hermana (plan_cache_mode). Todo lo demás quedó debajo:
--   get_product_sales_agg_jsonb  5,797 ms de promedio
--   get_pedido_generar_dashboard 1,219 ms
--   refresh_inventory_grouped_mv   825 ms
--   get_stock_analysis_jsonb       812 ms
-- 30s deja 3x de aire sobre el peor caso real y aprieta 4x el techo actual. Se
-- elige por encima del máximo observado y no pegado a él porque la ventana
-- medida son 6 horas: un reporte mensual puede no haber corrido en ella, y un
-- techo que corta trabajo legítimo se termina subiendo de vuelta sin pensarlo.
--
-- `service_role` se queda en 120s a propósito. Ese número tiene su motivo
-- escrito en 20260801135812: el camino del cron tenía MENOS techo que un
-- usuario logueado, y eso mató el recálculo mensual de MIN/MAX en La Popular el
-- 2026-08-01. Esta migración no lo revierte — deja la relación en el orden
-- correcto por primera vez: fondo 120s, pantalla 30s.
--
-- OJO: colgarle `SET statement_timeout` a la FUNCIÓN no sirve, está probado en
-- esa misma migración. El temporizador se arma al inicio de la sentencia con el
-- valor de QUIEN LLAMA y la función no lo re-arma. El único lugar que funciona
-- es el rol.
--
-- SI HAY QUE REVERTIRLO: `ALTER ROLE authenticated SET statement_timeout='120s'`
-- + `NOTIFY pgrst, 'reload config'`. Pero la salida correcta ante un reporte que
-- necesitaba más NO es subirle el techo a todos: es mover ESE reporte a una edge
-- function, que corre como service_role y ya tiene los 120s por decisión escrita.
--
-- Probado antes en el branch staging (cbnjplmnfmfsambavjce).

ALTER ROLE authenticated SET statement_timeout = '30s';

-- PostgREST cachea los settings por rol; sin esto sigue aplicando el viejo.
NOTIFY pgrst, 'reload config';
