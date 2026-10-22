-- Anular el cobro de una reserva que ya se ajustó (2026-10-22).
--
-- `reserva_ajustar` y `reserva_precio_de_bodega` reparten el anticipo entre la
-- reserva original y las que nacen de ella (`ajuste_de`): lo que se queda, la
-- alternativa, el resto a otro precio y el sobrante a favor. Si DESPUÉS se
-- anula o se corrige a la baja el cobro que trajo ese dinero (`operar-caja`:
-- rechazo del comprobante o corrección aprobada), `apartado_deshacer` sólo
-- miraba la fila original:
--   · si la reserva nació de ese cobro intentaba BORRARLA, y la FK de
--     `ajuste_de` / `app_encargos.reserva_id` lo impedía — el error queda en el
--     registro de la edge function y la reserva sigue pagada con dinero anulado;
--   · si no, restaba de la original con tope 0, y lo que había pasado a la
--     alternativa o al saldo a favor quedaba vivo.
--
-- Ahora el dinero sale de la FAMILIA entera: primero la original, después las
-- nacidas de ella en orden, y de un saldo a favor sólo lo que no se usó ni se
-- devolvió. Lo que ya no está (se usó en caja o se entregó) no se inventa: se
-- le avisa a la sala con el monto.
SET lock_timeout = '5s';

ALTER TABLE public.saldo_favor_movimientos DROP CONSTRAINT IF EXISTS saldo_favor_movimientos_tipo_check;
ALTER TABLE public.saldo_favor_movimientos ADD CONSTRAINT saldo_favor_movimientos_tipo_check
  CHECK (tipo = ANY (ARRAY['uso', 'devolucion', 'vencimiento', 'reverso', 'anulacion']));

CREATE OR REPLACE FUNCTION public.reserva_quitar_de_familia(p_id bigint, p_monto numeric, p_nota text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_falta numeric := round(coalesce(p_monto, 0), 2);
  f record; k record; v_quita numeric; v_ant numeric; v_saldo numeric;
BEGIN
  IF v_falta <= 0 THEN RETURN 0; END IF;
  FOR f IN
    WITH RECURSIVE fam AS (
      SELECT id, 0 AS nivel FROM public.app_reservas WHERE id = p_id
      UNION ALL
      SELECT r.id, fam.nivel + 1 FROM public.app_reservas r JOIN fam ON r.ajuste_de = fam.id WHERE fam.nivel < 10)
    SELECT r.* FROM fam JOIN public.app_reservas r ON r.id = fam.id
     ORDER BY fam.nivel, r.id
       FOR UPDATE OF r
  LOOP
    EXIT WHEN v_falta <= 0;
    IF f.pago_metodo = 'en_linea' THEN CONTINUE; END IF;
    IF f.estado IN ('pendiente', 'lista') THEN
      v_quita := least(coalesce(f.anticipo, 0), v_falta);
      IF v_quita <= 0 THEN CONTINUE; END IF;
      v_ant := round(coalesce(f.anticipo, 0) - v_quita, 2);
      SELECT * INTO k FROM public.reserva_cuenta(f.id);
      UPDATE public.app_reservas
         SET anticipo = v_ant,
             pago_estado = CASE WHEN v_ant > 0 AND v_ant >= k.total - 0.004 THEN 'pagado' WHEN v_ant > 0 THEN 'anticipo' ELSE 'pendiente' END,
             pago_metodo = CASE WHEN v_ant > 0 THEN pago_metodo ELSE 'al_retirar' END,
             pagado_at = CASE WHEN v_ant > 0 THEN pagado_at END,
             updated_at = now()
       WHERE id = f.id;
      v_falta := round(v_falta - v_quita, 2);
    ELSIF coalesce(f.saldo_favor, 0) > 0 AND f.saldo_favor_usado_at IS NULL AND f.saldo_favor_devuelto_at IS NULL THEN
      v_quita := least(f.saldo_favor, v_falta);
      v_saldo := round(f.saldo_favor - v_quita, 2);
      UPDATE public.app_reservas
         SET saldo_favor_inicial = coalesce(saldo_favor_inicial, saldo_favor),
             saldo_favor = v_saldo, anticipo = greatest(round(coalesce(anticipo, 0) - v_quita, 2), 0), updated_at = now()
       WHERE id = f.id;
      INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, branch_id, employee_id, nota)
      VALUES (f.id, 'anulacion', v_quita, v_saldo, f.branch_id, public.auth_employee_id(), left(coalesce(p_nota, 'Se anuló el cobro que lo originó.'), 300));
      v_falta := round(v_falta - v_quita, 2);
    END IF;
  END LOOP;
  IF v_falta > 0 THEN
    PERFORM public.reserva_avisar_sala(p_id, 'Cobro anulado: falta descontar',
      format('Se anuló un cobro de esta reserva y $%s ya se había usado o entregado. Revísalo con administración.',
             to_char(v_falta, 'FM999990.00')), 'anulacion_sin_cubrir');
  END IF;
  RETURN v_falta;
END $function$;

REVOKE EXECUTE ON FUNCTION public.reserva_quitar_de_familia(bigint, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserva_quitar_de_familia(bigint, numeric, text) TO service_role;

CREATE OR REPLACE FUNCTION public.apartado_deshacer(p_movimiento bigint, p_anular boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  m public.caja_movimientos_portal%ROWTYPE; r public.app_reservas; k record;
  v_prev jsonb; v_nuevo numeric; v_en_linea boolean; v_familia boolean;
BEGIN
  SELECT * INTO m FROM public.caja_movimientos_portal WHERE id = p_movimiento FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF m.tipo_codigo IS DISTINCT FROM 'APARTADO' THEN RETURN; END IF;
  v_prev := m.apartado_previo;
  IF m.reserva_id IS NOT NULL THEN
    SELECT * INTO r FROM public.app_reservas WHERE id = m.reserva_id FOR UPDATE;
    IF FOUND THEN
      -- Se ajustó o se encargó el resto (2026-10-22): ya no es una fila sola.
      v_familia := EXISTS (SELECT 1 FROM public.app_reservas x WHERE x.ajuste_de = r.id)
                OR EXISTS (SELECT 1 FROM public.app_encargos e WHERE e.reserva_id = r.id);
      -- Se borra sólo si: es de sala, la creó ESTE cobro (anotado; en los
      -- cobros viejos sin anotar, la reserva nació después del movimiento),
      -- no hay otro cobro vivo sobre ella, sigue abierta, su anticipo no se
      -- aplicó a ninguna factura y nada nació de ella. Una reserva de la app
      -- NUNCA se borra.
      IF NOT v_familia AND r.origen = 'sucursal' AND r.estado IN ('pendiente', 'lista')
         AND (v_prev->>'modo' = 'nueva' OR (v_prev IS NULL AND r.created_at >= m.created_at))
         AND NOT EXISTS (SELECT 1 FROM public.caja_movimientos_portal x
                          WHERE x.reserva_id = r.id AND x.id <> m.id AND x.anulado_at IS NULL AND x.tipo_codigo = 'APARTADO')
         AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id) THEN
        UPDATE public.caja_movimientos_portal SET reserva_id = NULL WHERE id = m.id;
        DELETE FROM public.app_reservas WHERE id = r.id;     -- nació de este cobro
      ELSIF v_familia THEN
        -- El dinero se repartió: sale de la familia entera.
        PERFORM public.reserva_quitar_de_familia(r.id, m.monto,
          format('Se anuló el cobro %s que lo originó.', m.id));
      ELSE
        -- Si no, se le resta lo de este cobro y el estado de pago se recalcula:
        -- con anticipo 0 no puede quedar 'anticipo'; vuelve al de antes.
        SELECT * INTO k FROM public.reserva_cuenta(r.id);
        v_nuevo := greatest(round(coalesce(r.anticipo, 0) - m.monto, 2), 0);
        v_en_linea := r.pago_estado = 'pagado' AND r.pago_metodo = 'en_linea';
        UPDATE public.app_reservas
           SET anticipo = v_nuevo,
               pago_estado = CASE
                 WHEN v_en_linea THEN pago_estado
                 WHEN v_nuevo > 0 AND v_nuevo >= k.total - 0.004 THEN 'pagado'
                 WHEN v_nuevo > 0 THEN 'anticipo'
                 ELSE coalesce(nullif(v_prev->>'pago_estado', 'anticipo'), 'pendiente') END,
               pago_metodo = CASE WHEN v_en_linea OR v_nuevo > 0 OR v_prev IS NULL OR NOT (v_prev ? 'pago_metodo') THEN pago_metodo
                                  ELSE coalesce(v_prev->>'pago_metodo', pago_metodo) END,
               pagado_at = CASE WHEN v_en_linea OR v_nuevo > 0 THEN pagado_at
                                ELSE (v_prev->>'pagado_at')::timestamptz END,
               updated_at = now()
         WHERE id = r.id;
      END IF;
    END IF;
  END IF;
  IF m.encargo_id IS NOT NULL THEN
    UPDATE public.app_encargos
       SET pago_estado = 'pendiente', pagado_at = NULL, updated_at = now(),
           estado = CASE WHEN estado = 'aceptado' THEN 'confirmado' ELSE estado END
     WHERE id = m.encargo_id AND pago_estado = 'pagado';
  END IF;
  IF p_anular THEN
    UPDATE public.caja_movimientos_portal
       SET anulado_at = now(), anulado_motivo = 'La caja no aceptó el cobro', clave_envio = NULL, reserva_id = NULL, encargo_id = NULL, updated_at = now()
     WHERE id = p_movimiento;
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.apartado_cambiar_monto(p_movimiento bigint, p_antes numeric, p_nuevo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE m public.caja_movimientos_portal%ROWTYPE; r public.app_reservas; k record; v_nuevo numeric;
BEGIN
  SELECT * INTO m FROM public.caja_movimientos_portal WHERE id = p_movimiento FOR UPDATE;
  IF NOT FOUND OR m.reserva_id IS NULL OR m.tipo_codigo IS DISTINCT FROM 'APARTADO' THEN RETURN; END IF;
  SELECT * INTO r FROM public.app_reservas WHERE id = m.reserva_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  -- A la baja sobre una reserva ajustada (2026-10-22): sale de la familia entera.
  IF p_nuevo < p_antes AND EXISTS (SELECT 1 FROM public.app_reservas x WHERE x.ajuste_de = r.id) THEN
    PERFORM public.reserva_quitar_de_familia(r.id, round(p_antes - p_nuevo, 2),
      format('Se corrigió a la baja el cobro %s que lo originó.', m.id));
    RETURN;
  END IF;
  SELECT * INTO k FROM public.reserva_cuenta(r.id);
  -- La caja ya se corrigió: acá no se frena, sólo se acompaña.
  v_nuevo := greatest(round(coalesce(r.anticipo, 0) + (p_nuevo - p_antes), 2), 0);
  UPDATE public.app_reservas
     SET anticipo = v_nuevo,
         pago_estado = CASE WHEN pago_estado = 'pagado' AND pago_metodo = 'en_linea' THEN pago_estado
                            WHEN v_nuevo > 0 AND v_nuevo >= k.total - 0.004 THEN 'pagado'
                            WHEN v_nuevo > 0 THEN 'anticipo'
                            ELSE coalesce(nullif(m.apartado_previo->>'pago_estado', 'anticipo'), 'pendiente') END,
         updated_at = now()
   WHERE id = r.id;
END $function$;
