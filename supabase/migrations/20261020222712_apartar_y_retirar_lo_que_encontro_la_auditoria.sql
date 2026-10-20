SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Apartar y retirar: lo que encontró la auditoría (2026-10-20).
--   1. Completar una reserva con OTRA forma de pago fallaba siempre: se
--      escribía `pago_metodo = 'mixto'` y el CHECK de `app_reservas` no lo
--      acepta. Queda la forma del primer cobro; el detalle de cada cobro vive
--      en `caja_movimientos_portal.forma_pago`.
--   2. Dos cobros a la vez podían pagar dos veces un encargo, o pasar el
--      anticipo de una reserva por encima del total: el UPDATE no miraba el
--      estado. Ahora lo mira bajo el candado de la fila, y si ya no vale, el
--      cobro se rechaza y el movimiento se anula sin tocar la caja.
--   3. Un encargo de más de 20 unidades reventaba con un CHECK crudo: el
--      tope de `app_encargos` es 20 y la función decía 999.
--   4. Anular el cobro de un encargo que ya iba en «pedido» o «llegó» lo
--      dejaba pagado sin dinero: ahora vuelve a «sin pagar» en cualquier
--      estado (y sólo a «confirmado» si todavía no se había pedido).
--   0. `apartado_entregar` dejaba ENTREGAR lo pagado sin aplicar el anticipo:
--      `v->'aplicado'` de un `null` de JSON no es NULL de SQL, así que la
--      guarda nunca disparaba. Se compara con `->>`, que sí da NULL.
--   5. Un anticipo que la caja rechazó quedaba con su `clave_envio`: el
--      reintento del mismo envío contestaba con ese intento muerto. Al
--      anularlo se suelta la clave.
-- ═══════════════════════════════════════════════════════════════════════════
DO $do$
DECLARE v text; v2 text;
BEGIN
  v := pg_get_functiondef('public.apartado_aplicar(bigint, jsonb, bigint, numeric, text, uuid)'::regprocedure);
  v2 := replace(v, $a$pago_metodo = CASE WHEN pago_metodo IS NULL OR pago_metodo = v_metodo THEN v_metodo ELSE 'mixto' END,$a$,
                   $b$pago_metodo = coalesce(pago_metodo, v_metodo),$b$);
  v2 := replace(v2, $a$           pagado_at = now(), updated_at = now()
     WHERE id = v_id
    RETURNING anticipo, vence_at INTO v_anticipo, v_vence;$a$,
                    $b$           pagado_at = now(), updated_at = now()
     WHERE id = v_id AND estado IN ('pendiente', 'lista')
       AND round(coalesce(anticipo, 0) + p_monto, 2) <= v_total + 0.004
    RETURNING anticipo, vence_at INTO v_anticipo, v_vence;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva ya cambió: vuelve a abrirla.'; END IF;$b$);
  v2 := replace(v2, $a$    UPDATE public.app_encargos SET pago_estado = 'pagado', pagado_at = now(), estado = 'aceptado', updated_at = now()
     WHERE id = v_id;$a$,
                    $b$    UPDATE public.app_encargos SET pago_estado = 'pagado', pagado_at = now(), estado = 'aceptado', updated_at = now()
     WHERE id = v_id AND estado = 'confirmado' AND pago_estado = 'pendiente';
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo ya está pagado.'; END IF;$b$);
  IF position('''mixto''' in v2) > 0 OR position('Esa reserva ya cambió' in v2) = 0 OR position('Ese encargo ya está pagado' in v2) = 0 THEN
    RAISE EXCEPTION 'apartado_aplicar: no se encontró lo que había que cambiar';
  END IF;
  EXECUTE v2;

  v := pg_get_functiondef('public.encargo_en_sucursal_crear(bigint, bigint, bigint, text, integer, integer, text)'::regprocedure);
  v2 := replace(v, $a$p_cantidad > 999 THEN RAISE EXCEPTION 'La cantidad va de 1 a 999.'$a$,
                   $b$p_cantidad > 20 THEN RAISE EXCEPTION 'Un encargo va de 1 a 20 unidades.'$b$);
  IF v2 = v THEN RAISE EXCEPTION 'encargo_en_sucursal_crear: no se encontró el tope'; END IF;
  EXECUTE v2;

  v := pg_get_functiondef('public.apartado_deshacer(bigint, boolean)'::regprocedure);
  v2 := replace(v, $a$    UPDATE public.app_encargos SET pago_estado = 'pendiente', pagado_at = NULL, estado = 'confirmado', updated_at = now()
     WHERE id = m.encargo_id AND estado = 'aceptado';$a$,
                   $b$    UPDATE public.app_encargos
       SET pago_estado = 'pendiente', pagado_at = NULL, updated_at = now(),
           estado = CASE WHEN estado = 'aceptado' THEN 'confirmado' ELSE estado END
     WHERE id = m.encargo_id AND pago_estado = 'pagado';$b$);
  v2 := replace(v2, $a$anulado_motivo = 'La caja no aceptó el cobro', reserva_id = NULL,$a$,
                    $b$anulado_motivo = 'La caja no aceptó el cobro', clave_envio = NULL, reserva_id = NULL,$b$);
  IF v2 = v OR position('clave_envio = NULL' in v2) = 0 OR position('ELSE estado END' in v2) = 0 THEN
    RAISE EXCEPTION 'apartado_deshacer: no se encontró el encargo o la anulación';
  END IF;
  EXECUTE v2;

  v := pg_get_functiondef('public.apartado_entregar(bigint, jsonb)'::regprocedure);
  v2 := replace(v, $a$(v->'aplicado') IS NULL$a$, $b$(v->>'aplicado') IS NULL$b$);
  IF v2 = v THEN RAISE EXCEPTION 'apartado_entregar: no se encontró la guarda'; END IF;
  EXECUTE v2;
END $do$;
