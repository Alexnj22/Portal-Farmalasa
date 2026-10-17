SET lock_timeout = '5s';

-- Inyecciones sin ficha → que salgan en la app del cliente (2026-10-17).
--
-- Desde el 7-oct el cobro de una inyección TRAÍDA puede elegir la ficha del
-- cliente (`BuscarFicha` en DialogoAplicacion), pero es opcional — «si no
-- tiene, se cobra igual» — y no había forma de ponérsela DESPUÉS. Medido hoy:
-- 28 traídas y 3 compradas sin ficha, que la app (`app_cliente_inyecciones`
-- filtra por `customer_id`) no puede mostrar a nadie.
--
-- Dos piezas:
--   1. La bitácora dice cuáles no tienen ficha (`sin_ficha`). Se parte de la
--      definición VIVA y se le agrega sólo esa columna: la función se rehízo
--      esta misma mañana en otra sesión y copiar un archivo la pisaría.
--   2. `inyeccion_asignar_ficha` se la pone. Nunca se adivina por nombre (el
--      cliente se liga por su ficha, ver CLAUDE.md): la elige una persona en
--      el portal, igual que al cobrar.

DO $do$
DECLARE
  v_firma regprocedure := 'public.inyecciones_bitacora_buscar(integer, date, date, jsonb, text, integer, integer)'::regprocedure;
  v_def   text := pg_get_functiondef(v_firma);
  v_viejo text := '(a.vinculada_por IS NOT NULL) AS asignada_a_mano,';
BEGIN
  IF position('AS sin_ficha' IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_viejo IN v_def) = 0 THEN
    RAISE EXCEPTION 'inyecciones_bitacora_buscar cambió: no se encontró «%»', v_viejo;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_viejo || ' (a.customer_id IS NULL) AS sin_ficha,');
END
$do$;

-- Asigna la ficha a una aplicación y a lo que fue en el MISMO cobro sin ficha
-- (un cobro es un cliente: tres aplicaciones pagadas juntas son de la misma
-- persona), mezclas incluidas. No toca las que ya tienen ficha: cambiarle el
-- dueño a una es otra decisión, y se haría desde su cobro.
-- Mismo guardián que asignar un cobro a su venta (`inyeccion_vincular_cobro`).
CREATE OR REPLACE FUNCTION public.inyeccion_asignar_ficha(p_aplicacion_id bigint, p_customer_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cobro   bigint;
  v_nombre  text;
  v_n       integer;
BEGIN
  IF NOT (SELECT auth_has_module_permission('inyecciones_dosis', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT name INTO v_nombre FROM customers WHERE id = p_customer_id;
  IF v_nombre IS NULL THEN RAISE EXCEPTION 'Esa ficha no existe.'; END IF;
  SELECT cobro_id INTO v_cobro FROM inyeccion_aplicaciones
   WHERE id = p_aplicacion_id AND customer_id IS NULL AND confirmada;
  IF v_cobro IS NULL THEN RAISE EXCEPTION 'Esa aplicación ya tiene cliente o no existe.'; END IF;

  -- `cliente` también: es el texto que muestra la bitácora, y con la ficha
  -- puesta el nombre bueno es el de la ficha.
  UPDATE inyeccion_aplicaciones
     SET customer_id = p_customer_id, cliente = v_nombre
   WHERE cobro_id = v_cobro AND customer_id IS NULL AND confirmada;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.inyeccion_asignar_ficha(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_asignar_ficha(bigint, bigint) TO authenticated, service_role;
