-- «Mis tratamientos» › Agregar fallaba con «No se pudo agregar» (2026-11-14):
-- la app deja decir que un medicamento dura de 1 a 365 días (y la función lo
-- valida así), pero la tabla exigía intervalo_dias entre 7 y 120. Cualquier
-- duración fuera de ese rango violaba el CHECK, en el teléfono y en la web.
-- El rango pasa a ser el mismo que dura_cliente (1–365), y las dos funciones
-- que escriben la columna la acotan ahí: un cálculo por unidades (una compra
-- grande) no puede tumbar la detección de TODO el lote de clientes.
SET lock_timeout = '5s';

ALTER TABLE public.app_tratamientos DROP CONSTRAINT app_tratamientos_intervalo_dias_check;
ALTER TABLE public.app_tratamientos ADD CONSTRAINT app_tratamientos_intervalo_dias_check
  CHECK (intervalo_dias >= 1 AND intervalo_dias <= 365);

-- Las dos funciones se reescriben desde su definición VIVA, cambiando sólo la
-- expresión del intervalo (si no la encuentra, falla: no se reescribe a ciegas).
DO $$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.app_tratamiento_agregar(bigint,integer,numeric,integer)'::regprocedure);
  n := replace(d, 'v_nombre, greatest(v_dura, 1), v_ultima', 'v_nombre, least(greatest(v_dura, 1), 365), v_ultima');
  IF n = d THEN RAISE EXCEPTION 'app_tratamiento_agregar: no se encontró la expresión del intervalo'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.app_tratamientos_detectar(bigint[])'::regprocedure);
  n := replace(d, 'nombre, coalesce(mediana, dura), ultima', 'nombre, least(greatest(coalesce(mediana, dura), 1), 365), ultima');
  IF n = d THEN RAISE EXCEPTION 'app_tratamientos_detectar: no se encontró la expresión del intervalo'; END IF;
  EXECUTE n;
END $$;
