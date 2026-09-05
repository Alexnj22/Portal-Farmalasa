SET lock_timeout = '5s';

-- El costo que se compara contra el precio de venta va CON IVA.
--
-- ── Lo que estaba mal, y por qué no se notaba ─────────────────────────────
-- `product_precios.vineta` es el precio al público, o sea CON IVA (medido: el
-- producto 4792 tiene vineta 13.50 y la factura de compra lo trae a 11.9469
-- neto = 13.50/1.13). `product_precios.costo`, en cambio, es EXACTAMENTE el
-- `precio_unitario` de la compra —ratio 1.0000 en las 8 comparaciones—, y ese
-- precio es NETO: de 1,237 recibos con IVA de los últimos tres meses, la suma
-- de sus renglones da el **subtotal** en 471 y el **total** en CERO.
--
-- Así que la pantalla comparaba dos números que no viven en la misma escala:
-- el costo salía 13 % más barato de lo que es, y el aviso «bajo el costo»
-- dejaba pasar descuentos que sí venden perdiendo.
--
-- La tasa es 13 % y no una columna: de 3,039 recibos de 2026, **ninguno** tiene
-- una tasa distinta (7 no llevan IVA del todo, y ésos son exentos, no otra
-- tasa).
--
-- Se llama `costo_con_iva` a propósito. `costo` a secas es el nombre de la
-- columna cruda, y dejarlo igual invitaba a que el próximo lector lo comparara
-- otra vez contra un precio con IVA sin enterarse.
CREATE OR REPLACE FUNCTION public.get_precios_para_descuento(p_ids int[])
RETURNS json
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

    SELECT coalesce(json_agg(to_json(x) ORDER BY x.nombre), '[]'::json)
      INTO v_out
      FROM (
        SELECT p.id,
               p.nombre,
               -- El precio MÁS BAJO y el costo MÁS ALTO: el peor caso decide.
               -- Si la presentación con menos margen aguanta el descuento,
               -- todas aguantan; un promedio esconde justo la que se vendería
               -- perdiendo.
               min(pp.vineta) FILTER (WHERE pp.activo AND pp.vineta > 0) AS precio,
               round(max(pp.costo) FILTER (WHERE pp.activo AND pp.costo > 0) * 1.13, 4)
                   AS costo_con_iva
          FROM public.products p
          LEFT JOIN public.product_precios pp ON pp.product_id = p.id
         WHERE p.id = ANY(p_ids)
         GROUP BY p.id, p.nombre
      ) x;

    RETURN v_out;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_precios_para_descuento(int[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_precios_para_descuento(int[]) TO authenticated, service_role;
