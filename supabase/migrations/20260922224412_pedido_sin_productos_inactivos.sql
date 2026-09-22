-- Un producto INACTIVO no entra al pedido — regla del usuario, 2026-09-22:
-- «si están ocultos, inactivos, no debe de afectar».
--
-- `get_pedido_preview` unía `products` sin mirar `activo`: medido ese día, el
-- pedido de las seis salas traía 1 renglón de un producto inactivo
-- (APLICACION DE INYECCION, 4 en Salud 3). Los ocultos ya no entraban.
--
-- Se agrega `AND p.activo` al único JOIN con `products`. El cuerpo sale de
-- `prosrc`; si ese JOIN no aparece exactamente una vez, aborta.

SET lock_timeout = '5s';

DO $mig$
DECLARE
    v_src   text;
    v_viejo text := 'JOIN products p ON p.id = cr.erp_product_id';
    v_nuevo text := 'JOIN products p ON p.id = cr.erp_product_id AND p.activo  -- inactivo: no se pide (2026-09-22)';
    v_def   text;
BEGIN
    SELECT prosrc INTO v_src FROM pg_proc
     WHERE oid = 'public.get_pedido_preview(integer[], integer[])'::regprocedure;
    IF (length(v_src) - length(replace(v_src, v_viejo, ''))) / length(v_viejo) <> 1 THEN
        RAISE EXCEPTION 'CUERPO_INESPERADO: el JOIN con products de get_pedido_preview no aparece exactamente una vez';
    END IF;
    -- La cabecera se toma de la definición viva (lenguaje, volatilidad,
    -- DEFINER, search_path) y se le cambia sólo el cuerpo.
    v_def := pg_get_functiondef('public.get_pedido_preview(integer[], integer[])'::regprocedure);
    EXECUTE replace(v_def, v_src, replace(v_src, v_viejo, v_nuevo));
END
$mig$;
