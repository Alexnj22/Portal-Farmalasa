-- Finalizar un conteo y guardar un producto se ordenan sobre la fila del conteo.
--
-- Antes ninguno de los dos tomaba la fila con candado:
--   * dos «Finalizar» a la vez (doble toque, dos personas) pasaban los dos la
--     revisión de estado y escribían dos veces el cierre «no ubicado» en el
--     historial de cada pendiente;
--   * un producto guardado mientras otro finalizaba podía entrar DESPUÉS de
--     que el cierre calculara los totales: el conteo quedaba FINALIZADO con un
--     producto cambiado que los totales no ven.
--
-- Ahora finalizar toma la fila FOR UPDATE y guardar la toma FOR KEY SHARE.
-- KEY SHARE no choca entre dos guardados (contar en paralelo sigue igual) ni
-- con un UPDATE común del conteo, pero sí con el FOR UPDATE de finalizar: el
-- guardado espera, relee el estado y ve FINALIZADO → CONTEO_CERRADO_NO_EDITABLE.
--
-- Se parte de la definición VIVA de cada función y se cambia una sola línea;
-- si la línea no está tal cual, la migración falla en vez de reescribir a ciegas.
SET lock_timeout = '5s';

DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.finalizar_conteo_inventario(uuid,boolean)'::regprocedure);
  v_new := replace(v_def,
    $q$FROM public.conteos_inventario WHERE id = p_conteo_id AND status IN ('BORRADOR','EN_PROGRESO');$q$,
    $q$FROM public.conteos_inventario WHERE id = p_conteo_id AND status IN ('BORRADOR','EN_PROGRESO') FOR UPDATE;$q$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'finalizar_conteo_inventario: no está la lectura del conteo a bloquear';
  END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.guardar_conteo_item(uuid,integer,text,text)'::regprocedure);
  v_new := replace(v_def,
    $q$SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = v_item.conteo_id;$q$,
    $q$SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = v_item.conteo_id FOR KEY SHARE;$q$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'guardar_conteo_item: no está la lectura del conteo a bloquear';
  END IF;
  EXECUTE v_new;
END
$mig$;
