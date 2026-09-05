SET lock_timeout = '5s';

-- ── «A qué sucursales aplica» ahora ACOTA de verdad ──────────────────────
--
-- Preguntado por el usuario el 2026-09-05: «que se marquen las sucursales a las
-- que aplica». Al ir a construirlo se midió que **ese concepto no existía**:
-- `promocion_corte_del_lote` y `promocion_avance` contaban las ventas de TODAS
-- las salas, y `promocion_reparto` sólo servía para mostrar el avance contra lo
-- asignado. O sea que una campaña de dos salas pagaba bono por una venta hecha
-- en una tercera.
--
-- ── El modelo no cambia, cambia lo que significa una fila ────────────────
-- `promocion_reparto` YA es «esta sala participa». Lo que se agrega es que una
-- fila con **0 unidades** valga como «aplica acá, sin lote asignado» —antes
-- sólo existía con un número— y que las dos funciones de cálculo **filtren por
-- esas salas**.
--
-- ── La compatibilidad es la parte delicada ──────────────────────────────
-- Un renglón **sin ninguna fila de reparto sigue contando TODAS las salas**.
-- Es el comportamiento de siempre y el más común: la mayoría de las campañas
-- son para toda la cadena. Sólo acota el que marcó salas.
--
-- Medido sobre agosto con Omega 3:
--   · sin marcar   → 30 filas, 6 salas, 129 unidades
--   · Salud 2 y 3  →  8 filas, 2 salas,  51 unidades  (30 + 21 del crudo)
--
-- Se hizo con **0 promociones vivas** en producción: cambiar cómo se calcula el
-- bono no movió ni un número ya calculado. Con campañas vivas esto habría
-- exigido una comparación antes/después por persona.

CREATE OR REPLACE FUNCTION public.promocion_corte_del_lote(p_promocion_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(renglon_id bigint, promocion_id bigint, cod_vendedor text, employee_id uuid, branch_id bigint, u_dentro numeric, u_excedente numeric, monto_dentro numeric, monto_excedente numeric, fondo_adm numeric, fondo_bodega numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
    v_ini   date;
    v_fin   date;
    v_prods integer[];
BEGIN
    SELECT min(r.inicio), max(r.fin), array_agg(DISTINCT r.erp_product_id)
      INTO v_ini, v_fin, v_prods
      FROM public.promocion_renglon r
     WHERE p_promocion_id IS NULL OR r.promocion_id = p_promocion_id;

    IF v_ini IS NULL THEN RETURN; END IF;

    RETURN QUERY
    -- `items` PRIMERO: el producto filtra fuerte y tiene índice. `facturas`
    -- sólo mira las que algún renglón referencia.
    WITH items AS MATERIALIZED (
        SELECT ii.id, ii.invoice_id, ii.erp_product_id, ii.factor_unidades, ii.cantidad
          FROM public.sales_invoice_items ii
         WHERE ii.erp_product_id = ANY (v_prods)
    ),
    facturas AS MATERIALIZED (
        SELECT si.id, si.branch_id, si.cod_vendedor, si.fecha
          FROM public.sales_invoices si
         WHERE si.fecha >= v_ini AND si.fecha <= v_fin
           AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
           AND si.id IN (SELECT i2.invoice_id FROM items i2)
    ),
    lineas AS (
        SELECT r.id AS renglon_id, r.promocion_id, r.lote_total,
               f.id AS invoice_id, i.id AS item_id,
               f.branch_id, f.cod_vendedor, f.fecha,
               (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric AS u_base,
               CASE WHEN r.factor_unidades IS NULL
                    THEN (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric
                    ELSE i.cantidad::numeric
               END AS u_pago
          FROM items i
          JOIN facturas f ON f.id = i.invoice_id
          JOIN public.promocion_renglon r
            ON r.erp_product_id = i.erp_product_id
           AND f.fecha BETWEEN r.inicio AND r.fin
           AND (r.factor_unidades IS NULL OR i.factor_unidades = r.factor_unidades)
           AND (p_promocion_id IS NULL OR r.promocion_id = p_promocion_id)
         WHERE NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v
                            WHERE v.invoice_id = f.id)
           -- ── Las salas donde APLICA ────────────────────────────────────
           -- Sin ninguna fila de reparto cuenta todas —el caso más común y el
           -- comportamiento de siempre—. Con salas marcadas, una venta hecha
           -- fuera de ellas no genera bono.
           AND (NOT EXISTS (SELECT 1 FROM public.promocion_reparto pr0
                             WHERE pr0.renglon_id = r.id)
                OR EXISTS (SELECT 1 FROM public.promocion_reparto pr
                            WHERE pr.renglon_id = r.id AND pr.branch_id = f.branch_id))
    ),
    -- La tarifa VIGENTE a la fecha de cada venta. Acá vive «sin retroactividad».
    con_tarifa AS (
        SELECT l.*, t.id AS tarifa_id, t.bono_vendedor, t.bono_adm, t.bono_bodega,
               greatest(coalesce(t.unidades_por_bono, 1), 1) AS upb
          FROM lineas l
          JOIN LATERAL (
              SELECT tt.id, tt.bono_vendedor, tt.bono_adm, tt.bono_bodega,
                     tt.unidades_por_bono
                FROM public.promocion_renglon_tarifa tt
               WHERE tt.renglon_id = l.renglon_id AND tt.desde <= l.fecha
               ORDER BY tt.desde DESC LIMIT 1
          ) t ON true
    ),
    ordenadas AS (
        SELECT c.*,
               sum(c.u_base) OVER (PARTITION BY c.renglon_id
                                   ORDER BY c.fecha, c.invoice_id, c.item_id
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acum
          FROM con_tarifa c
    ),
    partidas AS (
        SELECT o.*,
               greatest(least(o.u_base, o.lote_total - (o.acum - o.u_base)), 0) AS cabe
          FROM ordenadas o
    ),
    por_tramo AS (
        SELECT p.renglon_id, p.promocion_id, p.cod_vendedor, p.branch_id, p.tarifa_id,
               max(p.upb)           AS upb,
               max(p.bono_vendedor) AS monto,
               max(p.bono_adm)      AS monto_adm,
               max(p.bono_bodega)   AS monto_bod,
               sum(p.cabe)                                              AS u_base_dentro,
               sum(p.u_base - p.cabe)                                   AS u_base_fuera,
               sum(p.cabe              * (p.u_pago / nullif(p.u_base,0))) AS u_pago_dentro,
               sum((p.u_base - p.cabe) * (p.u_pago / nullif(p.u_base,0))) AS u_pago_fuera
          FROM partidas p
         GROUP BY p.renglon_id, p.promocion_id, p.cod_vendedor, p.branch_id, p.tarifa_id
    )
    SELECT t.renglon_id, t.promocion_id, t.cod_vendedor,
           e.id, t.branch_id,
           sum(t.u_base_dentro),
           sum(t.u_base_fuera),
           round(sum(floor(t.u_pago_dentro / t.upb) * t.monto), 2),
           round(sum(floor(t.u_pago_fuera  / t.upb) * t.monto), 2),
           round(sum(floor(t.u_pago_dentro / t.upb) * t.monto_adm), 2),
           round(sum(floor(t.u_pago_dentro / t.upb) * t.monto_bod), 2)
      FROM por_tramo t
      LEFT JOIN public.employees e
             ON e.code = t.cod_vendedor AND e.status = 'ACTIVO'
     GROUP BY t.renglon_id, t.promocion_id, t.cod_vendedor, e.id, t.branch_id
    HAVING sum(t.u_base_dentro + t.u_base_fuera) > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.promocion_avance(p_solo_abiertos boolean DEFAULT true)
 RETURNS TABLE(renglon_id bigint, branch_id bigint, vendido numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
    v_ini   date;
    v_fin   date;
    v_prods integer[];
BEGIN
    SELECT min(r.inicio), max(r.fin), array_agg(DISTINCT r.erp_product_id)
      INTO v_ini, v_fin, v_prods
      FROM public.promocion_renglon r
      JOIN public.promociones pm ON pm.id = r.promocion_id
     WHERE NOT p_solo_abiertos
        OR (r.estado = 'abierto' AND pm.estado = 'activa');

    IF v_ini IS NULL THEN RETURN; END IF;

    RETURN QUERY
    -- ⚠️ SÓLO (id, branch_id, fecha) y SIN filtrar por los items: así entra por
    -- Index Only Scan sobre `idx_si_fecha_estado_branch`. Pedir una columna más
    -- —o acotar por `si.id IN (…)`— rompe el index-only y la deja 2.3× más
    -- lenta. Medido el 2026-09-05.
    WITH facturas AS MATERIALIZED (
        SELECT si.id, si.branch_id, si.fecha
          FROM public.sales_invoices si
         WHERE si.fecha >= v_ini AND si.fecha <= v_fin
           AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
    ),
    items AS MATERIALIZED (
        SELECT ii.invoice_id, ii.erp_product_id, ii.factor_unidades, ii.cantidad
          FROM public.sales_invoice_items ii
         WHERE ii.erp_product_id = ANY (v_prods)
    )
    SELECT r.id, f.branch_id,
           sum(i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric
      FROM items i
      JOIN facturas f ON f.id = i.invoice_id
      JOIN public.promocion_renglon r
        ON r.erp_product_id = i.erp_product_id
       AND f.fecha BETWEEN r.inicio AND r.fin
       AND (r.factor_unidades IS NULL OR i.factor_unidades = r.factor_unidades)
      JOIN public.promociones pm ON pm.id = r.promocion_id
     WHERE (NOT p_solo_abiertos OR (r.estado = 'abierto' AND pm.estado = 'activa'))
       AND NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v
                        WHERE v.invoice_id = f.id)
       -- Las salas donde aplica: sin reparto, todas. Ver el encabezado.
       AND (NOT EXISTS (SELECT 1 FROM public.promocion_reparto pr0
                         WHERE pr0.renglon_id = r.id)
            OR EXISTS (SELECT 1 FROM public.promocion_reparto pr
                        WHERE pr.renglon_id = r.id AND pr.branch_id = f.branch_id))
     GROUP BY r.id, f.branch_id;
END;
$function$;
