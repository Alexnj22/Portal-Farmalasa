-- Conteo de Inventario — el resumen dice cuánto falta EN CADA ANAQUEL.
--
-- Bodega y área de vencidos son pestañas desde v2.754.0, y una pestaña esconde
-- lo que no está abierto: sin un número, «Área de vencidos» con todo contado y
-- con nueve productos sin tocar se ven exactamente igual desde afuera.
--
-- El número que se pinta en la píldora es el de PRODUCTOS que faltan, no el de
-- renglones, porque la lista de abajo se pagina por producto: decir «9» y que
-- al abrir haya 9 tarjetas es lo que hace que el número se pueda verificar de
-- un vistazo. Un producto con dos lotes, uno contado y otro no, cuenta como
-- uno: todavía hay trabajo ahí.
--
-- Va acá y no en una función nueva porque es exactamente el mismo barrido de
-- `conteo_inventario_items` que esta función ya hace — dos FILTER más sobre un
-- scan que ya ocurre, contra dos consultas de ida y vuelta cada vez que alguien
-- teclea una cantidad.
--
-- Sin la reja de `v_ver`: cuántos renglones faltan por contar no es una cifra
-- del sistema. Un conteo ciego tapa el sistema y la diferencia, nunca el avance
-- — de hecho, saber cuánto falta es lo único que la persona que cuenta tiene.
--
-- Medido en el conteo abierto de Bodega (2026-08-25): bodega 2,716 productos
-- (2,141 por contar), área de vencidos 77 (77 por contar), y el total distinto
-- es 2,756 — o sea que 37 productos viven en LOS DOS anaqueles. Ése es el
-- motivo de que las dos listas estén separadas, dicho en números.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_conteo_resumen(p_conteo_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $function$
DECLARE
  -- Mismo predicado que las cinco RPCs de lectura: sin el permiso y con el
  -- conteo abierto, las cifras del sistema no salen de la base. Una tarjeta
  -- "faltante $109,591" arriba de una tabla ciega revelaría de un golpe todo lo
  -- que la tabla está tapando renglón por renglón.
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
BEGIN
  RETURN (
    SELECT to_json(t)
    FROM (
      SELECT
        count(*)::int                                                                  AS total_items,
        count(DISTINCT ci.erp_product_id)::int                                         AS total_productos,
        count(*) FILTER (WHERE ci.estado_item <> 'PENDIENTE')::int                     AS contados,
        count(*) FILTER (WHERE ci.estado_item = 'PENDIENTE')::int                      AS pendientes,
        count(*) FILTER (WHERE ci.estado_item = 'SIN_UBICAR')::int                     AS sin_ubicar,
        count(*) FILTER (WHERE ci.recontado_at IS NOT NULL)::int                       AS recontados,
        count(*) FILTER (WHERE ci.es_agregado_manual)::int                             AS agregados,
        count(DISTINCT ci.contado_por)::int                                            AS contadores,
        -- ── Cuánto falta en cada anaquel ────────────────────────────────────
        -- Productos, no renglones: es la unidad que la lista pagina y muestra.
        count(DISTINCT ci.erp_product_id)
          FILTER (WHERE ci.estado_item = 'PENDIENTE' AND NOT ci.is_vencidos)::int      AS pendientes_bodega,
        count(DISTINCT ci.erp_product_id)
          FILTER (WHERE ci.estado_item = 'PENDIENTE' AND ci.is_vencidos)::int          AS pendientes_vencidos,
        -- Y cuántos productos tiene cada anaquel en total. Sin esto, «0 por
        -- contar» no distingue «ya lo conté todo» de «acá no hay nada»: la
        -- pestaña del área de vencidos no debe existir en el segundo caso, y
        -- hasta hoy eso se deducía de una consulta aparte que baja 500 filas
        -- para mirarles el largo.
        count(DISTINCT ci.erp_product_id) FILTER (WHERE NOT ci.is_vencidos)::int       AS productos_bodega,
        count(DISTINCT ci.erp_product_id) FILTER (WHERE ci.is_vencidos)::int           AS productos_vencidos,
        CASE WHEN v_ver THEN count(*) FILTER (WHERE ci.diferencia IS NOT NULL AND ci.diferencia <> 0)::int END AS con_diferencia,
        CASE WHEN v_ver THEN COALESCE(SUM(GREATEST(-ci.diferencia, 0) * COALESCE(ci.costo_unitario, 0)), 0) END AS valor_faltante,
        CASE WHEN v_ver THEN COALESCE(SUM(GREATEST( ci.diferencia, 0) * COALESCE(ci.costo_unitario, 0)), 0) END AS valor_sobrante,
        v_ver                                                                          AS ver_sistema
      FROM public.conteo_inventario_items ci
      WHERE ci.conteo_id = p_conteo_id
    ) t
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteo_resumen(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_conteo_resumen(uuid) TO authenticated, service_role;
