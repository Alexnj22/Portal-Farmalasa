SET lock_timeout = '5s';

-- «En ruta» es de la SALA, no del pedido.
--
-- `crear_ruta` estampa `pedidos.enviado_at`/`enviado_por` sobre el PEDIDO
-- entero, y esta función se los copiaba a cada una de sus salas. En un pedido
-- de dos salas donde sólo una se despachó, la que se quedó en Bodega heredaba
-- la hora de salida de la otra: la tarjeta decía «En ruta 11:51 a.m.» sobre una
-- sala que nadie había empezado siquiera a preparar.
--
-- Medido el 2026-08-24, pedido 137 (`07-240826-2-S1` / `09-240826-2-S2`):
-- Salud 1 salió en la ruta #21, Salud 2 tenía `iniciado_at` y `finalizado_at`
-- en NULL y ninguna fila en `ruta_pedidos` — y aun así se pintaba dentro de la
-- ruta, con su nodo «En ruta» y con el botón de confirmar llegada de cajas.
--
-- La salida de una sala es la de SU parada. Verificado antes de cambiarlo:
-- de las 29 salas despachadas (pedido enviado + sala finalizada) las 29 tienen
-- parada, no hay ninguna sala con llegada o ingreso sin parada, y sobre las 111
-- salas del historial la expresión nueva cambia UNA sola fila: la de Salud 2.
CREATE OR REPLACE FUNCTION public.get_pedidos_en_curso()
 RETURNS TABLE(pedido_id uuid, numero integer, codigo text, notes text, status text, created_at timestamp with time zone, enviado_at timestamp with time zone, erp_sucursal_id integer, iniciado_at timestamp with time zone, finalizado_at timestamp with time zone, pausado_at timestamp with time zone, reanudado_at timestamp with time zone, llegada_fisica_at timestamp with time zone, llegada_fisica_por uuid, recibido_erp_at timestamp with time zone, recibido_erp_por uuid, diferencias_reportadas_at timestamp with time zone, diferencias_reportadas_por uuid, corregido_bodega_at timestamp with time zone, corregido_bodega_por uuid, corregido_bodega_nota text, confirmado_correccion_at timestamp with time zone, confirmado_correccion_por uuid, min_pausado_total integer, created_by uuid, iniciado_por uuid, finalizado_por uuid, enviado_por uuid, llegada_tipo text, llegada_nota text, falta_cajas jsonb, falta_caja_at timestamp with time zone, cajas_danadas jsonb, reenvios_historial jsonb, reenvio_bodega_at timestamp with time zone, reenvio_por uuid, segunda_llegada_at timestamp with time zone, total_cajas integer, caja_map jsonb, cajas_electrolit integer, electrolit_ok boolean, electrolit_faltantes integer, cajas_especiales jsonb, cajas_especiales_llegadas jsonb, pauses jsonb, pedido_status text, reanudado_por uuid, entrega_programada_at timestamp with time zone, entrega_programada_historial jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    p.id,
    p.numero, pss.codigo, p.notes, p.status,
    p.created_at, salida.salio_at, pss.erp_sucursal_id,
    pss.iniciado_at, pss.finalizado_at, pss.pausado_at, pss.reanudado_at,
    pss.llegada_fisica_at, pss.llegada_fisica_por,
    pss.recibido_erp_at, pss.recibido_erp_por,
    pss.diferencias_reportadas_at, pss.diferencias_reportadas_por,
    pss.corregido_bodega_at, pss.corregido_bodega_por, pss.corregido_bodega_nota,
    pss.confirmado_correccion_at, pss.confirmado_correccion_por,
    COALESCE(
      (SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(pph.reanudado_at, NOW()) - pph.pausado_at)) / 60)::INT
       FROM   pedido_pausa_historial pph
       WHERE  pph.pedido_id = p.id AND pph.erp_sucursal_id = pss.erp_sucursal_id), 0
    ),
    p.created_by, pss.iniciado_por, pss.finalizado_por, salida.despacho_por,
    pss.llegada_tipo, pss.llegada_nota,
    COALESCE(pss.falta_cajas,        '[]'::jsonb),
    pss.falta_caja_at,
    COALESCE(pss.cajas_danadas,      '[]'::jsonb),
    COALESCE(pss.reenvios_historial, '[]'::jsonb),
    pss.reenvio_bodega_at, pss.reenvio_por, pss.segunda_llegada_at,
    pss.total_cajas, COALESCE(pss.caja_map, '{}'::jsonb),
    COALESCE(pss.cajas_electrolit, 0),
    pss.electrolit_ok,
    pss.electrolit_faltantes,
    COALESCE(pss.cajas_especiales,          '[]'::jsonb),
    COALESCE(pss.cajas_especiales_llegadas, '{}'::jsonb),
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
    ),
    p.status,
    pss.reanudado_por,
    pss.entrega_programada_at,
    COALESCE(pss.entrega_programada_historial, '[]'::jsonb)
  FROM  pedidos p
  JOIN  pedido_sucursal_status pss ON pss.pedido_id = p.id
  -- La parada de ESTA sala. `LEFT JOIN LATERAL` y no un `EXISTS`: hace falta
  -- la hora y el autor, no sólo si existe. La primera ruta manda — una sala
  -- despachada dos veces (reenvío) salió por primera vez con la primera.
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
  ORDER BY
    CASE WHEN p.status IN ('completado', 'parcial') THEN 1 ELSE 0 END,
    p.created_at DESC;
$function$;
