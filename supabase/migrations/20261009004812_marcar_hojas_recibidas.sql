-- 05 · marcar_hojas_recibidas: agregar hojas sin pisar las de otro (2026-10-08).
--
-- Hasta hoy el navegador (`marcarHojasRecibidas` en src/data/recepcion.js, que
-- usan RecepcionModal y la app del teléfono) leía `hojas_recibidas`, le sumaba
-- la hoja recién contada y ESCRIBÍA EL ARREGLO ENTERO. Dos personas contando
-- hojas distintas de la misma sala —el portal y el teléfono, o dos teléfonos—
-- se pisaban: gana la última escritura y la hoja del otro desaparece de la
-- lista sin error. La hoja se vuelve a ofrecer como pendiente y alguien la
-- cuenta dos veces.
--
-- Ahora la suma la hace la base, sobre la fila BLOQUEADA (`FOR UPDATE`): cada
-- llamada agrega las suyas a lo que haya en ese momento, sin duplicados y
-- conservando el orden (primero las que ya estaban, después las nuevas en el
-- orden en que llegaron).
--
-- Contrato: `p_hojas` son las hojas QUE SE AGREGAN, no la lista completa.
-- Devuelve el arreglo final (jsonb, mismo tipo que la columna: arreglo de
-- números — medido el 2026-10-08: 226 filas, todas arreglo, ningún elemento
-- que no sea número).
--
-- SECURITY DEFINER con el mismo alcance que la policy `pss_update` y que la
-- recepción (`update_pedido_sucursal_lifecycle`): la sala propia, o alcance de
-- red. DEFINER y no INVOKER porque el borrador 03 cierra el UPDATE directo de
-- `hojas_recibidas` para `authenticated`.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.marcar_hojas_recibidas(
  p_pedido_id   uuid,
  p_sucursal_id integer,
  p_hojas       integer[]
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor  uuid := auth_employee_id();
  v_actual jsonb;
  v_final  jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos']))
     AND p_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: sólo puedes recibir el pedido de tu sucursal';
  END IF;

  SELECT hojas_recibidas INTO v_actual
    FROM public.pedido_sucursal_status
   WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: esa sucursal no tiene ese pedido';
  END IF;
  v_actual := CASE WHEN jsonb_typeof(v_actual) = 'array' THEN v_actual ELSE '[]'::jsonb END;

  SELECT v_actual || coalesce(jsonb_agg(to_jsonb(n.h) ORDER BY n.o), '[]'::jsonb)
    INTO v_final
    FROM (SELECT u.h, min(u.o) AS o
            FROM unnest(coalesce(p_hojas, '{}'::integer[])) WITH ORDINALITY AS u(h, o)
           WHERE u.h IS NOT NULL
             AND NOT v_actual @> jsonb_build_array(u.h)
           GROUP BY u.h) n;

  IF v_final IS DISTINCT FROM v_actual THEN
    UPDATE public.pedido_sucursal_status
       SET hojas_recibidas = v_final
     WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;
  END IF;

  RETURN v_final;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.marcar_hojas_recibidas(uuid, integer, integer[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marcar_hojas_recibidas(uuid, integer, integer[]) TO authenticated, service_role;
