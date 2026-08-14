SET lock_timeout = '5s';

-- Una solicitud de MIN/MAX que no cambia lo que la sala repone no debería
-- poder nacer. Medido el 2026-08-14 sobre las 5 pendientes de Salud 2: CUATRO
-- eran exactamente eso —CHIP DIGICEL, NORGESIC, CARBIMEN y LAMICTAL, todas
-- pidiendo 0 · 0 sobre un producto que ya no se repone— y la única real era
-- CIPRO DENK (0 · 1 → 0 · 0, que sí apaga el «traelo por encargo»).
--
-- El punto de fondo: para la reposición, «—» y «0» son LO MISMO. El pedido
-- entra por `minmax_eff_max(...) > 0` (get_pedido_preview), y esa función
-- coalesce los NULL a 0 — o sea que un producto sin par publicado y uno
-- publicado en 0 · 0 son indistinguibles ahí. La pantalla los dibuja distinto
-- («— · —» contra «0 · 0») y eso hizo creer que pasar de uno al otro era un
-- ajuste. No lo es.
--
-- Los tres casos que el disparador corta, y los tres son callejones sin salida
-- que ya existían — no reglas nuevas de negocio:
--
--  1. **Producto oculto.** Ocultar deja el par en «— · —» publicado
--     (TabMinMax.jsx:1196), y `approve_minmax_request` REVIENTA con
--     PRODUCT_HIDDEN. La solicitud nacía muerta: quien la aprobara se llevaba
--     un error de Postgres y la solicitud se quedaba pendiente para siempre.
--  2. **Bodega.** `approve_minmax_request` también reviste con
--     BODEGA_NOT_APPROVABLE_HERE: su par sale de la suma de las salas. El
--     selector del tablero SÍ ofrece Bodega (ERP_ORDEN la incluye), así que la
--     puerta estaba abierta; hoy no hay ninguna solicitud así, y no la va a
--     haber.
--  3. **Sin cambio.** El par propuesto es el que la sala ya tiene, con «sin
--     fila» y «— · —» contando como 0 · 0.
--
-- Por qué el par de HOY se lee de `product_stock_params` y no de las columnas
-- `current_min`/`current_max` de la propia solicitud: esas las escribe el
-- navegador. Un formulario abierto hace media hora manda un retrato viejo, y
-- una guarda que se cree lo que le manda el cliente no es una guarda. Es la
-- misma razón por la que `approve_minmax_request` ignora `p_decided_by`.
CREATE OR REPLACE FUNCTION public.mmcr_solicitud_con_efecto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_oculto  boolean;
  v_hoy_min integer;
  v_hoy_max integer;
BEGIN
  IF NEW.erp_sucursal_id = 6 THEN
    RAISE EXCEPTION 'MMCR_BODEGA: Bodega no admite solicitudes de MIN/MAX — su par sale de la suma de las salas (trg_bodega_draft_sync)';
  END IF;

  -- SECURITY DEFINER a propósito: hoy `psp_select` es USING (true), pero si esa
  -- policy se ajusta alguna vez, un INVOKER dejaría de ver la fila y la guarda
  -- leería «0 · 0» donde hay «5 · 10» — o sea rechazaría por «sin cambio» algo
  -- que sí cambia. No ver y ver un cero se parecen demasiado.
  SELECT p.is_hidden,
         public.minmax_eff_min(p.min_units, p.max_units, p.manual_min, p.manual_max),
         public.minmax_eff_max(p.min_units, p.max_units, p.manual_min, p.manual_max)
    INTO v_oculto, v_hoy_min, v_hoy_max
  FROM public.product_stock_params p
  WHERE p.erp_product_id  = NEW.erp_product_id
    AND p.erp_sucursal_id = NEW.erp_sucursal_id;

  IF v_oculto IS TRUE THEN
    RAISE EXCEPTION 'MMCR_PRODUCTO_OCULTO: el producto está oculto en esa sala — hoy no entra en sus pedidos y aprobar la solicitud fallaría';
  END IF;

  -- Sin fila = nunca tuvo par en esa sala = no se repone = 0 · 0.
  v_hoy_min := COALESCE(v_hoy_min, 0);
  v_hoy_max := COALESCE(v_hoy_max, 0);

  IF COALESCE(NEW.requested_min, 0) = v_hoy_min
     AND COALESCE(NEW.requested_max, 0) = v_hoy_max THEN
    RAISE EXCEPTION 'MMCR_SIN_CAMBIO: el par propuesto (% · %) es el que la sala ya tiene', v_hoy_min, v_hoy_max;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.mmcr_solicitud_con_efecto() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.mmcr_solicitud_con_efecto() IS
  'Corta las solicitudes de MIN/MAX que no pueden hacer nada: producto oculto, Bodega, o par idéntico al de hoy (— cuenta como 0). Decisión del usuario, 2026-08-14.';

DROP TRIGGER IF EXISTS trg_mmcr_solicitud_con_efecto ON public.minmax_change_requests;
CREATE TRIGGER trg_mmcr_solicitud_con_efecto
BEFORE INSERT ON public.minmax_change_requests
FOR EACH ROW EXECUTE FUNCTION public.mmcr_solicitud_con_efecto();
