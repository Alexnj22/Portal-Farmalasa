-- ─────────────────────────────────────────────────────────────────────────────
-- Correr las fechas del branch de pruebas hasta hoy
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Se aplica al BRANCH DE PRUEBAS y no a producción. No es una migración: es una
-- herramienta del entorno de pruebas, como sus vecinas de esta carpeta. Vive
-- acá y no en `supabase/migrations/` a propósito — meterla ahí crearía en la
-- base real una función capaz de correr fechas, y aunque la guarda la haga
-- inerte, la superficie no hace falta.
--
--   supabase db query --linked -f scripts/entorno-pruebas/correr_fechas.sql
--   select * from correr_fechas_del_branch_de_pruebas();     -- delta automático
--   select * from correr_fechas_del_branch_de_pruebas(30);   -- 30 días a mano
--
-- ── El problema, medido ────────────────────────────────────────────────────
-- El barrido móvil de las 54 rutas corrió el 2026-08-23 contra el entorno de
-- pruebas y dijo «0 por corregir». Sólo **13 rutas tenían algo que medir**; las
-- otras 41 llegaron sin una ficha, sin una tabla y sin una fila.
--
-- La primera hipótesis fue «faltan datos» y estaba MAL. El branch tiene 5.111
-- facturas, 163 cortes, 2.436 existencias y 300 productos. Lo que les pasa es
-- otra cosa: **todos son del 15 de agosto**. Las vistas del portal filtran por
-- hoy, por esta semana o por el mes en curso, así que con datos de hace nueve
-- días la pantalla es un `EmptyState` perfectamente correcto — y un barrido
-- sobre un portal vacío mide el chasis.
--
-- O sea que no había que sembrar más: había que CORRER LO QUE YA HAY. Es más
-- barato, no inventa datos y conserva las relaciones entre ellos.
--
-- ── Por qué un delta ÚNICO para todas las tablas ───────────────────────────
-- Cada tabla se corre el MISMO número de días. Si cada una se ajustara por su
-- cuenta, una factura quedaría anulada antes de emitirse y un corte resuelto
-- antes de capturarse — y el portal empezaría a mostrar imposibles que nadie
-- programó. El orden entre los hechos es parte del dato.
--
-- ── Qué NO se corre, y es lo más importante ────────────────────────────────
-- Sólo fechas de ACTIVIDAD: cuándo pasó algo. Las de IDENTIDAD se quedan
-- quietas — `birth_date`, `hire_date`, `contract_start_date`, `opening_date` de
-- una sucursal, `fecha_vencimiento` de un lote. Correrlas convertiría a alguien
-- de 40 años en uno de 41, y a un lote que vence en marzo en uno que vence en
-- abril. La lista es EXPLÍCITA por eso: un barrido automático de «todas las
-- columnas de fecha» habría corrido esas también.
--
-- ── Y las DERIVADAS no se corren: se recalculan ────────────────────────────
-- El primer intento incluía `sales_daily_stats` y reventó con violación de
-- clave: su PK es `(date, branch_id)`, así que correr el rango nueve días lo
-- solapa consigo mismo. Es una tabla derivada de las facturas — moverla a mano
-- es reconstruir a mano algo que ya sabe reconstruirse. Sale del plan y se
-- refresca al final desde los datos ya corridos.
--
-- ── Una tabla que falla no tumba al resto ──────────────────────────────────
-- Cada UPDATE va en su propio bloque con EXCEPTION. Sin eso, la primera tabla
-- con un CHECK o una PK incómoda aborta la corrida entera y deja las anteriores
-- corridas y las siguientes quietas — el peor estado posible: fechas
-- inconsistentes entre tablas, justo lo que el delta único viene a evitar.

SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.correr_fechas_del_branch_de_pruebas(integer);

CREATE FUNCTION public.correr_fechas_del_branch_de_pruebas(p_dias integer DEFAULT NULL)
RETURNS TABLE(tabla text, resultado text, filas bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_dias      integer := p_dias;
    v_mas_nuevo timestamptz;
    v_sql       text;
    v_filas     bigint;
    v_plan      text[][] := ARRAY[
        ARRAY['sales_invoices',           'created_at,fecha,updated_at'],
        ARRAY['cortes_caja',              'capturado_at,created_at,fecha,resuelto_at,updated_at'],
        ARRAY['cortes_caja_eventos',      'created_at'],
        ARRAY['cortes_caja_movimientos',  'created_at'],
        ARRAY['bitacora_dispensaciones',  'anulada_at,completada_at,created_at,fecha,updated_at'],
        ARRAY['bitacora_lecturas',        'created_at,fecha'],
        ARRAY['bitacora_limpiezas',       'created_at,fecha'],
        ARRAY['pedidos',                  'created_at,updated_at'],
        ARRAY['pedido_items',             'confirmado_suc_at,enviado_at,received_at,rechazado_at,resuelto_at'],
        ARRAY['pedido_sucursal_status',   'created_at,updated_at'],
        ARRAY['approval_requests',        'created_at,updated_at'],
        ARRAY['notifications',            'created_at,read_at'],
        ARRAY['inventory',                'synced_at'],
        ARRAY['product_last_sale',        'last_sale_date'],
        ARRAY['metas_sucursal',           'created_at,gerente_at,supervisor_at'],
        ARRAY['metas_resultado',          'created_at'],
        ARRAY['audit_logs',               'created_at'],
        ARRAY['conteos_inventario',       'created_at'],
        ARRAY['bolsas',                   'created_at'],
        ARRAY['cotizaciones',             'created_at'],
        ARRAY['ventas_perdidas',          'created_at'],
        ARRAY['announcements',            'created_at'],
        ARRAY['timesheets',               'work_date'],
        ARRAY['purchase_receipts',        'fecha_emision'],
        ARRAY['product_precios_changelog','changed_at']
    ];
    i integer;
BEGIN
    -- ── La guarda ───────────────────────────────────────────────────────────
    -- La cuenta `pruebas` la crea la semilla del branch SÓLO si la base no tiene
    -- ni un empleado, así que en producción no existe y nunca existirá
    -- (comprobado el 2026-08-24: cero filas con ese usuario contra 49 empleados
    -- reales). Es la misma llave que separa «sembrar un branch» de «tocar la
    -- base real», y por eso se reusa en vez de inventar una bandera nueva: una
    -- bandera se olvida de poner, y olvidarla acá corre las fechas de la
    -- empresa.
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE username = 'pruebas') THEN
        RAISE EXCEPTION 'Esta función SÓLO corre en el branch de pruebas (no se encontró la cuenta `pruebas`).';
    END IF;

    IF v_dias IS NULL THEN
        SELECT max(created_at) INTO v_mas_nuevo FROM public.sales_invoices;
        IF v_mas_nuevo IS NULL THEN
            RAISE EXCEPTION 'No hay ventas de referencia para calcular el desplazamiento.';
        END IF;
        v_dias := GREATEST(0, (current_date - v_mas_nuevo::date));
    END IF;

    IF v_dias = 0 THEN
        tabla := '(nada)'; resultado := 'las fechas ya están al día'; filas := 0;
        RETURN NEXT; RETURN;
    END IF;

    FOR i IN 1 .. array_length(v_plan, 1) LOOP
        IF to_regclass('public.' || v_plan[i][1]) IS NULL THEN
            tabla := v_plan[i][1]; resultado := 'no existe en este branch'; filas := 0;
            RETURN NEXT; CONTINUE;
        END IF;

        SELECT string_agg(format('%I = %I + make_interval(days => %s)', col, col, v_dias), ', ')
          INTO v_sql
          FROM unnest(string_to_array(v_plan[i][2], ',')) AS col
         WHERE EXISTS (
             SELECT 1 FROM information_schema.columns c
              WHERE c.table_schema='public' AND c.table_name = v_plan[i][1] AND c.column_name = col
         );
        IF v_sql IS NULL THEN
            tabla := v_plan[i][1]; resultado := 'ninguna de esas columnas existe'; filas := 0;
            RETURN NEXT; CONTINUE;
        END IF;

        BEGIN
            EXECUTE format('UPDATE public.%I SET %s', v_plan[i][1], v_sql);
            GET DIAGNOSTICS v_filas = ROW_COUNT;
            tabla := v_plan[i][1]; resultado := format('corrida %s días', v_dias); filas := v_filas;
        EXCEPTION WHEN OTHERS THEN
            tabla := v_plan[i][1]; resultado := 'NO se pudo: ' || left(SQLERRM, 90); filas := 0;
        END;
        RETURN NEXT;
    END LOOP;

    -- ── Las derivadas, al final y recalculadas ─────────────────────────────
    BEGIN
        PERFORM public.refresh_sales_daily_stats(365);
        tabla := 'sales_daily_stats'; resultado := 'RECALCULADA desde las facturas'; filas := 0;
    EXCEPTION WHEN OTHERS THEN
        tabla := 'sales_daily_stats'; resultado := 'no se pudo recalcular: ' || left(SQLERRM, 90); filas := 0;
    END;
    RETURN NEXT;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.correr_fechas_del_branch_de_pruebas(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.correr_fechas_del_branch_de_pruebas(integer) TO service_role;

COMMENT ON FUNCTION public.correr_fechas_del_branch_de_pruebas(integer) IS
'Corre las fechas de ACTIVIDAD del branch de pruebas para que lo más nuevo sea hoy, y así las vistas que filtran por fecha dejen de mostrar un EmptyState. Un delta único para todas las tablas: el orden entre los hechos es parte del dato. NO corre fechas de identidad (nacimiento, contratación, apertura de sala, vencimiento de lote) ni tablas derivadas (esas se recalculan). Lanza si no encuentra la cuenta `pruebas`, que sólo existe en el branch.';
