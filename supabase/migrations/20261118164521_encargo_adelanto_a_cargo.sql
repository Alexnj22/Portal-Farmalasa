-- Encargo con adelanto o sin anticipo, a cargo de quien lo cobra (2026-11-18).
--
-- Pedido del usuario, con un encargo de $210 donde el cliente quería dejar
-- $100: «hagamos como hicimos con el otro, que queda responsable la persona
-- que lo reserva». Es el mismo trato que la reserva sin anticipo
-- (20261105181147): quien lo deja pasar sin el 100 % queda firmado.
--
-- · Adelanto en caja: de $0.01 al total. Si no es el total, el encargo queda
--   `pago_estado = 'anticipo'`, `abonado` = lo cobrado, y `responsable_id` =
--   quien registró el cobro. Pasa a ACEPTADO igual: Compras lo pide.
-- · Sin anticipo: `encargo_sin_anticipo` lo acepta sin cobro, firmado por la
--   sesión (`auth_employee_id()`, nunca un parámetro).
-- · El resto se cobra al retirar: `apartado_para_retirar` devuelve lo abonado
--   como pagado y el diálogo de retiro ya sabe cobrar un saldo.
-- · El enlace de pago sigue siendo por el total: el pago en línea marca el
--   encargo como pagado entero (`app_reserva_pago_confirmar`).
-- · Se parte de las definiciones VIVAS y se reemplazan piezas; si una no se
--   encuentra, la migración falla entera.
SET lock_timeout = '5s';

ALTER TABLE public.app_encargos
  ADD COLUMN IF NOT EXISTS abonado numeric,
  ADD COLUMN IF NOT EXISTS responsable_id uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS responsable_at timestamptz;
COMMENT ON COLUMN public.app_encargos.abonado IS
  'Lo cobrado por el portal antes de retirar (2026-11-18). Con pago_estado = anticipo es menos que el total.';
COMMENT ON COLUMN public.app_encargos.responsable_id IS
  'Encargo aceptado sin el 100 %: la persona del personal que lo dejó pasar y responde por él (2026-11-18).';
CREATE INDEX IF NOT EXISTS app_encargos_responsable_idx
  ON public.app_encargos (responsable_id) WHERE responsable_id IS NOT NULL;

ALTER TABLE public.app_encargos DROP CONSTRAINT IF EXISTS app_encargos_pago_estado_check;
ALTER TABLE public.app_encargos ADD CONSTRAINT app_encargos_pago_estado_check
  CHECK (pago_estado = ANY (ARRAY['pendiente'::text, 'anticipo'::text, 'pagado'::text, 'devuelto'::text]));

-- Reemplaza `a` por `b` en la definición viva de `f`; falla si `a` no está.
CREATE OR REPLACE FUNCTION pg_temp.parchar(f regprocedure, pares text[])
RETURNS void LANGUAGE plpgsql AS $p$
DECLARE d text := pg_get_functiondef(f); i int;
BEGIN
  FOR i IN 1 .. array_length(pares, 1) / 2 LOOP
    IF position(pares[2 * i - 1] IN d) = 0 THEN
      RAISE EXCEPTION '%: no se encontró la pieza %', f, i;
    END IF;
    d := replace(d, pares[2 * i - 1], pares[2 * i]);
  END LOOP;
  EXECUTE d;
END $p$;

-- 1 · Cotizar: el encargo admite un adelanto desde $0.01.
SELECT pg_temp.parchar('public.apartado_cotizar(bigint,jsonb)', ARRAY[
$a$    -- El encargo se paga completo: lo que no tenemos se pide para esa persona.
    RETURN json_build_object('tipo', 'encargo', 'total', round(e.anticipo, 2), 'minimo', round(e.anticipo, 2),$a$,
$b$    -- Desde el 2026-11-18 admite un adelanto: lo que falte queda a cargo de
    -- quien lo cobra (`apartado_aplicar`) y se cobra al retirar.
    RETURN json_build_object('tipo', 'encargo', 'total', round(e.anticipo, 2), 'minimo', 0.01,$b$]);

-- 2 · Aplicar el cobro: parcial → anticipo y responsable.
SELECT pg_temp.parchar('public.apartado_aplicar(bigint,jsonb,bigint,numeric,text,uuid)', ARRAY[
$a$    UPDATE public.app_encargos SET pago_estado = 'pagado', pagado_at = now(), estado = 'aceptado', updated_at = now()
     WHERE id = v_id AND estado = 'confirmado' AND pago_estado = 'pendiente';$a$,
$b$    -- Un adelanto (2026-11-18) queda a cargo de quien lo cobra, como la reserva sin anticipo.
    IF round(p_monto, 2) < v_total - 0.004 AND p_employee IS NULL THEN
      RAISE EXCEPTION 'Un adelanto queda a cargo de quien lo cobra, y no se sabe quién cobra.';
    END IF;
    UPDATE public.app_encargos
       SET pago_estado = CASE WHEN round(p_monto, 2) < v_total - 0.004 THEN 'anticipo' ELSE 'pagado' END,
           abonado = round(p_monto, 2), pagado_at = now(), estado = 'aceptado', updated_at = now(),
           responsable_id = CASE WHEN round(p_monto, 2) < v_total - 0.004 THEN p_employee END,
           responsable_at = CASE WHEN round(p_monto, 2) < v_total - 0.004 THEN now() END
     WHERE id = v_id AND estado = 'confirmado' AND pago_estado = 'pendiente';$b$,
$a$      'total', v_total, 'anticipo', v_total, 'saldo', 0);$a$,
$b$      'total', v_total, 'anticipo', round(p_monto, 2), 'saldo', round(greatest(v_total - p_monto, 0), 2));$b$]);

-- 3 · Deshacer el cobro: también el adelanto, y se va el responsable.
SELECT pg_temp.parchar('public.apartado_deshacer(bigint,boolean)', ARRAY[
$a$       SET pago_estado = 'pendiente', pagado_at = NULL, updated_at = now(),
           estado = CASE WHEN estado = 'aceptado' THEN 'confirmado' ELSE estado END
     WHERE id = m.encargo_id AND pago_estado = 'pagado';$a$,
$b$       SET pago_estado = 'pendiente', pagado_at = NULL, updated_at = now(),
           abonado = NULL, responsable_id = NULL, responsable_at = NULL,
           estado = CASE WHEN estado = 'aceptado' THEN 'confirmado' ELSE estado END
     WHERE id = m.encargo_id AND pago_estado IN ('pagado', 'anticipo');$b$]);

-- 4 · Retirar: lo pagado de un adelanto es lo abonado.
SELECT pg_temp.parchar('public.apartado_para_retirar(bigint,jsonb)', ARRAY[
$a$    v_pagado := CASE WHEN e.pago_estado = 'pagado' THEN v_total ELSE 0 END;$a$,
$b$    v_pagado := CASE WHEN e.pago_estado = 'pagado' THEN v_total
                     WHEN e.pago_estado = 'anticipo' THEN least(coalesce(e.abonado, 0), v_total) ELSE 0 END;$b$]);

-- 5 · Entregado al retirar: queda pagado, como la reserva.
SELECT pg_temp.parchar('public.apartado_marcar_entregado(jsonb,uuid)', ARRAY[
$a$    UPDATE public.app_encargos SET estado = 'entregado', cerrado_at = now(), updated_at = now()
     WHERE id = (p_apartado->>'encargo_id')::bigint AND estado = 'listo'$a$,
$b$    UPDATE public.app_encargos SET estado = 'entregado', cerrado_at = now(), updated_at = now(),
           pago_estado = CASE WHEN pago_estado IN ('pendiente', 'anticipo') THEN 'pagado' ELSE pago_estado END,
           pagado_at = coalesce(pagado_at, now())
     WHERE id = (p_apartado->>'encargo_id')::bigint AND estado = 'listo'$b$]);

-- 6 · «Entregar» a secas no sirve con un adelanto: falta cobrar el resto.
SELECT pg_temp.parchar('public.encargo_responder(bigint,text,numeric,date,text)', ARRAY[
$a$    IF e.pago_estado = 'pagado' AND NOT EXISTS$a$,
$b$    IF e.pago_estado = 'anticipo' THEN
      RAISE EXCEPTION 'Este encargo tiene un adelanto: usa «Retirar» para cobrar lo que falta.' USING ERRCODE = 'P0001';
    END IF;
    IF e.pago_estado = 'pagado' AND NOT EXISTS$b$]);

-- 7 · Un pago en línea sólo por el total (el enlace marca el encargo pagado entero).
SELECT pg_temp.parchar('public.apartado_enlace_preparar(bigint,jsonb,numeric,uuid)', ARRAY[
$a$  IF v_modo = 'pedido' THEN
    RAISE EXCEPTION 'Un pedido de varios productos se cobra en caja$a$,
$b$  IF v_modo = 'encargo' AND abs(v_monto - (v_cot->>'total')::numeric) > 0.004 THEN
    RAISE EXCEPTION 'Por enlace, un encargo se paga completo. Un adelanto se cobra en caja.';
  END IF;

  IF v_modo = 'pedido' THEN
    RAISE EXCEPTION 'Un pedido de varios productos se cobra en caja$b$]);

-- 8 · A saldo a favor / el proveedor no entregó: con un adelanto, el monto es lo abonado.
SELECT pg_temp.parchar('public.encargo_pasar_a_saldo(bigint,text)', ARRAY[
$a$  IF e.estado NOT IN ('aceptado', 'pedido', 'listo') OR e.pago_estado <> 'pagado' THEN$a$,
$b$  -- Un adelanto (2026-11-18): lo que pasa a favor es lo abonado, no el total.
  IF e.pago_estado = 'anticipo' THEN e.anticipo := coalesce(e.abonado, 0); END IF;
  IF e.estado NOT IN ('aceptado', 'pedido', 'listo') OR e.pago_estado NOT IN ('pagado', 'anticipo') THEN$b$]);

SELECT pg_temp.parchar('public.encargo_proveedor_no_entrego(bigint,text,text)', ARRAY[
$a$  IF e.estado NOT IN ('aceptado', 'pedido') OR e.pago_estado <> 'pagado' THEN$a$,
$b$  -- Un adelanto (2026-11-18): se devuelve o queda a favor lo abonado, no el total.
  IF e.pago_estado = 'anticipo' THEN e.anticipo := coalesce(e.abonado, 0); END IF;
  IF e.estado NOT IN ('aceptado', 'pedido') OR e.pago_estado NOT IN ('pagado', 'anticipo') THEN$b$]);

-- 9 · Cancelar sin pago: también el aceptado sin anticipo, que tiene responsable.
SELECT pg_temp.parchar('public.encargo_cancelar_sin_pago(bigint,text)', ARRAY[
$a$  IF e.estado NOT IN ('solicitado', 'confirmado') THEN$a$,
$b$  IF e.estado NOT IN ('solicitado', 'confirmado')
     AND NOT (e.estado IN ('aceptado', 'pedido', 'listo') AND e.pago_estado = 'pendiente' AND e.responsable_id IS NOT NULL) THEN$b$,
$a$  IF e.pago_estado = 'pagado' THEN$a$,
$b$  IF e.pago_estado IN ('pagado', 'anticipo') THEN$b$,
$a$jsonb_build_object('antes', e.estado, 'motivo', v_motivo, 'por_cobrar', e.anticipo)$a$,
$b$jsonb_build_object('antes', e.estado, 'motivo', v_motivo, 'por_cobrar', e.anticipo, 'responsable', e.responsable_id)$b$]);

-- 10 · «Ya se vendió» no aplica a un encargo con adelanto.
SELECT pg_temp.parchar('public.encargo_ya_vendido(bigint,bigint,text)', ARRAY[
$a$  IF e.pago_estado = 'pagado' THEN$a$,
$b$  IF e.pago_estado IN ('pagado', 'anticipo') THEN$b$]);
SELECT pg_temp.parchar('public.encargos_ventas_candidatas(bigint[])', ARRAY[
$a$e.pago_estado <> 'pagado'$a$,
$b$e.pago_estado NOT IN ('pagado', 'anticipo')$b$]);

-- 11 · La lista trae lo abonado y quién responde; el paso «cobrado» cuenta el adelanto.
SELECT pg_temp.parchar('public.encargos_de_sucursal(bigint,boolean)', ARRAY[
$a$      'retirar_hasta', public.encargo_retirar_hasta(e),$a$,
$b$      'retirar_hasta', public.encargo_retirar_hasta(e),
      'abonado', e.abonado,
      'responsable', CASE WHEN e.responsable_id IS NOT NULL THEN (SELECT jsonb_build_object('id', er.id, 'name', er.name,
        'first_names', er.first_names, 'last_names', er.last_names, 'at', e.responsable_at) FROM public.employees er WHERE er.id = e.responsable_id) END,$b$,
$a$      'puede_no_entrego', v_v2 AND e.estado IN ('aceptado', 'pedido') AND e.pago_estado = 'pagado'$a$,
$b$      'puede_no_entrego', v_v2 AND e.estado IN ('aceptado', 'pedido') AND e.pago_estado IN ('pagado', 'anticipo')$b$,
$a$                     WHERE e.pago_estado = 'pagado' AND e.reserva_id IS NULL$a$,
$b$                     WHERE e.pago_estado IN ('pagado', 'anticipo') AND e.reserva_id IS NULL$b$]);

-- 12 · Aceptar sin anticipo, a cargo de quien lo acepta.
CREATE OR REPLACE FUNCTION public.encargo_sin_anticipo(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  e public.app_encargos; v_emp uuid := public.auth_employee_id();
BEGIN
  SELECT * INTO e FROM public.app_encargos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
  IF v_emp IS NULL OR NOT public.encargo_puede_manejar(e.branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF e.reserva_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ese encargo es el resto de la reserva R-%: se resuelve desde la reserva.', lpad(e.reserva_id::text, 6, '0');
  END IF;
  IF e.estado <> 'confirmado' OR e.pago_estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Sólo un encargo con el precio confirmado y sin pagar.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.caja_movimientos_portal m WHERE m.encargo_id = e.id AND m.anulado_at IS NULL) THEN
    RAISE EXCEPTION 'Ese encargo tiene un cobro en caja.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_reservas_pagos pg WHERE pg.encargo_id = e.id
               AND (pg.pagado_at IS NOT NULL OR pg.created_at > now() - interval '2 hours')) THEN
    RAISE EXCEPTION 'El cliente tiene un pago en línea en curso para ese encargo: espera a que se resuelva.';
  END IF;

  UPDATE public.app_encargos
     SET estado = 'aceptado', responsable_id = v_emp, responsable_at = now(), updated_at = now()
   WHERE id = p_id;

  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (e.customer_id, 'encargo', 'base:encargo_sin_anticipo:' || p_id, 'Confirmamos tu encargo',
          'Vamos a pedir ' || coalesce(e.producto_nombre, 'tu producto') || '. Lo pagas ('
            || to_char(e.anticipo, 'FM$999,990.00') || ') al retirarlo en la sucursal.',
          '/reservas')
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;

  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'ENCARGO_SIN_ANTICIPO', p_id::text,
          jsonb_build_object('total', e.anticipo, 'responsable', v_emp), e.branch_id, 'ADMIN_PANEL');

  RETURN json_build_object('ok', true, 'id', p_id, 'codigo', 'E-' || lpad(p_id::text, 6, '0'));
END $function$;

REVOKE EXECUTE ON FUNCTION public.encargo_sin_anticipo(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargo_sin_anticipo(bigint) TO authenticated, service_role;
