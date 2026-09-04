SET lock_timeout = '5s';

-- Publicar DEVUELVE la fila al cálculo: le limpia la marca de «lo puso una
-- persona», porque a partir de ese UPDATE el número vigente ES el calculado.
--
-- Sin esto `manual_at` sólo crece y nunca baja. Medido el 2026-09-04: de 1,141
-- filas que decían «a mano», **926 se habían publicado encima** — el valor era
-- el del cálculo y la fila seguía firmada por alguien. En Salud 2 eran 180 de
-- 216, y es lo que hacía que la pantalla mostrara EN CONFLICTO en casi todas
-- las filas: ese badge se dispara con `manual_at` + un borrador distinto, o sea
-- con cualquier fila que alguien tocó alguna vez y que el cálculo vuelve a
-- proponer. Un indicador que marca casi todo no indica nada.
--
-- `manual_motivo` es la excepción y NO se limpia: es una declaración sobre el
-- PRODUCTO, no sobre el número, y el cálculo la usa. «Ya no rota» además usa
-- `manual_at` como FECHA DE CORTE del historial de ventas — borrarla dejándole
-- el motivo haría desaparecer el corte sin que nadie lo note.
--
-- El sello de la solicitud sí se limpia siempre: si esta publicación pisó un par
-- aprobado —sólo puede pasar por publicación DIRIGIDA, que es deliberada— el par
-- vigente ya no es el que se aprobó.
--
-- Por reemplazo de texto sobre la definición viva, con guarda que FALLA si el
-- patrón no está: un `replace` que no encuentra su patrón devuelve la cadena
-- intacta y la migración diría «éxito» sin cambiar nada.
DO $migracion$
DECLARE
  v_def text;
  v_viejo CONSTANT text :=
    '      draft_status             = ''none'',' || E'\n' ||
    '      published_at             = v_now,';
  v_nuevo CONSTANT text :=
    '      draft_status             = ''none'',' || E'\n' ||
    '      -- El número pasa a ser el calculado, así que la firma de la persona' || E'\n' ||
    '      -- deja de describirlo. `manual_motivo` sobrevive: es una declaración' || E'\n' ||
    '      -- sobre el producto, y «ya no rota» depende de `manual_at` como corte.' || E'\n' ||
    '      manual_at                = CASE WHEN psp.manual_motivo IS NULL THEN NULL ELSE psp.manual_at   END,' || E'\n' ||
    '      manual_por               = CASE WHEN psp.manual_motivo IS NULL THEN NULL ELSE psp.manual_por  END,' || E'\n' ||
    '      manual_nota              = CASE WHEN psp.manual_motivo IS NULL THEN NULL ELSE psp.manual_nota END,' || E'\n' ||
    '      ajuste_solicitud_id      = NULL,' || E'\n' ||
    '      published_at             = v_now,';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'publish_stock_params';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'publish_stock_params no existe';
  END IF;
  IF position(v_viejo IN v_def) = 0 THEN
    RAISE EXCEPTION 'No se encontró el SET de publish_stock_params — la función cambió y este reemplazo ya no aplica';
  END IF;

  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$migracion$;

-- Lo mismo en el auto-aplicar, que escribe min_units/max_units sin pasar por
-- publish_stock_params. Ahí no hace falta el CASE: desde la migración anterior
-- sólo toca filas sin sello y sin motivo.
DO $migracion$
DECLARE
  v_def text;
  v_viejo CONSTANT text :=
    '      draft_status             = ''none'',' || E'\n' ||
    '      published_at             = v_now,' || E'\n' ||
    '      published_by             = ''auto'',';
  v_nuevo CONSTANT text :=
    '      draft_status             = ''none'',' || E'\n' ||
    '      -- Igual que al publicar: el número pasa a ser el calculado. Acá sin' || E'\n' ||
    '      -- CASE porque el auto-aplicar sólo alcanza filas sin sello ni motivo.' || E'\n' ||
    '      manual_at                = NULL,' || E'\n' ||
    '      manual_por               = NULL,' || E'\n' ||
    '      manual_nota              = NULL,' || E'\n' ||
    '      published_at             = v_now,' || E'\n' ||
    '      published_by             = ''auto'',';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'calculate_stock_params';

  IF position(v_viejo IN v_def) = 0 THEN
    RAISE EXCEPTION 'No se encontró el SET del auto-aplicar en calculate_stock_params';
  END IF;

  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$migracion$;

-- Y las 926 que ya arrastraban la firma vieja. `published_at > manual_at`
-- significa que se publicó DESPUÉS del ajuste, o sea que el valor de hoy es el
-- calculado. Se excluye Bodega: ahí `manual_at` es la protección real contra
-- trg_bodega_draft_sync, que reescribe la fila con la suma de las salas.
UPDATE public.product_stock_params
SET manual_at = NULL, manual_por = NULL, manual_nota = NULL
WHERE erp_sucursal_id <> 6
  AND manual_at IS NOT NULL
  AND published_at IS NOT NULL
  AND published_at > manual_at
  AND ajuste_solicitud_id IS NULL
  AND manual_motivo IS NULL;
