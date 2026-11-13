-- `ruta_bolsas(ruta)` devuelve también `recibio_firma_at`, para que la app
-- muestre «Entregado · firmó la sala» en el paquete suelto (2026-11-13).
-- Parte de la definición VIVA y sólo agrega la clave; si la frase no está,
-- avisa y no toca nada (el entorno de pruebas repite esta historia).
SET lock_timeout = '5s';
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.ruta_bolsas(uuid)'::regprocedure);
  v_a   text := '''soltada_at'', rb.soltada_at,';
  v_b   text := '''soltada_at'', rb.soltada_at, ''recibio_firma_at'', rb.recibio_firma_at,';
BEGIN
  IF position('recibio_firma_at' IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_a IN v_def) = 0 THEN
    RAISE NOTICE 'ruta_bolsas: no se encontró la frase de soltada_at'; RETURN;
  END IF;
  EXECUTE replace(v_def, v_a, v_b);
END
$mig$;
