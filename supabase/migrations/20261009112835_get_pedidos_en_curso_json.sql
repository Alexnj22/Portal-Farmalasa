-- 14 · get_pedidos_en_curso: sin techo de 1000 filas y acotable por fecha
--      (2026-10-08; aplicada 2026-10-09).
--
-- Era `RETURNS TABLE` (SETOF) sin ningún tope de fechas: devolvía TODA sala de
-- todo pedido no anulado desde el primero. Medido: 194 filas, ~353 KB, ~50
-- filas por mes. A las 1000 PostgREST la corta en silencio (CLAUDE.md, regla
-- crítica): en ~16 meses el tablero empezaría a perder pedidos sin error.
--
-- Dos cambios:
--   1. `RETURNS json` (Patrón C, `json_agg(to_json(t))`, nunca jsonb): el
--      límite de PostgREST no aplica a un único objeto JSON.
--   2. Parámetro opcional `p_desde date DEFAULT NULL`. Con NULL devuelve lo
--      mismo que antes (verificado byte a byte por PostgREST con supabase-js
--      2.97 y 2.117 en pruebas). Con fecha, devuelve las salas de pedidos
--      creados desde ese día MÁS toda sala que siga abierta o con observación.
--      ⚠ No ve lo «sin ingresar» (sale de otra consulta): el frontend no debe
--      pasar `p_desde` en «Pendientes» hasta resolverlo. Hoy nadie lo pasa.
--
-- Compatible hacia atrás: `supabase.rpc('get_pedidos_en_curso')` sigue dando
-- el mismo arreglo con las mismas claves y el mismo orden; las apps ya
-- instaladas no se enteran. `src/types/database.ts` → `npm run tipos:base`.
--
-- INVOKER, como antes (el RLS decide qué salas ve cada quien). plpgsql para no
-- caer en la trampa 4. DROP + CREATE porque cambia el tipo de retorno; nada
-- depende de ella (medido).
SET lock_timeout = '5s';


DROP FUNCTION IF EXISTS public.get_pedidos_en_curso();

CREATE OR REPLACE FUNCTION public.get_pedidos_en_curso(p_desde date DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN (
    SELECT coalesce(json_agg(to_json(t)
                    ORDER BY CASE WHEN t.status IN ('completado', 'parcial') THEN 1 ELSE 0 END,
                             t.created_at DESC), '[]'::json)
    FROM (
      SELECT
        p.id                          AS pedido_id,
        p.numero                      AS numero,
        pss.codigo                    AS codigo,
        p.notes                       AS notes,
        p.status                      AS status,
        p.created_at                  AS created_at,
        salida.salio_at               AS enviado_at,
        pss.erp_sucursal_id           AS erp_sucursal_id,
        pss.iniciado_at               AS iniciado_at,
        pss.finalizado_at             AS finalizado_at,
        pss.pausado_at                AS pausado_at,
        pss.reanudado_at              AS reanudado_at,
        pss.llegada_fisica_at         AS llegada_fisica_at,
        pss.llegada_fisica_por        AS llegada_fisica_por,
        pss.recibido_erp_at           AS recibido_erp_at,
        pss.recibido_erp_por          AS recibido_erp_por,
        pss.diferencias_reportadas_at AS diferencias_reportadas_at,
        pss.diferencias_reportadas_por AS diferencias_reportadas_por,
        pss.corregido_bodega_at       AS corregido_bodega_at,
        pss.corregido_bodega_por      AS corregido_bodega_por,
        pss.corregido_bodega_nota     AS corregido_bodega_nota,
        pss.confirmado_correccion_at  AS confirmado_correccion_at,
        pss.confirmado_correccion_por AS confirmado_correccion_por,
        COALESCE(
          (SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(pph.reanudado_at, NOW()) - pph.pausado_at)) / 60)::INT
           FROM   pedido_pausa_historial pph
           WHERE  pph.pedido_id = p.id AND pph.erp_sucursal_id = pss.erp_sucursal_id), 0
        )::integer                    AS min_pausado_total,
        p.created_by                  AS created_by,
        pss.iniciado_por              AS iniciado_por,
        pss.finalizado_por            AS finalizado_por,
        salida.despacho_por           AS enviado_por,
        pss.llegada_tipo              AS llegada_tipo,
        pss.llegada_nota              AS llegada_nota,
        COALESCE(pss.falta_cajas,        '[]'::jsonb) AS falta_cajas,
        pss.falta_caja_at             AS falta_caja_at,
        COALESCE(pss.cajas_danadas,      '[]'::jsonb) AS cajas_danadas,
        COALESCE(pss.reenvios_historial, '[]'::jsonb) AS reenvios_historial,
        pss.reenvio_bodega_at         AS reenvio_bodega_at,
        pss.reenvio_por               AS reenvio_por,
        pss.segunda_llegada_at        AS segunda_llegada_at,
        pss.total_cajas               AS total_cajas,
        COALESCE(pss.caja_map, '{}'::jsonb) AS caja_map,
        COALESCE(pss.cajas_electrolit, 0)   AS cajas_electrolit,
        pss.electrolit_ok             AS electrolit_ok,
        pss.electrolit_faltantes      AS electrolit_faltantes,
        COALESCE(pss.cajas_especiales,          '[]'::jsonb) AS cajas_especiales,
        COALESCE(pss.cajas_especiales_llegadas, '{}'::jsonb) AS cajas_especiales_llegadas,
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
              'razon',         pph.razon,
              'pausado_at',    pph.pausado_at,
              'pausado_por',   pph.pausado_por,
              'reanudado_at',  pph.reanudado_at,
              'reanudado_por', pph.reanudado_por
            ) ORDER BY pph.pausado_at)
           FROM pedido_pausa_historial pph
           WHERE pph.pedido_id = p.id AND pph.erp_sucursal_id = pss.erp_sucursal_id),
          '[]'::jsonb
        )                             AS pauses,
        p.status                      AS pedido_status,
        pss.reanudado_por             AS reanudado_por,
        pss.entrega_programada_at     AS entrega_programada_at,
        COALESCE(pss.entrega_programada_historial, '[]'::jsonb) AS entrega_programada_historial
      FROM  pedidos p
      JOIN  pedido_sucursal_status pss ON pss.pedido_id = p.id
      LEFT JOIN LATERAL (
        SELECT r.created_at AS salio_at, r.created_by AS despacho_por
        FROM   ruta_pedidos rp
        JOIN   rutas r ON r.id = rp.ruta_id
        WHERE  rp.pedido_id = pss.pedido_id
          AND  rp.erp_sucursal_id = pss.erp_sucursal_id
        ORDER  BY r.created_at
        LIMIT  1
      ) salida ON TRUE
      WHERE p.status <> 'anulado'
        AND (p_desde IS NULL
             OR p.created_at >= (p_desde::timestamp AT TIME ZONE 'UTC')
             OR pss.recibido_erp_at IS NULL
             OR (pss.diferencias_reportadas_at IS NOT NULL AND pss.confirmado_correccion_at IS NULL)
             OR coalesce(pss.llegada_tipo, '') NOT IN ('', 'completa')
             OR (jsonb_typeof(pss.falta_cajas) = 'array' AND jsonb_array_length(pss.falta_cajas) > 0)
             OR (jsonb_typeof(pss.cajas_danadas) = 'array' AND jsonb_array_length(pss.cajas_danadas) > 0)
             OR pss.electrolit_ok IS FALSE
             OR (coalesce(pss.electrolit_faltantes, 0) > 0 AND pss.electrolit_ok IS NOT TRUE)
             OR (jsonb_typeof(pss.cajas_especiales_llegadas) = 'object'
                 AND EXISTS (SELECT 1 FROM jsonb_each_text(pss.cajas_especiales_llegadas) e
                             WHERE e.value = 'faltante'))
             OR (jsonb_typeof(pss.reenvios_historial) = 'array'
                 AND EXISTS (SELECT 1 FROM jsonb_array_elements(pss.reenvios_historial) c
                             WHERE nullif(c->>'arrived_at', '') IS NULL)))
    ) t
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_pedidos_en_curso(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_pedidos_en_curso(date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
