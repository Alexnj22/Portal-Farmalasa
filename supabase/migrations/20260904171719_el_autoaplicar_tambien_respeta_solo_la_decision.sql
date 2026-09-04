SET lock_timeout = '5s';

-- El auto-aplicar de `calculate_stock_params` tenía el MISMO freno que el
-- barrido de publicar (`manual_at IS NULL`) y le toca el mismo cambio: lo que
-- protege un número no es que alguien lo haya tecleado, es que alguien lo haya
-- DECIDIDO — una solicitud aprobada, o un motivo declarado.
--
-- Se hace por reemplazo de texto sobre la definición viva y no reescribiendo la
-- función entera (400 líneas de cálculo que no cambian) para que el cambio sea
-- exactamente el que dice ser: una cláusula, sin margen para que se cuele una
-- diferencia al transcribir el resto.
--
-- Y falla FUERTE si el texto no está: un reemplazo que no encuentra su patrón
-- devuelve la cadena intacta, o sea que la migración diría «éxito» sin cambiar
-- nada. Es la peor forma de fallar que tiene una migración.
DO $migracion$
DECLARE
  v_def   text;
  v_nuevo text;
  v_viejo CONSTANT text := '      AND psp.manual_at IS NULL';
  v_reemplazo CONSTANT text :=
    '      -- Frena la DECISIÓN, no la edición: una solicitud aprobada' || E'\n' ||
    '      -- (`ajuste_solicitud_id`) o un motivo declarado. Corregir un borrador' || E'\n' ||
    '      -- durante la revisión del mes es trabajo de ese ciclo y no congela la' || E'\n' ||
    '      -- fila contra el cálculo siguiente.' || E'\n' ||
    '      AND psp.ajuste_solicitud_id IS NULL' || E'\n' ||
    '      AND psp.manual_motivo IS NULL';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'calculate_stock_params';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'calculate_stock_params no existe';
  END IF;

  IF position(v_viejo IN v_def) = 0 THEN
    RAISE EXCEPTION 'No se encontró la cláusula del freno en calculate_stock_params — la función cambió y este reemplazo ya no aplica';
  END IF;

  v_nuevo := replace(v_def, v_viejo, v_reemplazo);
  EXECUTE v_nuevo;
END;
$migracion$;
