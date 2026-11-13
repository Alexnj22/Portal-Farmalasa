-- Anular vuelve a pedir una caja abierta (2026-11-13).
--
-- `20260825031643` puso en `validar_solicitud_facturacion()` el freno
-- «sólo se anula mientras la sala tenga caja abierta» (`sala_con_caja_abierta`).
-- Al día siguiente `20260826222947_una_venta_emitida_no_se_pasa_a_credito`
-- reescribió la función desde una versión ANTERIOR y el freno desapareció sin
-- error: desde el 26-ago la base aceptaba pedir una anulación con la caja ya
-- cerrada. Lo seguían frenando la pantalla y `aplicar-solicitud-facturacion`
-- (al aprobar). Medido en la auditoría de pendientes del 13-nov.
--
-- Se repone partiendo de la definición VIVA (conserva el freno de «no pasar a
-- crédito» y la regla de factura anulada de la versión actual) y sólo se le
-- suman tres piezas: la variable, la sala leída de la FACTURA (nunca del
-- `metadata` que manda el navegador) y el freno. Si alguna frase no está,
-- avisa y no toca nada (el entorno de pruebas repite esta historia).
SET lock_timeout = '5s';

DO $mig$
DECLARE
  v_def   text := pg_get_functiondef('public.validar_solicitud_facturacion()'::regprocedure);
  v_nuevo text;
  a1 text := E'    v_id     bigint;\nBEGIN';
  b1 text := E'    v_id     bigint;\n    v_branch bigint;\nBEGIN';
  a2 text := 'SELECT estado INTO v_estado FROM public.sales_invoices WHERE id = v_id;';
  b2 text := E'-- La sala sale de la FACTURA, nunca del `metadata` que mandó el navegador.\n    SELECT estado, branch_id INTO v_estado, v_branch FROM public.sales_invoices WHERE id = v_id;';
  a3 text := E'    END IF;\n\n    RETURN NEW;\nEND;';
  b3 text := E'    END IF;\n\n    -- Sólo la anulación: el efectivo devuelto sale de una caja abierta de esa sala.\n    IF NEW.type = ''ANNULMENT_REQUEST''\n       AND NOT public.sala_con_caja_abierta(v_branch) THEN\n        RAISE EXCEPTION ''CAJA_CERRADA: esa sala ya sacó su cierre del día, así que no hay caja de dónde descontar.'';\n    END IF;\n\n    RETURN NEW;\nEND;';
BEGIN
  IF position('sala_con_caja_abierta' IN v_def) > 0 THEN
    RAISE NOTICE 'validar_solicitud_facturacion ya tiene el freno'; RETURN;
  END IF;
  IF position(a1 IN v_def) = 0 OR position(a2 IN v_def) = 0 OR position(a3 IN v_def) = 0 THEN
    RAISE NOTICE 'validar_solicitud_facturacion: la definición no es la esperada; no se toca'; RETURN;
  END IF;
  v_nuevo := replace(replace(replace(v_def, a1, b1), a2, b2), a3, b3);
  EXECUTE v_nuevo;
END
$mig$;
