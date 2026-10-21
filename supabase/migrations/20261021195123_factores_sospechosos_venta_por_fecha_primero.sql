SET lock_timeout = '5s';

-- factores_sospechosos: la rama «venta» entraba por producto y recorría TODO
-- el historial de renglones de cada uno (1.15 M filas descartadas) antes de
-- mirar la fecha, porque el planificador estimaba `unico` en 28 filas y son
-- 5,677. Medido el 2026-10-21: 10,316 ms y 1.1 M bloques por llamada. Ahora
-- se toman primero los renglones de los últimos 30 días (entra por
-- idx_si_fecha_estado_branch) y recién después se cruzan: 87 ms, 60 K
-- bloques, mismo resultado. `unico` va MATERIALIZED para que el cruce no se
-- replanifique con la estimación mala.
CREATE OR REPLACE FUNCTION public.factores_sospechosos()
 RETURNS TABLE(clave text, tipo text, erp_product_id integer, nombre text, presentacion text, dice integer, catalogo integer, filas integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH cat AS (
    SELECT pp.product_id, upper(trim(pr.tipo)) AS tipo, pp.factor, pp.descripcion,
           nullif(substring(regexp_replace(pp.descripcion, '\s', '', 'g') from '(?i)^\d*x(\d+)$'), '')::int AS txt
      FROM public.product_precios pp
      JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
      JOIN public.products p ON p.id = pp.product_id
     WHERE pp.activo AND pp.factor > 0 AND p.activo AND p.nombre NOT ILIKE 'RECARGA%'
  ),
  unico AS MATERIALIZED (
    SELECT product_id, tipo, min(factor) AS factor
      FROM cat GROUP BY 1, 2 HAVING min(factor) = max(factor)
  ),
  ven AS MATERIALIZED (
    SELECT ii.erp_product_id, upper(ii.presentacion) AS pres, ii.factor_unidades
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
     WHERE si.fecha >= CURRENT_DATE - 30
       AND public.venta_valida(si.estado)
  )
  SELECT 'texto:' || c.product_id || ':' || c.tipo || ':' || c.txt || ':' || c.factor,
         'texto', c.product_id, p.nombre, c.tipo, c.txt, c.factor, 1
    FROM cat c JOIN public.products p ON p.id = c.product_id
   WHERE c.txt IS NOT NULL AND c.txt <> c.factor
  UNION ALL
  SELECT 'existencia:' || i.erp_product_id || ':' || u.tipo || ':' || x.dice || ':' || u.factor,
         'existencia', i.erp_product_id, p.nombre, u.tipo, x.dice, u.factor, count(*)::int
    FROM public.inventory i
    JOIN unico u ON u.product_id = i.erp_product_id AND u.tipo = upper(trim(i.presentacion))
    JOIN public.products p ON p.id = i.erp_product_id
    CROSS JOIN LATERAL (SELECT nullif(substring(regexp_replace(i.detalle, '\s', '', 'g') from '(?i)^\d*x(\d+)$'), '')::int AS dice) x
   WHERE i.cantidad > 0 AND x.dice IS NOT NULL AND x.dice <> u.factor
   GROUP BY i.erp_product_id, u.tipo, x.dice, u.factor, p.nombre
  UNION ALL
  SELECT 'venta:' || v.erp_product_id || ':' || u.tipo || ':' || v.factor_unidades || ':' || u.factor,
         'venta', v.erp_product_id, p.nombre, u.tipo, v.factor_unidades::int, u.factor, count(*)::int
    FROM ven v
    JOIN unico u ON u.product_id = v.erp_product_id AND v.pres LIKE u.tipo || ' %'
    JOIN public.products p ON p.id = v.erp_product_id
   WHERE v.factor_unidades <> u.factor
     -- Un tipo más largo que también calza («CAJA X 100» contra «CAJA») es el
     -- que manda: ésa no es una venta con el tamaño equivocado.
     AND NOT EXISTS (SELECT 1 FROM unico u2
                      WHERE u2.product_id = u.product_id AND length(u2.tipo) > length(u.tipo)
                        AND v.pres LIKE u2.tipo || ' %')
   GROUP BY v.erp_product_id, u.tipo, v.factor_unidades, u.factor, p.nombre;
$function$;

-- avisar_factores_sospechosos llamaba a factores_sospechosos() DOS veces (una
-- para insertar las claves nuevas y otra para traer sus filas). Una sola
-- lectura alcanza.
CREATE OR REPLACE FUNCTION public.avisar_factores_sospechosos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_nuevos jsonb;
  v_n      integer;
  v_cuerpo text;
BEGIN
  WITH f AS MATERIALIZED (
    SELECT * FROM public.factores_sospechosos()
  ), ins AS (
    INSERT INTO public.factores_sospechosos_avisados (clave)
    SELECT f.clave FROM f
    ON CONFLICT (clave) DO NOTHING
    RETURNING clave
  )
  SELECT jsonb_agg(to_jsonb(f)), count(*)
    INTO v_nuevos, v_n
    FROM f
    JOIN ins ON ins.clave = f.clave;

  IF coalesce(v_n, 0) = 0 THEN RETURN 0; END IF;

  SELECT string_agg(x->>'nombre' || ' (' || (x->>'presentacion') || ': '
                    || CASE x->>'tipo'
                         WHEN 'texto'      THEN 'el texto dice ' || (x->>'dice') || ' y el factor ' || (x->>'catalogo')
                         WHEN 'existencia' THEN 'la existencia dice ' || (x->>'dice') || ' y el catálogo ' || (x->>'catalogo')
                         ELSE (x->>'filas') || ' ventas con ' || (x->>'dice') || ' y el catálogo dice ' || (x->>'catalogo')
                       END || ')', '; ')
    INTO v_cuerpo
    FROM (SELECT x FROM jsonb_array_elements(v_nuevos) x LIMIT 5) s;

  PERFORM public.notify_employees(
    public.get_minmax_approver_ids(), 'SYSTEM',
    CASE WHEN v_n = 1 THEN 'Un producto con el factor que no cuadra'
         ELSE v_n || ' productos con el factor que no cuadra' END,
    v_cuerpo || CASE WHEN v_n > 5 THEN ' y ' || (v_n - 5) || ' más.' ELSE '.' END
      || ' Revisalo en Productos → Revisión de factor.',
    '/productos?tab=revision',
    jsonb_build_object('factores_sospechosos', v_nuevos));
  RETURN v_n;
END;
$function$;
